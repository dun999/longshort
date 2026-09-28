import { randomUUID } from 'node:crypto';
import { MODES, Mode } from '@longshort/shared';
import { arena, pub } from './chain';
import { db } from './db';

/*
 * Keeper-side matchmaking. The contract lets anyone open or join a lobby, so browsers deciding on their own race
 * each other: two players who press Play together each open a lobby and wait alone, and a stranger can take the
 * seat a party member was about to fill. The keeper answers every Play with one of:
 * - join: lobby X, team T. The seat is held for that player for a while; bots and other players skip it.
 * - create: nothing fits, so this player opens the lobby. One creator per mode and stake at a time.
 * - wait: a lobby this player fits into is being opened right now. Ask again in a moment.
 * Party members are sent to the lobby once their leader is seated in it.
 */
const HOLD_MS = 45_000; // a browser wallet may take a while to confirm the join
const LEASE_MS = 45_000; // time to open and register the lobby
const FRESH_S = 280; // older open lobbies are left to time out

export interface Seat { addr: string; team: number }
interface Hold extends Seat { matchId: number; until: number; leader?: string; sent?: boolean }
interface Lease { id: string; creator: string; mode: number; entry: number; allowBots: boolean; party: string[]; duel: boolean; until: number }
export interface Ticket { addr: string; mode: number; entry: number; allowBots: boolean; party: string[]; lobby?: number; avoid?: number }
export type Assignment = { join: number; team: number } | { create: string; team: number } | { wait: true };

let holds: Hold[] = [];
const leases = new Map<string, Lease>();

function prune() {
  const now = Date.now();
  holds = holds.filter((h) => h.until > now);
  for (const [id, l] of leases) if (l.until <= now) leases.delete(id);
}

/** Seats held for players who haven't joined yet, per team. */
export function heldSeats(matchId: number, seated: Set<string>) {
  prune();
  const n = [0, 0];
  for (const h of holds) if (h.matchId === matchId && !seated.has(h.addr)) n[h.team]++;
  return n;
}

async function lobby(id: number) {
  const [m, ps] = await Promise.all([
    pub.readContract({ ...arena, functionName: 'getMatch', args: [BigInt(id)] }),
    pub.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(id)] }),
  ]);
  return { m, sitting: ps.map((p) => ({ addr: p.addr.toLowerCase(), team: Number(p.team) })) };
}

/** The side with room for the whole group (the emptier side first), or -1. */
function sideFor(mode: number, maxPlayers: number, id: number, sitting: Seat[], size: number) {
  const royale = mode === Mode.ROYALE;
  const cap = royale ? maxPlayers : maxPlayers / 2;
  const taken = heldSeats(id, new Set(sitting.map((s) => s.addr)));
  for (const s of sitting) taken[s.team]++;
  const sides = royale ? [0] : [0, 1].sort((a, b) => taken[a] - taken[b]);
  return sides.find((team) => cap - taken[team] >= size) ?? -1;
}

function hold(matchId: number, seats: Seat[], leader: string) {
  const until = Date.now() + HOLD_MS;
  for (const s of seats) holds.push({ ...s, matchId, until, ...(s.addr === leader ? {} : { leader }) });
}

