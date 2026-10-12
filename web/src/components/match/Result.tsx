'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MotionConfig, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { MARGIN, MODES, Mode, STAKE, explorerTx, fmtUsd, level, payouts } from '@longshort/shared';
import RESULT from '@/assets/cast/result.json';
import type { MatchView, PlayerView } from '@/lib/match';
import { sfx } from '@/lib/sfx';
import { useApi } from '@/lib/api';
import { awards, compute, winMargin, type Row } from '@/lib/matchStats';
import { ordinal, practiceCode, rankedCode, shareText, type CardData } from '@/lib/shareLink';
import { useLang, useT } from '@/lib/i18n';
import { ShareIcon, ShareSheet } from './ShareSheet';
import { useCapital } from './TradingCapital';
import { Fighter, type FighterPose } from './Fighter';
import { Plinth, TOP, plinthHeight } from './Plinth';

const EASE = [0.2, 0.8, 0.2, 1] as const;
const COUNT = [0.16, 1, 0.3, 1] as const;
const TEAM_NAME = ['Alpha', 'Bravo'];

/** One figure on the stage: where it stands (% of the stage), its size, pose, light and plinth. */
interface Spot {
  p: PlayerView;
  x: number;
  y: number;
  s: number;
  pose: FighterPose;
  lit: boolean;
  dim: boolean;
  plinth: 'gold' | 'tall' | 'stone';
  tag?: string;
  flip: boolean;
}

/** Counts a number up from zero with rising ticks; a hidden copy of the final value holds the width. */
function Tally({ to, fmt, delay, still, onDone }: { to: number; fmt: (n: number) => string; delay: number; still: boolean; onDone: () => void }) {
  const v = useMotionValue(0);
  const fmtRef = useRef(fmt);
  const doneRef = useRef(onDone);
  fmtRef.current = fmt;
  doneRef.current = onDone;
  const text = useTransform(v, (x) => fmtRef.current(x));
  useEffect(() => {
    if (still) return void (v.set(to), doneRef.current());
    let last = 0;
    const c = animate(v, to, {
      duration: 1.5,
      ease: COUNT,
      delay,
      onUpdate: (x) => {
        const now = performance.now();
        if (now - last < 75 || x >= to) return;
        last = now;
        sfx.tally(to ? x / to : 1);
      },
      onComplete: () => doneRef.current(),
    });
    return () => c.stop();
  }, [to, v, delay, still]);
  return (
    <span className="vx-amt">
      <span aria-hidden className="ghost">{fmt(to)}</span>
      <motion.span aria-hidden>{text}</motion.span>
    </span>
  );
}

