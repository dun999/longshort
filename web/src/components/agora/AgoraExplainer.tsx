'use client';
/*
 * /agora: one real round, step by step, through the three things a player never sets up by hand: a Mera
 * passkey account, AUSD as the only balance, and a Perpl account the arena opens for them. The flow's numbers
 * are recorded match #2 on the live arena; the calculators use the game's own constants and Perpl's live mark.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ADDR, ENTRY_TIERS, FEE_BPS, LEVERAGES, MODES, Mode, PERPL_BTC_MAINT, RAKE_BPS, TRADING_BUDGET,
  explorerAddr, explorerTx, fmtPx, payouts, readPerplPrices, shortAddr,
} from '@longshort/shared';
import { publicClient } from '@/lib/clients';
import { AgoraLogo, MeraLogo, MonadLogo, PerplLogo } from '@/components/landing/SponsorLogos';
import s from './agora.module.css';

const gh = (path: string) => `https://github.com/dun999/longshort/blob/main/${path}`;

// ─── recorded match #2 on the live arena: a passkey player at 15x, one 50% long, against a bot at 10x ───
const M2 = {
  id: 2,
  account: 803,
  claimTx: '0xe9da9763a08f9104ab25d08e52c04a1dd41af458e1e96b64de71d00e31fb2fab', // a 200 AUSD welcome claim (first arena)
  entryTx: '0xf95bd783c053083f5c9af7d0ef4f6990aeb96c7575bdd9333eb68096000032d6',
  tradeTx: '0x25140735bd614af7b2ab0248b106f9fe8fa60e422368c797f4b3c34ee15bb775',
  settleTx: '0xdbfe23af0abcea7181103e41bcdeba034bfa101ab680ca2fa0722f606b0f3ea1',
  btc: 0.0084,
  openPx: 84779.3,
  closePx: 84778.9,
  notional: 712.14612,
  openFee: 0.245691,
  closeFee: 0.24569,
  returned: 99.505259,
  prize: 9.75,
};
const ENTRY = 5;
const MOVE = (M2.openPx - M2.closePx) * M2.btc; // the long lost 0.4 per BTC on 0.0084 BTC

// ─── the flow: six steps, five layers ───
type Lane = 'you' | 'mera' | 'ausd' | 'perpl' | 'monad';
type Ledger = { wallet: number; trading?: number; pot?: number };
type Step = {
  id: string;
  name: string;
  short: string;
  when: string;
  you: React.ReactNode;
  youNote: string;
  mera: [string, string];
  ausd: Ledger;
  ausdNote: string;
  perpl: [string, string];
  monad: [string, string];
  txs: number;
  prompts: number;
  title: string;
  body: React.ReactNode;
  caveat?: string;
  hood: string[];
  proof: { label: string; href: string; internal?: boolean }[];
  code: { label: string; path: string }[];
};

const Btn = ({ tone = 'bone', children }: { tone?: 'bone' | 'ghost' | 'green' | 'red'; children: React.ReactNode }) => (
  <span className={`${s.btn} ${s[`btn_${tone}`]}`}>{children}</span>
);

const STEPS: Step[] = [
  {
    id: 'signin',
    name: 'Sign in',
    short: 'Sign in',
    when: 'once',
    you: <Btn>Create passkey account</Btn>,
    youNote: 'Face ID, Touch ID or device PIN',
    mera: ['Owner key made', 'Derived from the passkey, kept in memory'],
    ausd: { wallet: 0 },
    ausdNote: 'A new address, empty',
    perpl: ['Nothing to open', 'No Perpl sign-up, ever'],
    monad: ['No transaction', 'The address exists before it is used'],
    txs: 0,
    prompts: 1,
    title: 'Your passkey becomes your account',
    body: (
      <>
        You tap <b>Create passkey account</b> and confirm with Face ID, Touch ID or your device PIN. Mera reads a secret from the passkey and turns it into signing keys
        inside the browser. The owner key is an ordinary Monad address, and that is your account. There is no seed phrase, no extension and nothing secret saved on the
        device.
      </>
    ),
    caveat: 'Some authenticators show a second sheet the first time a passkey is created.',
    hood: ['createPasskeyWithPrfOutput()', 'HKDF "longshort/owner/v1" → owner', 'HKDF "longshort/trade-root/v1" → root', 'PRF bytes wiped after use'],
    proof: [],
    code: [
      { label: 'mera.ts', path: 'web/src/lib/mera.ts' },
      { label: 'ConnectDialog.tsx', path: 'web/src/components/ConnectDialog.tsx' },
    ],
  },
  {
    id: 'claim',
    name: 'Get AUSD',
    short: 'AUSD',
    when: 'one tap',
    you: <Btn>Claim 200 AUSD</Btn>,
    youNote: 'Testnet AUSD, one claim per wallet',
    mera: ['Owner key signs', 'The claim request, in the background'],
    ausd: { wallet: 200 },
    ausdNote: '+200 from the welcome claim',
    perpl: ['Still nothing', 'Your balance lives in your wallet'],
    monad: ['1 transfer', 'Sent and paid by the funding wallet'],
    txs: 1,
    prompts: 0,
    title: 'Start with 200 test AUSD',
    body: (
      <>
        One tap on <b>Claim 200 AUSD</b>. Your owner key signs the request without a prompt, and Longshort’s funding wallet sends an ordinary AUSD transfer. The transfer
        is saved before it is sent, so a retry or a server restart never pays twice. From here the balance shows in the header and the account menu.
      </>
    ),
    hood: ['owner-signed claim request', 'AUSD.transfer(you, 200 AUSD)', '6 decimals: 1 AUSD = 1,000,000', 'saved to SQLite before broadcast'],
    proof: [{ label: 'A recorded 200 AUSD claim', href: explorerTx(M2.claimTx) }],
    code: [
      { label: 'claims.ts', path: 'keeper/src/claims.ts' },
      { label: 'ClaimAUSDDialog.tsx', path: 'web/src/components/ClaimAUSDDialog.tsx' },
    ],
  },
  {
    id: 'enter',
    name: 'Enter a Duel',
    short: 'Enter',
    when: 'one tap',
    you: (
      <>
        <Btn tone="ghost">Duel</Btn>
        <Btn tone="ghost">5 AUSD</Btn>
        <Btn>Play</Btn>
      </>
    ),
    youNote: 'Any character, 15× leverage',
    mera: ['New match key', 'Made for this match, registered as yours'],
    ausd: { wallet: 95, trading: TRADING_BUDGET, pot: ENTRY * 2 },
    ausdNote: '−105: 5 to the pot, 100 to trade',
    perpl: [`Account #${M2.account}`, 'Opened for you with 100 AUSD'],
    monad: ['2 transactions', 'Approve 105, then join. Gas sponsored'],
    txs: 2,
    prompts: 0,
    title: 'One entry, two amounts',
    body: (
      <>
        Pick <b>Duel</b>, a 5 AUSD entry and a leverage, then <b>Play</b>. Your owner key approves exactly 105 AUSD and enters. The arena keeps 5 in the prize pot and
        creates a trading account for you, which opens a Perpl account with the other 100. A fresh match key is registered as yours for this match only. Within two
        minutes of the passkey check this needs no second prompt; a later entry asks again.
      </>
    ),
    hood: ['AUSD.approve(arena, 105)', 'PerplArena.createMatch(…, 15, matchKey)', 'clone MatchTradingAccount', `Perpl.createAccount(100) → #${M2.account}`],
    proof: [{ label: 'Entry, match #2', href: explorerTx(M2.entryTx) }],
    code: [
      { label: 'PerplArena.sol', path: 'contracts/src/PerplArena.sol' },
      { label: 'actions.ts', path: 'web/src/lib/actions.ts' },
    ],
  },
  {
    id: 'trade',
    name: 'Trade',
    short: 'Trade',
    when: 'each tap',
    you: (
      <>
        <Btn tone="green">Long</Btn>
        <Btn tone="red">Short</Btn>
        <Btn tone="ghost">Close</Btn>
      </>
    ),
    youNote: '25, 50 or 100% size',
    mera: ['Match key signs', 'Every order, no prompt all round'],
    ausd: { wallet: 95, trading: TRADING_BUDGET - M2.openFee, pot: ENTRY * 2 },
    ausdNote: `−${M2.openFee.toFixed(2)} Perpl fee on the fill`,
    perpl: [`Long ${M2.btc} BTC`, `Filled in full at ${fmtPx(M2.openPx)}`],
    monad: ['1 per order', 'Sponsored. 300 ms blocks'],
    txs: 1,
    prompts: 0,
    title: 'Each tap is a real Perpl order',
    body: (
      <>
        <b>Long</b>, <b>Short</b> and <b>Close</b> are one tap each, with no prompt. The match key signs the order in the browser, Longshort’s relayer pays the gas, and your
        address runs a small delegate contract (EIP-7702) that may only call the arena. The arena hands the order to your trading account, which places it on Perpl and
        checks that every lot filled. In match #2 a 50% long at 15× filled {M2.btc} BTC at {fmtPx(M2.openPx)}.
      </>
    ),
    hood: ['sign Execute(target, data, nonce, deadline)', 'type 0x04 tx on the first order', 'RelayDelegate → PerplArena.open', 'Perpl.execOrder · IOC · mark ±1%'],
    proof: [{ label: 'The long, match #2', href: explorerTx(M2.tradeTx) }],
    code: [
      { label: 'RelayDelegate.sol', path: 'contracts/src/RelayDelegate.sol' },
      { label: 'MatchTradingAccount.sol', path: 'contracts/src/MatchTradingAccount.sol' },
    ],
  },
  {
    id: 'bell',
    name: 'The bell',
    short: 'Bell',
    when: 'automatic',
    you: <span className={s.timer}>0:00</span>,
    youNote: 'Nothing to tap',
    mera: ['Orders closed', 'The arena refuses trades after the bell'],
    ausd: { wallet: 95, trading: M2.returned, pot: ENTRY * 2 },
    ausdNote: `−${M2.closeFee.toFixed(2)} close fee, −${MOVE.toFixed(3)} price`,
    perpl: [`Closed at ${fmtPx(M2.closePx)}`, 'Every account flattened'],
    monad: ['settle()', 'Sent by the keeper, open to anyone'],
    txs: 1,
    prompts: 0,
    title: 'The bell closes everything',
    body: (
      <>
        At 0:00 nobody taps anything. The arena closes every open position on Perpl and reads each trading account’s final balance onchain. The bigger balance wins.
        Longshort’s keeper sends this on time, but anyone can call <code>settle</code>, so a round can always finish without us.
      </>
    ),
    hood: ['PerplArena.settle(id)', 'CLOSING: reduce-only closes, retried', 'rank by final Perpl balance', 'returned when every account is flat'],
    proof: [{ label: 'Settlement, match #2', href: explorerTx(M2.settleTx) }],
    code: [{ label: 'PerplArena.sol', path: 'contracts/src/PerplArena.sol' }],
  },
  {
    id: 'paid',
    name: 'Paid out',
    short: 'Paid',
    when: 'automatic',
    you: <span className={s.victory}>Victory</span>,
    youNote: `+${M2.prize.toFixed(2)} AUSD prize`,
    mera: ['Match key retired', 'The owner key keeps the account'],
    ausd: { wallet: 95 + M2.prize + M2.returned, trading: 0, pot: 0 },
    ausdNote: `+${M2.prize.toFixed(2)} prize, +${M2.returned.toFixed(2)} back`,
    perpl: [`${M2.returned.toFixed(2)} withdrawn`, 'To you, win or lose'],
    monad: ['Same settlement', 'Pot paid, capital returned'],
    txs: 0,
    prompts: 0,
    title: 'Prize and capital come back separately',
    body: (
      <>
        The pot is both entries, 10 AUSD, minus the 2.5% rake: <b>9.75 AUSD</b> to the winner. On its own path, whatever is left in each trading account goes back to its
        owner, win or lose: <b>{M2.returned} AUSD</b> here. This player put in 105 AUSD and got {(M2.prize + M2.returned).toFixed(6)} back.
      </>
    ),
    hood: ['pot 10.00 − rake 0.25 = 9.75', `trading account → owner: ${M2.returned}`, 'round signing session ended', 'Envio indexes payout and return'],
    proof: [
      { label: 'Settlement, match #2', href: explorerTx(M2.settleTx) },
      { label: 'Match #2 report', href: `/match/${M2.id}/report`, internal: true },
    ],
    code: [{ label: 'PerplArena.sol', path: 'contracts/src/PerplArena.sol' }],
  },
];

const LANES: { id: Lane; head: React.ReactNode; sub: string }[] = [
  { id: 'you', head: <span className={s.laneWord}>On screen</span>, sub: 'what you tap' },
  { id: 'mera', head: <MeraLogo title="Mera" className={s.logoMera} />, sub: 'keys' },
  { id: 'ausd', head: <AgoraLogo title="Agora AUSD" className={s.logoAgora} />, sub: 'AUSD balance' },
  { id: 'perpl', head: <PerplLogo title="Perpl" className={s.logoPerpl} />, sub: 'orders' },
  { id: 'monad', head: <MonadLogo title="Monad" className={s.logoMonad} />, sub: 'transactions' },
];

// ─── formatting ───
const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n6 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const signed = (v: number, f = n2) => `${v < 0 ? '−' : '+'}${f(Math.abs(v))}`;

export function AgoraExplainer() {
  const [at, setAt] = useState(0);
  const show = (i: number) => {
    setAt(i);
    document.getElementById('flow')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={`${s.wrap} ${s.topRow}`}>
          <Link href="/play" className={s.brand}>
            <span>longshort<i>.fun</i></span>
            <span className={s.brandX}>×</span>
            <AgoraLogo title="Agora" className={s.brandAgora} />
          </Link>
          <nav className={s.nav}>
            <a href="#flow">Flow</a>
            <a href="#account">Account</a>
            <a href="#ausd">AUSD</a>
            <a href="#perpl">Perpl</a>
            <a href="#check">Check it</a>
          </nav>
          <Link href="/play" className={s.play}>Play</Link>
        </div>
      </header>
      <main className={s.wrap}>
        <Hero />
        <Flow at={at} setAt={setAt} />
        <Account onStep={show} />
        <Money />
        <Orders />
        <Check />
      </main>
    </div>
  );
}

// ─── hero ───
function Hero() {
  return (
    <section className={s.hero}>
      <div>
        <div className={s.eyebrow}>Mera · Agora AUSD · Perpl · Monad testnet</div>
        <h1 className={s.h1}>From a passkey to a real Perpl trade</h1>
        <p className={s.lede}>
          Longshort is a trading game you play against friends. You sign in with a passkey, get AUSD and trade BTC on Perpl, without installing a wallet, holding MON or
          opening a Perpl account. This page follows one real match through every step and shows what happens underneath.
        </p>
      </div>
      <div className={s.zeros}>
        <Zero n="1" label="Passkey prompt" sub="at sign-in; a later entry asks again" />
        <Zero n="0" label="Wallet pop-ups" sub="no extension, no seed phrase" />
        <Zero n="0" label="MON to hold" sub="Longshort pays the gas" />
        <Zero n="0" label="Perpl sign-ups" sub="the arena opens your account" />
      </div>
    </section>
  );
}
function Zero({ n, label, sub }: { n: string; label: string; sub: string }) {
  return (
    <div className={s.zero}>
      <span className={s.zeroN}>{n}</span>
      <span className={s.zeroLabel}>{label}</span>
      <span className={s.zeroSub}>{sub}</span>
    </div>
  );
}

function SectionHead({ id, n, title, sub }: { id?: string; n: string; title: string; sub: React.ReactNode }) {
  return (
    <div className={s.head} id={id}>
      <span className={s.headN}>{n}</span>
      <div>
        <h2 className={s.h2}>{title}</h2>
        <p className={s.sub}>{sub}</p>
      </div>
    </div>
  );
}

// ─── 01 the flow map ───
function Flow({ at, setAt }: { at: number; setAt: (i: number | ((i: number) => number)) => void }) {
  const [playing, setPlaying] = useState(false);
  const last = STEPS.length - 1;
  useEffect(() => {
    if (!playing) return;
    if (at >= last) return setPlaying(false);
    const t = setTimeout(() => setAt((i) => i + 1), 3200);
    return () => clearTimeout(t);
  }, [playing, at, last, setAt]);
  const go = (i: number) => {
    setPlaying(false);
    setAt(Math.max(0, Math.min(last, i)));
  };
  const toggle = () => {
    if (!playing && at === last) setAt(0);
    setPlaying((p) => !p);
  };
  const sofar = STEPS.slice(0, at + 1);
  const txs = sofar.reduce((a, x) => a + x.txs, 0);
  const prompts = sofar.reduce((a, x) => a + x.prompts, 0);
  const step = STEPS[at];
  const state = (i: number) => (i === at ? 'on' : i < at ? 'past' : 'next');
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    go(at + d);
  };

  return (
    <section className={s.section}>
      <SectionHead
        id="flow"
        n="01"
        title="One round, layer by layer"
        sub={<>Step through recorded match #{M2.id}: a passkey player’s 5 AUSD Duel at 15× against a bot. Balances start from a fresh 200 AUSD claim. Use the arrows or press Play.</>}
      />
      <div className={`${s.card} ${s.map}`} onKeyDown={onKey}>
        <div className={s.toolbar}>
          <div className={s.meter} aria-live="polite">
            <Meter n={txs} label="Transactions on Monad" />
            <Meter n={prompts} label="Passkey prompts" />
            <Meter n={0} label="Wallet pop-ups" />
            <Meter n={0} label="MON you paid" />
          </div>
          <div className={s.controls}>
            <button className={s.ctl} onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous step">‹</button>
            <button className={`${s.ctl} ${s.ctlPlay}`} onClick={toggle} aria-pressed={playing}>{playing ? 'Pause' : at === last ? 'Replay' : 'Play'}</button>
            <button className={s.ctl} onClick={() => go(at + 1)} disabled={at === last} aria-label="Next step">›</button>
          </div>
        </div>

        <div className={s.tabs} role="tablist" aria-label="Steps">
          {STEPS.map((x, i) => (
            <button key={x.id} role="tab" aria-selected={i === at} className={s.tab} data-state={state(i)} onClick={() => go(i)}>
              <span className={s.tabN}>{String(i + 1).padStart(2, '0')}</span>
              <span className={s.tabName}>{x.short}</span>
            </button>
          ))}
        </div>

        <div className={s.grid}>
          <div className={s.corner} />
          {STEPS.map((x, i) => (
            <button key={x.id} className={s.stage} data-state={state(i)} onClick={() => go(i)} aria-pressed={i === at}>
              <span className={s.stageN}>{String(i + 1).padStart(2, '0')}</span>
              <span className={s.stageName}>{x.name}</span>
              <span className={s.stageWhen}>{x.when}</span>
            </button>
          ))}
          {LANES.map((lane) => (
            <Row key={lane.id} lane={lane} at={at} state={state} onPick={go} />
          ))}
        </div>

        <div className={s.detail} role="tabpanel" aria-live="polite">
          <div className={s.detailMain}>
            <div className={s.kicker}>Step {String(at + 1).padStart(2, '0')} · {step.name}</div>
            <h3 className={s.h3}>{step.title}</h3>
            <p className={s.body}>{step.body}</p>
            {step.caveat && <p className={s.caveat}>{step.caveat}</p>}
          </div>
          <div className={s.detailCol}>
            <div className={s.colLabel}>Under the hood</div>
            <ul className={s.hood}>
              {step.hood.map((h) => <li key={h}>{h}</li>)}
            </ul>
          </div>
          <div className={s.detailCol}>
            <div className={s.colLabel}>At this step</div>
            <div className={s.stepFacts}>
              <span><b>{step.prompts}</b> passkey {step.prompts === 1 ? 'prompt' : 'prompts'}</span>
              <span><b>{step.txs}</b> {step.txs === 1 ? 'transaction' : 'transactions'}</span>
            </div>
            <div className={s.links}>
              {step.proof.map((p) =>
                p.internal ? (
                  <Link key={p.href} href={p.href}>{p.label} →</Link>
                ) : (
                  <a key={p.href} href={p.href} target="_blank" rel="noreferrer">{p.label} ↗</a>
                ),
              )}
              {step.code.map((c) => (
                <a key={c.path} href={gh(c.path)} target="_blank" rel="noreferrer" className={s.codeLink}>{c.label} ↗</a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Meter({ n, label }: { n: number; label: string }) {
  return (
    <span className={s.meterCell}>
      <b className={s.num}>{n}</b>
      <span>{label}</span>
    </span>
  );
}

function Row({ lane, at, state, onPick }: { lane: (typeof LANES)[number]; at: number; state: (i: number) => string; onPick: (i: number) => void }) {
  return (
    <>
      <div className={s.laneHead}>
        {lane.head}
        <span className={s.laneSub}>{lane.sub}</span>
      </div>
      {STEPS.map((x, i) => (
        <div key={x.id} className={s.cell} data-state={state(i)} data-lane={lane.id} onClick={() => i !== at && onPick(i)}>
          {lane.id === 'you' ? (
            <>
              <span className={s.ui}>{x.you}</span>
              <span className={s.note}>{x.youNote}</span>
            </>
          ) : lane.id === 'ausd' ? (
            <Balances now={x.ausd} prev={STEPS[i - 1]?.ausd} note={x.ausdNote} />
          ) : (
            <>
              <span className={s.title}>{x[lane.id as 'mera' | 'perpl' | 'monad'][0]}</span>
              <span className={s.note}>{x[lane.id as 'mera' | 'perpl' | 'monad'][1]}</span>
            </>
          )}
        </div>
      ))}
    </>
  );
}

function Balances({ now, prev, note }: { now: Ledger; prev?: Ledger; note: string }) {
  const rows: [string, keyof Ledger][] = [['Wallet', 'wallet'], ['Trading', 'trading'], ['Pot', 'pot']];
  return (
    <>
      <span className={s.bal}>
        {rows.map(([label, k]) => {
          const v = now[k];
          const changed = v !== (prev ? prev[k] : undefined) && !(v === undefined && prev?.[k] === undefined);
          return (
            <span key={k} className={s.balRow} data-changed={changed || undefined}>
              <span>{label}</span>
              <span className={s.num}>{v === undefined ? '—' : n2(v)}</span>
            </span>
          );
        })}
      </span>
      <span className={s.note}>{note}</span>
    </>
  );
}

// ─── 02 the account: Mera keys ───
/** `steps`: indexes into STEPS where this key acts in the round above. */
type Key = { id: string; parent?: string; name: string; tag: string; can: string[]; cannot: string[]; lives: string; steps: number[] };
const KEYS: Key[] = [
  {
    id: 'passkey',
    name: 'Your passkey',
    tag: 'Face ID · Touch ID · device PIN',
    can: ['Rebuild the whole account on any device it syncs to', 'Approve a paid entry, once per check'],
    cannot: ['Leave your device or password manager', 'Be seen by Longshort or Mera'],
    lives: 'In your phone, laptop or password manager, like any passkey.',
    steps: [0, 2],
  },
  {
    id: 'prf',
    parent: 'passkey',
    name: 'Account secret',
    tag: 'WebAuthn PRF output',
    can: ['Seed the owner key and trade root through HKDF'],
    cannot: ['Be stored anywhere: it is wiped once the keys exist'],
    lives: 'For a moment during unlock, then erased.',
    steps: [0],
  },
  {
    id: 'owner',
    parent: 'prf',
    name: 'Owner key',
    tag: 'HKDF · longshort/owner/v1',
    can: ['Hold your AUSD', 'Approve exactly the entry plus 100 AUSD', 'Join matches and register a match key', 'Sign requests to Longshort: claim, name'],
    cannot: ['Be read from storage: it exists only in memory', 'Be used after the account locks'],
    lives: 'A Mera signing session in memory, cleared on lock.',
    steps: [1, 2, 5],
  },
  {
    id: 'root',
    parent: 'prf',
    name: 'Trade root',
    tag: 'HKDF · longshort/trade-root/v1',
    can: ['Derive a fresh key for each match'],
    cannot: ['Sign a transaction'],
    lives: 'In memory, cleared on lock.',
    steps: [2],
  },
  {
    id: 'match',
    parent: 'root',
    name: 'Match key',
    tag: 'HKDF · longshort/match/<label> · one per match',
    can: ['Long, Short and Close in its own match', 'Sign every order of the round with no prompt'],
    cannot: ['Move your AUSD', 'Change where your collateral goes', 'Enter a match', 'Trade any other match'],
    lives: 'In memory for one round. Its public label is saved so another device can rebuild it.',
    steps: [2, 3],
  },
  {
    id: 'jprf',
    parent: 'passkey',
    name: 'Journal secret',
    tag: 'PRF · its own salt namespace',
    can: ['Seed the journal key only'],
    cannot: ['Reach the account keys: different salt, different output'],
    lives: 'Read when you open the journal, then erased.',
    steps: [],
  },
  {
    id: 'journal',
    parent: 'jprf',
    name: 'Journal key',
    tag: 'AES-256-GCM · non-extractable',
    can: ['Encrypt and read your private notes beside each match report'],
    cannot: ['Sign anything', 'Be exported from the browser', 'Show Longshort your notes: only ciphertext is stored'],
    lives: 'A Web Crypto key in memory while the journal is open.',
    steps: [],
  },
];
/** Tree guides: for each ancestor level, whether its line continues past this row. */
const TREE = KEYS.map((k) => {
  const depthOf = (id?: string): number => (id ? 1 + depthOf(KEYS.find((x) => x.id === id)?.parent) : -1);
  const isLast = (x: Key) => !KEYS.slice(KEYS.indexOf(x) + 1).some((y) => y.parent === x.parent);
  const chain: Key[] = [];
  for (let p = k.parent; p; p = KEYS.find((x) => x.id === p)?.parent) chain.unshift(KEYS.find((x) => x.id === p)!);
  return { key: k, depth: depthOf(k.id), last: isLast(k), rails: chain.slice(1).map((a) => !isLast(a)), path: new Set([k.id, ...chain.map((a) => a.id)]) };
});

