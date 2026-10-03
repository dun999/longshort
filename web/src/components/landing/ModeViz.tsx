'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, AnimatePresence, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { CLASSES, ENTRY_TIERS, Mode, MODES, payouts, royaleRounds } from '@longshort/shared';
import { PlayerMark } from '@/components/PlayerMark';

/*
 * Mode card key art: each card replays one scripted round in the game's own vocabulary (balances,
 * team totals, the cut list) on a match clock, with a one-line caption per beat. Motion only ever
 * means something happened in the round: a balance moves, the lead changes hands, a row is cut.
 * Beats are short ease-out state changes followed by a hold (after Linear/Stripe-style UI replays),
 * never ambient drift. Payouts come from the same payouts() the contract mirrors, at the smallest entry.
 * Reduced motion shows the final beat, which carries the whole rule.
 */

const EASE = [0.2, 0.8, 0.2, 1] as const;
const ENTRY = ENTRY_TIERS[0];
const LEV = [CLASSES.tank.leverage, CLASSES.scout.leverage, CLASSES.sniper.leverage] as const;
const usd = (n: number) => n.toFixed(2);
const clock = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

/** Steps through `frames` (each holds for its own `ms`) while the card is on screen. */
function useReplay<T extends { ms: number }>(frames: T[]) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { amount: 0.45 });
  const still = useReducedMotion();
  const [at, setAt] = useState({ i: 0, loop: 0 });
  useEffect(() => {
    if (still || !seen) return;
    const id = setTimeout(() => setAt(({ i, loop }) => (i + 1 < frames.length ? { i: i + 1, loop } : { i: 0, loop: loop + 1 })), frames[at.i].ms);
    return () => clearTimeout(id);
  }, [at, seen, still, frames]);
  const i = still ? frames.length - 1 : at.i;
  return { ref, f: frames[i], i, loop: at.loop };
}

