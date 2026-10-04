'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { animate, AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { useScene } from '@/lib/scene';
import { CHARACTER_INFO, REAL_TRADING, fmtPx, type CharacterId } from '@longshort/shared';
import { useWallet } from '@/lib/wallet';
import { useApi } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import { sfx } from '@/lib/sfx';
import { Logo } from '@/components/Logo';
import { ConnectDialog } from '@/components/ConnectDialog';
import { HeroChart } from '@/components/landing/HeroChart';
import { Tracks } from '@/components/landing/Tracks';
import { MatchFlow } from '@/components/landing/MatchFlow';
import LOUNGE from '@/assets/cast/lounge.json';

const EASE = [0.2, 0.8, 0.2, 1] as const;

type Seat = { id: CharacterId; flip?: boolean; ring?: string; dim?: boolean };
/** Each format told by who's in it: the avatars are the same portraits as the lobby's character picker. */
const MODES: { key: 'duel' | 'squad' | 'royale'; name: string; meta: [string, string]; line: string; sides: Seat[][] }[] = [
  {
    key: 'duel',
    name: 'Duel',
    meta: ['1v1', '60s'],
    line: 'One rival, one minute. The bigger balance at the bell takes the pot.',
    sides: [[{ id: 'gladiator' }], [{ id: 'sniper', flip: true }]],
  },
  {
    key: 'squad',
    name: 'Squad',
    meta: ['2v2', '120s'],
    line: 'Team up with a friend. Your leader sets the leverage; the bigger team total splits the pot.',
    sides: [
      [{ id: 'keone', ring: '#5b8cff' }, { id: 'pigeon', ring: '#5b8cff' }],
      [{ id: 'pirate', flip: true, ring: '#ff9a3d' }, { id: 'pathfinder', flip: true, ring: '#ff9a3d' }],
    ],
  },
  {
    key: 'royale',
    name: 'Royale',
    meta: ['8 players', '180s'],
    line: 'The lowest balance is cut every 30 seconds. The top three are paid 60/30/10.',
    sides: [
      [
        { id: 'pirate', ring: '#ffc857' },
        { id: 'keone', ring: '#c9ced8' },
        { id: 'sniper', ring: '#d08a52' },
        { id: 'pigeon' },
        { id: 'pathfinder' },
        { id: 'gladiator' },
        { id: 'sniper', dim: true },
        { id: 'pigeon', dim: true },
      ],
    ],
  },
];

/** The cast off duty, each in its own 4 s loop (rendered from the arena models: web/art/cast/stills.cjs). Sizes are
 * the images' pixels at one shared scale, so the pigeon stays pigeon-sized next to the gladiator. */
const ROSTER: CharacterId[] = ['gladiator', 'sniper', 'pirate', 'pigeon', 'keone', 'pathfinder'];

/** Counts up to `to` the first time it scrolls into view; the final number is what's served and read out. */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.8 });
  const still = useReducedMotion();
  const [n, setN] = useState(to);
  useEffect(() => {
    if (still) return;
    if (!seen) return setN(0);
    const c = animate(0, to, { duration: 1.5, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setN(Math.round(v)) });
    return () => c.stop();
  }, [seen, still, to]);
  return (
    <span ref={ref} className="lp-count">
      <span className="sr-only">{to}</span>
      {/* the final number holds the width, so the unit beside it doesn't shuffle while counting */}
      <span aria-hidden className="lp-count-hold">{to}</span>
      <span aria-hidden className="lp-count-run">{n}</span>
    </span>
  );
}

