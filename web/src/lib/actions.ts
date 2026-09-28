'use client';
import { createWalletClient, http, parseEventLogs, parseUnits, zeroAddress, type WalletClient } from 'viem';
import { MODES, MatchState, Mode, activeChain, arenaAbi } from '@longshort/shared';
import { arena, GAS, publicClient } from './clients';
import { RPC_URL } from './config';
import * as mera from './mera';
import { timedTx, useWallet, type TxResult } from './wallet';
import { api } from './api';
import { authed, signIn } from './auth';
import { useSettings } from './settings';

const LAST_CLASS = 'ls.class';
export const lastLeverage = (): 10 | 25 | 50 => {
  try {
    const v = Number(localStorage.getItem(LAST_CLASS));
    if (v === 10 || v === 25 || v === 50) return v;
  } catch {}
  return 25;
};
export const rememberLeverage = (l: number) => {
  try {
    localStorage.setItem(LAST_CLASS, String(l));
  } catch {}
};

// Monad bills the gas *limit*, so estimate and add a small buffer instead of padding by hand.
// Trade estimates are cached per action so clicks don't wait on an extra RPC round-trip.
const gasCache = new Map<string, bigint>();
async function gasFor(key: string, estimate: () => Promise<bigint>, fallback: bigint, fresh = false): Promise<bigint> {
  if (!fresh && gasCache.has(key)) return gasCache.get(key)!;
  try {
    const g = ((await estimate()) * 125n) / 100n;
    gasCache.set(key, g);
    return g;
  } catch {
    return gasCache.get(key) ?? fallback;
  }
}
const est = (functionName: string, args: readonly unknown[], account: any, value?: bigint) => () =>
  publicClient.estimateContractGas({ ...arena, functionName, args, account, value } as any);

async function mainCtx() {
  await useWallet.getState().ensureUnlocked(); // passkey: one biometric prompt if locked
  await signIn(); // a seated player's connection must speak for them (lobby heartbeats, party follow)
  await useWallet.getState().ensureGas(); // passkey/guest: silent refill when nearly dry
  const w = useWallet.getState();
  if (!w.main || !w.address) throw new Error('Connect a wallet first');
  return { w, client: w.main as WalletClient, account: (w.main.account ?? w.address) as any };
}

/**
 * The key that will sign this match's trades, registered by the join tx. Nobody sends MON with it:
 * the keeper's gas station funds every human trading key as they join (keeper/src/gas.ts).
 * - passkey: a brand-new key derived from the passkey for this match only (one passkey, many keys)
 * - browser wallet: the per-browser session key
 * - guest: the guest key trades for itself
 */
function sessionArgs(): { session: `0x${string}`; value: bigint; label?: string } {
  const w = useWallet.getState();
  if (w.kind === 'passkey') {
    const label = mera.nextMatchLabel();
    return { session: mera.matchKey(label).address, value: 0n, label };
  }
  if (w.kind !== 'injected' || !w.sessionAddress) return { session: zeroAddress, value: 0n };
  return { session: w.sessionAddress, value: 0n };
}

export async function createMatch(mode: Mode, entry: number, leverage: number, team = 0, rematch?: { source: number; token: string; duration: number; maxPlayers: number }, lease?: string): Promise<{ id: number; tx: TxResult }> {
  const allowBots = useSettings.getState().allowBots;
  const { w, client, account } = await mainCtx();
  await w.ensureAllowance();
  const cfg = rematch ?? MODES[mode];
  const { session, value, label } = sessionArgs();
  const createArgs = [mode, parseUnits(String(entry), 6), cfg.duration, cfg.maxPlayers, team, leverage, session] as const;
  const gas = await gasFor('createMatch', est('createMatch', createArgs, w.address!, value), GAS.createMatch, true);
  const tx = await timedTx(() =>
    client.writeContract({
      ...arena,
      account,
      chain: activeChain,
      functionName: 'createMatch',
      args: [mode, parseUnits(String(entry), 6), cfg.duration, cfg.maxPlayers, team, leverage, session],
      value,
      gas,
    }),
  );
  const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
  const ev = parseEventLogs({ abi: arenaAbi, logs: receipt.logs, eventName: 'MatchCreated' })[0];
  if (!ev) throw new Error('Match creation reverted');
  if (label) mera.bindMatch(Number(ev.args.id), label);
  const id = Number(ev.args.id);
  try {
    const signer = await trader(id);
    const ts = Math.floor(Date.now() / 1000);
    const rematchOf = rematch?.source ?? 0;
    const token = rematch?.token ?? '';
    const sig = await signer.signMessage({ account: signer.account!, message: `longshort.fun lobby:${id}:${Number(allowBots)}:${rematchOf}:${token}:${ts}` });
    await api('/lobby-options', { id, addr: w.address, ts, sig, allowBots, rematchOf, token, lease });
  } catch (error) {
    // If registration failed, refund this new lobby rather than leaving an untracked stake.
    await cancelMatchmaking(id).catch(() => {});
    throw error;
  }
  void w.refresh();
  return { id: Number(ev.args.id), tx };
}

