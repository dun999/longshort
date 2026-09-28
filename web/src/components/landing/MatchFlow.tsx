'use client';
import { motion } from 'motion/react';
import { STAKE } from '@longshort/shared';

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
  { n: '01', t: 'Queue', d: 'Pick a mode and stake. Matchmaking fills the lobby in seconds; a labelled bot takes any seat still empty after 12s.', v: <Radar /> },
  { n: '02', t: 'Face-off', d: 'Match found. Lock your class (Tank 10x, Scout 25x, Sniper 50x), see who you drew, then the countdown.', v: <FaceOff /> },
  { n: '03', t: 'Fight', d: 'Long, short, close, repeat. Every click is a Monad transaction that confirms before the candle does.', v: <Candles /> },
  { n: '04', t: 'Payout', d: 'At the bell ArenaCore closes every position at the oracle mark and pays the winners from the pot.', v: <Payout /> },
];

export function MatchFlow() {
  return (
    <section id="how" className="lp-flow">
      <div className="lp-wrap">
        <div className="lp-head">
          <h2 className="lp-h2">From queue to payout</h2>
          <p>A whole match fits in a minute. Here is what happens between hitting Play and getting paid.</p>
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
