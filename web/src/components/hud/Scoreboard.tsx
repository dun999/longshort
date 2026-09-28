'use client';
import { motion, LayoutGroup } from 'motion/react';
import { CLASSES, MARKETS, Mode, classOf, fmtUsd, royaleRounds } from '@longshort/shared';
import type { MatchView, PlayerView } from '@/lib/match';
import { TEAM_COLOR } from '@/lib/scene';
import { PlayerMark } from '../PlayerMark';
import { PanelHeader } from '../ui/Hint';
import { useT } from '@/lib/i18n';

function PlayerRow({ p, rank, danger }: { p: PlayerView; rank?: number; danger?: boolean }) {
  const t = useT();
  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      className={`relative flex items-center gap-2 border px-2 py-1 ${p.isMe ? 'border-[var(--line-hi)] bg-[var(--panel-hi)]' : 'border-line bg-white/[0.02]'} ${p.out ? 'opacity-40 grayscale' : ''} ${danger ? 'border-red! bg-[rgba(244,63,94,0.14)]!' : ''}`}
    >
      {rank !== undefined && <span className="font-display w-4 text-center text-xs font-bold text-dim">{rank}</span>}
      <PlayerMark addr={p.addr} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-[12px] font-semibold">
          {p.name}
          {p.bot && <span className="border border-line px-1 text-[9px] tracking-wider text-dim uppercase">{t('hud.bot')}</span>}
          {p.isMe && <span className="text-[9px] tracking-wider text-violet uppercase">{t('hud.you')}</span>}
        </div>
        <div className="text-[10px] tracking-wider text-dim uppercase">
          {CLASSES[classOf(p.leverage)].name} {p.leverage}x ·{' '}
          {p.out ? (
            <span className="text-red">{t('hud.out')}</span>
          ) : p.pos ? (
            <span className={p.pos.isLong ? 'up' : 'down'}>
              {t(p.pos.isLong ? 'hud.long' : 'hud.short')} {MARKETS[p.pos.market]}
            </span>
          ) : (
            t('hud.flat')
          )}
        </div>
      </div>
      <div className={`num text-right text-sm font-bold ${p.pnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(p.pnl, true)}</div>
      {danger && <span className="absolute -top-2 right-2 bg-red px-1.5 text-[9px] font-bold tracking-widest text-white">{t('hud.nextCut')}</span>}
    </motion.div>
  );
}

function DuelBoard({ m }: { m: MatchView }) {
  const t = useT();
  const a = m.players.find((p) => p.team === 0);
  const b = m.players.find((p) => p.team === 1);
  const ea = a?.equity ?? 1000;
  const eb = b?.equity ?? 1000;
  const share = ea + eb > 0 ? ea / (ea + eb) : 0.5;
  // amplify so small edges are visible: map ±5% equity edge to the full bar
  const edge = Math.max(-1, Math.min(1, (ea - eb) / 100));
  return (
    <div className="grid gap-1.5">
      <PanelHeader title={t('hud.scoreboard')} sub={t('hud.ahead')} hint="The bar shows each player's share of total equity. The player on the bigger side is winning. Each row shows their class, open position and PnL." />
      <div className="relative h-6 overflow-hidden border border-line">
        <motion.div className="absolute inset-y-0 left-0" style={{ background: TEAM_COLOR[0] }} animate={{ width: `${50 + edge * 50}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
        <motion.div className="absolute inset-y-0 right-0" style={{ background: TEAM_COLOR[1] }} animate={{ width: `${50 - edge * 50}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
        <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-[var(--bg)]" />
        <div className="num absolute inset-0 flex items-center justify-between px-2 text-xs font-bold">
          <span>{(share * 100).toFixed(1)}%</span>
          <span>{((1 - share) * 100).toFixed(1)}%</span>
        </div>
      </div>
      {a && <PlayerRow p={a} />}
      <div className="font-display text-center text-xs tracking-[0.4em] text-dim">VS</div>
      {b && <PlayerRow p={b} />}
    </div>
  );
}

function SquadBoard({ m }: { m: MatchView }) {
  const T = useT();
  const teams = [0, 1].map((t) => {
    const ps = m.players.filter((p) => p.team === t).sort((x, y) => y.equity - x.equity);
    return { t, ps, pnl: ps.reduce((s, p) => s + p.pnl, 0) };
  });
  const lead = teams[0].pnl === teams[1].pnl ? -1 : teams[0].pnl > teams[1].pnl ? 0 : 1;
  return (
    <div className="grid gap-2.5">
      <PanelHeader title={T('hud.scoreboard')} sub={T('hud.teamPnl')} hint="Squad is 3v3. Each team's PnL is the sum of its players'. The team ahead at the bell splits the pot." />
      {teams.map(({ t, ps, pnl }) => (
        <div key={t} className="grid gap-1.5">
          <div className="flex items-center justify-between border-b-2 pb-1" style={{ borderColor: TEAM_COLOR[t] }}>
            <span className="font-display text-sm font-bold tracking-[0.2em] uppercase" style={{ color: TEAM_COLOR[t] }}>
              {t === 0 ? 'Alpha' : 'Bravo'} {lead === t && <span className="text-[10px] text-gold">{T('hud.leading')}</span>}
            </span>
            <span className={`num text-sm font-bold ${pnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(pnl, true)}</span>
          </div>
          <LayoutGroup>
            {ps.map((p) => (
              <PlayerRow key={p.addr} p={p} />
            ))}
          </LayoutGroup>
        </div>
      ))}
    </div>
  );
}

function RoyaleBoard({ m, now }: { m: MatchView; now: number }) {
  const t = useT();
  const ranked = [...m.players].sort((a, b) => (a.out !== b.out ? (a.out ? 1 : -1) : a.out ? b.outRank - a.outRank : b.equity - a.equity));
  const alive = ranked.filter((p) => !p.out);
  const { rounds, roundLen } = royaleRounds(m.maxPlayers, m.duration);
  const nextCut = m.round < rounds ? m.startAt + roundLen * (m.round + 1) : null;
  const cutting = nextCut && alive.length > 3;
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <PanelHeader title={t('hud.survivors', { a: alive.length, n: m.players.length })} hint="Ranked by equity. At every countdown the lowest survivor (NEXT CUT) is eliminated onchain. The last three standing are paid 60/30/10." />
        {cutting ? (
          <span className="num text-xs text-red">{t('hud.nextCutIn', { n: Math.max(0, Math.ceil(nextCut - now)) })}</span>
        ) : (
          <span className="text-xs text-gold">{t('hud.finalThree')}</span>
        )}
      </div>
      <LayoutGroup>
        {ranked.map((p, i) => (
          <PlayerRow key={p.addr} p={p} rank={i + 1} danger={!!cutting && p === alive.at(-1)} />
        ))}
      </LayoutGroup>
    </div>
  );
}

export function Scoreboard({ m, now }: { m: MatchView; now: number }) {
  if (m.mode === Mode.DUEL) return <DuelBoard m={m} />;
  if (m.mode === Mode.SQUAD) return <SquadBoard m={m} />;
  return <RoyaleBoard m={m} now={now} />;
}
