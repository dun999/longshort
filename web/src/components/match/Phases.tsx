'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react';
import { REAL_TRADING, CLASSES, MARGIN, MODES, Mode, XP, explorerTx, fmtUsd, level, levelProgress, liqMove, type ClassId, STAKE, CHARACTER_INFO } from '@longshort/shared';
import type { MatchView, PlayerView } from '@/lib/match';
import { CLASS_COLOR, TEAM_COLOR, useScene } from '@/lib/scene';
import { PlayerMark } from '../PlayerMark';
import { sfx } from '@/lib/sfx';
import { useApi } from '@/lib/api';
import { awards, compute, type Award, type Row, type Stats } from '@/lib/matchStats';
import { practiceCode, rankedCode, shareText, type CardData } from '@/lib/shareLink';
import { ShareIcon, ShareSheet } from './ShareSheet';
import { useLang, useT } from '@/lib/i18n';
import { TradingCapital } from './TradingCapital';

const fadeUp = { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -24 } };
const EASE = [0.2, 0.8, 0.2, 1] as const;
const BOT_FILL = 12; // keeper fills empty seats with labelled bots after this many seconds (BOT_FILL_AFTER)
const TEAM_NAME = ['Alpha', 'Bravo'];

/** Players split into the two sides the screens show (teams, or alternating seats in a royale). */
function sides(m: MatchView): [PlayerView[], PlayerView[]] {
  if (m.mode === Mode.ROYALE) return [m.players.filter((_, i) => i % 2 === 0), m.players.filter((_, i) => i % 2 === 1)];
  return [m.players.filter((p) => p.team === 0), m.players.filter((p) => p.team === 1)];
}

// ─── matchmaking: searching ─────────────────────────────────────────────────
const STATUS = ['mm.s1', 'mm.s2', 'mm.s3', 'mm.s4'] as const;

