'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, stringify } from 'viem';
import { REAL_TRADING, MARGIN, MARKETS, Mode, MatchState, characterOf, equityOf, shortAddr, type CharacterId, type MarketSymbol, type Pos } from '@longshort/shared';
import { arena, publicClient } from './clients';
import { api } from './api';
import { onChainEvent, useMarketPrices } from './socket';
import { useWallet } from './wallet';
import { useCharacter } from './character';

export interface PlayerView {
  addr: string;
  name: string;
  bot: boolean;
  character: CharacterId;
  team: number;
  leverage: number;
  out: boolean;
  outRank: number;
  realized: number;
  pos: Pos | null;
  equity: number;
  pnl: number; // equity - margin
  isMe: boolean;
  session: string;
}

export interface FeedItem {
  id: string;
  at: number;
  kind: 'open' | 'close' | 'liquidated' | 'eliminated' | 'join' | 'start' | 'settled' | 'class';
  who?: string;
  text: string;
  tone: 'up' | 'down' | 'neutral' | 'warn';
  tx?: string;
}

export interface TradeRow {
  kind: string;
  addr: string;
  market: number | null;
  is_long: number | null;
  notional: number | null;
  price: number | null;
  pnl?: number | null; // close: gross PnL, before the close fee
  fee?: number | null;
  ts: number;
  tx: string;
}

export interface MatchView {
  id: number;
  trades: TradeRow[];
  loaded: boolean;
  mode: Mode;
  state: MatchState;
  entry: number;
  maxPlayers: number;
  nPlayers: number;
  duration: number;
  createdAt: number;
  startAt: number;
  endAt: number;
  round: number;
  players: PlayerView[];
  me?: PlayerView;
  prices: Record<MarketSymbol, number | undefined>;
  feed: FeedItem[];
  settleTx?: string;
  allowBots?: boolean;
  rematchOf?: number;
  results?: { addr: string; result: string; payout: number; final_equity: number; xp_delta: number }[];
  accounts?: {addr:string;account:string;account_id:string;budget:number;final_balance:number|null;returned:number}[];
  fills?: {addr:string;notional:number;fee:number}[];
  refresh: () => void;
}

const e18 = (x: bigint) => Number(formatUnits(x, 18));
const MKT = (m: number) => MARKETS[m] ?? '?';

export function useMatch(id: number): MatchView {
  const me = useWallet((s) => s.address?.toLowerCase());
  const myCharacter = useCharacter((c) => c.id);
  const [raw, setRaw] = useState<{ m: any; ps: readonly any[] } | null>(null);
  const [meta, setMeta] = useState<{ names: Record<string, { name: string | null; bot: boolean; character?: string | null }>; match?: any; players?: any[]; trades?: TradeRow[]; accounts?:MatchView['accounts'];fills?:MatchView['fills'] }>({ names: {} });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const seen = useRef(new Set<string>());
  const nameRef = useRef(meta.names);
  nameRef.current = meta.names;

  // The chain is read every second; an unchanged answer must not re-render the whole match screen.
  const lastRaw = useRef('');
  const load = useCallback(async () => {
    const [m, ps] = await Promise.all([
      publicClient.readContract({ ...arena, functionName: 'getMatch', args: [BigInt(id)] }),
      publicClient.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(id)] }),
    ]).catch(() => [null, null] as const);
    if (!m || !ps) return;
    const key = `${id}:${stringify([m, ps])}`;
    if (key === lastRaw.current) return;
    lastRaw.current = key;
    setRaw({ m, ps });
  }, [id]);

  const lastMeta = useRef('');
  const loadMeta = useCallback(async () => {
    const r = await api<any>(`/match/${id}`).catch(() => null);
    if (!r?.players) return;
    const key = `${id}:${JSON.stringify(r)}`;
    if (key === lastMeta.current) return;
    lastMeta.current = key;
    const names = Object.fromEntries(r.players.map((p: any) => [p.addr, { name: p.name, bot: p.bot, character: p.character }]));
    setMeta({ names, match: r.match, players: r.players, trades: r.trades, accounts:r.accounts, fills:r.fills });
    // seed the feed from indexed trades once
    const items: FeedItem[] = [];
    for (const t of r.trades as any[]) {
      const k = `${t.tx}:${t.kind}:${t.addr}`;
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      items.push(tradeItem(k, t.kind, t.addr, t.ts * 1000, { market: t.market, isLong: t.is_long, notional: t.notional, price: t.price, pnl: t.pnl }, t.tx, names));
    }
    if (items.length) setFeed((f) => [...f, ...items].sort((a, b) => a.at - b.at).slice(-60));
  }, [id]);

  useEffect(() => {
    void load();
    void loadMeta();
    const a = setInterval(load, 1000);
    const b = setInterval(loadMeta, 4000);
    const off = onChainEvent((e) => {
      if (e.matchId !== id) return;
      void load();
      if (['PlayerJoined', 'Settled', 'MatchStarted', 'Opened', 'Closed', 'Liquidated','CollateralReturned','Closing','FinalBalance','TradingAccountCreated'].includes(e.name)) setTimeout(() => void loadMeta(), 900);
      const who = String(e.args.player ?? '').toLowerCase();
      // same key shape as indexed trades so a trade seen via both paths shows once
      const kind = ({ Opened: 'open', Closed: 'close', Liquidated: 'liquidated', Eliminated: 'eliminated' } as Record<string, string>)[e.name] ?? e.name;
      const k = `${e.tx}:${kind}:${who}`;
      if (seen.current.has(k)) return;
      seen.current.add(k);
      const item = eventItem(k, e, nameRef.current);
      if (item) setFeed((f) => [...f, item].slice(-60));
    });
    return () => {
      clearInterval(a);
      clearInterval(b);
      off();
    };
  }, [id, load, loadMeta]);

  const prices = useMarketPrices();

  return useMemo<MatchView>(() => {
    const m = raw?.m;
    const players: PlayerView[] = (raw?.ps ?? []).map((p: any) => {
      const addr = String(p.addr).toLowerCase();
      const pos: Pos | null = p.hasPos ? { market: Number(p.pos.market), isLong: p.pos.isLong, notional: e18(p.pos.notional), entryPx: e18(p.pos.entryPx) } : null;
      const realized = e18(BigInt(p.realized));
      const equity = REAL_TRADING || p.out ? e18(BigInt(p.frozenEquity)) : equityOf(realized, pos, pos ? prices[MKT(pos.market) as MarketSymbol] : undefined);
      const n = meta.names[addr];
      const isMe = addr === me || String(p.session).toLowerCase() === me;
      return {
        addr,
        name: n?.name ?? shortAddr(addr),
        bot: !!n?.bot,
        // the keeper's record wins; until it loads, my own seat shows this browser's pick, not the address fallback
        character: characterOf(addr, n?.character ?? (isMe ? myCharacter : undefined)),
        team: Number(p.team),
        leverage: Number(p.leverage),
        out: p.out,
        outRank: Number(p.outRank),
        realized,
        pos,
        equity,
        pnl: equity - MARGIN,
        isMe,
        session: String(p.session).toLowerCase(),
      };
    });
    return {
      id,
      trades: meta.trades ?? [],
      loaded: !!m,
      mode: (m?.mode ?? 0) as Mode,
      state: (m?.state ?? 0) as MatchState,
      entry: m ? Number(formatUnits(m.entry, 6)) : 0,
      maxPlayers: m?.maxPlayers ?? 2,
      nPlayers: m?.nPlayers ?? 0,
      duration: m?.duration ?? 60,
      createdAt: Number(m?.createdAt ?? 0),
      startAt: Number(m?.startAt ?? 0),
      endAt: Number(m?.endAt ?? 0),
      round: m?.round ?? 0,
      players,
      me: players.find((p) => p.isMe),
      prices,
      feed,
      settleTx: meta.match?.settle_tx ?? undefined,
      allowBots: meta.match?.allow_bots ?? false,
      rematchOf: meta.match?.rematch_of ?? undefined,
      results: meta.players?.filter((p) => p.result),
      accounts: meta.accounts,
      fills: meta.fills,
      refresh: () => void (load(), loadMeta()),
    };
  }, [raw, meta, prices, feed, me, myCharacter, id, load, loadMeta]);
}

