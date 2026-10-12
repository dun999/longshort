'use client';
/*
 * Envio HyperIndex reads. The indexer (../indexer) turns every ArenaCore event into GraphQL
 * entities; this is the source of truth for onchain history. The keeper API only adds
 * off-chain profile data (display names, bot flags). Unset → pages use the keeper.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ADDR } from '@longshort/shared';
import { api } from './api';
import { handleGateResponse } from './gate-client';

export const ENVIO_URL = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL ?? '';
export const envioEnabled = () => !!ENVIO_URL;

const E18 = 1e18;
const addressOf = (id:string) => id.slice(-42).toLowerCase();
const currentArena = ADDR.arena.toLowerCase();
const STAKE_DP = 1e6;
const n18 = (v: unknown) => (v === null || v === undefined ? null : Number(v) / E18);
const nStake = (v: unknown) => Number(v ?? 0) / STAKE_DP;

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENVIO_URL, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (handleGateResponse(res)) throw new Error('Access code required');
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? 'Envio query failed');
  return json.data as T;
}

/** Off-chain profile info keyed by address (names, bots), best effort. */
async function profiles(addresses: string[]): Promise<Record<string, { name: string | null; bot: boolean }>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const rows = unique.length ? await api<any[]>(`/profiles?addresses=${unique.join(',')}`).catch(() => []) : [];
  return Object.fromEntries(rows.map((r) => [r.addr, { name: r.name, bot: !!r.bot }]));
}

export const matchEntityId = (id: number) => `${ADDR.arena.toLowerCase()}-${id}`;

/** Match report in the same shape the keeper's /match/:id returns. */
export async function envioMatch(id: number, options: { finalized?: boolean } = {}) {
  const d = await gql<{ Match_by_pk: any }>(
    `query($id: String!) { Match_by_pk(id: $id) {
        matchId mode entry duration state startAt endAt settledAt rake settleTx createTx asset tradingBudget
        players { trader_id team leverage result payout xpDelta finalEquity out }
        accounts { id trader_id address budget finalBalance returned }
        fills(order_by: { blockNumber: asc }) { id trader_id account_id orderType price lots notional fee txHash blockNumber timestamp }
        trades(order_by: { timestamp: asc }) { kind trader_id market isLong notional price pnl fee txHash timestamp }
      } }`,
    { id: matchEntityId(id) },
  );
  const m = d.Match_by_pk;
  if (!m) return null;
  // HyperSync can pause under rate limits. Until its terminal event arrives,
  // a report uses the keeper's receipt rather than presenting an older snapshot as final.
  if (options.finalized && (m.state !== 'SETTLED' || !m.settleTx)) return null;
  const names = await profiles(m.players.map((p: any) => addressOf(p.trader_id)));
  return {
    source: 'envio' as const,
    accounts:m.accounts.map((a:any)=>({addr:addressOf(a.trader_id),account:a.address,account_id:a.id,budget:nStake(a.budget),final_balance:a.finalBalance===null?null:nStake(a.finalBalance),returned:nStake(a.returned)})),
    fills:m.fills.map((f:any)=>({addr:addressOf(f.trader_id),account_id:f.account_id,order_type:f.orderType,price:Number(f.price)/10,lots:f.lots,notional:nStake(f.notional),fee:nStake(f.fee),tx:f.txHash,log_index:Number(f.id.split('-').at(-1)),block:f.blockNumber,ts:f.timestamp})),
    match: { id: Number(m.matchId), mode: m.mode, entry: nStake(m.entry), duration: m.duration, state: { OPEN: 0, LIVE: 1, SETTLED: 2, CANCELLED: 3, CLOSING:4 }[m.state as string], start_at: m.startAt, end_at: m.endAt, settled_at: m.settledAt as number | null, asset:m.asset,trading_budget:nStake(m.tradingBudget),rake: nStake(m.rake), settle_tx: m.settleTx },
    players: m.players.map((p: any) => ({
      addr: addressOf(p.trader_id),
      name: names[addressOf(p.trader_id)]?.name ?? null,
      bot: names[addressOf(p.trader_id)]?.bot ?? false,
      team: p.team,
      leverage: p.leverage,
      result: p.result,
      payout: nStake(p.payout),
      final_equity: n18(p.finalEquity),
      xp_delta: p.xpDelta,
    })),
    trades: m.trades.map((t: any) => {
      const closeFee=t.kind==='close'?m.fills.filter((f:any)=>f.txHash===t.txHash&&f.trader_id===t.trader_id&&f.orderType>=2).reduce((sum:number,f:any)=>sum+nStake(f.fee),0):0;
      return {kind:t.kind,addr:addressOf(t.trader_id),market:t.market,is_long:t.isLong===null?null:t.isLong?1:0,notional:n18(t.notional),price:n18(t.price),pnl:t.kind==='close'?(n18(t.pnl)??0)+closeFee:n18(t.pnl),fee:t.kind==='close'?closeFee:n18(t.fee),ts:t.timestamp,tx:t.txHash};
    }),
  };
}

