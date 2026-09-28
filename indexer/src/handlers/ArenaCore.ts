/*
 * longshort.fun ArenaCore indexer (Envio HyperIndex).
 * Turns every ArenaCore event into queryable game state: matches, players, the full trade log,
 * lifetime trader records with XP, and arena-wide + daily stats.
 */
import { indexer, type ArenaStats, type DailyStat, type EvmOnEventContext, type Match, type MatchPlayer, type Trader } from 'envio';

// XP rules mirror packages/shared/src/game.ts (win +50, loss −20 with a floor, draws 0)
const XP_START = 1000;
const XP_WIN = 50;
const XP_LOSS = -20;
const XP_FLOOR = 1000;
const MARGIN = 1000n * 10n ** 18n; // every player's virtual starting margin (ArenaCore.MARGIN)

type Ctx = EvmOnEventContext;

const lc = (a: string) => a.toLowerCase();
const matchKey = (arena: string, id: bigint) => `${lc(arena)}-${id}`;
const playerKey = (match: string, player: string) => `${match}-${lc(player)}`;
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

async function stats(context: Ctx): Promise<ArenaStats> {
  return context.ArenaStats.getOrCreate({
    id: 'global',
    matchesCreated: 0,
    matchesSettled: 0,
    matchesCancelled: 0,
    players: 0,
    trades: 0,
    liquidations: 0,
    eliminations: 0,
    volume: 0n,
    staked: 0n,
    paidOut: 0n,
    rake: 0n,
  });
}

async function daily(context: Ctx, ts: number): Promise<DailyStat> {
  return context.DailyStat.getOrCreate({ id: day(ts), trades: 0, volume: 0n, matchesSettled: 0 });
}

async function trader(context: Ctx, addr: string, ts: number): Promise<{ t: Trader; isNew: boolean }> {
  const existing = await context.Trader.get(lc(addr));
  if (existing) return { t: { ...existing, lastSeen: ts }, isNew: false };
  return {
    t: { id: lc(addr), matches: 0, wins: 0, losses: 0, draws: 0, trades: 0, liquidations: 0, volume: 0n, fees: 0n, staked: 0n, earned: 0n, xp: XP_START, firstSeen: ts, lastSeen: ts },
    isNew: true,
  };
}

// ─── lobby lifecycle ────────────────────────────────────────────────────────
indexer.onEvent({ contract: 'ArenaCore', event: 'MatchCreated' }, async ({ event, context }) => {
  const p = event.params;
  const ts = event.block.timestamp;
  context.Match.set({
    id: matchKey(event.srcAddress, p.id),
    arena: lc(event.srcAddress),
    matchId: p.id,
    mode: Number(p.mode),
    entry: p.entry,
    maxPlayers: Number(p.maxPlayers),
    duration: Number(p.duration),
    creator: lc(p.creator),
    state: 'OPEN',
    createdAt: ts,
    startAt: undefined,
    endAt: undefined,
    settledAt: undefined,
    playerAddrs: [],
    playerCount: 0,
    tradeCount: 0,
    volume: 0n,
    rake: 0n,
    paidOut: 0n,
    createTx: event.transaction.hash,
    settleTx: undefined,
  });
  const s = await stats(context);
  context.ArenaStats.set({ ...s, matchesCreated: s.matchesCreated + 1 });
});

indexer.onEvent({ contract: 'ArenaCore', event: 'PlayerJoined' }, async ({ event, context }) => {
  const p = event.params;
  const ts = event.block.timestamp;
  const mId = matchKey(event.srcAddress, p.id);
  const m = await context.Match.getOrThrow(mId);
  const addr = lc(p.player);
  context.Match.set({ ...m, playerAddrs: [...m.playerAddrs, addr], playerCount: m.playerCount + 1 });
  context.MatchPlayer.set({
    id: playerKey(mId, addr),
    match_id: mId,
    trader_id: addr,
    team: Number(p.team),
    leverage: Number(p.leverage),
    session: lc(p.session),
    trades: 0,
    closes: 0,
    volume: 0n,
    fees: 0n,
    realizedPnl: 0n,
    out: undefined,
    frozenEquity: undefined,
    finalEquity: undefined,
    result: undefined,
    payout: 0n,
    xpDelta: 0,
  });
  const { t, isNew } = await trader(context, addr, ts);
  context.Trader.set({ ...t, staked: t.staked + m.entry });
  const s = await stats(context);
  context.ArenaStats.set({ ...s, staked: s.staked + m.entry, players: s.players + (isNew ? 1 : 0) });
});