const nm = (addr: string, names: Record<string, { name: string | null }>) => names[addr]?.name ?? shortAddr(addr);
const usd = (n: number) => `$${Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toFixed(0)}`;

function tradeItem(id: string, kind: string, addr: string, at: number, t: any, tx: string, names: any): FeedItem {
  const who = nm(addr, names);
  if (kind === 'open')
    return { id, at, kind: 'open', who, tx, tone: t.isLong ? 'up' : 'down', text: `${t.isLong ? 'LONG' : 'SHORT'} ${MKT(t.market)} ${usd(t.notional)} @ ${Number(t.price).toPrecision(6)}` };
  if (kind === 'close') return { id, at, kind: 'close', who, tx, tone: t.pnl >= 0 ? 'up' : 'down', text: `closed ${MKT(t.market)} ${t.pnl >= 0 ? '+' : '−'}$${Math.abs(t.pnl).toFixed(2)}` };
  if (kind === 'liquidated') return { id, at, kind: 'liquidated', who, tx, tone: 'warn', text: 'LIQUIDATED' };
  return { id, at, kind: 'eliminated', who, tx, tone: 'warn', text: 'ELIMINATED' };
}

function eventItem(id: string, e: any, names: any): FeedItem | null {
  const a = e.args;
  const addr = String(a.player ?? '').toLowerCase();
  const at = Date.now();
  switch (e.name) {
    case 'Opened':
      return tradeItem(id, 'open', addr, at, { market: Number(a.market), isLong: a.isLong, notional: e18(BigInt(a.notional)), price: e18(BigInt(a.price)) }, e.tx, names);
    case 'Closed':
      return tradeItem(id, 'close', addr, at, { market: Number(a.market), pnl: e18(BigInt(a.pnl)) - e18(BigInt(a.fee)) }, e.tx, names);
    case 'Liquidated':
      return tradeItem(id, 'liquidated', addr, at, {}, e.tx, names);
    case 'Eliminated':
      return tradeItem(id, 'eliminated', addr, at, {}, e.tx, names);
    case 'PlayerJoined':
      return { id, at, kind: 'join', who: nm(addr, names), text: 'entered the lobby', tone: 'neutral', tx: e.tx };
    case 'MatchStarted':
      return { id, at, kind: 'start', text: 'Lobby full: match locked onchain', tone: 'neutral', tx: e.tx };
    case 'Settled':
      return { id, at, kind: 'settled', text: 'Settled onchain: payouts sent', tone: 'up', tx: e.tx };
    default:
      return null;
  }
}