/** Gold shards falling through the light when the prize lands (one burst, skipped with reduced motion). */
function Shards({ x }: { x: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const box = cv.getBoundingClientRect();
    const ctx = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = box.width * dpr;
    cv.height = box.height * dpr;
    ctx.scale(dpr, dpr);
    const cols = ['#ffc857', '#e9b04a', '#f6dc95', '#b98a2e', '#efe9dc'];
    const cx = (box.width * x) / 100;
    const ps = Array.from({ length: 70 }, () => ({
      x: cx + (Math.random() - 0.5) * box.width * 0.34,
      y: -Math.random() * box.height * 0.5,
      vx: (Math.random() - 0.5) * 1.2,
      vy: 1.5 + Math.random() * 2.5,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      w: 4 + Math.random() * 7,
      c: cols[(Math.random() * cols.length) | 0],
    }));
    let raf = 0;
    const t0 = performance.now();
    const frame = (t: number) => {
      const age = (t - t0) / 1000;
      ctx.clearRect(0, 0, box.width, box.height);
      ctx.globalAlpha = Math.max(0, Math.min(1, 3.4 - age));
      for (const p of ps) {
        p.vy += 0.06;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.moveTo(0, -p.w / 2);
        ctx.lineTo(p.w / 2, p.w / 3);
        ctx.lineTo(-p.w / 2, p.w / 4);
        ctx.fill();
        ctx.restore();
      }
      if (age < 3.4) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [x]);
  return <canvas ref={ref} className="vx-shards" aria-hidden />;
}

// drifting debris in the dark, fixed so every render matches
const DEBRIS = [
  [8, 22, 14, 0], [18, 64, 9, 3], [31, 12, 7, 6], [57, 9, 11, 2], [71, 18, 8, 8], [83, 58, 12, 4], [92, 30, 7, 1], [64, 72, 6, 5], [40, 80, 8, 7],
] as const;

/** Your reward in level terms: the XP it gave and whether it took you up a level. */
function useLevelUp(m: MatchView, xpDelta: number) {
  const { data } = useApi<{ profile?: { xp: number } }>(m.me && m.id > 0 ? `/profile/${m.me.addr}` : null);
  const xp = data?.profile?.xp;
  return xp !== undefined && level(xp) > level(xp - xpDelta);
}

export function Result({ m, onAgain, busy }: { m: MatchView; onAgain: () => void; busy: boolean }) {
  const t = useT();
  const lang = useLang((x) => x.lang);
  // read only in effects and after the first paint, so the server and client markup match
  const still = !!useReducedMotion();
  const router = useRouter();
  const practice = m.id === 0;
  const royale = m.mode === Mode.ROYALE;
  const settled = !!m.results?.length;
  const resultOf = (p: PlayerView) => m.results?.find((r) => r.addr === p.addr);
  const equityOf = (p: PlayerView) => resultOf(p)?.final_equity ?? p.equity;
  const paidOf = (p: PlayerView) => resultOf(p)?.payout ?? 0;
  const won = (p: PlayerView) => {
    const r = resultOf(p);
    return !!r && r.result !== 'draw' && (r.result === 'win' || r.payout > 0);
  };
  const mine = m.me ? resultOf(m.me) : undefined;
  const draw = !!m.results?.some((r) => r.result === 'draw');
  const outcome: 'win' | 'loss' | 'draw' | 'over' | 'pending' = !settled ? 'pending' : draw ? 'draw' : !m.me ? 'over' : mine?.result === 'win' || (mine?.payout ?? 0) > 0 ? 'win' : 'loss';
  const standings = [...m.players].sort((a, b) => paidOf(b) - paidOf(a) || equityOf(b) - equityOf(a));
  const rankOf = (p: PlayerView) => standings.indexOf(p) + 1;
  const rank = m.me ? rankOf(m.me) : 0;
  const top = standings[0];
  const place = (n: number) => (lang === 'en' ? ordinal(n) : `#${n}`);
  const xpUp = useLevelUp(m, mine?.xp_delta ?? 0);
  const capital = useCapital(m.id, m.accounts, m.refresh);
  const [landed, setLanded] = useState(false);
  const [sharing, setSharing] = useState<{ code: string; text: string } | null>(null);

  useEffect(() => {
    if (outcome === 'loss') sfx.lose();
  }, [outcome]);
  // Enter queues the next match, Esc quits to the lobby, as in most fighting games' result screens
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sharing || document.querySelector('[role="dialog"][aria-modal="true"]')) return; // an open dialog owns the keyboard
      if (e.key === 'Escape') return void (sfx.click(), router.push('/play'));
      if (e.key === 'Enter' && m.me && !busy && !['BUTTON', 'INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) (sfx.click(), onAgain());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onAgain, router, m.me, sharing]);

  // ─── who stands where ──────────────────────────────────────────────────
  const { spots, cone } = (() => {
    const spot = (p: PlayerView, x: number, y: number, s: number, o: Partial<Spot> = {}): Spot => ({ p, x, y, s, pose: 'idle', lit: false, dim: false, plinth: 'stone', flip: x > 56, ...o });
    const beaten = (p: PlayerView, x: number, y: number, s: number, tag = t('rs.defeat')) => spot(p, x, y, s, { pose: 'sulk', dim: true, tag });
    if (!settled || draw) {
      const row = standings.slice(0, royale ? 3 : 4);
      const xs = row.length === 2 ? [32, 66] : row.length === 3 ? [24, 50, 76] : [17, 39, 61, 83];
      const s = row.length <= 2 ? 0.86 : row.length === 3 ? 0.72 : 0.6;
      return { spots: row.map((p, i) => spot(p, xs[i], 21, s, { lit: true, flip: i >= row.length / 2 })), cone: { x: 50, y: 21, w: 1.9, gold: false } };
    }
    if (m.mode === Mode.DUEL) {
      const [w, l] = standings;
      return { spots: [...(l ? [beaten(l, 79, 33, 0.6)] : []), spot(w, 44, 20, 1, { pose: 'cheer', lit: true, plinth: 'gold', flip: false })], cone: { x: 44, y: 20, w: 1, gold: true } };
    }
    if (m.mode === Mode.SQUAD) {
      const ws = standings.filter(won);
      const ls = standings.filter((p) => !won(p));
      return {
        spots: [...ls.map((p, i) => beaten(p, 78 + i * 13, 34 - i, 0.46)), ...ws.map((p, i) => spot(p, 36 + i * 23, 20 - i, 0.82, { pose: 'cheer', lit: true, plinth: 'gold', flip: false }))],
        cone: { x: 47.5, y: 19.5, w: 1.55, gold: true },
      };
    }
    // royale: the paid three on a podium, first in the light; a viewer outside it waits at the back
    const [a, b, c] = standings;
    const out: Spot[] = [];
    if (m.me && rank > 3) out.push(beaten(m.me, 87, 37, 0.44, place(rank)));
    if (b) out.push(spot(b, 24, 20, 0.72, { pose: won(b) ? 'cheer' : 'sulk', plinth: 'gold', tag: place(2), flip: false }));
    if (c) out.push(spot(c, 70, 19, 0.68, { pose: won(c) ? 'cheer' : 'sulk', plinth: 'gold', tag: place(3) }));
    out.push(spot(a, 47, 25, 0.94, { pose: 'cheer', lit: true, plinth: 'tall', flip: false }));
    return { spots: out, cone: { x: 47, y: 25, w: 1, gold: true } };
  })();

  // ─── the words ─────────────────────────────────────────────────────────
  const word = t(outcome === 'win' ? 'rs.victory' : outcome === 'loss' ? 'rs.defeat' : outcome === 'draw' ? 'rs.draw' : outcome === 'over' ? 'rs.over' : 'rs.settling');
  const tone = outcome === 'win' || outcome === 'over' ? 'gold' : outcome === 'loss' ? 'red' : 'bone';
  const myRoi = m.me ? ((equityOf(m.me) - MARGIN) / MARGIN) * 100 : 0;
  const gap = winMargin(m.players.map((p) => ({ team: p.team, equity: equityOf(p) })));
  const winnerName = m.mode === Mode.SQUAD && top ? TEAM_NAME[top.team] : top?.name;
  // the prize counts up for whoever won it: you, or the winner when you're watching
  const prize = outcome === 'win' ? (mine?.payout ?? 0) : outcome === 'over' && top ? paidOf(top) : outcome === 'draw' ? (mine?.payout ?? 0) : 0;
  const counted = practice ? (settled && m.me ? myRoi : null) : prize > 0 ? prize : null;
  const fmt = practice ? (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%` : (n: number) => `+${n.toFixed(2)}`;
  const big =
    counted !== null ? null
    : outcome === 'loss' ? (royale ? t('rs.place', { rank: place(rank), n: m.players.length }) : t('rs.lostBy', { amount: fmtUsd(gap) }))
    : outcome === 'draw' ? t('rs.deadHeat')
    : outcome === 'pending' ? t('rs.paying')
    : word;
  const shares = payouts(m.mode, m.entry, m.players.length);
  const pct = (r: number) => Math.round((([shares.first, shares.second ?? 0, shares.third ?? 0][r - 1] ?? 0) / (shares.first + (shares.second ?? 0) + (shares.third ?? 0))) * 100);
  const line =
    practice ? t('rs.practice')
    : outcome === 'win' ? (royale ? t('rs.royalePot', { place: place(rank), pct: pct(rank) }) : t(m.mode === Mode.SQUAD ? 'rs.teamTakesPot' : 'rs.takesPot'))
    : outcome === 'loss' || outcome === 'over' ? (!winnerName ? '' : t(royale ? 'rs.nameTakesFirst' : 'rs.nameTakesPot', { name: winnerName }))
    : outcome === 'draw' ? t('rs.refundedLine')
    : '';
  const back = capital.account && !practice ? capital.account.returned : null;
  const xp = mine && !practice && mine.xp_delta !== 0 ? `${mine.xp_delta > 0 ? '+' : ''}${mine.xp_delta} XP${xpUp ? t('rs.levelUp') : ''}` : '';
  const paidLine = [settled && !practice ? t(outcome === 'draw' ? 'rs.refundedBy' : 'rs.paidBy') : '', xp].filter(Boolean).join(' · ');
  const gold = outcome === 'win' && !practice;
  const land = () => {
    setLanded(true);
    if (outcome === 'win') sfx.win();
  };

  // your result (or the winner's, when spectating) as a link whose card unfurls wherever it's posted
  const stats = useMemo(
    () =>
      compute(
        { start_at: m.startAt, end_at: m.endAt },
        m.players.map((p) => {
          const r = m.results?.find((x) => x.addr === p.addr);
          return { ...p, result: r?.result ?? null, payout: r?.payout ?? 0, final_equity: r?.final_equity ?? p.equity, xp_delta: r?.xp_delta ?? 0 };
        }),
        m.trades as Row[],
        m.fills,
      ),
    [m.players, m.results, m.trades, m.fills, m.startAt, m.endAt],
  );
  const share = () => {
    const who = m.me ?? top;
    if (!who) return;
    sfx.click();
    const r = resultOf(who);
    const card: CardData = {
      outcome: r?.result === 'win' || r?.result === 'loss' || r?.result === 'draw' ? r.result : 'over',
      roi: ((equityOf(who) - MARGIN) / MARGIN) * 100,
      equity: equityOf(who),
      payout: r?.payout ?? 0,
      name: who.name,
      addr: who.addr,
      leverage: who.leverage,
      character: who.character,
      mode: m.mode,
      rival: m.mode === Mode.DUEL ? m.players.find((p) => p.addr !== who.addr)?.name : undefined,
      place: rankOf(who),
      of: m.players.length,
      award: awards(stats).find((a) => a.who.addr === who.addr)?.k,
      practice,
      id: m.id,
    };
    setSharing({ code: practice ? practiceCode(card) : rankedCode(m.id, who.addr), text: shareText(card, !!m.me) });
  };

  // MotionConfig below drops the movement for reduced-motion users and keeps the fades
  const enter = (delay: number, y = 18) => ({ initial: { opacity: 0, y }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.6, ease: EASE } });
  const rise = 0.55;
  const copyAt = counted !== null ? 1.25 : 0.9;

  return (
    <MotionConfig reducedMotion="user">
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className={`vx vx-${tone}`}>
      {/* the result as one huge outlined word behind everything */}
      <motion.div
        key={word}
        className={`vx-word ${word.length > 8 ? 'long' : ''}`}
        aria-hidden
        initial={{ clipPath: 'inset(-20% 100% -20% 0)', x: -60 }}
        animate={{ clipPath: 'inset(-20% -5% -20% 0)', x: 0 }}
        transition={{ delay: 0.1, duration: 1, ease: EASE }}
      >
        <span>{word}</span>
      </motion.div>
      {DEBRIS.map(([x, y, s, d], i) => (
        <i key={i} className="vx-debris" style={{ left: `${x}%`, top: `${y}%`, ['--s' as string]: `${s}px`, animationDelay: `${-d * 2.3}s` }} />
      ))}

      <div className="vx-stage">
        <div className={`vx-cone ${cone.gold ? '' : 'plain'}`} style={{ ['--cx' as string]: `${cone.x}%`, ['--cy' as string]: `${cone.y}%`, ['--cw' as string]: cone.w }}>
          <i />
          {Array.from({ length: 9 }, (_, i) => (
            <b key={i} style={{ left: `${12 + ((i * 37) % 76)}%`, animationDelay: `${-i * 1.1}s`, animationDuration: `${7 + (i % 4) * 1.6}s` }} />
          ))}
        </div>
        {spots.map((sp, i) => {
          const r = RESULT[sp.p.character];
          const ph = plinthHeight(sp.plinth) - TOP;
          return (
            <motion.div
              key={sp.p.addr}
              className={`vx-spot ${sp.lit ? 'lit' : ''} ${sp.dim ? 'dim' : ''}`}
              style={{ left: `${sp.x}%`, bottom: `${sp.y}%`, ['--s' as string]: sp.s, ['--fh' as string]: r.h * r.y * 0.78, ['--ph' as string]: ph }}
              {...(sp.lit ? { initial: { opacity: 0, y: 46 }, animate: { opacity: 1, y: 0 }, transition: { delay: rise + i * 0.06, type: 'spring', stiffness: 170, damping: 19 } } : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay: rise + 0.15, duration: 0.7 } })}
            >
              <Plinth kind={sp.plinth} className="vx-plinth" />
              <Fighter id={sp.p.character} pose={sp.pose} flip={sp.flip} />
              {sp.tag && (
                <motion.span className={`vx-tag ${sp.dim ? 'out' : ''}`} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: rise + 0.5, type: 'spring', stiffness: 380, damping: 18 }}>
                  {sp.tag}
                </motion.span>
              )}
              <span className="vx-plate">
                <span className="truncate">{sp.p.name}</span>
                {sp.p.isMe && <em>{t('hud.you')}</em>}
              </span>
            </motion.div>
          );
        })}
        {landed && gold && !still && <Shards x={cone.x} />}
      </div>

      <div className="vx-kicker">
        {practice ? <b>{t('rs.practiceTag')}</b> : <><b>#{m.id}</b> {MODES[m.mode].name}</>}
      </div>

      <div className="vx-copy">
        {counted !== null ? (
          <motion.div className={`vx-big ${practice ? (counted >= 0 ? 'gold' : 'red') : outcome === 'draw' ? 'bone' : 'gold'} ${landed ? 'landed' : ''}`} aria-label={`${fmt(counted)}${practice ? '' : ` ${STAKE}`}`} {...enter(0.75, 24)}>
            <Tally to={counted} fmt={fmt} delay={0.9} still={still} onDone={land} />
            {!practice && <small>{STAKE}</small>}
          </motion.div>
        ) : (
          <motion.div className={`vx-big text ${tone}`} {...enter(0.75, 24)}>
            {big}
          </motion.div>
        )}
        {line && (
          <motion.div className="vx-line" {...enter(copyAt)}>
            {line}
          </motion.div>
        )}
        {(paidLine || back !== null) && (
          <motion.div className="vx-cap" {...enter(copyAt + 0.12, 10)}>
            {paidLine && <span>{paidLine}</span>}
            {back !== null && !capital.outstanding && <span>{t('rs.capitalBack', { amount: back.toFixed(2), stake: STAKE })}</span>}
          </motion.div>
        )}
        {(capital.outstanding > 0 || capital.message || m.settleTx) && (
          <motion.div className="vx-meta" {...enter(copyAt + 0.2, 10)}>
            {capital.outstanding > 0 && (
              <button className="gbtn ghost sm" disabled={capital.pending} onClick={() => void capital.recover()}>
                {t(capital.pending ? 'capital.pending' : 'capital.recover', { amount: capital.outstanding.toFixed(2) })}
              </button>
            )}
            {capital.message && <span role="status">{capital.message}</span>}
            {m.settleTx && (
              <a className="vx-proof" href={explorerTx(m.settleTx)} target="_blank" rel="noreferrer" title="The payout was made by the arena contract. Open the settlement to check it yourself.">
                <i>✓</i> {t('rs.verified')} <span>{t('rs.proof')}</span>
              </a>
            )}
          </motion.div>
        )}

        <motion.div className="vx-actions" {...enter(copyAt + 0.25, 12)}>
          <button className="btn-play" disabled={busy || !m.me} onClick={() => (sfx.click(), onAgain())}>
            {t(busy ? 'rs.finding' : practice ? 'rs.again' : 'rs.rematch')}
            {!busy && <span className="kbd ml-3">↵</span>}
          </button>
          <div className="vx-links">
            <Link href="/play" className="gbtn ghost" onMouseEnter={sfx.hover}>
              {t('rs.lobby')} <span className="kbd ml-2">Esc</span>
            </Link>
            {!practice && (
              <Link href={`/match/${m.id}/report`} className="gbtn ghost" onMouseEnter={sfx.hover}>
                {t('rs.details')}
              </Link>
            )}
            <button className="gbtn ghost" onClick={share} onMouseEnter={sfx.hover}>
              <ShareIcon /> {t('rs.shareBtn')}
            </button>
          </div>
        </motion.div>
      </div>
      {sharing && <ShareSheet code={sharing.code} text={sharing.text} onClose={() => setSharing(null)} />}
    </motion.div>
    </MotionConfig>
  );
}
