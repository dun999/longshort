'use client';
/* Dev-only QA harness: renders each match phase with sample players (no chain, no stake). 404 in production. */
import { notFound, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { MARGIN, Mode, MatchState, MARKETS, type MarketSymbol } from '@longshort/shared';
import type { MatchView, PlayerView } from '@/lib/match';
import { useScene, type Shot } from '@/lib/scene';
import { ClassSelect, MatchFound, Result, VsScreen, Waiting } from '@/components/match/Phases';
import { Hud } from '@/components/hud/Hud';

const ADDRS = ['0x5bf0b1240279edcbf19942dd934565eb76852384', '0x20b0c479c08e9d3402095c665ba2794990ae7149', '0x816f4de03028ed8a296ea3c3a94e2a09c7536a47', '0xf59089942a961ab9c6f790d400fabfc65616c062', '0xa92fc1336148f617792f5bc45920e6e7f9cb02ec', '0xce603ae1f275c7a4d24d99fc5429fb00df662f06', '0x752960e5f2e6c2060873c81f3a140a004f655cf9', '0xc40ebd00000000000000000000000000000000aa'];
const NAMES = ['sigmaboy', 'bot·Vega', 'Dun', 'kira', 'bot·Nyx', 'mo', 'bot·Atlas', 'zed'];

function sample(mode: Mode, filled: number): MatchView {
  const max = mode === Mode.DUEL ? 2 : mode === Mode.SQUAD ? 6 : 8;
  const now = Date.now() / 1000;
  const players: PlayerView[] = Array.from({ length: Math.min(filled, max) }, (_, i) => {
    const equity = MARGIN + (i % 2 ? -1 : 1) * (12 + i * 7.3);
    return { addr: ADDRS[i], name: NAMES[i], bot: NAMES[i].startsWith('bot'), team: mode === Mode.ROYALE ? 0 : i % 2, leverage: [25, 10, 50][i % 3], out: false, outRank: 0, realized: 0, pos: null, equity, pnl: equity - MARGIN, isMe: i === 0, session: '' };
  });
  const sorted = [...players].sort((a, b) => b.equity - a.equity);
  return {
    id: 42, trades: [], loaded: true, mode, state: MatchState.SETTLED, entry: 5, maxPlayers: max, nPlayers: players.length, duration: 60,
    createdAt: now - 7, startAt: now - 70, endAt: now - 10, round: 0, players, me: players[0],
    prices: Object.fromEntries(MARKETS.map((m) => [m, 1])) as Record<MarketSymbol, number>, feed: [],
    results: sorted.map((p, i) => ({ addr: p.addr, result: mode === Mode.ROYALE ? (i < 3 ? 'win' : 'loss') : p.team === sorted[0].team ? 'win' : 'loss', payout: i === 0 ? 9.75 : 0, final_equity: p.equity, xp_delta: i === 0 ? 50 : -20 })),
    settleTx: '0x7671077fb046c018458c08f9e869970cf663def96ad0eea8363b55d6d3ac5679', refresh: () => {},
  };
}

const SHOT: Record<string, Shot> = { waiting: 'queue', found: 'lobby', select: 'select', vs: 'vs', live: 'arena', result: 'result' };
const NOOP = { open: async () => ({ ms: 0 }), close: async () => ({ ms: 0 }), simulated: true };

function Harness() {
  const q = useSearchParams();
  const phase = q.get('phase') ?? 'waiting';
  const mode = ({ duel: Mode.DUEL, squad: Mode.SQUAD, royale: Mode.ROYALE } as Record<string, Mode>)[q.get('mode') ?? 'duel'] ?? Mode.DUEL;
  const m = useMemo(() => sample(mode, Number(q.get('filled') ?? 99)), [mode, q]);
  const [lev, setLev] = useState(25);
  useEffect(() => useScene.getState().set({ shot: SHOT[phase] ?? 'lobby', slots: [] }), [phase]);
  const now = Date.now() / 1000;
  return (
    <div className="relative min-h-[calc(100dvh-64px)]">
      {phase === 'waiting' && <Waiting m={{ ...m, state: MatchState.OPEN }} now={now} onLeave={() => {}} leaving={false} />}
      {phase === 'found' && <MatchFound m={m} />}
      {phase === 'select' && <ClassSelect m={{ ...m, me: { ...m.me!, leverage: lev } }} left={6} onPick={setLev} pending={false} />}
      {phase === 'vs' && <VsScreen m={m} left={3} />}
      {phase === 'live' && (
        <Hud
          m={{ ...m, state: MatchState.LIVE, startAt: now - 20, endAt: now + 40, results: undefined, players: m.players.map((p, i) => (mode === Mode.ROYALE && i >= 6 ? { ...p, out: true, outRank: i } : p)) }}
          now={now}
          actions={NOOP}
          live
        />
      )}
      {phase === 'result' && <Result m={m} onAgain={() => {}} busy={false} />}
    </div>
  );
}

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense>
      <Harness />
    </Suspense>
  );
}