function Seat({ p, color, i }: { p?: PlayerView; color: string; i: number }) {
  const t = useT();
  return (
    <motion.div layout className={`mm-seat ${p ? 'on' : ''} ${p?.isMe ? 'me' : ''}`} style={{ ['--c' as string]: color }}>
      <AnimatePresence mode="popLayout" initial={false}>
        {p ? (
          <motion.div key={p.addr} className="flex min-w-0 items-center gap-2.5" initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 22 }}>
            <PlayerMark addr={p.addr} size={34} />
            <div className="min-w-0 text-left">
              <div className="truncate text-[13px] font-semibold">
                {p.isMe ? 'You' : p.name} {p.bot && <span className="text-[9px] text-dim">BOT</span>}
              </div>
              <div className="text-[10px] tracking-[0.18em] uppercase" style={{ color: CLASS_COLOR[p.leverage] }}>
                {CHARACTER_INFO[p.character].name} · {p.leverage}x
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="empty" className="mm-seat-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ animationDelay: `${i * 0.18}s` }}>
            {t('mm.searching')}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function Waiting({ m, now, onLeave, onJoin, leaving }: { m: MatchView; now: number; onLeave?: () => void; onJoin?: () => void; leaving?: boolean }) {
  const T = useT();
  const t = Math.max(0, now - m.createdAt);
  const cfg = MODES[m.mode];
  const teams = m.mode !== Mode.ROYALE;
  const status = STATUS[Math.floor(t / 2.4) % STATUS.length];
  const fillIn = Math.max(0, BOT_FILL - t);

  // a blip for every trader who sits down
  const seen = useRef(m.players.length);
  useEffect(() => {
    if (m.players.length > seen.current) sfx.select();
    seen.current = m.players.length;
  }, [m.players.length]);

  const per = teams ? m.maxPlayers / 2 : m.maxPlayers;
  const [a, b] = teams ? sides(m) : [m.players, []];
  const row = (list: PlayerView[], team: number) =>
    Array.from({ length: per }, (_, i) => <Seat key={i} i={i} p={list[i]} color={teams ? TEAM_COLOR[team] : list[i] ? CLASS_COLOR[list[i].leverage] : '#626873'} />);

  return (
    <motion.div {...fadeUp} className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-5 px-4">
      <div className="flex items-center gap-6">
        <div className="mm-radar" aria-hidden>
          <span className="mm-sweep" />
          {m.players.map((p, i) => (
            <motion.i key={p.addr} initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ left: `${50 + Math.cos(i * 2.4 + 0.6) * 32}%`, top: `${50 + Math.sin(i * 2.4 + 0.6) * 32}%`, background: p.isMe ? 'var(--accent)' : 'var(--green)' }} />
          ))}
          <span className="num mm-clock">
            {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, '0')}
          </span>
        </div>
        <div className="grid gap-1">
          <div className="panel-title">
            {T('mm.lobby', { id: m.id })} · {cfg.name} · {m.entry} {STAKE}
          </div>
          <div className="mm-title">
            {T('mm.finding')} <b>{m.nPlayers}</b>
            <span>/{m.maxPlayers}</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={status} className="mm-status" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.25 }}>
              {T(status)}
              <span className="mm-dots" />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className={`mm-seats ${teams ? 'teams' : ''}`}>
        {teams ? (
          <>
            <div className="mm-team">
              <span style={{ color: TEAM_COLOR[0] }}>{TEAM_NAME[0]}</span>
              {row(a, 0)}
            </div>
            <div className="mm-vs">VS</div>
            <div className="mm-team">
              <span style={{ color: TEAM_COLOR[1] }}>{TEAM_NAME[1]}</span>
              {row(b, 1)}
            </div>
          </>
        ) : (
          row(a, 0)
        )}
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-4">
        <div className="mm-fill">
          {m.allowBots && !m.rematchOf && <i style={{ width: `${Math.min(100, (t / BOT_FILL) * 100)}%` }} />}
          <span>{m.rematchOf ? T('mm.rematch') : !m.allowBots ? T('mm.humans') : fillIn > 0 ? T('mm.botsIn', { n: Math.ceil(fillIn) }) : T('mm.botsNow')}</span>
        </div>
        {onLeave && (
          <button className="gbtn ghost sm" disabled={leaving} onClick={onLeave}>
            {T(leaving ? 'mm.refunding' : 'mm.leave')}
          </button>
        )}
        {onJoin && (
          <button className="gbtn sm" disabled={leaving} onClick={onJoin}>
            {leaving ? T('mm.joining') : T('mm.join', { entry: `${m.entry} ${STAKE}` })}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── matchmaking: found ─────────────────────────────────────────────────────
export function MatchFound({ m }: { m: MatchView }) {
  const t = useT();
  useEffect(() => {
    sfx.found();
    useScene.getState().shake('rgba(124,92,255,0.45)');
  }, []);
  const [a, b] = sides(m);
  const royale = m.mode === Mode.ROYALE;
  return (
    <motion.div className="pointer-events-none fixed inset-0 z-30 grid place-items-center overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.08 }}>
      <motion.div className="absolute inset-0 bg-white" initial={{ opacity: 0.55 }} animate={{ opacity: 0 }} transition={{ duration: 0.5 }} />
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="mm-wave" initial={{ scale: 0.2, opacity: 0.9 }} animate={{ scale: 5, opacity: 0 }} transition={{ duration: 1.3, delay: i * 0.16, ease: 'easeOut' }} />
      ))}
      <motion.div className="mm-band" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.45, ease: EASE }} />
      <div className="relative text-center">
        <motion.div className="mm-found" initial={{ scale: 2.6, opacity: 0, skewX: -18 }} animate={{ scale: 1, opacity: 1, skewX: 0 }} transition={{ type: 'spring', stiffness: 280, damping: 17 }}>
          {t('mm.found')}
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mt-3 font-display text-sm tracking-[0.45em] text-violet uppercase">
          {t('mm.foundSub', { mode: MODES[m.mode].name, n: m.players.length })}
        </motion.div>
        <div className="mt-7 flex items-center justify-center gap-5">
          {[a, b].map((list, side) => (
            <div key={side} className={`flex gap-2 ${side ? 'flex-row-reverse' : ''}`}>
              {list.map((p, i) => (
                <motion.div key={p.addr} className="mm-chip" style={{ ['--c' as string]: royale ? CLASS_COLOR[p.leverage] : TEAM_COLOR[side] }} initial={{ x: side ? 80 : -80, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.45 + i * 0.07, type: 'spring', stiffness: 300, damping: 24 }}>
                  <PlayerMark addr={p.addr} size={22} />
                  <span>{p.isMe ? t('hud.you') : p.name}</span>
                </motion.div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── class select (unchanged flow) ──────────────────────────────────────────
export function ClassSelect({ m, left, onPick, pending }: { m: MatchView; left: number; onPick: (lev: number) => void; pending: boolean }) {
  const t = useT();
  const cur = m.me?.leverage ?? CLASSES.tank.leverage;
  const classes = Object.keys(CLASSES) as ClassId[];
  // Squad: one leverage per team, picked by the team's first seated player (the contract enforces it)
  const lead = m.mode === Mode.SQUAD && m.me ? m.players.find((p) => p.team === m.me!.team) : undefined;
  const follower = !!lead && lead.addr !== m.me?.addr;
  const pct = (lev: number) => `${(liqMove(lev) * 100).toFixed(liqMove(lev) < 0.1 ? 1 : 0)}%`;
  return (
    <motion.div {...fadeUp} className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-4 px-4">
      <div className="text-center">
        <div className="panel-title">{follower ? t('mm.leaderPicks', { name: lead!.name }) : t('mm.chooseClass', { n: Math.max(0, Math.ceil(left)) })}</div>
        <div className="font-display text-3xl font-bold tracking-[0.16em] uppercase">{t('mm.loadout')}</div>
      </div>
      <div className={`class-options pointer-events-auto grid w-full max-w-4xl gap-2 md:gap-3 ${classes.length === 1 ? 'single grid-cols-1' : 'grid-cols-3'}`}>
        {classes.map((id) => {
          const c = CLASSES[id];
          const on = cur === c.leverage;
          const col = CLASS_COLOR[c.leverage];
          return (
            <motion.button
              key={id}
              whileHover={{ y: -6 }}
              whileTap={{ scale: 0.97 }}
              onMouseEnter={sfx.hover}
              onClick={() => (sfx.lockIn(), onPick(c.leverage))}
              disabled={pending || follower}
              className={`panel p-2.5 text-left transition-colors md:p-3 ${on ? 'bg-[var(--panel-hi)]!' : ''}`}
              style={{ borderColor: on ? col : undefined, boxShadow: on ? `inset 0 -3px 0 ${col}` : undefined }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="num text-xl font-bold md:text-3xl" style={{ color: col }}>
                  {c.leverage}x
                </span>
                <span className="text-[10px] tracking-[0.12em] text-muted uppercase md:text-[11px] md:tracking-[0.2em]">{t(`role.${id}`)}</span>
              </div>
              <p className="mt-2 hidden text-sm text-muted md:block">{t(`blurb.${id}`, { pct: pct(c.leverage) })}</p>
              <div className="num mt-1 text-[11px] text-gold md:hidden">{t('mm.outAt', { pct: pct(c.leverage) })}</div>
              <div className="mt-3 hidden grid-cols-2 gap-2 text-[11px] md:grid">
                <div>
                  <div className="text-dim">{t('mm.maxSize')}</div>
                  <div className="num">{fmtUsd(MARGIN * c.leverage * (REAL_TRADING ? 0.95 : 1))}</div>
                </div>
                <div>
                  <div className="text-dim">{t('mm.liqFull')}</div>
                  <div className="num text-gold">{`−${pct(c.leverage)} ${t('mm.move')}`}</div>
                </div>
              </div>
              {on && <div className="mt-2 font-display text-[10px] font-bold tracking-[0.24em] uppercase md:mt-3 md:text-xs md:tracking-[0.3em]" style={{ color: col }}>{t(pending ? 'mm.locking' : 'mm.locked')}</div>}
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── VS: panels slam in, lightning seam, 3-2-1-FIGHT ────────────────────────
function VsCard({ p, side, i, color, big }: { p: PlayerView; side: 0 | 1; i: number; color: string; big?: boolean }) {
  const t = useT();
  return (
    <motion.div
      initial={{ x: side ? 320 : -320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 240, damping: 22, delay: 0.25 + i * 0.08 }}
      className={`vs-card ${side ? 'r' : ''} ${p.isMe ? 'me' : ''} ${big ? 'big' : ''}`}
      style={{ ['--c' as string]: color }}
    >
      <PlayerMark addr={p.addr} size={big ? 68 : 48} />
      <div className="min-w-0">
        <div className="vs-name truncate font-display text-lg font-bold tracking-wide">
          {p.isMe ? 'You' : p.name} {p.bot && <span className="text-[10px] text-dim">BOT</span>}
        </div>
        <div className="text-[11px] tracking-[0.2em] uppercase" style={{ color: CLASS_COLOR[p.leverage] }}>
          {CHARACTER_INFO[p.character].name} · {p.leverage}x
        </div>
      </div>
    </motion.div>
  );
}

export function VsScreen({ m, left, note }: { m: MatchView; left: number; note?: string }) {
  const t = useT();
  const royale = m.mode === Mode.ROYALE;
  const [a, b] = sides(m);
  const sec = Math.max(0, Math.ceil(left));
  useEffect(() => {
    if (sec <= 3) sfx.beep(sec === 0);
  }, [sec]);
  useEffect(() => {
    sfx.lockIn();
    useScene.getState().shake('rgba(255,61,90,0.35)');
  }, []);
  const colA = royale ? '#a9b8d4' : TEAM_COLOR[0];
  const colB = royale ? '#a9b8d4' : TEAM_COLOR[1];
  return (
    <motion.div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.25 }} transition={{ duration: 0.3 }}>
      <motion.div className="vs-panel a" style={{ ['--c' as string]: colA }} initial={{ x: '-105%' }} animate={{ x: 0 }} transition={{ type: 'spring', stiffness: 170, damping: 24 }} />
      <motion.div className="vs-panel b" style={{ ['--c' as string]: colB }} initial={{ x: '105%' }} animate={{ x: 0 }} transition={{ type: 'spring', stiffness: 170, damping: 24 }} />
      <motion.svg className="vs-seam" viewBox="0 0 100 1000" preserveAspectRatio="none" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.6, 1] }} transition={{ delay: 0.3, duration: 0.5 }} aria-hidden>
        <polyline points="62,0 38,210 58,330 34,540 60,660 40,1000" />
      </motion.svg>
      <div className="vs-lineup absolute inset-0 flex items-center justify-between gap-6 px-[8vw]">
        <div className="vs-col grid gap-2">
          <div className="vs-team" style={{ color: colA }}>
            {royale ? t('mm.field') : TEAM_NAME[0]}
          </div>
          {a.map((p, i) => (
            <VsCard key={p.addr} p={p} side={0} i={i} color={royale ? CLASS_COLOR[p.leverage] : colA} big={a.length === 1} />
          ))}
        </div>
        <div className="vs-col grid gap-2 justify-items-end">
          <div className="vs-team" style={{ color: colB }}>
            {royale ? t('mm.field') : TEAM_NAME[1]}
          </div>
          {b.map((p, i) => (
            <VsCard key={p.addr} p={p} side={1} i={i} color={royale ? CLASS_COLOR[p.leverage] : colB} big={b.length === 1} />
          ))}
        </div>
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <div className="grid justify-items-center">
          <motion.div className="vs-word" initial={{ scale: 5, opacity: 0, rotate: -14 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 13, delay: 0.4 }}>
            {royale ? 'FFA' : 'VS'}
          </motion.div>
          <div className="relative h-24">
            <AnimatePresence mode="popLayout">
              <motion.div key={sec} className={`vs-count ${sec === 0 ? 'go' : ''}`} initial={{ scale: 2.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 16 }}>
                {sec > 0 ? sec : t('mm.fight')}
              </motion.div>
            </AnimatePresence>
          </div>
          {note && <div className="vs-note">{note}</div>}
        </div>
      </div>
    </motion.div>
  );
}

// ─── after the fight ────────────────────────────────────────────────────────
function CountUp({ to, prefix = '', suffix = '', decimals = 2, sign = false, delay = 0.5 }: { to: number; prefix?: string; suffix?: string; decimals?: number; sign?: boolean; delay?: number }) {
  const v = useMotionValue(0);
  const text = useTransform(v, (x) => `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}${prefix}${Math.abs(x).toFixed(decimals)}${suffix}`);
  useEffect(() => {
    const c = animate(v, to, { duration: 1.4, ease: 'easeOut', delay });
    return () => c.stop();
  }, [to, v, delay]);
  return <motion.span>{text}</motion.span>;
}

/** One-shot confetti burst on a canvas (skipped with reduced motion). */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = cv.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const cols = ['#ffc857', '#2fd08a', '#7c5cff', '#efe9dc', '#ff3d5a'];
    const ps = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: innerHeight * 0.32,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 15 - 5,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 5 + Math.random() * 6,
      c: cols[(Math.random() * cols.length) | 0],
    }));
    let raf = 0;
    const t0 = performance.now();
    const frame = (t: number) => {
      const age = (t - t0) / 1000;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age / 3.2);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
        ctx.restore();
      }
      if (age < 3.4) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-40 h-full w-full" aria-hidden />;
}

type ResultRow = NonNullable<MatchView['results']>[number];

/** Equity through the match as a step line, with the starting margin dashed. Drawn in on mount. */
function EquitySpark({ s, start, end, color, delay }: { s: Stats; start: number; end: number; color: string; delay: number }) {
  const W = 300;
  const H = 56;
  const pts = s.curve.length > 1 ? s.curve : [{ time: start, value: MARGIN }, { time: end, value: s.finalEquity }];
  const vals = [...pts.map((p) => p.value), MARGIN];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.18);
  const x = (t: number) => (end > start ? ((Math.min(end, Math.max(start, t)) - start) / (end - start)) * W : 0);
  const y = (v: number) => H - ((v - (lo - pad)) / (hi - lo + pad * 2)) * H;
  let d = `M0 ${y(pts[0].value)}`;
  for (const p of pts.slice(1)) d += ` H${x(p.time)} V${y(p.value)}`;
  d += ` H${W}`;
  const last = pts.at(-1)!.value;
  return (
    <div className="rs-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <line x1="0" x2={W} y1={y(MARGIN)} y2={y(MARGIN)} className="base" />
        {/* revealed left to right; the end dot is HTML so the stretched SVG can't squash it */}
        <motion.path d={d} stroke={color} initial={{ clipPath: 'inset(-10% 100% -10% 0)' }} animate={{ clipPath: 'inset(-10% 0% -10% 0)' }} transition={{ delay, duration: 1.1, ease: EASE }} />
      </svg>
      <motion.b style={{ top: `${(y(last) / H) * 100}%`, background: color }} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: delay + 1.05 }} />
    </div>
  );
}