const FAQ = [
  ['Is this real money?', 'longshort runs on Monad testnet with test AUSD. Duels execute real testnet Perpl trades, while Practice is a simulation. The tokens have no monetary value.'],
  ['Do I need a wallet?', 'Create a Mera passkey account with your device, then claim 200 test AUSD. No seed phrase, extension, email or OTP, and the same passkey restores the account in a fresh browser. No passkey on your device? Play as a guest and export its key from the account menu.'],
  ['What is leverage?', 'A multiplier on your position. At 5x, 95 AUSD controls a 475 AUSD BTC position: wins and losses both grow five times, and a big enough move against you knocks you out. Start at 5x, move to 10x or 15x when you feel brave. Your character is just your look: any character plays at any leverage.'],
  ['How are winners paid?', 'Each pot is every entry added together, minus a 2.5% rake. A Duel winner takes it all, the winning Squad team splits it, and Royale pays the top three 60%, 30% and 10%. Ties get their entries back. The full math is on the Rules & Risks page.'],
  ['Who holds the pot?', REAL_TRADING ? 'The PerplArena contract escrows entries and pays prizes onchain after settlement. A separate trading account holds each player’s 100 AUSD budget. Trading and fees can reduce it; remaining capital returns to that player. Settlement is coordinated by the keeper.' : 'The arena contract escrows stakes and pays prizes after settlement.'],
  ['What happens if I get liquidated?', REAL_TRADING ? 'Perpl closes the position and the round uses the actual remaining trading balance. Entry and trading capital are both at risk. The report shows returned capital separately from the prize.' : 'The position closes when it reaches its liquidation threshold.'],
  ['How long does matchmaking take?', 'By default, matchmaking waits for human players. Enable Match with bots in Settings to let labelled sparring bots fill empty seats after about 12 seconds.'],
];

/** The real BTC mark from Perpl (via the keeper feed), ticking green/red. Hidden until the feed has a price. */
/**
 * The lounge loops are 130-240 KB each, and on phones native lazy loading fetches them with the page (its
 * head start reaches past this section). Show the small still until the figure is near, then the loop; the
 * still stays on screen until the loop has loaded.
 */
function LoungeImg({ id, w, h }: { id: CharacterId; w: number; h: number }) {
  const ref = useRef<HTMLImageElement>(null);
  const near = useInView(ref, { once: true, margin: '600px 0px' });
  return (
    <picture>
      <source srcSet={`/cast/lounge/${id}.webp`} media="(prefers-reduced-motion: reduce)" />
      <img ref={ref} src={`/cast/lounge/${id}${near ? '-loop' : ''}.webp`} alt={`${CHARACTER_INFO[id].name}: ${CHARACTER_INFO[id].line}`} width={w} height={h} loading="lazy" decoding="async" draggable={false} />
    </picture>
  );
}

function MarkTag() {
  const px = useSocket((s) => s.prices.BTC.at(-1)?.px);
  const prev = useRef<number | undefined>(undefined);
  const [dir, setDir] = useState<'up' | 'down' | ''>('');
  useEffect(() => {
    if (px === undefined) return;
    if (prev.current !== undefined && px !== prev.current) setDir(px > prev.current ? 'up' : 'down');
    prev.current = px;
  }, [px]);
  if (px === undefined) return null;
  return (
    <div className={`lp-mark ${dir}`}>
      <b>BTC-PERP</b>
      <span className="num">{fmtPx(px)}</span>
      <i>Mark · Perpl</i>
    </div>
  );
}

