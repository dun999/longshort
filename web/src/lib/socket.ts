'use client';
import { create } from 'zustand';
import { MARKETS, type MarketSymbol } from '@longshort/shared';
import { WS_URL } from './config';
import { api } from './api';

export interface Tick { t: number; px: number }
export interface ChainEvent { name: string; matchId: number; tx: string; block: number; ts: number; args: Record<string, any> }
export interface PartyMember { addr: string; name?: string; ready: boolean; leverage: number }
export interface Party { id: string; leader: string; members: PartyMember[]; mode: number; entry: number; chat: { from: string; text: string; at: number }[] }
export interface Invite { partyId: string; from: string; fromName?: string }
export interface RematchInvite { sourceId: number; matchId: number; from: string; team: number }

interface SocketState {
  connected: boolean;
  /** The keeper accepted this browser's sign-in for the current address. */
  verified: boolean;
  /** A party action is waiting for sign-in (see lib/auth). */
  authWanted: boolean;
  online: string[];
  party: Party | null;
  invites: Invite[];
  rematchInvites: RematchInvite[];
  toast?: string;
  prices: Record<MarketSymbol, Tick[]>;
  events: ChainEvent[];
  /** The keeper sent this player to a lobby (party leader seated there, or a rematch accepted). */
  joinMatch?: { matchId: number; team: number };
  send: (msg: object) => void;
  hello: (addr?: string) => void;
  clearJoin: () => void;
  dismissInvite: (partyId: string) => void;
}

let ws: WebSocket | undefined;
let me: string | undefined;
let outbox: object[] = []; // party actions sent before sign-in went through
const listeners = new Set<(e: ChainEvent) => void>();

// sign-in tokens, one per address, kept by this browser (see lib/auth)
const TOKEN = (addr: string) => `ls.auth.v1:${addr.toLowerCase()}`;
export const tokenFor = (addr: string) => {
  try {
    return localStorage.getItem(TOKEN(addr)) ?? undefined;
  } catch {
    return undefined;
  }
};
export const saveToken = (addr: string, token?: string) => {
  try {
    if (token) localStorage.setItem(TOKEN(addr), token);
    else localStorage.removeItem(TOKEN(addr));
  } catch {}
};
export const onChainEvent = (fn: (e: ChainEvent) => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const useSocket = create<SocketState>((set, get) => ({
  connected: false,
  verified: false,
  authWanted: false,
  online: [],
  party: null,
  invites: [],
  rematchInvites: [],
  prices: { BTC: [], ETH: [], MON: [] },
  events: [],
  send: (msg: any) => {
    // the keeper ignores party actions from a connection that hasn't signed in: hold them until it has
    if (String(msg.t).startsWith('party:') && !get().verified) {
      outbox.push(msg);
      return set({ authWanted: true });
    }
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  },
  hello: (addr) => {
    const was = me;
    me = addr;
    if (addr) {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'hello', addr, token: tokenFor(addr) }));
      return;
    }
    // signed out: drop everything that belonged to the previous account
    outbox = [];
    if (was && ws?.readyState === 1) ws.send(JSON.stringify({ t: 'bye' }));
    set({ verified: false, authWanted: false, party: null, invites: [], rematchInvites: [], joinMatch: undefined });
  },
  clearJoin: () => set({ joinMatch: undefined }),
  dismissInvite: (partyId) => set({ invites: get().invites.filter((i) => i.partyId !== partyId) }),
}));

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    useSocket.setState({ connected: true });
    if (me) useSocket.getState().hello(me);
  };
  ws.onclose = () => {
    useSocket.setState({ connected: false, verified: false });
    setTimeout(connect, 1500);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const s = useSocket.getState();
    switch (msg.t) {
      case 'auth': {
        if (!msg.ok && me) saveToken(me, undefined); // expired or unknown: lib/auth signs in again
        useSocket.setState({ verified: !!msg.ok, ...(msg.ok ? { authWanted: false } : {}) });
        if (msg.ok) for (const m of outbox.splice(0)) s.send(m);
        return;
      }
      case 'presence':
        return useSocket.setState({ online: msg.online });
      case 'party':
        return useSocket.setState({ party: msg.party });
      case 'invite':
        return useSocket.setState({ invites: [...s.invites.filter((i) => i.partyId !== msg.partyId), msg] });
      case 'rematch-invite':
        return useSocket.setState({ rematchInvites: [...s.rematchInvites.filter((i) => i.matchId !== msg.matchId), msg] });
      case 'toast':
        return useSocket.setState({ toast: msg.text });
      case 'join-match':
        return useSocket.setState({ joinMatch: { matchId: msg.matchId, team: msg.team } });
      case 'tick': {
        const m = msg.market as MarketSymbol;
        const arr = [...s.prices[m], msg.tick].slice(-1800);
        return useSocket.setState({ prices: { ...s.prices, [m]: arr } });
      }
      case 'chain':
        useSocket.setState({ events: [...s.events, msg.e].slice(-200) });
        for (const fn of listeners) fn(msg.e);
        return;
    }
  };
}

let started = false;
export function startSocket() {
  if (started || typeof window === 'undefined') return;
  started = true;
  connect();
  api<Record<MarketSymbol, Tick[]>>('/prices')
    .then((p) => {
      const cur = useSocket.getState().prices;
      const merged = Object.fromEntries(MARKETS.map((m) => [m, [...(p[m] ?? []), ...cur[m]].slice(-1800)])) as Record<MarketSymbol, Tick[]>;
      useSocket.setState({ prices: merged });
    })
    .catch(() => {});
}

export const lastPx = (ticks: Tick[]) => ticks.at(-1)?.px;