indexer.onEvent({ contract: 'ArenaCore', event: 'PlayerLeft' }, async ({ event, context }) => {
  const mId = matchKey(event.srcAddress, event.params.id);
  const addr = lc(event.params.player);
  const m = await context.Match.getOrThrow(mId);
  context.Match.set({ ...m, playerAddrs: m.playerAddrs.filter((a) => a !== addr), playerCount: m.playerCount - 1 });
  context.MatchPlayer.deleteUnsafe(playerKey(mId, addr));
  const t = await context.Trader.get(addr);
  if (t) context.Trader.set({ ...t, staked: t.staked - m.entry });
  const s = await stats(context);
  context.ArenaStats.set({ ...s, staked: s.staked - m.entry });
});

indexer.onEvent({ contract: 'ArenaCore', event: 'ClassChanged' }, async ({ event, context }) => {
  const mId = matchKey(event.srcAddress, event.params.id);
  const mp = await context.MatchPlayer.get(playerKey(mId, event.params.player));
  if (mp) context.MatchPlayer.set({ ...mp, leverage: Number(event.params.leverage) });
});

indexer.onEvent({ contract: 'ArenaCore', event: 'MatchStarted' }, async ({ event, context }) => {
  const m = await context.Match.getOrThrow(matchKey(event.srcAddress, event.params.id));
  context.Match.set({ ...m, state: 'LIVE', startAt: Number(event.params.startAt), endAt: Number(event.params.endAt) });
});

indexer.onEvent({ contract: 'ArenaCore', event: 'Cancelled' }, async ({ event, context }) => {
  const m = await context.Match.getOrThrow(matchKey(event.srcAddress, event.params.id));
  context.Match.set({ ...m, state: 'CANCELLED' });
  const s = await stats(context);
  context.ArenaStats.set({ ...s, matchesCancelled: s.matchesCancelled + 1, staked: s.staked - m.entry * BigInt(m.playerCount) });
});

// ─── trading ────────────────────────────────────────────────────────────────
indexer.onEvent({ contract: 'ArenaCore', event: 'Opened' }, async ({ event, context }) => {
  const p = event.params;
  const ts = event.block.timestamp;
  const mId = matchKey(event.srcAddress, p.id);
  const addr = lc(p.player);
  context.Trade.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    match_id: mId,
    trader_id: addr,
    kind: 'open',
    market: Number(p.market),
    isLong: p.isLong,
    notional: p.notional,
    price: p.price,
    pnl: undefined,
    fee: p.fee,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: ts,
  });
  const m = await context.Match.getOrThrow(mId);
  context.Match.set({ ...m, tradeCount: m.tradeCount + 1, volume: m.volume + p.notional });
  const mp = await context.MatchPlayer.get(playerKey(mId, addr));
  if (mp) context.MatchPlayer.set({ ...mp, trades: mp.trades + 1, volume: mp.volume + p.notional, fees: mp.fees + p.fee, realizedPnl: mp.realizedPnl - p.fee });
  const { t } = await trader(context, addr, ts);
  context.Trader.set({ ...t, trades: t.trades + 1, volume: t.volume + p.notional, fees: t.fees + p.fee });
  const s = await stats(context);
  context.ArenaStats.set({ ...s, trades: s.trades + 1, volume: s.volume + p.notional });
  const d = await daily(context, ts);
  context.DailyStat.set({ ...d, trades: d.trades + 1, volume: d.volume + p.notional });
});

indexer.onEvent({ contract: 'ArenaCore', event: 'Closed' }, async ({ event, context }) => {
  const p = event.params;
  const mId = matchKey(event.srcAddress, p.id);
  const addr = lc(p.player);
  context.Trade.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    match_id: mId,
    trader_id: addr,
    kind: 'close',
    market: Number(p.market),
    isLong: undefined,
    notional: undefined,
    price: p.price,
    pnl: p.pnl,
    fee: p.fee,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
  const mp = await context.MatchPlayer.get(playerKey(mId, addr));
  if (mp) context.MatchPlayer.set({ ...mp, closes: mp.closes + 1, fees: mp.fees + p.fee, realizedPnl: mp.realizedPnl + p.pnl - p.fee });
  const t = await context.Trader.get(addr);
  if (t) context.Trader.set({ ...t, fees: t.fees + p.fee });
});