export default function Landing() {
  const router = useRouter();
  const address = useWallet((s) => s.address);
  const [connect, setConnect] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const { data: stats } = useApi<{ settled: number; trades: number; txs: number; live: number }>('/stats', 10_000);

  useEffect(() => {
    useScene.getState().set({
      shot: 'title',
      intensity: 0.35,
      slots: [],
    });
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const play = (to = '/play') => {
    sfx.lockIn();
    if (!address) return setConnect(to);
    useScene.getState().set({ shot: 'lobby' });
    router.push(to);
  };
  useEffect(() => {
    if (connect && address) router.push(connect);
  }, [address, connect, router]);

  return (
    <div className="lp">
      <div className="lp-grain" aria-hidden />

      <header className={`lp-nav ${scrolled ? 'solid' : ''}`}>
        <Logo />
        <button className="lp-cta sm" onClick={() => play()} onMouseEnter={sfx.hover}>
          <span>Play testnet</span>
        </button>
      </header>

      {/* ─── hero: headline over an endless market ─── */}
      <section className="lp-hero">
        <div className="lp-chart" aria-hidden>
          <HeroChart className="lp-chart-canvas" />
        </div>
        <div className="lp-wrap lp-hero-grid">
          <div className="relative z-[6]">
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="lp-eyebrow">
              <i /> Season 0 · Live on Monad testnet
            </motion.p>
            <h1 className="lp-h1">
              {['Out', 'trade', 'them.'].map((w, i) => (
                <motion.span key={w} initial={{ opacity: 0, y: '0.4em' }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.08, duration: 0.7, ease: EASE }} className={i === 2 ? 'lp-outline' : ''}>
                  {w}
                </motion.span>
              ))}
            </h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="lp-lead">
              BTC trading battles: 1v1 Duels, 2v2 Squads and 8-player Royales. Sign in with a passkey, go long or short, and outtrade everyone. Trades execute on Monad testnet and the contract pays the winners.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, ease: EASE }} className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
              <button className="lp-cta" onClick={() => play()} onMouseEnter={sfx.hover}>
                <span>Play testnet</span>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </button>
              <Link href="/practice" className="lp-textlink">
                Practice vs a bot
              </Link>
            </motion.div>
          </div>
        </div>
        <MarkTag />
      </section>

      {/* ─── built on ─── */}
      <Tracks />

      {/* ─── modes ─── */}
      <section id="modes" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-head">
            <h2 className="lp-h2">Pick your fight</h2>
            <p>Three formats, one rule: the best trader walks away with the pot. All live on BTC with real Perpl orders; warm up in free Practice first.</p>
          </div>
          <div className="lp-roster">
            {ROSTER.map((id, i) => {
              const [w, h] = LOUNGE[id];
              return (
                <motion.figure
                  key={id}
                  className="lp-roster-fig"
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ delay: i * 0.05, duration: 0.5, ease: EASE }}
                  style={{ ['--w' as string]: w, ['--h' as string]: h }}
                >
                  <LoungeImg id={id} w={w} h={h} />
                  <figcaption>{CHARACTER_INFO[id].name}</figcaption>
                </motion.figure>
              );
            })}
          </div>
          <div className="lp-modes">
            {MODES.map(({ key, name, meta, line, sides }, i) => (
              <motion.button
                key={key}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ delay: i * 0.08, duration: 0.6, ease: EASE }}
                className={`lp-mode ${key}`}
                aria-label={`Queue ${name}, ${meta.join(', ')}`}
                onClick={() => play(`/play?mode=${key}`)}
                onMouseEnter={sfx.hover}
              >
                <div className="lp-mode-cast" aria-hidden>
                  {sides.map((side, s) => (
                    <div key={s} className="lp-mode-side">
                      {s > 0 && <i className="lp-mode-vs">vs</i>}
                      {side.map((c, j) => (
                        <span key={j} className={`lp-av ${c.dim ? 'dim' : ''}`} style={c.ring ? { ['--ring' as string]: c.ring } : undefined}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- 15 KB static avatar */}
                          <img src={`/cast/${c.id}.webp`} alt="" width={96} height={96} loading="lazy" draggable={false} style={c.flip ? { transform: 'scaleX(-1)' } : undefined} />
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="lp-mode-body">
                  <div className="lp-mode-meta">
                    {meta.map((m) => (
                      <span key={m}>{m}</span>
                    ))}
                  </div>
                  <div className="lp-mode-row">
                    <h3 className="lp-mode-name">{name}</h3>
                    <span className="lp-mode-go" aria-hidden>
                      <svg viewBox="0 0 24 24">
                        <path d="M5 12h13M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </div>
                  <p className="lp-mode-line">{line}</p>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      </section>

      {/* ─── how a match plays (light) ─── */}
      <MatchFlow />

      {/* ─── numbers ─── */}
      <section className="lp-section">
        <div className="lp-wrap">
          <div className="lp-head">
            <h2 className="lp-h2">Why it runs on Monad</h2>
          </div>
          <div className="lp-numbers">
            {[
              ['300', 'ms', 'Block time. A 60-second duel is about 200 blocks, so every Long, Short and Close is its own transaction and still lands while the price matters. The in-match Ping meter shows each order’s real time.'],
              ['600', 'ms', 'To finality. After two blocks a result can’t be reversed, so the payout and the proof behind “Verified result” are final almost as soon as they appear.'],
              ['0', 'MON', 'Gas you need to hold. Your passkey is the account (Face ID or a device PIN, no seed phrase), and because Monad supports EIP-\u20607702 a relay pays the network fee. Trades never pop up a wallet.'],
            ].map(([v, u, d]) => (
              <div key={v + u}>
                <div className="lp-num">
                  {Number(v) > 0 ? <CountUp to={Number(v)} /> : v}
                  <small>{u}</small>
                </div>
                <p>{d}</p>
              </div>
            ))}
          </div>
          {stats && (
            <div className="lp-live">
              <span className="lp-dot" /> Indexed contract activity ·<b>{stats.settled.toLocaleString()}</b> matches settled ·<b>{stats.trades.toLocaleString()}</b> trade opens
            </div>
          )}
        </div>
      </section>

      {/* ─── faq ─── */}
      <Faq />

      {/* ─── closing ─── */}
      <section className="lp-closing">
        <div className="lp-wrap flex flex-col items-start gap-8 md:flex-row md:items-end md:justify-between">
          <h2 className="lp-h2 xl">
            Ready for
            <br />
            a fight?
          </h2>
          <button className="lp-cta dark" onClick={() => play()} onMouseEnter={sfx.hover}>
            <span>Play testnet</span>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-wrap flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4">A PvP perpetuals arena on Monad testnet. Test tokens only. Nothing here is financial advice.</p>
          </div>
          <nav className="grid grid-cols-2 gap-x-16 gap-y-3">
            {[
              ['/play', 'Play'],
              ['/practice', 'Practice'],
              ['/leaderboard', 'Ranks'],
              ['/stats', 'Stats'],
              ['/rules', 'Rules & Risks'],
              ['#faq', 'FAQ'],
            ].map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="lp-wrap lp-mono mt-14">© {new Date().getFullYear()} longshort.fun</div>
      </footer>

      <ConnectDialog open={!!connect} onClose={() => setConnect(null)} />
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section id="faq" className="lp-section pt-0">
      <div className="lp-wrap grid gap-8 lg:grid-cols-[1fr_1.6fr] lg:gap-10">
        <div className="lg:sticky lg:top-28 lg:self-start">
          {/* The heading is what scrolls into view. The words start below its clip edge, so they can't be the
              thing observed: a fully clipped element never counts as visible and would stay hidden forever. */}
          <motion.h2
            className="lp-h2 overflow-hidden"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
          >
            {['Ques', 'tions'].map((w) => (
              <motion.span key={w} className="inline-block" variants={{ hidden: { y: '105%' }, show: { y: 0, transition: { duration: 0.7, ease: EASE } } }}>
                {w}
              </motion.span>
            ))}
          </motion.h2>
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 }} className="lp-faq-aside">
            Still unsure? The full risk disclosure lives on the{' '}
            <Link href="/rules" className="lp-textlink small">
              Rules &amp; Risks page
            </Link>
            .
          </motion.p>
        </div>
        <div>
          {FAQ.map(([q, a], i) => {
            const on = open === i;
            return (
              <motion.div
                key={q}
                className={`lp-faq ${on ? 'open' : ''}`}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ delay: i * 0.07, duration: 0.6, ease: EASE }}
              >
                <button className="lp-faq-q" onClick={() => (sfx.click(), setOpen(on ? null : i))} aria-expanded={on}>
                  <span className="lp-faq-n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="lp-faq-t">{q}</span>
                  <motion.i className="lp-faq-x" animate={{ rotate: on ? 135 : 0 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }} aria-hidden />
                </button>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div key="a" className="overflow-hidden" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.45, ease: EASE }}>
                      <motion.p className="lp-faq-a" initial={{ opacity: 0, y: -10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.4, delay: 0.06 }}>
                        {a}
                      </motion.p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
