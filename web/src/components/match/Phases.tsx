'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { REAL_TRADING, CLASSES, MARGIN, MODES, Mode, fmtUsd, liqMove, type ClassId, STAKE, CHARACTER_INFO } from '@longshort/shared';
import type { MatchView, PlayerView } from '@/lib/match';
import { CLASS_COLOR, TEAM_COLOR, useScene } from '@/lib/scene';
import { PlayerMark } from '../PlayerMark';
import { sfx } from '@/lib/sfx';
import { useT } from '@/lib/i18n';

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
  const fillIn = Math.max(0, BOT_FILL - t);

  // a blip, and their name for a moment, for every trader who sits down
  const seen = useRef(m.players.length);
  const [joined, setJoined] = useState<string>();
  useEffect(() => {
    const newest = m.players.at(-1);
    if (m.players.length > seen.current) {
      sfx.select();
      if (newest && !newest.isMe) setJoined(newest.name);
    }
    seen.current = m.players.length;
  }, [m.players]);
  useEffect(() => {
    if (!joined) return;
    const t = setTimeout(() => setJoined(undefined), 3000);
    return () => clearTimeout(t);
  }, [joined]);
  const left = Math.max(0, m.maxPlayers - m.nPlayers);
  const status = joined ? T('mm.joined', { name: joined }) : m.mode === Mode.DUEL ? T('mm.waitRival') : left === 1 ? T('mm.waitOne') : T('mm.waitMore', { n: left });

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
          {m.me && <div className="mm-seat-ok">✓ {T(REAL_TRADING ? 'mm.seatPerpl' : 'mm.seat')}</div>}
          <div className="mm-title">
            {T('mm.finding')} <b>{m.nPlayers}</b>
            <span>/{m.maxPlayers}</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={status} className="mm-status" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.25 }}>
              {status}
              {!joined && <span className="mm-dots" />}
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

// ─── after the fight: ./Result ─────────────────────────────────────────────
export { Result } from './Result';