/** How far the indexer has synced, and whether it's on HyperSync. */
export async function envioSync() {
  const d = await gql<{ chain_metadata: { block_height: number; latest_processed_block: number; is_hyper_sync: boolean }[] }>(`{ chain_metadata { block_height latest_processed_block is_hyper_sync } }`);
  const m = d.chain_metadata[0];
  return m ? { block: Number(m.latest_processed_block), head: Number(m.block_height), hyperSync: m.is_hyper_sync } : null;
}

/** Arena-wide onchain totals. */
export async function envioStats() {
  const d = await gql<{ ArenaStats: any[]; DailyStat: any[]; live: { aggregate: { count: number } } | null; byMode: any[] }>(
    `query($arena:String!) { ArenaStats(where:{arena:{_eq:$arena}}) { matchesCreated matchesSettled matchesCancelled players trades liquidations eliminations volume staked paidOut rake }
       DailyStat(where:{arena:{_eq:$arena}},order_by: { date: desc }, limit: 14) { id date trades volume matchesSettled }
       byMode: Match(where: {arena:{_eq:$arena}, state: { _eq: "SETTLED" } }) { mode } }`,
    {arena:currentArena},
  );
  const s = d.ArenaStats[0];
  const byMode = [0, 1, 2].map((mode) => ({ mode, n: d.byMode.filter((m) => m.mode === mode).length }));
  return s
    ? {
        matches: s.matchesCreated,
        settled: s.matchesSettled,
        cancelled: s.matchesCancelled,
        players: s.players,
        trades: s.trades,
        liquidations: s.liquidations,
        eliminations: s.eliminations,
        volume: n18(s.volume) ?? 0,
        staked: nStake(s.staked),
        paidOut: nStake(s.paidOut),
        rake: nStake(s.rake),
        byMode,
        daily: d.DailyStat.map((r) => ({ d: r.date, trades: r.trades, volume: n18(r.volume) ?? 0 })),
      }
    : null;
}

/** The leaderboard's own query, shown verbatim on /envio. */
export const LEADERBOARD_QUERY = `query Leaderboard($arena: String!) {
  Trader(
    where: { arena: { _eq: $arena }, matches: { _gt: 0 } }
    order_by: [{ xp: desc }, { wins: desc }]
    limit: 100
  ) { id address xp wins losses matches volume earned }
}`;
export const ARENA_ID = currentArena;

/** Leaderboard rows (keeper shape: addr, name, xp, wins, losses, matches, volume, earned, bot). */
export async function envioLeaderboard() {
  const d = await gql<{ Trader: any[] }>(LEADERBOARD_QUERY, { arena: currentArena });
  const names = await profiles(d.Trader.map((t) => t.address));
  return d.Trader.map((t) => ({ addr: t.address, name: names[t.address]?.name ?? null, bot: names[t.address]?.bot ? 1 : 0, xp: t.xp, wins: t.wins, losses: t.losses, matches: t.matches, volume: n18(t.volume) ?? 0, earned: nStake(t.earned) }));
}