function Account({ onStep }: { onStep: (i: number) => void }) {
  const [pick, setPick] = useState('match');
  const sel = TREE.find((t) => t.key.id === pick)!;
  return (
    <section className={s.section}>
      <SectionHead
        id="account"
        n="02"
        title="The wallet you never see"
        sub="Mera turns one passkey into separate keys, each allowed to do one job. Pick a key to see what it can and cannot do."
      />
      <div className={s.keysGrid}>
        <div className={`${s.card} ${s.tree}`} role="listbox" aria-label="Keys">
          {TREE.map(({ key, depth, last, rails }) => (
            <button
              key={key.id}
              role="option"
              aria-selected={key.id === pick}
              className={s.treeRow}
              data-on={key.id === pick || undefined}
              data-path={(sel.path.has(key.id) && key.id !== pick) || undefined}
              onClick={() => setPick(key.id)}
            >
              {rails.map((r, i) => <i key={i} className={r ? s.rail : s.blank} />)}
              {depth > 0 && <i className={last ? s.elbowLast : s.elbow} />}
              <span className={s.treeNode}>
                <b>{key.name}</b>
                <span>{key.tag}</span>
              </span>
            </button>
          ))}
        </div>
        <div className={`${s.card} ${s.keyCard}`} aria-live="polite">
          <div className={s.keyHead}>
            <div className={s.kicker}>Selected key</div>
            <h3 className={s.h3}>{sel.key.name}</h3>
            <code className={s.keyTag}>{sel.key.tag}</code>
          </div>
          <div className={s.canGrid}>
            <div>
              <div className={s.colLabel}>Can</div>
              <ul className={s.can}>{sel.key.can.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
            <div>
              <div className={s.colLabel}>Cannot</div>
              <ul className={s.cannot}>{sel.key.cannot.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          </div>
          <dl className={s.keyFacts}>
            <dt className={s.colLabel}>Lives</dt>
            <dd>{sel.key.lives}</dd>
            <dt className={s.colLabel}>In the round</dt>
            <dd className={s.stepTags}>
              {sel.key.steps.length
                ? sel.key.steps.map((i) => (
                    <button key={i} className={s.stepTag} onClick={() => onStep(i)}>
                      <span>{String(i + 1).padStart(2, '0')}</span> {STEPS[i].name}
                    </button>
                  ))
                : 'Not used during play. It opens your private notes on the match report.'}
            </dd>
          </dl>
        </div>
      </div>
      <div className={s.strip}>
        <Fact title="Nothing secret saved" text="No seed phrase, no key file. Storage holds only public IDs and match labels." />
        <Fact title="Locks by itself" text="After 30 idle minutes or when the page closes. The idle timer pauses from the countdown to the bell." />
        <Fact title="One check per entry" text="A passkey check covers one entry within two minutes. Orders in the round need none." />
        <Fact title="Any device" text="Same passkey, same account. An open round’s match key is rebuilt and checked against the key registered onchain." />
      </div>
    </section>
  );
}
function Fact({ title, text }: { title: string; text: React.ReactNode }) {
  return (
    <div className={s.fact}>
      <b>{title}</b>
      <span>{text}</span>
    </div>
  );
}

// ─── 03 the money: AUSD ───
function Money() {
  const [mode, setMode] = useState<Mode>(Mode.DUEL);
  const [entry, setEntry] = useState<number>(ENTRY_TIERS[0]);
  const players = MODES[mode].maxPlayers;
  const pay = payouts(mode, entry, players);
  const rake = (pay.pot * RAKE_BPS) / 10_000;
  const need = entry + TRADING_BUDGET;
  const prizeLabel = mode === Mode.ROYALE ? '1st place' : mode === Mode.SQUAD ? 'Each winner' : 'Winner';
  const prizeSub = mode === Mode.ROYALE ? `2nd ${n2(pay.second!)} · 3rd ${n2(pay.third!)}` : mode === Mode.SQUAD ? 'both players on the team' : 'paid at settlement';
  return (
    <section className={s.section}>
      <SectionHead
        id="ausd"
        n="03"
        title="One balance for everything"
        sub="Your wallet, the entry, Perpl collateral, fees, the prize and returned capital are all AUSD on Monad. Nothing is swapped or bridged. Each entry splits into two amounts that never mix."
      />
      <div className={s.moneyGrid}>
        <div className={`${s.card} ${s.calc}`}>
          <div className={s.calcBar}>
            <Seg label="Mode" options={[Mode.DUEL, Mode.SQUAD, Mode.ROYALE].map((m) => [m, MODES[m].name] as [Mode, string])} value={mode} onChange={setMode} />
            <Seg label="Entry" options={ENTRY_TIERS.map((e) => [e, `${e} AUSD`] as [number, string])} value={entry} onChange={setEntry} />
          </div>
          <div className={s.need}>
            <span className={s.needN}>{need}<small> AUSD</small></span>
            <span className={s.needText}>leaves your wallet when you join a {MODES[mode].name} at {entry} AUSD</span>
          </div>
          <div className={s.split} aria-hidden>
            <i style={{ width: `${(entry / need) * 100}%` }} />
            <i />
          </div>
          <div className={s.splitKey}>
            <span><i className={s.keyEntry} />Entry {entry}: goes in the pot</span>
            <span><i className={s.keyTrade} />Trading {TRADING_BUDGET}: comes back, minus losses</span>
          </div>
          <div className={s.paths}>
            <div className={s.pathLabel}>Prize path</div>
            <Box tone="gold" k="Entry" v={n2(entry)} sub="from each player" />
            <Box tone="gold" k="Pot" v={n2(pay.pot)} sub={`${players} entries`} />
            <Box tone="gold" k="Rake" v={n2(rake)} sub="2.5%; a tie refunds it" />
            <Box tone="gold" k={prizeLabel} v={n2(pay.first)} sub={prizeSub} strong />
            <div className={s.pathLabel}>Capital path</div>
            <Box tone="violet" k="Trading" v={n2(TRADING_BUDGET)} sub="separate from the entry" />
            <Box tone="violet" k="Perpl account" v="isolated" sub="one per player, per match" />
            <Box tone="violet" k="Perpl fees" v={`${(FEE_BPS / 100).toFixed(4)}%`} sub="of each fill, plus your PnL" />
            <Box tone="violet" k="Returned" v="the rest" sub="to you, win or lose" strong />
          </div>
        </div>
        <div className={`${s.card} ${s.ledger}`}>
          <div className={s.kicker}>Match #{M2.id}, to the cent</div>
          <table className={s.table}>
            <tbody>
              <tr className={s.tGroup}><td colSpan={2}>Inside the trading account</td></tr>
              <tr><td>Budget in</td><td className={s.num}>{n6(TRADING_BUDGET)}</td></tr>
              <tr><td>Perpl fee, open</td><td className={s.num}>{signed(-M2.openFee, n6)}</td></tr>
              <tr><td>BTC {fmtPx(M2.openPx)} → {fmtPx(M2.closePx)} on {M2.btc}</td><td className={s.num}>{signed(-MOVE, n6)}</td></tr>
              <tr><td>Perpl fee, close</td><td className={s.num}>{signed(-M2.closeFee, n6)}</td></tr>
              <tr className={s.tSum}><td>Returned to the owner</td><td className={s.num}>{n6(M2.returned)}</td></tr>
              <tr className={s.tGroup}><td colSpan={2}>The player’s wallet</td></tr>
              <tr><td>Entry and budget out</td><td className={s.num}>{signed(-(ENTRY + TRADING_BUDGET), n6)}</td></tr>
              <tr><td>Capital back</td><td className={s.num}>{signed(M2.returned, n6)}</td></tr>
              <tr><td>Prize: 10.00 pot − 0.25 rake</td><td className={s.num}>{signed(M2.prize, n6)}</td></tr>
              <tr className={s.tSum}><td>Net for the round</td><td className={`${s.num} ${s.pos}`}>{signed(M2.returned + M2.prize - ENTRY - TRADING_BUDGET, n6)}</td></tr>
            </tbody>
          </table>
          <div className={s.links}>
            <a href={explorerTx(M2.settleTx)} target="_blank" rel="noreferrer">Settlement transaction ↗</a>
            <Link href={`/match/${M2.id}/report`}>Match report →</Link>
          </div>
        </div>
      </div>
      <div className={s.strip}>
        <Fact title="Gas (MON)" text="Paid by Longshort’s relayer. Your account holds 0 MON." />
        <Fact title="Perpl trading fees" text="Taken by Perpl from your 100 AUSD trading balance, per fill." />
        <Fact title="Arena rake" text="2.5% of the pot. The arena charges no trading fee of its own." />
        <Fact title="Exact approvals" text="Each entry approves its entry plus 100 AUSD, never an unlimited amount." />
      </div>
    </section>
  );
}

function Seg<T extends number>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={s.segWrap}>
      <span className={s.segLabel}>{label}</span>
      <div className={s.seg} role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}
function Box({ k, v, sub, strong, tone }: { k: string; v: string; sub: string; strong?: boolean; tone?: 'gold' | 'violet' }) {
  return (
    <div className={s.box} data-strong={strong || undefined} data-tone={tone}>
      <span className={s.boxK}>{k}</span>
      <span className={`${s.boxV} ${s.num}`}>{v}</span>
      <span className={s.boxSub}>{sub}</span>
    </div>
  );
}

// ─── 04 the orders: Perpl ───
const PATH: [string, string, string][] = [
  ['You tap Long', 'browser', 'One tap, no sheet, no pop-up.'],
  ['Match key signs', 'browser · Mera', 'An EIP-712 message, signed in memory.'],
  ['Relayer sends it', 'Longshort', 'Simulates first, then pays the MON.'],
  ['Your address runs RelayDelegate', 'Monad · EIP-7702', 'It may only call the arena, or approve AUSD to it.'],
  ['PerplArena.open', 'Monad', 'Checks the round is live and the key is yours.'],
  ['Your trading account', 'MatchTradingAccount', `Owns Perpl account #${M2.account}. Only the arena can trade it.`],
  ['Perpl.execOrder', 'Perpl BTC-PERP', 'Fills on the book; the account checks every lot.'],
];
const SIZES = [2500, 5000, 10_000] as const;

function usePerplMark() {
  const [mark, setMark] = useState<{ px: number; ts: number } | null>();
  useEffect(() => {
    let live = true;
    const read = () =>
      readPerplPrices(publicClient as never).then(
        (ps) => {
          const btc = ps.find((p) => p.symbol === 'BTC');
          if (live) setMark(btc ? { px: btc.price, ts: btc.timestamp } : null);
        },
        () => live && setMark((m) => m ?? null),
      );
    void read();
    const t = setInterval(read, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return mark;
}

function Orders() {
  const [lev, setLev] = useState<number>(LEVERAGES[2]);
  const [size, setSize] = useState<number>(SIZES[1]);
  const mark = usePerplMark();
  const px = mark?.px ?? M2.openPx;
  const out = useMemo(() => {
    const notional = (TRADING_BUDGET * lev * size * 0.95) / 10_000;
    const btc = Math.floor((notional / px) * 1e5) / 1e5; // Perpl BTC lots are 0.00001 BTC
    const eff = (0.95 * lev * size) / 10_000;
    return { notional: btc * px, btc, fee: (btc * px * FEE_BPS) / 10_000, liq: (1 - eff * PERPL_BTC_MAINT) / eff };
  }, [lev, size, px]);
  const sameAsM2 = lev === 15 && size === 5000;
  return (
    <section className={s.section}>
      <SectionHead
        id="perpl"
        n="04"
        title="Real orders without a Perpl account"
        sub="When you join, the arena deploys a small trading account for you and opens a Perpl account inside it. You never visit Perpl, sign up or deposit, and the collateral can only ever go back to you."
      />
      <div className={s.ordersGrid}>
        <div className={`${s.card} ${s.chain}`}>
          <div className={s.kicker}>One tap, seven hops, one transaction</div>
          <ol className={s.hops}>
            {PATH.map(([what, where, note], i) => (
              <li key={what} className={s.hop}>
                <span className={`${s.hopN} ${s.num}`}>{i + 1}</span>
                <span className={s.hopWhat}>{what}</span>
                <span className={s.hopWhere}>{where}</span>
                <span className={s.hopNote}>{note}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className={`${s.card} ${s.sizer}`}>
          <div className={s.sizerHead}>
            <div>
              <div className={s.kicker}>How big is one tap?</div>
              <div className={s.markRow}>
                <span className={s.markLabel}>BTC mark on Perpl</span>
                <span className={`${s.markPx} ${s.num}`}>{mark === undefined ? '…' : fmtPx(px)}</span>
                <span className={s.markSrc}>{mark ? 'live' : mark === null ? `match #${M2.id} price` : 'reading'}</span>
              </div>
            </div>
          </div>
          <div className={s.calcBar}>
            <Seg label="Leverage" options={LEVERAGES.map((l) => [l, `${l}×`] as [number, string])} value={lev} onChange={setLev} />
            <Seg label="Size" options={SIZES.map((v) => [v, `${v / 100}%`] as [number, string])} value={size} onChange={setSize} />
          </div>
          <div className={s.outs}>
            <Box k="Position" v={n2(out.notional)} sub="AUSD of BTC" />
            <Box k="Order" v={out.btc.toFixed(5)} sub="BTC, in 0.00001 lots" />
            <Box k="Perpl fee" v={`≈ ${out.fee.toFixed(4)}`} sub="AUSD at 3.45 bps" />
            <Box k="Liquidation" v={`${(out.liq * 100).toFixed(1)}%`} sub="BTC move against you" strong />
          </div>
          <p className={s.formula}>
            <code>balance × leverage × size × 95% ÷ mark</code>, the same sum <code>MatchTradingAccount.open</code> runs onchain. The 5% left over covers fees.{' '}
            {sameAsM2 ? `These are match #${M2.id}’s settings: it filled ${M2.btc} BTC.` : 'Liquidation ignores fees and funding.'}
          </p>
          <div className={s.guards}>
            <span><b>Immediate or cancel</b> nothing rests on the book</span>
            <span><b>Limit at mark ±1%</b> no fill far from the price you saw</span>
            <span><b>Opens fill in full</b> or the order is rejected</span>
            <span><b>Closes reduce only</b> a retry can never flip you</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 05 check it yourself ───
function Check() {
  const contracts = (
    [
      ['PerplArena', ADDR.arena, 'entries, rounds, payouts'],
      ['RelayDelegate', ADDR.relayDelegate, 'gasless calls, EIP-7702'],
      ['AUSD', ADDR.stake, 'Agora’s stablecoin'],
      ['Perpl exchange', ADDR.perplExchange, 'the BTC-PERP book'],
    ] as [string, string | undefined, string][]
  ).filter((c): c is [string, string, string] => !!c[1]);
  return (
    <section className={s.section} id="check">
      <SectionHead n="05" title="Check it yourself" sub="Every contract is public on Monad testnet, and the docs explain each integration in full." />
      <div className={s.checkGrid}>
        {contracts.map(([name, addr, role]) => (
          <a key={name} className={s.contract} href={explorerAddr(addr)} target="_blank" rel="noreferrer">
            <b>{name}</b>
            <span className={s.mono}>{shortAddr(addr)} ↗</span>
            <span>{role}</span>
          </a>
        ))}
      </div>
      <footer className={s.foot}>
        <span>
          Docs: <a href={gh('docs/MERA.md')} target="_blank" rel="noreferrer">Mera</a> · <a href={gh('docs/AGORAUSD.md')} target="_blank" rel="noreferrer">AUSD</a> ·{' '}
          <a href={gh('README.md#real-perpl-trades-without-a-perpl-account')} target="_blank" rel="noreferrer">Perpl</a> · <Link href="/demo">time your own run</Link>
        </span>
        <span>Testnet only. Test AUSD has no monetary value.</span>
        <Link href="/play" className={s.footPlay}>Back to the arena →</Link>
      </footer>
    </section>
  );
}
