'use client';
import { motion } from 'motion/react';
import { MODES, Mode, STAKE, fmtUsd, payouts, royaleRounds } from '@longshort/shared';
import type { MatchView } from '@/lib/match';
import { TEAM_COLOR } from '@/lib/scene';
import { Hint } from '../ui/Hint';
import { useT } from '@/lib/i18n';

const TEAM_NAME = ['Alpha', 'Bravo'];
const toneOf = (n: number) => (n > 0.005 ? 'up' : n < -0.005 ? 'down' : '');

export function TimerRing({ left, total }: { left: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / total));
  const hot = left <= 10;
  return (
    <div className="sb-ring" title="Time left in the match">
      <svg viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="5" fill="none" />
        <circle cx="32" cy="32" r={r} stroke={hot ? '#d25a55' : '#e7e1d3'} strokeWidth="5" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset .25s linear' }} />
      </svg>
      <span className={`num ${hot ? 'text-red animate-pulse' : ''}`}>{Math.max(0, Math.ceil(left))}</span>
    </div>
  );
}

/**
 * The one line a player reads first: time left, who's winning and by how much. Everything else on
 * the HUD is detail. You are always on the left.
 */
export function ScoreBar({ m, now, left, live, practice }: { m: MatchView; now: number; left: number; live: boolean; practice?: boolean }) {
  const t = useT();
  const pay = payouts(m.mode, m.entry, m.maxPlayers);
  return (
    <div className="sb panel">
      <TimerRing left={live ? left : m.duration} total={m.duration} />
      <div className="sb-main">
        <div className="sb-top">
          <span className="sb-mode">
            {MODES[m.mode].name}
            <em>{practice ? t('hud.practiceTag') : `#${m.id}`}</em>
          </span>
          {m.mode === Mode.ROYALE ? <RoyaleStatus m={m} now={now} /> : <VersusStatus m={m} />}
          <span className="sb-prize">
            {practice ? (
              t('hud.noStakes')
            ) : (
              <>
                {t('hud.prize')} <b className="num">{`${pay.first.toFixed(2)} ${STAKE}`}</b>
              </>
            )}
            <Hint text={`Everyone starts with $1,000 of virtual margin. Best final equity wins${practice ? '. Practice: nothing at stake.' : `: entry ${m.entry} ${STAKE}, pot ${pay.pot} ${STAKE}, paid by the contract at the bell.`} Equity = 1,000 + realized PnL + open PnL.`} />
          </span>
        </div>
        {m.mode === Mode.ROYALE ? <RoyaleTrack m={m} /> : <Tug m={m} />}
      </div>
    </div>
  );
}

/** Your side (or Alpha, when spectating) against the other, by summed PnL. */
function versus(m: MatchView) {
  const home = m.me?.team ?? 0;
  const L = m.players.filter((p) => p.team === home);
  const R = m.players.filter((p) => p.team !== home);
  const sum = (ps: typeof L) => ps.reduce((s, p) => s + p.pnl, 0);
  return { home, L, R, lp: sum(L), rp: sum(R) };
}

function VersusStatus({ m }: { m: MatchView }) {
  const t = useT();
  const { home, L, R, lp, rp } = versus(m);
  const diff = lp - rp;
  const v = fmtUsd(Math.abs(diff));
  const squad = m.mode === Mode.SQUAD;
  let text: string;
  if (m.me?.out && !squad) text = t('hud.outNow');
  else if (Math.abs(diff) < 0.005) text = t('hud.even');
  else if (m.me) text = t(squad ? (diff > 0 ? 'hud.teamLead' : 'hud.teamTrail') : diff > 0 ? 'hud.lead' : 'hud.trail', { v });
  else text = t('hud.otherLead', { name: squad ? TEAM_NAME[diff > 0 ? home : 1 - home] : ((diff > 0 ? L : R)[0]?.name ?? '…'), v });
  return <b className={`sb-status ${m.me && !m.me.out ? toneOf(diff) : ''}`}>{text}</b>;
}

