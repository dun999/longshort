'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useScene } from '@/lib/scene';
import { REAL_TRADING, fmtPx } from '@longshort/shared';
import { useWallet } from '@/lib/wallet';
import { useApi } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import { sfx } from '@/lib/sfx';
import { Logo } from '@/components/Logo';
import { ConnectDialog } from '@/components/ConnectDialog';
import { HeroChart } from '@/components/landing/HeroChart';
import { Tracks } from '@/components/landing/Tracks';
import { ModeViz } from '@/components/landing/ModeViz';
import { MatchFlow } from '@/components/landing/MatchFlow';

const EASE = [0.2, 0.8, 0.2, 1] as const;

const ALL_MODES: { key: 'duel' | 'squad' | 'royale'; n: string; name: string; meta: string; line: string }[] = [
  { key: 'duel', n: '01', name: 'Duel', meta: '1v1 · 60s', line: 'One rival, one minute. Higher equity at the bell takes the pot.' },
  { key: 'squad', n: '02', name: 'Squad', meta: '3v3 · 120s', line: 'Party up with friends. Summed team PnL wins and the pot is split.' },
  { key: 'royale', n: '03', name: 'Royale', meta: '8 FFA · 180s', line: 'Lowest equity is cut every round. The top three are paid 60/30/10.' },
];
const MODES = REAL_TRADING ? ALL_MODES.slice(0, 1) : ALL_MODES;

const FAQ = [
  ['Is this real money?', 'longshort runs on Monad testnet with test AUSD. Duels execute real testnet Perpl trades, while Practice is a simulation. The tokens have no monetary value.'],
  ['Do I need a wallet?', 'Create a Mera passkey account with your device, then claim 200 test AUSD. No seed phrase, extension, email or OTP. Use the same passkey to recover the account in a fresh browser.'],
  ['Who holds the pot?', REAL_TRADING ? 'The PerplArena contract escrows entries and pays prizes onchain after settlement. A separate trading account holds each player’s 100 AUSD budget. Trading and fees can reduce it; remaining capital returns to that player. Settlement is coordinated by the keeper.' : 'The arena contract escrows stakes and pays prizes after settlement.'],
  ['What happens if I get liquidated?', REAL_TRADING ? 'Perpl closes the position and the round uses the actual remaining trading balance. Entry and trading capital are both at risk. The report shows returned capital separately from the prize.' : 'The position closes when it reaches its liquidation threshold.'],
  ['How long does matchmaking take?', 'By default, matchmaking waits for human players. Enable Match with bots in Settings to let labelled sparring bots fill empty seats after about 12 seconds.'],
];

/** The real BTC mark from Perpl (via the keeper feed), ticking green/red. Hidden until the feed has a price. */
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
              Sixty-second BTC duels. Sign in with a passkey, go long or short, and outtrade your rival. Trades execute on Monad testnet and the contract pays the winner.
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
            <div className="lp-credits">
              <span>Built on Monad</span>
              <span>Priced by Perpl</span>
              <span>Accounts by Mera</span>
              <span>Test AUSD by Agora</span>
            </div>
          </div>
        </div>
        <MarkTag />
      </section>

      {/* ─── bounty tracks ─── */}
      <Tracks />

      {/* ─── modes ─── */}
      <section id="modes" className="lp-section">
        <div className="lp-wrap">
          <div className="lp-head">
            <h2 className="lp-h2">Pick your fight</h2>
            <p>{REAL_TRADING ? 'One live format: a 60-second BTC Duel with test AUSD. Try free simulated Practice before entering.' : 'Three formats, one rule: the best trader in the lobby walks away with the pot.'}</p>
          </div>
          <div className={`grid gap-4 ${REAL_TRADING ? 'md:max-w-xl' : 'md:grid-cols-3'}`}>
            {MODES.map(({ key, n, name, meta, line }, i) => (
              <motion.button
                key={key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ delay: i * 0.08, duration: 0.6, ease: EASE }}
                className="lp-mode"
                onClick={() => play(`/play?mode=${key}`)}
                onMouseEnter={sfx.hover}
              >
                <div className="lp-mode-stage">
                  <ModeViz mode={key} />
                </div>
                <div className="lp-mode-body">
                  <div className="flex items-baseline justify-between">
                    <span className="lp-mono">{n}</span>
                    <span className="lp-mono">{meta}</span>
                  </div>
                  <h3 className="lp-h3">{name}</h3>
                  <p>{line}</p>
                  <span className="lp-mode-go">
                    Queue {name}
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M5 12h13M13 6l6 6-6 6" />
                    </svg>
                  </span>
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
            <p>Each Duel uses real testnet transactions for entry, trading and payout. Receipt links show exactly what confirmed.</p>
          </div>
          <div className="lp-numbers">
            {[
              ['1', 'passkey', 'Your account and round signers reconstruct from your passkey. No seed phrase or wallet extension.'],
              ['2.5', '%', 'Prize-pool rake. Perpl trading fees apply separately and appear in the match report.'],
              ['60', 's', 'Per duel. Short enough for a coffee break, long enough to get liquidated.'],
            ].map(([v, u, d]) => (
              <div key={u}>
                <div className="lp-num">
                  {v}
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
            your Duel?
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
      <div className="lp-wrap grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="lp-h2 overflow-hidden">
            {['Ques', 'tions'].map((w, i) => (
              <motion.span key={w} className="inline-block" initial={{ y: '105%' }} whileInView={{ y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.7, ease: EASE }}>
                {w}
              </motion.span>
            ))}
          </h2>
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