const signedPct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;
const toneOf = (n: number | null) => (n === null || Math.abs(n) < 0.005 ? '' : n > 0 ? 'up' : 'down');

interface CardProps {
  p: PlayerView;
  s: Stats;
  award?: Award;
  rank: number;
  result?: ResultRow;
  color: string;
  side: 0 | 1;
  i: number;
  compact: boolean;
  span: [number, number];
}

function ResultCard({ p, s, award, rank, result, color, side, i, compact, span }: CardProps) {
  const t = useT();
  const equity = result?.final_equity ?? p.equity;
  const pnl = equity - MARGIN;
  const roi = (pnl / MARGIN) * 100;
  const won = result?.result === 'win' || (result?.payout ?? 0) > 0;
  const lost = result?.result === 'loss';
  const delay = 0.3 + i * 0.08 + side * 0.12;
  const out = s.out ?? (p.out ? 'liquidated' : null);
  const strip: [string, React.ReactNode, string?][] = [
    [t('rs.trades'), s.opens],
    [t('rs.winRate'), s.closes ? `${Math.round((s.wins / s.closes) * 100)}%` : '–'],
    [t('rs.best'), s.best === null ? '–' : fmtUsd(s.best, true), toneOf(s.best)],
  ];
  return (
    <motion.div
      className={`rs-card ${compact ? 'compact' : ''} ${side ? 'r' : ''} ${p.isMe ? 'me' : ''} ${won ? 'won' : ''} ${lost ? 'lost' : ''}`}
      style={{ ['--c' as string]: color }}
      initial={{ opacity: 0, x: side ? 56 : -56 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.55, ease: EASE }}
    >
      <div className="rs-card-head">
        <span className="rs-rank">{rank}</span>
        <PlayerMark addr={p.addr} size={compact ? 30 : 42} />
        <div className="rs-identity min-w-0">
          <div className="rs-name">
            <span className="truncate">{p.name}</span>
            {p.isMe && <span className="rs-tag me">{t('hud.you')}</span>}
            {p.bot && <span className="rs-tag">Bot</span>}
          </div>
          <div className="rs-class" style={{ color: CLASS_COLOR[p.leverage] }}>
            {CHARACTER_INFO[p.character].name} · {p.leverage}x
          </div>
        </div>
        {(won || compact) && <div className="rs-summary">
        {won && (
          <span className="rs-badge">
            {t('rs.winner')}{result && result.payout > 0 && <b className="num">+{result.payout.toFixed(2)} {STAKE}</b>}
          </span>
        )}
        {compact && (
          <div className="rs-card-eq">
            <b className={`num ${toneOf(roi)}`}>{signedPct(roi)}</b>
            <span className="num">{fmtUsd(equity)}</span>
          </div>
        )}
        </div>}
      </div>

      {!compact && (
        <>
          <div className="rs-hero">
            <div className="rs-label">{t('rs.return')}</div>
            <div className={`rs-roi num ${toneOf(roi)}`}>
              <CountUp to={roi} suffix="%" sign delay={delay + 0.2} />
            </div>
            <div className="rs-eqline num">
              {fmtUsd(equity)} {t('rs.equity')} · <span className={toneOf(pnl)}>{fmtUsd(pnl, true)}</span>
            </div>
          </div>
          <EquitySpark s={s} start={span[0]} end={span[1]} color={won ? '#ffc857' : color} delay={delay + 0.25} />
        </>
      )}

      <div className="rs-strip">
        {strip.map(([k, v, cls]) => (
          <div key={k}>
            <span>{k}</span>
            <b className={`num ${cls ?? ''}`}>{v}</b>
          </div>
        ))}
      </div>

      {(award || out) && (
        <div className="rs-foot">
          {award && (
            <span className="rs-award">
              <i>★</i> {award.k} <em>{award.v}</em>
            </span>
          )}
          {out && <span className="rs-out">{t(out === 'eliminated' ? 'rs.eliminated' : 'rs.liquidated')}</span>}
        </div>
      )}
    </motion.div>
  );
}