/** A raw read for the /envio explainer: the response and the round trip it took. */
export async function envioQuery<T = unknown>(query: string, variables: Record<string, unknown> = {}) {
  const t0 = performance.now();
  const data = await gql<T>(query, variables);
  return { data, ms: Math.round(performance.now() - t0) };
}

const ROW_CAP = 2000;
/** Everything /envio draws: sync state, arena totals, daily activity, rows per entity and recent rounds. */
export async function envioOverview() {
  const d = await gql<any>(
    `query Overview($arena: String!, $cap: Int!) {
      chain_metadata { block_height latest_processed_block is_hyper_sync }
      ArenaStats(where: { arena: { _eq: $arena } }) { matchesCreated matchesSettled matchesCancelled players trades liquidations eliminations volume paidOut rake }
      DailyStat(where: { arena: { _eq: $arena } }, order_by: { date: desc }, limit: 14) { date trades volume matchesSettled }
      matches: Match(where: { arena: { _eq: $arena } }, limit: $cap) { mode state }
      players: MatchPlayer(where: { match: { arena: { _eq: $arena } } }, limit: $cap) { id }
      trades: Trade(where: { match: { arena: { _eq: $arena } } }, limit: $cap) { id }
      accounts: TradingAccount(where: { match: { arena: { _eq: $arena } } }, limit: $cap) { id }
      orders: PerplOrder(where: { account: { match: { arena: { _eq: $arena } } } }, limit: $cap) { id }
      fills: PerplFill(where: { match: { arena: { _eq: $arena } } }, limit: $cap) { id }
      vaults: VaultAddress(where: { account: { match: { arena: { _eq: $arena } } } }, limit: $cap) { id }
      traders: Trader(where: { arena: { _eq: $arena } }, limit: $cap) { id }
      recent: Match(where: { arena: { _eq: $arena }, state: { _eq: "SETTLED" } }, order_by: { settledAt: desc }, limit: 8) { matchId mode playerCount settledAt volume }
    }`,
    { arena: currentArena, cap: ROW_CAP },
  );
  const m = d.chain_metadata[0];
  const s = d.ArenaStats[0];
  const n = (rows: unknown[]) => ({ n: rows.length, capped: rows.length >= ROW_CAP });
  return {
    sync: m ? { block: Number(m.latest_processed_block), head: Number(m.block_height), hyperSync: !!m.is_hyper_sync } : null,
    stats: s
      ? { created: s.matchesCreated, settled: s.matchesSettled, cancelled: s.matchesCancelled, players: s.players, trades: s.trades, liquidations: s.liquidations, eliminations: s.eliminations, volume: n18(s.volume) ?? 0, paidOut: nStake(s.paidOut), rake: nStake(s.rake) }
      : null,
    daily: [...d.DailyStat].reverse().map((r: any) => ({ date: r.date as string, trades: r.trades as number, volume: n18(r.volume) ?? 0, settled: r.matchesSettled as number })),
    byMode: [0, 1, 2].map((mode) => d.matches.filter((x: any) => x.mode === mode && x.state === 'SETTLED').length),
    rows: {
      Match: n(d.matches), MatchPlayer: n(d.players), Trade: n(d.trades), TradingAccount: n(d.accounts), PerplOrder: n(d.orders),
      PerplFill: n(d.fills), VaultAddress: n(d.vaults), Trader: n(d.traders), ArenaStats: { n: d.ArenaStats.length, capped: false }, DailyStat: { n: d.DailyStat.length, capped: d.DailyStat.length >= 14 },
    } as Record<string, { n: number; capped: boolean }>,
    recent: d.recent.map((r: any) => ({ id: Number(r.matchId), mode: r.mode as number, players: r.playerCount as number, settledAt: r.settledAt as number, volume: n18(r.volume) ?? 0 })) as { id: number; mode: number; players: number; settledAt: number; volume: number }[],
  };
}
export type EnvioOverview = Awaited<ReturnType<typeof envioOverview>>;