indexer.onEvent({ contract: 'ArenaCore', event: 'Liquidated' }, async ({ event, context }) => {
  const p = event.params;
  const mId = matchKey(event.srcAddress, p.id);
  const addr = lc(p.player);
  context.Trade.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    match_id: mId,
    trader_id: addr,
    kind: 'liquidated',
    market: undefined,
    isLong: undefined,
    notional: undefined,
    price: p.price,
    pnl: undefined,
    fee: undefined,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
  const mp = await context.MatchPlayer.get(playerKey(mId, addr));
  if (mp) context.MatchPlayer.set({ ...mp, out: 'liquidated', frozenEquity: 0n });
  const t = await context.Trader.get(addr);
  if (t) context.Trader.set({ ...t, liquidations: t.liquidations + 1 });
  const s = await stats(context);
  context.ArenaStats.set({ ...s, liquidations: s.liquidations + 1 });
});

indexer.onEvent({ contract: 'ArenaCore', event: 'Eliminated' }, async ({ event, context }) => {
  const p = event.params;
  const mId = matchKey(event.srcAddress, p.id);
  const addr = lc(p.player);
  context.Trade.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    match_id: mId,
    trader_id: addr,
    kind: 'eliminated',
    market: undefined,
    isLong: undefined,
    notional: undefined,
    price: undefined,
    pnl: undefined,
    fee: undefined,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
  const mp = await context.MatchPlayer.get(playerKey(mId, addr));
  if (mp) context.MatchPlayer.set({ ...mp, out: 'eliminated', frozenEquity: p.equity < 0n ? 0n : p.equity });
  const s = await stats(context);
  context.ArenaStats.set({ ...s, eliminations: s.eliminations + 1 });
});

// ─── settlement: results, payouts, XP ───────────────────────────────────────
indexer.onEvent({ contract: 'ArenaCore', event: 'Settled' }, async ({ event, context }) => {
  const p = event.params;
  const ts = event.block.timestamp;
  const mId = matchKey(event.srcAddress, p.id);
  const m: Match = await context.Match.getOrThrow(mId);
  const winners = p.winners.map(lc);
  const paid = new Map<string, bigint>(winners.map((w, i) => [w, p.payouts[i] ?? 0n]));
  // a refunded tie pays every player their entry with no rake
  const draw = p.rake === 0n && winners.length === m.playerAddrs.length;
  let total = 0n;
  for (const addr of m.playerAddrs) {
    const payout = paid.get(addr) ?? 0n;
    total += payout;
    const result = draw ? 'draw' : paid.has(addr) ? 'win' : 'loss';
    const { t } = await trader(context, addr, ts);
    const xpDelta = result === 'win' ? XP_WIN : result === 'loss' ? Math.max(XP_FLOOR, t.xp + XP_LOSS) - t.xp : 0;
    context.Trader.set({
      ...t,
      matches: t.matches + 1,
      wins: t.wins + (result === 'win' ? 1 : 0),
      losses: t.losses + (result === 'loss' ? 1 : 0),
      draws: t.draws + (result === 'draw' ? 1 : 0),
      earned: t.earned + payout - m.entry,
      xp: t.xp + xpDelta,
    });
    const mp: MatchPlayer | undefined = await context.MatchPlayer.get(playerKey(mId, addr));
    if (mp) {
      // settle() closes open positions first (their Closed events are already applied), so
      // survivors' equity is margin + realized; knocked-out players keep their frozen equity
      const live = MARGIN + mp.realizedPnl;
      const finalEquity = mp.out ? (mp.frozenEquity ?? 0n) : live < 0n ? 0n : live;
      context.MatchPlayer.set({ ...mp, result, payout, xpDelta, finalEquity });
    }
  }
  context.Match.set({ ...m, state: 'SETTLED', settledAt: ts, rake: p.rake, paidOut: total, settleTx: event.transaction.hash });
  const s = await stats(context);
  context.ArenaStats.set({
    ...s,
    matchesSettled: s.matchesSettled + 1,
    paidOut: s.paidOut + total,
    rake: s.rake + p.rake,
    staked: s.staked - m.entry * BigInt(m.playerAddrs.length),
  });
  const d = await daily(context, ts);
  context.DailyStat.set({ ...d, matchesSettled: d.matchesSettled + 1 });
});