/** Your reward: payout and the level bar filling from where you were before this match. */
function Reward({ m, mine }: { m: MatchView; mine: ResultRow }) {
  const t = useT();
  const { data } = useApi<{ profile?: { xp: number } }>(m.me ? `/profile/${m.me.addr}` : null);
  const xp = data?.profile?.xp;
  const before = xp === undefined ? undefined : xp - mine.xp_delta;
  const up = xp !== undefined && before !== undefined && level(xp) > level(before);
  return (
    <motion.div className="rs-reward" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
      <div className="rs-reward-pay">
        <span className="rs-label">{t('rs.payout')}</span>
        <b className={`num ${mine.payout > 0 ? 'text-gold' : 'text-dim'}`}>
          {mine.payout > 0 ? <CountUp to={mine.payout} prefix="+" suffix={` ${STAKE}`} delay={0.9} /> : `0 ${STAKE}`}
        </b>
      </div>
      <div className="rs-level">
        <div className="rs-level-top">
          <span className="rs-label">{t('rs.level', { n: xp !== undefined ? level(xp) : '' })}</span>
          <b className={`num ${mine.xp_delta > 0 ? 'up' : mine.xp_delta < 0 ? 'down' : 'text-dim'}`}>
            {mine.xp_delta > 0 ? '+' : ''}
            {mine.xp_delta} XP{up && t('rs.levelUp')}
          </b>
        </div>
        <div className="rs-level-bar">
          <motion.i initial={{ width: `${(up ? 0 : levelProgress(before ?? XP.start)) * 100}%` }} animate={{ width: `${(xp === undefined ? 0 : levelProgress(xp) || (up ? 1 : 0)) * 100}%` }} transition={{ delay: 1.1, duration: 1, ease: EASE }} />
        </div>
      </div>
    </motion.div>
  );
}

