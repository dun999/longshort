import { verifyMessage, zeroAddress } from 'viem';
import { arena, chainNow, estimateGas, keeper, log, pub, send } from './chain';
import { db } from './db';
import { onChainEvent } from './indexer';
import { lobbyOptions, roster } from './matchmaking';

/*
 * Lobby guard: makes "cancel matchmaking" mean cancel, whatever the timing.
 * - A player's signed cancel request stops bots from filling their lobby. If the lobby filled anyway
 *   (a bot or another player landed first), the owner-only emergencyCancel refunds every stake during
 *   the countdown, before a single trade. A request the client never follows with a leave is honoured
 *   the same way.
 * - Bots only fill lobbies whose humans are on the match screen (clients send a heartbeat every few
 *   seconds), and a lobby a human abandoned mid-search (tab closed, navigated away) is refunded instead
 *   of starting without them.
 */
const PRESENT_MS = 12_000; // a heartbeat this recent = "on the match screen"
const ABANDON_MS = 25_000; // searching with no heartbeat for this long → refund the lobby
const LEAVE_GRACE_MS = 20_000; // cancel requested but still seated after this → refund the lobby
const bootAt = Date.now(); // after a keeper restart, clients get a fresh grace to check back in

const seen = new Map<string, number>();
const joined = new Map<string, number>();
const intents = new Map<number, { addr: string; at: number }>();
const cancelling = new Set<number>();
const key = (id: number, a: string) => `${id}:${a.toLowerCase()}`;

export const heartbeat = (id: number, addr: string) => void seen.set(key(id, addr), Date.now());

const humansIn = (id: number) =>
  db
    .prepare('SELECT p.addr FROM players p LEFT JOIN profiles f ON f.addr = p.addr WHERE p.match_id = ? AND COALESCE(f.bot, 0) = 0')
    .all(id) as { addr: string }[];

/** Bots must not fill this lobby: a cancel is pending, or one of its humans isn't on the match screen. */
export function holdFill(id: number) {
  if (intents.has(id)) return true;
  if (!lobbyOptions(id)?.allow_bots) return true;
  const now = Date.now();
  return humansIn(id).some((h) => now - (seen.get(key(id, h.addr)) ?? 0) > PRESENT_MS);
}

async function emergency(id: number, why: string) {
  if (cancelling.has(id)) return;
  cancelling.add(id);
  try {
    const req = { ...arena, functionName: 'emergencyCancel', args: [BigInt(id)], account: keeper.account } as const;
    await pub.simulateContract(req as any);
    const gas = await estimateGas('cancel', req);
    const hash = await send('lobby', () => keeper.writeContract({ ...arena, functionName: 'emergencyCancel', args: [BigInt(id)], gas } as any));
    if (hash) log('lobby', `#${id} cancelled (${why}): every stake refunded`, hash.slice(0, 10));
  } catch (e) {
    log('lobby', `#${id} could not cancel (${why})`, (e as Error).message.split('\n')[0].slice(0, 120));
  } finally {
    setTimeout(() => cancelling.delete(id), 10_000);
  }
}

async function guard(id: number) {
  const intent = intents.get(id);
  if (!intent) return;
  const [m, ps] = await Promise.all([
    pub.readContract({ ...arena, functionName: 'getMatch', args: [BigInt(id)] }),
    pub.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(id)] }),
  ]);
  const state = Number(m.state); // 0 open, 1 live, 2 settled, 3 cancelled
  const seated = ps.some((p) => p.addr.toLowerCase() === intent.addr);
  if (state >= 2 || !seated) return void intents.delete(id); // done, or they left by themselves
  if (state === 1) {
    if ((await chainNow()) < Number(m.startAt)) return emergency(id, 'player cancelled as the lobby filled');
    intents.delete(id);
    return log('lobby', `#${id} started before the cancel landed`);
  }
  if (Date.now() - intent.at > LEAVE_GRACE_MS) return emergency(id, 'player cancelled but never left');
}

/** A signed "cancel my matchmaking" from a seated player (signed by their own key or their session key). */
export async function requestCancel(id: number, addr: string, ts: number, sig: `0x${string}`) {
  if (!Number.isInteger(id) || id <= 0) return { error: 'bad match' };
  if (Math.abs(Date.now() / 1000 - ts) > 300) return { error: 'expired' };
  const ps = await pub.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(id)] });
  const p = ps.find((x) => x.addr.toLowerCase() === addr.toLowerCase());
  if (!p) return { ok: true, state: 'not-seated' };
  const message = `longshort.fun cancel:${id}:${ts}`;
  const signers = [p.addr, p.session].filter((a) => a !== zeroAddress);
  let ok = false;
  for (const s of signers) ok ||= await verifyMessage({ address: s, message, signature: sig }).catch(() => false);
  if (!ok) return { error: 'bad signature' };
  intents.set(id, { addr: addr.toLowerCase(), at: Date.now() });
  log('lobby', `cancel requested #${id} by ${addr.slice(0, 10)}`);
  await guard(id);
  return { ok: true };
}

export function startLobbyGuard() {
  onChainEvent((e) => {
    if (e.name === 'PlayerJoined') joined.set(key(e.matchId, String(e.args.player)), Date.now());
    if (e.name === 'MatchStarted' && intents.has(e.matchId)) void guard(e.matchId); // filled under a pending cancel
    if (e.name === 'MatchStarted') {
      const source = lobbyOptions(e.matchId)?.rematch_of;
      const expected = source ? roster(source) : undefined;
      if (expected && roster(e.matchId).some((p) => !expected.some((old) => old.addr === p.addr && old.team === p.team))) {
        void emergency(e.matchId, 'rematch roster changed').catch((e) => log('lobby', String(e)));
      }
    }
  });
  const loop = async () => {
    try {
      for (const id of [...intents.keys()]) await guard(id);
      const open = db.prepare('SELECT id, created_at FROM matches WHERE state = 0').all() as { id: number; created_at: number }[];
      for (const m of open) {
        const source = lobbyOptions(m.id)?.rematch_of;
        if (source) {
          const expected = roster(source);
          if (roster(m.id).some((p) => !expected.some((old) => old.addr === p.addr && old.team === p.team))) {
            await emergency(m.id, 'rematch roster changed');
            continue;
          }
        }
        for (const h of humansIn(m.id)) {
          const base = Math.max(seen.get(key(m.id, h.addr)) ?? 0, joined.get(key(m.id, h.addr)) ?? 0, m.created_at * 1000, bootAt);
          if (Date.now() - base > ABANDON_MS) {
            await emergency(m.id, `abandoned by ${h.addr.slice(0, 10)}`);
            break;
          }
        }
      }
    } catch (e) {
      log('lobby', 'guard error', (e as Error).message.slice(0, 120));
    }
    setTimeout(loop, 2000);
  };
  void loop();
  log('lobby', `guard on: bots wait for present players, abandoned lobbies refund after ${ABANDON_MS / 1000}s`);
}