export async function joinMatch(id: number, team: number, leverage: number): Promise<TxResult> {
  const { w, client, account } = await mainCtx();
  let info: any;
  for (let attempt = 0; attempt < 12; attempt++) {
    try { info = await api<any>(`/match/${id}`); break; }
    catch (e) {
      if ((e as Error).message !== 'not found' || attempt === 11) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!useSettings.getState().allowBots && (info.match.allow_bots || info.players.some((p: any) => p.bot))) throw new Error('Enable bot matching in Settings to join this lobby');
  if (info.match.rematch_of && !info.roster?.some((p: any) => p.addr === w.address?.toLowerCase() && p.team === team)) throw new Error('Rematch is reserved for the previous players and teams');
  await w.ensureAllowance();
  const { session, value, label } = sessionArgs();
  const args = [BigInt(id), team, leverage, session] as const;
  await publicClient.simulateContract({ ...arena, account: w.address!, functionName: 'joinMatch', args, value });
  const gas = await gasFor('joinMatch', est('joinMatch', args, w.address!, value), GAS.joinMatch, true);
  const tx = await timedTx(() => client.writeContract({ ...arena, account, chain: activeChain, functionName: 'joinMatch', args, value, gas }));
  if (tx.status !== 'success') throw new Error('Match join reverted');
  if (label && tx.status === 'success') mera.bindMatch(id, label);
  void w.refresh();
  return tx;
}

type Assignment = { join: number; team: number } | { create: string; team: number } | { wait: true };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask the keeper where to play, then take that seat or open the lobby. The keeper holds the seat it hands out
 * and lets one player at a time open a lobby per mode and stake, so players pressing Play together meet.
 */
async function play(req: { mode: Mode; entry: number; party?: boolean; lobby?: number }, leverage: number, cancelled: () => boolean): Promise<number> {
  const allowBots = useSettings.getState().allowBots;
  const deadline = Date.now() + 90_000;
  let avoid: number | undefined;
  for (let retries = 0; Date.now() < deadline; ) {
    if (cancelled()) throw new Error('Cancelled');
    const r = await authed<Assignment>('/matchmake', { ...req, allowBots, avoid });
    if ('wait' in r) {
      await pause(1000);
      continue;
    }
    if ('join' in r) {
      try {
        await joinMatch(r.join, r.team, leverage);
        return r.join;
      } catch (e) {
        void authed('/matchmake/release', { matchId: r.join }).catch(() => {});
        // only a lobby that filled or closed under us justifies asking again
        if (req.lobby || ++retries >= 3 || !/NotOpen|TeamFull|\bFull\b/.test((e as Error).message)) throw e;
        avoid = r.join;
        continue;
      }
    }
    try {
      return (await createMatch(req.mode, req.entry, leverage, r.team, undefined, r.create)).id;
    } catch (e) {
      void authed('/matchmake/release', { lease: r.create }).catch(() => {});
      throw e;
    }
  }
  throw new Error('No lobby found. Try again.');
}

/** Solo queue: a seat in an open lobby with these settings, or a new lobby. */
export const quickPlay = (mode: Mode, entry: number, leverage: number, cancelled = () => false) => play({ mode, entry }, leverage, cancelled);

/** Party queue (leader only): the whole party lands together; members follow once the leader is seated. */
export const partyPlay = (mode: Mode, entry: number, leverage: number, cancelled = () => false) => play({ mode, entry, party: true }, leverage, cancelled);

/** Play the same roster again; concurrent requests converge on one new lobby. */
export async function rematch(id: number): Promise<number> {
  const { w, client, account } = await mainCtx();
  const previous = await api<any>(`/match/${id}`);
  if (!useSettings.getState().allowBots && previous.players.some((p: any) => p.bot)) throw new Error('Enable bot matching in Settings to rematch these opponents');
  const ts = Math.floor(Date.now() / 1000);
  const sig = await client.signMessage({ account, message: `longshort.fun rematch:${id}:${ts}` });
  const r = await api<{ token?: string; matchId?: number; team: number; pending?: boolean }>('/rematch', { id, addr: w.address, ts, sig });
  if (r.pending) throw new Error('Rematch is being created. Accept the invitation when it arrives, or try again shortly.');
  if (r.matchId) {
    const ps = await publicClient.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(r.matchId)] });
    if (!ps.some((p) => p.addr.toLowerCase() === w.address?.toLowerCase())) await joinMatch(r.matchId, r.team, lastLeverage());
    return r.matchId;
  }
  const m = previous.match;
  try {
    return (await createMatch(m.mode, m.entry, lastLeverage(), r.team, { source: id, token: r.token!, duration: m.duration, maxPlayers: m.max_players })).id;
  } catch (error) {
    // Local signers can release silently. Browser wallets can let the short lease expire.
    if (w.kind !== 'injected') {
      const ts = Math.floor(Date.now() / 1000);
      const sig = await client.signMessage({ account, message: `longshort.fun rematch-release:${id}:${r.token}:${ts}` }).catch(() => null);
      if (sig) await api('/rematch-release', { id, addr: w.address, ts, sig, token: r.token }).catch(() => {});
    }
    throw error;
  }
}