/** A trader's lifetime record + match history (keeper profile shape). */
export async function envioProfile(addr: string) {
  const a = addr.toLowerCase();
  const d = await gql<{ Trader_by_pk: any; rank: { aggregate: { count: number } } }>(
    `query($a: String!) {
        Trader_by_pk(id: $a) { id xp wins losses draws matches trades volume earned liquidations
          entries(order_by: { match: { createdAt: desc } }, limit: 30) {
            team leverage result payout finalEquity xpDelta
            match { matchId mode entry state startAt settleTx arena } } }
      }`,
    { a: `${currentArena}-${a}` },
  );
  const t = d.Trader_by_pk;
  if (!t) return null;
  return {
    source: 'envio' as const,
    profile: { addr: a, xp: t.xp, wins: t.wins, losses: t.losses, matches: t.matches, volume: n18(t.volume) ?? 0, earned: nStake(t.earned) },
    matches: t.entries
      .filter((e: any) => e.match.arena === ADDR.arena.toLowerCase())
      .map((e: any) => ({ id: Number(e.match.matchId), mode: e.match.mode, entry: nStake(e.match.entry), state: { OPEN: 0, LIVE: 1, SETTLED: 2, CANCELLED: 3, CLOSING:4 }[e.match.state as string], start_at: e.match.startAt, settle_tx: e.match.settleTx, team: e.team, leverage: e.leverage, result: e.result, payout: nStake(e.payout), final_equity: n18(e.finalEquity), xp_delta: e.xpDelta })),
  };
}

/** Polls an Envio reader; falls back to the keeper endpoint when Envio is off or errors. */
export function useIndexed<T>(envio: (() => Promise<T | null>) | null, keeperPath: string | null, refreshMs?: number, scope?: string) {
  type Indexed = T & { source?: 'envio' | 'keeper' };
  const currentScope = scope ?? keeperPath ?? 'global';
  const [snapshot, setSnapshot] = useState<{ scope: string; data: Indexed }>();
  const active = useRef(currentScope);
  const fetcher = useRef(envio);
  active.current = currentScope;
  fetcher.current = envio;
  const load = useCallback(async () => {
    const commit = (value: T, source: 'envio' | 'keeper') => {
      if (active.current !== currentScope) return;
      const data = (Array.isArray(value) ? Object.assign(value, { source }) : { ...(value as object), source }) as Indexed;
      setSnapshot({ scope: currentScope, data });
    };
    const query = fetcher.current;
    if (query && envioEnabled()) {
      try {
        const r = await query();
        if (r) return commit(r, 'envio');
      } catch {
        /* fall through to the keeper */
      }
    }
    if (keeperPath) {
      const r = await api<T>(keeperPath).catch(() => undefined);
      if (r) commit(r, 'keeper');
    }
  }, [keeperPath, currentScope]);
  useEffect(() => {
    void load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { data: snapshot?.scope === currentScope ? snapshot.data : undefined, reload: load };
}

export function EnvioBadge({ source }: { source?: 'envio' | 'keeper' }) {
  if (source !== 'envio') return null;
  return (
    <span className="inline-flex items-center gap-1 border border-gold/40 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.14em] text-gold uppercase" title="Onchain data indexed by Envio HyperIndex">
      <EnvioMark size={11} /> Indexed by Envio
    </span>
  );
}

/** Small Envio mark: an "E" of three index rows in a chamfered frame. */
export function EnvioMark({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={className} role="img" aria-label="Envio">
      <path d="M1.5 1.5h10l3 3v10h-10l-3-3z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5 5.2h6M5 8h4.2M5 10.8h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
