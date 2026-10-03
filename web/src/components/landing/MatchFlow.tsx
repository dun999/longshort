'use client';
import { motion } from 'motion/react';
import { MODES, Mode, REAL_TRADING, STAKE } from '@longshort/shared';

/*
 * "From queue to payout": the four beats of a match, each with a small looping vignette.
 * Lives in the light (paper) section of the landing page.
 */

const EASE = [0.2, 0.8, 0.2, 1] as const;

function Radar() {
  return (
    <div className="lpf-radar">
      <span className="lpf-sweep" />
      {[
        [30, 38],
        [66, 28],
        [58, 70],
      ].map(([x, y], i) => (
        <i key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.7}s` }} />
      ))}
    </div>
  );
}

function FaceOff() {
  return (
    <div className="lpf-vs">
      <span className="a" />
      <b>VS</b>
      <span className="b" />
    </div>
  );
}

function Candles() {
  const c = [0.5, 0.7, 0.4, 0.8, 0.55, 0.9, 0.65];
  return (
    <div className="lpf-candles">
      {c.map((h, i) => (
        <i key={i} className={i % 3 === 2 ? 'dn' : 'up'} style={{ height: `${h * 100}%`, animationDelay: `${i * 0.18}s` }} />
      ))}
    </div>
  );
}

function Payout() {
  return (
    <div className="lpf-pay">
      <span className="num">+9.75</span>
      <small>{STAKE}</small>
    </div>
  );
}

const STEPS = [
  { n: '01', t: 'Queue', d: REAL_TRADING ? 'Sign in with Mera, claim AUSD, pick Duel, Squad or Royale, then fund your seat: entry plus a separate 100 AUSD Perpl account.' : 'Pick a mode and stake. Matchmaking fills the lobby in seconds; a labelled bot takes any seat still empty after 12s.', v: <Radar /> },
  { n: '02', t: 'Face-off', d: REAL_TRADING ? 'Meet your rivals: equal AUSD balances, BTC only, at 5x, 10x or 15x (in a Squad, the leader picks). Then a short countdown.' : 'Match found. Lock your class (Tank 10x, Scout 25x, Sniper 50x), see who you drew, then the countdown.', v: <FaceOff /> },
  { n: '03', t: 'Fight', d: 'Long, short, close, repeat. Round controls use your scoped signing session without extra passkey prompts. Each confirmed trade has a Monad receipt.', v: <Candles /> },
  { n: '04', t: 'Payout', d: REAL_TRADING ? 'Positions close on Perpl at the bell and the contract pays the pot: the Duel winner, the winning Squad, or the Royale top three. Your remaining trading capital comes back to you.' : 'At the bell ArenaCore closes every position at the oracle mark and pays the winners from the pot.', v: <Payout /> },
];

export function MatchFlow() {
  return (
    <section id="how" className="lp-flow lp-cut">
      <div className="lp-wrap">
        <div className="lp-head">
          <h2 className="lp-h2">From queue to payout</h2>
          <p>The round clock runs {MODES[Mode.DUEL].duration}s in a Duel, {MODES[Mode.SQUAD].duration}s in a Squad and {MODES[Mode.ROYALE].duration}s in a Royale. Matchmaking, the countdown and settlement happen outside it.</p>
        </div>
        <div className="lpf-grid">
          {STEPS.map((s, i) => (
            <motion.div key={s.n} className="lpf-step" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ delay: i * 0.08, duration: 0.6, ease: EASE }}>
              <div className="lpf-vis">{s.v}</div>
              <span className="lp-mono">{s.n}</span>
              <h3 className="lp-h3">{s.t}</h3>
              <p>{s.d}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
