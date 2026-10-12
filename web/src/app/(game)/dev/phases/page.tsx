'use client';
/* Dev-only QA harness: renders each match phase with sample players (no chain, no stake). 404 in production. */
import { notFound, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { REAL_TRADING, MARGIN, MODES, Mode, MatchState, MARKETS, characterOf, payouts, type MarketSymbol } from '@longshort/shared';
import type { MatchView, PlayerView } from '@/lib/match';
import { useScene, type Shot } from '@/lib/scene';
import { ClassSelect, MatchFound, Result, VsScreen, Waiting } from '@/components/match/Phases';
import { Hud } from '@/components/hud/Hud';

const ADDRS = ['0x5bf0b1240279edcbf19942dd934565eb76852384', '0x20b0c479c08e9d3402095c665ba2794990ae7149', '0x816f4de03028ed8a296ea3c3a94e2a09c7536a47', '0xf59089942a961ab9c6f790d400fabfc65616c062', '0xa92fc1336148f617792f5bc45920e6e7f9cb02ec', '0xce603ae1f275c7a4d24d99fc5429fb00df662f06', '0x752960e5f2e6c2060873c81f3a140a004f655cf9', '0xc40ebd00000000000000000000000000000000aa'];
const NAMES = ['sigmaboy', 'bot·Vega', 'Dun', 'kira', 'bot·Nyx', 'mo', 'bot·Atlas', 'zed'];

function sample(mode: Mode, filled: number): MatchView {
  const max = MODES[mode].maxPlayers;
  const now = Date.now() / 1000;
  // a Squad side shares its leader's leverage
  const players: PlayerView[] = Array.from({ length: Math.min(filled, max) }, (_, i) => {
    const equity = MARGIN + (i % 2 ? -1 : 1) * (12 + i * 7.3);
    return { addr: ADDRS[i], name: NAMES[i], bot: NAMES[i].startsWith('bot'), character: characterOf(ADDRS[i]), team: mode === Mode.ROYALE ? 0 : i % 2, leverage: REAL_TRADING ? (mode === Mode.SQUAD ? [10, 5][i % 2] : [5, 10, 15][i % 3]) : [25, 10, 50][i % 3], out: false, outRank: 0, realized: 0, pos: null, equity, pnl: equity - MARGIN, isMe: i === 0, session: '' };
  });
  const sorted = [...players].sort((a, b) => b.equity - a.equity);
  return {
    id: 42, trades: [], loaded: true, mode, state: MatchState.SETTLED, entry: 5, maxPlayers: max, nPlayers: players.length, duration: 60,
    createdAt: now - 7, startAt: now - 70, endAt: now - 10, round: 0, players, me: players[0],
    prices: Object.fromEntries(MARKETS.map((m) => [m, 1])) as Record<MarketSymbol, number>, feed: [],
    // paid as the contract would: Duel winner, both Squad winners, Royale's top three
    results: sorted.map((p, i) => {
      const pay = payouts(mode, 5, max);
      const win = mode === Mode.ROYALE ? i < 3 : p.team === sorted[0].team;
      const payout = !win ? 0 : mode === Mode.ROYALE ? [pay.first, pay.second!, pay.third!][i] : pay.first;
      return { addr: p.addr, result: win ? 'win' : 'loss', payout, final_equity: p.equity, xp_delta: win ? 50 : -20 };
    }),
    settleTx: '0x7671077fb046c018458c08f9e869970cf663def96ad0eea8363b55d6d3ac5679', refresh: () => {},
  };
}

const SHOT: Record<string, Shot> = { waiting: 'queue', found: 'lobby', select: 'select', vs: 'vs', live: 'arena', result: 'result' };
const NOOP = { open: async () => ({ ms: 0 }), close: async () => ({ ms: 0 }), simulated: true };
/** ?real=1: the HUD as a live (non-simulated) match renders it */
const LIVE = { ...NOOP, simulated: false };

function Harness() {
  const q = useSearchParams();
  const phase = q.get('phase') ?? 'waiting';
  const mode = ({ duel: Mode.DUEL, squad: Mode.SQUAD, royale: Mode.ROYALE } as Record<string, Mode>)[q.get('mode') ?? 'duel'] ?? Mode.DUEL;
  const m = useMemo(() => {
    const base = sample(mode, Number(q.get('filled') ?? 99));
    // ?me=<seat> plays as another seat (a loss, say); ?me=-1 watches. ?draw=1 refunds everyone. ?practice=1: no stake.
    const seat = Number(q.get('me') ?? 0);
    const players = base.players.map((p, i) => ({ ...p, isMe: i === seat }));
    const practice = !!q.get('practice');
    const results = q.get('draw') ? base.results?.map((r) => ({ ...r, result: 'draw', payout: base.entry, xp_delta: 0 })) : practice ? base.results?.map((r) => ({ ...r, payout: 0, xp_delta: 0 })) : base.results;
    const accounts = REAL_TRADING && !practice ? players.map((p) => ({ addr: p.addr, account: p.addr, account_id: '1119', budget: MARGIN, final_balance: p.equity, returned: p.equity })) : undefined;
    return { ...base, id: practice ? 0 : base.id, players, me: players[seat], results, accounts };
  }, [mode, q]);
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
          actions={q.get('real') ? LIVE : NOOP}
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