export function Result({ m, onAgain, busy }: { m: MatchView; onAgain: () => void; busy: boolean }) {
  const t = useT();
  const lang = useLang((x) => x.lang);
  const mine = m.results?.find((r) => r.addr === m.me?.addr);
  const outcome = !m.me ? 'spectate' : (mine?.result ?? 'pending');
  const [burst, setBurst] = useState(false);
  const [sharing, setSharing] = useState<{ code: string; text: string } | null>(null);
  useEffect(() => {
    if (outcome === 'win') (sfx.win(), setBurst(true));
    else if (outcome === 'loss') sfx.lose();
  }, [outcome]);
  // Enter queues the next match, Esc quits to the lobby, as in most fighting games' result screens
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sharing || document.querySelector('[role="dialog"][aria-modal="true"]')) return; // an open dialog owns the keyboard
      if (e.key === 'Escape') return void (sfx.click(), router.push('/play'));
      if (e.key === 'Enter' && m.me && !busy && !['BUTTON', 'INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) (sfx.click(), onAgain());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onAgain, router, m.me, sharing]);

  const title = t(outcome === 'win' ? 'rs.victory' : outcome === 'loss' ? 'rs.defeat' : outcome === 'draw' ? 'rs.draw' : outcome === 'spectate' ? 'rs.over' : 'rs.settling');
  const tone = outcome === 'win' ? 'win' : outcome === 'loss' ? 'loss' : 'neutral';
  const royale = m.mode === Mode.ROYALE;
  const practice = m.id === 0;
  const resultOf = (p: PlayerView) => m.results?.find((r) => r.addr === p.addr);
  const equityOf = (p: PlayerView) => resultOf(p)?.final_equity ?? p.equity;

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
  const awardList = useMemo(() => awards(stats), [stats]);
  const statOf = (p: PlayerView) => stats.find((s) => s.addr === p.addr)!;
  const awardOf = (p: PlayerView) => awardList.find((a) => a.who.addr === p.addr);

  const standings = [...m.players].sort((a, b) => (resultOf(b)?.payout ?? 0) - (resultOf(a)?.payout ?? 0) || equityOf(b) - equityOf(a));
  const rankOf = (p: PlayerView) => standings.indexOf(p) + 1;
  const rank = m.me ? rankOf(m.me) : 0;

  // you are always on the left (player one); in a royale the left column is the top half
  const home = !royale && m.me ? m.me.team : 0;
  const teamOf = (side: 0 | 1) => (side === 0 ? home : 1 - home);
  const half = Math.ceil(standings.length / 2);
  const [a, b] = royale ? [standings.slice(0, half), standings.slice(half)] : [m.players.filter((p) => p.team === teamOf(0)), m.players.filter((p) => p.team === teamOf(1))];
  const teamEq = (t: number) => m.players.filter((p) => p.team === t).reduce((s, p) => s + equityOf(p), 0);
  const share = teamEq(teamOf(0)) + teamEq(teamOf(1)) > 0 ? teamEq(teamOf(0)) / (teamEq(teamOf(0)) + teamEq(teamOf(1))) : 0.5;
  const teamWon = (t: number) => m.players.some((p) => p.team === t && (resultOf(p)?.payout ?? 0) > 0);

  const column = (list: PlayerView[], side: 0 | 1) => {
    const tm = teamOf(side);
    const color = royale ? '#a9b8d4' : TEAM_COLOR[tm];
    const label = royale ? (side ? `#${half + 1}–${standings.length}` : `#1–${half}`) : TEAM_NAME[tm];
    return (
      <div className={`rs-side ${side ? 'r' : ''} ${!royale && list.length === 1 ? 'solo' : ''}`}>
        <motion.div className="rs-side-head" style={{ ['--c' as string]: color }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
          <span>
            {label}
            {!royale && list.length > 1 && teamWon(tm) && <i>{t('rs.won')}</i>}
          </span>
          {!royale && list.length > 1 && <b className="num">{fmtUsd(teamEq(tm))}</b>}
        </motion.div>
        {list.map((p, i) => (
          <ResultCard
            key={p.addr}
            p={p}
            s={statOf(p)}
            award={awardOf(p)}
            rank={rankOf(p)}
            result={resultOf(p)}
            color={royale ? CLASS_COLOR[p.leverage] : color}
            side={side}
            i={i}
            compact={list.length > 1}
            span={[m.startAt, m.endAt]}
          />
        ))}
      </div>
    );
  };

  // your result (or the winner's, when spectating) as a link whose card unfurls wherever it's posted
  const share_ = () => {
    const who = m.me ?? standings[0];
    if (!who) return;
    const r = resultOf(who);
    const rival = m.mode === Mode.DUEL ? m.players.find((p) => p.addr !== who.addr) : undefined;
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
      rival: rival?.name,
      place: rankOf(who),
      of: m.players.length,
      award: awardOf(who)?.k,
      practice,
      id: m.id,
    };
    setSharing({ code: practice ? practiceCode(card) : rankedCode(m.id, who.addr), text: shareText(card, !!m.me) });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className={`rs rs-${tone}`}>
      {burst && <Confetti />}
      {column(a, 0)}

      <div className="rs-center">
        <div className="rs-kicker">{practice ? t('rs.practice') : t('rs.kicker', { mode: MODES[m.mode].name, id: m.id })}</div>
        <div className={`rs-title ${title.length > 7 ? 'long' : ''}`} aria-label={title}>
          {title.split('').map((ch, i) => (
            <motion.span key={i} initial={{ y: '0.5em', opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05 + i * 0.04, type: 'spring', stiffness: 420, damping: 22 }}>
              {ch === ' ' ? ' ' : ch}
            </motion.span>
          ))}
        </div>
        <div className="rs-sub">
          {m.mode === Mode.SQUAD && outcome !== 'draw' && standings[0]
            ? t('rs.wins', { name: TEAM_NAME[standings[0].team] })
            : rank > 0 ? t('rs.place', { rank: lang === 'en' ? ordinal(rank) : rank, n: m.players.length }) : standings[0] && outcome !== 'draw' ? t('rs.wins', { name: standings[0].name }) : MODES[m.mode].name}
          {outcome === 'draw' && t('rs.refunded')}
        </div>

        {mine && !practice && <Reward m={m} mine={mine} />}
        {REAL_TRADING && !practice && <TradingCapital id={m.id} accounts={m.accounts} onRecovered={m.refresh} />}

        {!royale && m.players.length > 1 && (
          <motion.div className={`rs-tug ${a.length === 1 && b.length === 1 ? 'solo' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
            <div className="rs-tug-legend">
              <span style={{ color: TEAM_COLOR[teamOf(0)] }}>{(share * 100).toFixed(1)}%</span>
              <span>{t('rs.share')}</span>
              <span style={{ color: TEAM_COLOR[teamOf(1)] }}>{((1 - share) * 100).toFixed(1)}%</span>
            </div>
            <div className="rs-tug-bar">
              <motion.i style={{ background: TEAM_COLOR[teamOf(0)] }} initial={{ width: '50%' }} animate={{ width: `${share * 100}%` }} transition={{ delay: 0.7, duration: 1.1, ease: EASE }} />
              <i style={{ background: TEAM_COLOR[teamOf(1)] }} />
            </div>
          </motion.div>
        )}

        <motion.div className="rs-actions" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
          <button className="btn-play" disabled={busy || !m.me} onClick={() => (sfx.click(), onAgain())}>
            {t(busy ? 'rs.finding' : practice ? 'rs.again' : 'rs.rematch')}
            {!busy && <span className="kbd ml-3">↵</span>}
          </button>
          <div className="rs-links">
            <Link href="/play" className="gbtn ghost" onMouseEnter={sfx.hover}>
              {t('rs.lobby')} <span className="kbd ml-2">Esc</span>
            </Link>
            {m.id > 0 && (
              <Link href={`/match/${m.id}/report`} className="gbtn ghost" onMouseEnter={sfx.hover}>
                {t('rs.details')}
              </Link>
            )}
            <button className="gbtn ghost" onClick={() => (sfx.click(), share_())} onMouseEnter={sfx.hover}>
              <ShareIcon /> {t('rs.shareBtn')}
            </button>
          </div>
          {m.settleTx && (
            <a className="rs-proof" href={explorerTx(m.settleTx)} target="_blank" rel="noreferrer" title="The payout was made by the arena contract. Open the settlement to check it yourself.">
              <i>✓</i> {t('rs.verified')} <span>{t('rs.proof')}</span>
            </a>
          )}
        </motion.div>
      </div>

      {column(b, 1)}
      {sharing && <ShareSheet code={sharing.code} text={sharing.text} onClose={() => setSharing(null)} />}
    </motion.div>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