export async function matchmake(t: Ticket): Promise<Assignment> {
  prune();
  const cfg = MODES[t.mode as Mode];
  if (!cfg || !(t.entry > 0) || !t.party.length || t.party.length > 3) throw new Error('Invalid matchmaking request');
  if (t.mode === Mode.DUEL && t.party.length > 2) throw new Error('Duel parties are 2 players: switch to Squad or Royale');
  // asking again replaces whatever this group was holding
  holds = holds.filter((h) => !t.party.includes(h.addr));
  const own = [...leases.values()].find((l) => l.creator === t.addr);
  if (own) leases.delete(own.id);

  // friends duelling each other: a private lobby, the second seat held for the friend
  if (t.mode === Mode.DUEL && t.party.length === 2) return lease(t, true);

  const rows = t.lobby
    ? (db.prepare('SELECT match_id id, allow_bots, rematch_of FROM lobby_options WHERE match_id = ?').all(t.lobby) as any[])
    : (db.prepare(`SELECT o.match_id id, o.allow_bots, o.rematch_of FROM lobby_options o LEFT JOIN matches m ON m.id = o.match_id
        WHERE o.mode = ? AND o.entry = ? AND o.rematch_of IS NULL AND o.created_at > ? AND COALESCE(m.state, 0) = 0
        ORDER BY o.match_id LIMIT 12`).all(t.mode, t.entry, Math.floor(Date.now() / 1000) - FRESH_S) as any[]);
  if (t.lobby && (!rows.length || rows[0].rematch_of)) throw new Error('This lobby is not open for matchmaking');
  for (const row of rows) {
    if (row.id === t.avoid) continue;
    // a bot-free player never lands where bots may fill; a bot-friendly player can join anyone
    if (row.allow_bots && !t.allowBots) {
      if (t.lobby) throw new Error('Enable bot matching in Settings to join this lobby');
      continue;
    }
    const { m, sitting } = await lobby(row.id);
    if (Number(m.state) !== 0 || sitting.some((s) => t.party.includes(s.addr))) continue;
    if (t.lobby && (Number(m.mode) !== t.mode || Number(m.entry) / 1e6 !== t.entry)) throw new Error('Invalid matchmaking request');
    const team = sideFor(Number(m.mode), Number(m.maxPlayers), row.id, sitting, t.party.length);
    if (team < 0) continue;
    hold(row.id, t.party.map((addr) => ({ addr, team })), t.addr);
    return { join: row.id, team };
  }
  if (t.lobby) throw new Error('This lobby is full');

  // someone is opening a lobby this group fits into: wait for it instead of opening a second one
  for (const l of leases.values()) {
    if (l.duel || l.mode !== t.mode || l.entry !== t.entry || (l.allowBots && !t.allowBots)) continue;
    if (t.mode === Mode.ROYALE && cfg.maxPlayers - l.party.length < t.party.length) continue;
    return { wait: true };
  }
  return lease(t, false);
}

function lease(t: Ticket, duel: boolean): Assignment {
  const id = randomUUID();
  leases.set(id, { id, creator: t.addr, mode: t.mode, entry: t.entry, allowBots: t.allowBots, party: t.party, duel, until: Date.now() + LEASE_MS });
  return { create: id, team: 0 };
}

/**
 * The creator registered their new lobby: it becomes visible to matchmaking, and their party's seats are held.
 * Returns the members to send there now (the creator is already seated).
 */
export function opened(matchId: number, creator: string, leaseId?: string): Seat[] {
  const l = leaseId ? leases.get(leaseId) : undefined;
  if (!l || l.creator !== creator) return [];
  leases.delete(l.id);
  const friends = l.party.filter((a) => a !== creator).map((addr) => ({ addr, team: l.duel ? 1 : 0 }));
  hold(matchId, friends, creator);
  return followersOf(matchId, creator);
}

/** A player took their seat: returns their party members, who can follow now. */
export function followersOf(matchId: number, player: string): Seat[] {
  prune();
  const now = Date.now();
  const follow = holds.filter((h) => h.matchId === matchId && h.leader === player && !h.sent);
  for (const h of follow) Object.assign(h, { sent: true, until: now + HOLD_MS });
  return follow.map(({ addr, team }) => ({ addr, team }));
}

/** Seats this player was sent to and hasn't taken yet (resent after a reconnect). */
export function pendingFor(addr: string) {
  prune();
  return holds.filter((h) => h.addr === addr && h.sent).map(({ matchId, team }) => ({ matchId, team }));
}

/** The player gave up: free their seat or their claim on opening the lobby. */
export function release(addr: string, leaseId?: string, matchId?: number) {
  const l = leaseId ? leases.get(leaseId) : undefined;
  if (l?.creator === addr) leases.delete(l.id);
  if (matchId) holds = holds.filter((h) => !(h.matchId === matchId && (h.addr === addr || h.leader === addr)));
}