export async function leaveMatch(id: number) {
  const { w, client, account } = await mainCtx();
  const tx = await timedTx(() => client.writeContract({ ...arena, account, chain: activeChain, functionName: 'leave', args: [BigInt(id)], gas: GAS.leave }));
  void w.refresh();
  return tx;
}

// ─── in-match (session key / guest key, no pop-ups) ─────────────────────────
/** The key that signs trades for this match: its derived passkey key, or the browser/guest session key. */
async function trader(id: number): Promise<WalletClient> {
  const w = useWallet.getState();
  if (w.kind === 'passkey') {
    const label = mera.labelFor(id);
    if (!label) throw new Error('No trading key registered for this match on this device');
    await w.ensureUnlocked();
    return createWalletClient({ account: mera.matchKey(label), chain: activeChain, transport: http(RPC_URL) });
  }
  if (!w.trader?.account) throw new Error('No session key');
  return w.trader;
}

export async function tradeOpen(id: number, market: number, isLong: boolean, sizeBps: number) {
  const t = await trader(id);
  const args = [BigInt(id), market, isLong, sizeBps] as const;
  // a flip also closes the old position, so it is costed separately from a fresh open
  const gas = await gasFor('open', est('open', args, t.account!), GAS.open);
  return timedTx(() => t.writeContract({ ...arena, account: t.account!, chain: activeChain, functionName: 'open', args, gas: gas + 40_000n }));
}

export async function tradeClose(id: number) {
  const t = await trader(id);
  const gas = await gasFor('close', est('close', [BigInt(id)], t.account!), GAS.close);
  return timedTx(() => t.writeContract({ ...arena, account: t.account!, chain: activeChain, functionName: 'close', args: [BigInt(id)], gas }));
}

export async function setClass(id: number, leverage: number) {
  rememberLeverage(leverage);
  const t = await trader(id);
  return timedTx(() => t.writeContract({ ...arena, account: t.account!, chain: activeChain, functionName: 'setClass', args: [BigInt(id), leverage], gas: GAS.setClass }));
}

/**
 * Key lifecycle: once a match is settled its passkey-derived trading key has no further use,
 * so it sends its leftover gas back to the owner. Returns the swept amount (0 if not worth it).
 */
export async function sweepMatchKey(id: number): Promise<bigint> {
  const w = useWallet.getState();
  if (w.kind !== 'passkey' || !w.address || !mera.isUnlocked()) return 0n;
  const label = mera.labelFor(id);
  if (!label) return 0n;
  const key = mera.matchKey(label);
  const [bal, gasPrice] = await Promise.all([publicClient.getBalance({ address: key.address }), publicClient.getGasPrice()]);
  const fee = (21_000n * gasPrice * 12n) / 10n;
  if (bal <= fee * 3n) return 0n;
  const client = createWalletClient({ account: key, chain: activeChain, transport: http(RPC_URL) });
  await timedTx(() => client.sendTransaction({ account: key, chain: activeChain, to: w.address!, value: bal - fee, gas: 21_000n, gasPrice }));
  void w.refresh();
  return bal - fee;
}

/** Join a specific open lobby on whichever side has room (seats the matchmaker holds for others stay theirs). */
export async function joinAny(id: number, mode: Mode, entry: number, leverage: number) {
  return play({ mode, entry, lobby: id }, leverage, () => false);
}

/**
 * Cancel matchmaking, whatever the timing. First the keeper is told (signed with this match's trading
 * key, so no pop-up): bots stop filling the lobby. Then we leave. If the lobby filled in between, the
 * keeper refunds every stake during the countdown. Resolves only once the stake is actually back.
 */
export async function cancelMatchmaking(id: number): Promise<'left' | 'cancelled'> {
  const w = useWallet.getState();
  if (!w.address) throw new Error('Connect a wallet first');
  const signer = await trader(id);
  const ts = Math.floor(Date.now() / 1000);
  const sig = await signer.signMessage({ account: signer.account!, message: `longshort.fun cancel:${id}:${ts}` });
  await api('/cancel', { id, addr: w.address.toLowerCase(), ts, sig }).catch(() => null);
  const state = async () => Number((await publicClient.readContract({ ...arena, functionName: 'getMatch', args: [BigInt(id)] })).state);
  if ((await state()) === MatchState.OPEN) {
    try {
      await leaveMatch(id);
      return 'left';
    } catch (e) {
      if (!/NotOpen/.test((e as Error).message)) throw e; // filled under us: the keeper's refund follows
    }
  }
  for (let i = 0; i < 40; i++) {
    const s = await state();
    if (s === MatchState.CANCELLED) return 'cancelled';
    if (s === MatchState.SETTLED) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('TooLate');
}