function Tug({ m }: { m: MatchView }) {
  const t = useT();
  const { home, L, R, lp, rp } = versus(m);
  const squad = m.mode === Mode.SQUAD;
  // ±$100 per player of PnL gap fills the bar, so small edges still show
  const edge = Math.max(-1, Math.min(1, (lp - rp) / (100 * Math.max(1, L.length))));
  const lName = squad ? TEAM_NAME[home] : m.me ? t('hud.you') : (L[0]?.name ?? '…');
  const rName = squad ? TEAM_NAME[1 - home] : (R[0]?.name ?? '…');
  return (
    <div className="sb-tug">
      <span className="sb-side">
        <i style={{ background: TEAM_COLOR[home] }} />
        <span className="sb-name">{lName}</span>
        <b className={`num ${toneOf(lp)}`}>{fmtUsd(lp, true)}</b>
      </span>
      <div className="sb-bar">
        <motion.i style={{ background: TEAM_COLOR[home] }} animate={{ width: `${50 + edge * 50}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
        <i style={{ background: TEAM_COLOR[1 - home] }} />
      </div>
      <span className="sb-side r">
        <b className={`num ${toneOf(rp)}`}>{fmtUsd(rp, true)}</b>
        <span className="sb-name">{rName}</span>
        <i style={{ background: TEAM_COLOR[1 - home] }} />
      </span>
    </div>
  );
}

/** Royale standing: survivors by equity, best first; the lowest is cut at every round's bell. */
function royale(m: MatchView, now = 0) {
  const alive = m.players.filter((p) => !p.out).sort((a, b) => b.equity - a.equity);
  const out = m.players.filter((p) => p.out).sort((a, b) => b.outRank - a.outRank);
  const { rounds, roundLen } = royaleRounds(m.maxPlayers, m.duration);
  const nextCut = m.round < rounds ? m.startAt + roundLen * (m.round + 1) : null;
  const cutting = !!nextCut && alive.length > 3;
  return { alive, ranked: [...alive, ...out], cutting, cutIn: nextCut ? Math.max(0, Math.ceil(nextCut - now)) : 0 };
}

function RoyaleStatus({ m, now }: { m: MatchView; now: number }) {
  const t = useT();
  const { alive, cutting, cutIn } = royale(m, now);
  const me = m.me;
  const rank = me ? alive.indexOf(me) + 1 : 0;
  const last = alive.at(-1);
  let text: string;
  let tone = '';
  if (me?.out) text = t('hud.outNow');
  else if (me && cutting && last === me) {
    text = t('hud.youNext', { n: cutIn });
    tone = 'down';
  } else if (me && rank) {
    text = `${t('hud.royaleRank', { r: rank, n: alive.length })} · ${cutting && last ? t('hud.aboveCut', { v: fmtUsd(me.equity - last.equity) }) : t('hud.paidTop')}`;
    tone = rank <= 3 ? 'up' : '';
  } else text = cutting ? t('hud.cutIn', { n: cutIn }) : t('hud.paidTop');
  return <b className={`sb-status ${tone}`}>{text}</b>;
}

function RoyaleTrack({ m }: { m: MatchView }) {
  const t = useT();
  const { ranked, alive, cutting } = royale(m);
  return (
    <div className="sb-track">
      {ranked.map((p, i) => (
        <span key={p.addr} className={`${p.isMe ? 'me' : ''} ${p.out ? 'out' : ''} ${cutting && p === alive.at(-1) ? 'cut' : ''} ${!p.out && i < 3 ? 'paid' : ''}`} title={`${i + 1}. ${p.name} ${fmtUsd(p.pnl, true)}`}>
          <b className="num">{i + 1}</b>
          <span className="sb-name">{p.isMe ? t('hud.you') : p.name}</span>
        </span>
      ))}
    </div>
  );
}
