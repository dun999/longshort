import { randomUUID } from 'node:crypto';
import { isAddress, verifyMessage, zeroAddress } from 'viem';
import { MODES, type Mode } from '@longshort/shared';
import { db } from './db';
import { arena, pub } from './chain';

export interface LobbyOptions { allow_bots: number; rematch_of: number | null }
interface Reservation { source_id: number; creator: string; token: string; match_id: number | null; created_at: number }
export const lobbyOptions = (id: number) => db.prepare('SELECT allow_bots, rematch_of FROM lobby_options WHERE match_id = ?').get(id) as LobbyOptions | undefined;
export const roster = (id: number) => db.prepare('SELECT p.addr, p.team, p.leverage, COALESCE(f.bot, 0) bot FROM players p LEFT JOIN profiles f ON f.addr = p.addr WHERE p.match_id = ?').all(id) as { addr: string; team: number; leverage: number; bot: number }[];
const reservation = (id: number) => db.prepare('SELECT * FROM rematches WHERE source_id = ?').get(id) as Reservation | undefined;

function validRequest(body: any) {
  if (!isAddress(String(body?.addr)) || !Number.isSafeInteger(body?.id) || body.id <= 0 || !Number.isFinite(body?.ts) || Math.abs(Date.now() / 1000 - body.ts) > 300) throw new Error('Invalid or expired matchmaking request');
}

/** Serialize simultaneous rematch clicks before any player spends a second stake. */
export async function reserveRematch(body: any) {
  validRequest(body);
  const { id, addr, ts, sig } = body;
  if (!await verifyMessage({ address: addr, message: `longshort.fun rematch:${id}:${ts}`, signature: sig }).catch(() => false)) throw new Error('Invalid rematch signature');
  const source = db.prepare('SELECT * FROM matches WHERE id = ? AND state = 2').get(id);
  const player = roster(id).find((p) => p.addr === addr.toLowerCase() && !p.bot);
  if (!source || !player) throw new Error('Rematch is only available to players of a settled match');
  const old = reservation(id);
  if (old?.match_id) {
    const match = await pub.readContract({ ...arena, functionName: 'getMatch', args: [BigInt(old.match_id)] });
    if (Number(match.state) < 2) return { matchId: old.match_id, team: player.team };
  }
  // No await between rechecking and claiming: concurrent callers share one reservation.
  const current = reservation(id);
  if (current && current.token !== old?.token) return { pending: true };
  if (current && !current.match_id && Date.now() - current.created_at < 120_000) return { pending: true };
  const token = randomUUID();
  db.prepare('INSERT OR REPLACE INTO rematches(source_id, creator, token, match_id, created_at) VALUES (?, ?, ?, NULL, ?)').run(id, addr.toLowerCase(), token, Date.now());
  return { token, team: player.team };
}

/** Aborted wallet prompts should not keep opponents waiting for the reservation to expire. */
export async function releaseRematch(body: any) {
  validRequest(body);
  const { id, addr, ts, sig, token } = body;
  if (typeof token !== 'string' || !await verifyMessage({ address: addr, message: `longshort.fun rematch-release:${id}:${token}:${ts}`, signature: sig }).catch(() => false)) throw new Error('Invalid rematch signature');
  db.prepare('DELETE FROM rematches WHERE source_id = ? AND creator = ? AND token = ? AND match_id IS NULL').run(id, addr.toLowerCase(), token);
  return { ok: true };
}

export async function configureLobby(body: any) {
  validRequest(body);
  const { id, addr, ts, sig, allowBots, rematchOf = 0, token = '' } = body;
  if (typeof allowBots !== 'boolean' || !Number.isSafeInteger(rematchOf) || rematchOf < 0) throw new Error('Invalid lobby options');
  const [m, ps] = await Promise.all([
    pub.readContract({ ...arena, functionName: 'getMatch', args: [BigInt(id)] }),
    pub.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(id)] }),
  ]);
  const p = ps[0];
  if (!p || p.addr.toLowerCase() !== addr.toLowerCase()) throw new Error('Only the lobby creator can set its options');
  const message = `longshort.fun lobby:${id}:${Number(allowBots)}:${rematchOf}:${token}:${ts}`;
  let verified = false;
  for (const signer of [p.addr, p.session].filter((a) => a !== zeroAddress)) verified ||= await verifyMessage({ address: signer, message, signature: sig }).catch(() => false);
  if (!verified) throw new Error('Invalid lobby signature');
  // a retry of a registration that already went through (say, its response was lost) succeeds again
  const same = (o?: LobbyOptions) => {
    if (o && (o.allow_bots !== Number(allowBots) || (o.rematch_of ?? 0) !== rematchOf)) throw new Error('Lobby options are already locked');
    return !!o;
  };
  if (same(lobbyOptions(id))) return { ok: true };
  if (Number(m.state) !== 0 || ps.length !== 1) throw new Error('Lobby options must be set before other players join');
  if (rematchOf) {
    const old = await pub.readContract({ ...arena, functionName: 'getMatch', args: [BigInt(rematchOf)] });
    const previous = roster(rematchOf);
    const me = previous.find((x) => x.addr === addr.toLowerCase());
    const r = reservation(rematchOf);
    if (!r || r.token !== token || r.creator !== addr.toLowerCase() || (r.match_id && r.match_id !== id)) throw new Error('Rematch reservation expired');
    if (!me || Number(old.state) !== 2 || old.mode !== m.mode || old.entry !== m.entry || old.duration !== m.duration || old.maxPlayers !== m.maxPlayers || me.team !== p.team || previous.length !== m.maxPlayers) throw new Error('Rematch must preserve the previous roster and settings');
    if (!allowBots && previous.some((x) => x.bot)) throw new Error('Enable bot matching in Settings to rematch these opponents');
  }
  // only standard lobbies are offered to matchmaking; rematches and custom settings stay unlisted
  const cfg = MODES[Number(m.mode) as Mode];
  const listed = !rematchOf && cfg?.duration === Number(m.duration) && cfg?.maxPlayers === Number(m.maxPlayers);
  const inserted = db
    .prepare('INSERT OR IGNORE INTO lobby_options(match_id, allow_bots, rematch_of, mode, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, Number(allowBots), rematchOf || null, listed ? Number(m.mode) : null, Number(m.entry) / 1e6, Math.floor(Date.now() / 1000));
  if (!inserted.changes) return (same(lobbyOptions(id)), { ok: true });
  if (rematchOf) db.prepare('UPDATE rematches SET match_id = ? WHERE source_id = ? AND token = ?').run(id, rematchOf, token);
  return { ok: true, created: true };
}

export function rematchInvites(addr: string) {
  return db.prepare(`SELECT r.source_id sourceId, r.match_id matchId, r.creator, p.team, m.mode, m.entry
    FROM rematches r JOIN matches m ON m.id = r.match_id
    JOIN players p ON p.match_id = r.source_id AND p.addr = ?
    WHERE m.state = 0 AND r.creator != ?
    AND NOT EXISTS (SELECT 1 FROM players seated WHERE seated.match_id = r.match_id AND seated.addr = ?)`)
    .all(addr, addr, addr);
}