/** A number that counts to its new value instead of jumping. */
function Num({ v, sign = false, className }: { v: number; sign?: boolean; className?: string }) {
  const mv = useMotionValue(v);
  const text = useTransform(mv, (x) => `${sign && x > 0.004 ? '+' : sign && x < -0.004 ? '−' : ''}${usd(sign ? Math.abs(x) : x)}`);
  useEffect(() => {
    const c = animate(mv, v, { duration: 0.5, ease: EASE });
    return () => c.stop();
  }, [v, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}

const tone = (d: number) => (d > 0.004 ? 'up' : d < -0.004 ? 'down' : '');

/** Shared frame: label + match clock on top, the board, the caption, and the match timeline. */
function Board({ label, t, total, marks = [], caption, loop, boardRef, children }: { label: string; t: number; total: number; marks?: number[]; caption: string; loop: number; boardRef: React.RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const done = total - t;
  return (
    <div ref={boardRef} className="mv">
      <div className="mv-top">
        <span>{label}</span>
        <span className={`mv-clock ${t === 0 ? 'bell' : ''}`}>{t === 0 ? 'Bell' : clock(t)}</span>
      </div>
      {/* a new loop remounts the board, so the round restarts clean instead of rewinding */}
      <motion.div key={loop} className="mv-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        {children}
      </motion.div>
      <div className="mv-cap" aria-hidden>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={caption} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.18, ease: EASE }}>
            {caption}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="mv-rail">
        <i style={{ transform: `scaleX(${done / total})` }} />
        {marks.map((m) => (
          <b key={m} className={done >= m ? 'hit' : ''} style={{ left: `${(m / total) * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

// ─── Duel: two balances, the lead changes hands, the bigger one at the bell takes the pot ───
const DUEL_POT = payouts(Mode.DUEL, ENTRY, 2).first;
type DuelF = { ms: number; t: number; btc: number; you: number; rival: number; youPos?: string; rivalPos?: string; cap: string };
const DUEL: DuelF[] = [
  { ms: 1300, t: 60, btc: 0, you: 100, rival: 100, cap: 'Both start with 100 AUSD to trade' },
  { ms: 1500, t: 54, btc: 0, you: 100, rival: 100, youPos: `Long ${LEV[2]}x`, rivalPos: `Short ${LEV[0]}x`, cap: 'You go long, your rival goes short' },
  { ms: 1500, t: 41, btc: 0.25, you: 103.56, rival: 98.81, youPos: `Long ${LEV[2]}x`, rivalPos: `Short ${LEV[0]}x`, cap: 'BTC climbs: you take the lead' },
  { ms: 1600, t: 27, btc: -0.2, you: 97.15, rival: 100.95, youPos: `Long ${LEV[2]}x`, rivalPos: `Short ${LEV[0]}x`, cap: 'BTC drops: your rival leads' },
  { ms: 1500, t: 19, btc: -0.2, you: 97.15, rival: 100.95, youPos: `Short ${LEV[2]}x`, rivalPos: `Short ${LEV[0]}x`, cap: `You flip short at ${LEV[2]}x` },
  { ms: 1500, t: 6, btc: -0.7, you: 104.05, rival: 103.33, youPos: `Short ${LEV[2]}x`, rivalPos: `Short ${LEV[0]}x`, cap: `Both gain, but ${LEV[2]}x gains faster` },
  { ms: 3200, t: 0, btc: -0.7, you: 104.05, rival: 103.33, cap: 'Bigger balance takes the pot' },
];

function Duel() {
  const { ref, f, loop } = useReplay(DUEL);
  const lead = f.you === f.rival ? null : f.you > f.rival ? 'you' : 'rival';
  const over = f.t === 0;
  const row = (who: 'you' | 'rival', name: string, bal: number, pos?: string) => (
    <div className={`mv-duel-row ${over && lead !== who ? 'lost' : ''}`}>
      {lead === who && <motion.i layoutId="mv-duel-lead" className="mv-lead" transition={{ duration: 0.35, ease: EASE }} />}
      <span className="mv-who">{name}</span>
      <span className="mv-chipslot">
        <AnimatePresence mode="popLayout" initial={false}>
          {over && lead === who ? (
            <motion.span key="win" className="mv-win" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22, ease: EASE }}>
              Wins +{usd(DUEL_POT)}
            </motion.span>
          ) : pos ? (
            <motion.span key={pos} className={`mv-pos ${pos.startsWith('Long') ? 'long' : 'short'}`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2, ease: EASE }}>
              {pos}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
      <span className="mv-bal">
        <Num v={bal} />
        <Num v={bal - 100} sign className={`mv-delta ${tone(bal - 100)}`} />
      </span>
    </div>
  );
  return (
    <Board label="Balance · AUSD" t={f.t} total={MODES[Mode.DUEL].duration} caption={f.cap} loop={loop} boardRef={ref}>
      <div className="mv-btc">
        BTC <b className={tone(f.btc)}>{f.btc > 0 ? '▲ +' : f.btc < 0 ? '▼ −' : ''}{Math.abs(f.btc).toFixed(2)}%</b>
      </div>
      {row('you', 'You', f.you, f.youPos)}
      {row('rival', 'Rival', f.rival, f.rivalPos)}
    </Board>
  );
}

// ─── Squad: four balances, two team totals; the leader's leverage applies to the whole team ───
const SQUAD_EACH = payouts(Mode.SQUAD, ENTRY, 4).first;
type SquadF = { ms: number; t: number; b: [number, number, number, number]; lev?: [number?, number?]; follow?: boolean; cap: string };
const SQUAD: SquadF[] = [
  { ms: 1300, t: 120, b: [100, 100, 100, 100], cap: 'Two teams of two, 100 AUSD each' },
  { ms: 1500, t: 116, b: [100, 100, 100, 100], lev: [LEV[1], LEV[0]], cap: 'Each leader picks the team’s leverage' },
  { ms: 1500, t: 112, b: [100, 100, 100, 100], lev: [LEV[1], LEV[0]], follow: true, cap: 'Teammates trade at their leader’s pick' },
  { ms: 1700, t: 80, b: [106.1, 97.4, 101.2, 99.6], lev: [LEV[1], LEV[0]], follow: true, cap: 'Your mate is down, but Alpha’s total leads' },
  { ms: 1600, t: 40, b: [104.3, 98.1, 103.9, 100.4], lev: [LEV[1], LEV[0]], follow: true, cap: 'Bravo pulls ahead' },
  { ms: 3200, t: 0, b: [107.2, 98.9, 101.7, 99.2], lev: [LEV[1], LEV[0]], follow: true, cap: 'Bigger team total wins; winners split the pot' },
];

function Squad() {
  const { ref, f, loop } = useReplay(SQUAD);
  const tot = [f.b[0] + f.b[1], f.b[2] + f.b[3]];
  const lead = tot[0] === tot[1] ? null : tot[0] > tot[1] ? 0 : 1;
  const over = f.t === 0;
  const team = (k: 0 | 1, name: string, who: [string, string]) => (
    <div className={`mv-team t${k} ${lead === k ? 'ahead' : ''} ${over && lead !== k ? 'lost' : ''}`}>
      <div className="mv-team-head">
        <span>{name}</span>
        {lead === k && <motion.i layoutId="mv-squad-lead" className="mv-lead-tag" transition={{ duration: 0.35, ease: EASE }}>{over ? 'Wins' : 'Ahead'}</motion.i>}
      </div>
      <div className="mv-total">
        <Num v={tot[k]} />
        <Num v={tot[k] - 200} sign className={`mv-delta ${tone(tot[k] - 200)}`} />
      </div>
      {who.map((w, j) => {
        const lev = f.lev?.[k];
        const show = lev && (j === 0 || f.follow);
        return (
          <div key={w} className="mv-mate">
            <span className="mv-who">
              {w}
              {j === 0 && <small>lead</small>}
            </span>
            <span className="mv-chipslot">
              <AnimatePresence initial={false}>
                {show && (
                  <motion.span key="lev" className="mv-pos" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22, ease: EASE }}>
                    {lev}x
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            <Num v={f.b[k * 2 + j]} className={`mv-num ${tone(f.b[k * 2 + j] - 100)}`} />
          </div>
        );
      })}
      <div className="mv-team-foot">
        <AnimatePresence initial={false}>
          {over && lead === k && (
            <motion.span key="pay" className="mv-win" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22, ease: EASE }}>
              +{usd(SQUAD_EACH)} each
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
  return (
    <Board label="Team total · AUSD" t={f.t} total={MODES[Mode.SQUAD].duration} caption={f.cap} loop={loop} boardRef={ref}>
      <div className="mv-squad">
        {team(0, 'Alpha', ['You', 'Mate'])}
        {team(1, 'Bravo', ['P3', 'P4'])}
      </div>
    </Board>
  );
}

// ─── Royale: the standings re-sort every round and the lowest balance is cut; top three are paid ───
const R = MODES[Mode.ROYALE];
const { roundLen } = royaleRounds(R.maxPlayers, R.duration);
const PAY = payouts(Mode.ROYALE, ENTRY, R.maxPlayers);
const PRIZE = [PAY.first, PAY.second!, PAY.third!];
const IDS = ['You', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
const SEED = (id: string) => `0x${[...id].map((c) => c.charCodeAt(0).toString(16)).join('')}c0ffee`;
// balances at each cut (seat order as IDS); you sit one place above the cut in round two and survive
const ROUNDS: number[][] = [
  [98.2, 103.1, 101.4, 96.9, 104.6, 99.5, 97.6, 93.8],
  [97.4, 105.0, 99.2, 95.1, 101.9, 100.8, 98.6, 0],
  [101.5, 102.2, 96.4, 0, 104.4, 98.9, 99.7, 0],
  [104.9, 100.3, 0, 0, 106.1, 97.2, 101.0, 0],
  [108.3, 99.4, 0, 0, 105.2, 0, 102.6, 0],
  [110.6, 0, 0, 0, 104.1, 0, 103.0, 0],
];
type RoyaleF = { ms: number; t: number; bal: number[]; out: string[]; cutting?: string; cap: string };
const ROYALE: RoyaleF[] = (() => {
  const fs: RoyaleF[] = [{ ms: 1300, t: R.duration, bal: Array(8).fill(100), out: [], cap: `${R.maxPlayers} traders, 100 AUSD each` }];
  const out: string[] = [];
  ROUNDS.slice(0, -1).forEach((bal, k) => {
    const t = R.duration - (k + 1) * roundLen;
    const alive = IDS.filter((id) => !out.includes(id));
    const low = alive.reduce((a, b) => (bal[IDS.indexOf(b)] < bal[IDS.indexOf(a)] ? b : a));
    fs.push({ ms: 1150, t, bal, out: [...out], cutting: low, cap: `${clock(R.duration - t)} in: the lowest balance is cut` });
    out.push(low);
    fs.push({ ms: 650, t, bal, out: [...out], cap: `${low} is out · ${R.maxPlayers - out.length} left` });
  });
  fs.push({ ms: 3400, t: 0, bal: ROUNDS.at(-1)!, out: [...out], cap: 'Top three split the pot 60 / 30 / 10' });
  return fs;
})();

function Royale() {
  const { ref, f, loop } = useReplay(ROYALE);
  const over = f.t === 0;
  const bal = (id: string) => f.bal[IDS.indexOf(id)];
  const alive = IDS.filter((id) => !f.out.includes(id)).sort((a, b) => bal(b) - bal(a));
  const order = [...alive, ...[...f.out].reverse()]; // latest cut sits just under the survivors
  const max = Math.max(...alive.map(bal));
  return (
    <Board label="Standings · AUSD" t={f.t} total={R.duration} marks={Array.from({ length: R.maxPlayers - 3 }, (_, k) => (k + 1) * roundLen)} caption={f.cap} loop={loop} boardRef={ref}>
      <div className="mv-list">
        {order.map((id) => {
          const isOut = f.out.includes(id);
          const place = alive.indexOf(id);
          const paid = over && place >= 0 && place < 3;
          return (
            <motion.div key={id} layout transition={{ layout: { duration: 0.42, ease: EASE } }} className={`mv-row ${id === 'You' ? 'me' : ''} ${isOut ? 'out' : ''} ${f.cutting === id ? 'cutting' : ''}`}>
              <span className="mv-rank">{isOut ? '' : place + 1}</span>
              <PlayerMark addr={SEED(id)} size={13} color={id === 'You' ? '#7c5cff' : undefined} />
              <span className="mv-who">{id}</span>
              <span className="mv-bar">{!isOut && <i style={{ transform: `scaleX(${Math.max(0.08, (bal(id) - 90) / (max - 90))})` }} />}</span>
              <span className="mv-num">
                {isOut ? 'Out' : f.cutting === id ? 'Cut' : paid ? <b>+{usd(PRIZE[place])}</b> : <Num v={bal(id)} />}
              </span>
            </motion.div>
          );
        })}
      </div>
    </Board>
  );
}

export function ModeViz({ mode }: { mode: 'duel' | 'squad' | 'royale' }) {
  return mode === 'duel' ? <Duel /> : mode === 'squad' ? <Squad /> : <Royale />;
}
