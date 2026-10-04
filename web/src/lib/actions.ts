'use client';
import { createWalletClient, encodeFunctionData, http, parseEventLogs, parseUnits, zeroAddress, type Address, type LocalAccount, type WalletClient } from 'viem';
import { ADDR, CLASSES, LEVERAGES, REAL_TRADING, TRADING_BUDGET, MODES, MatchState, Mode, activeChain, arenaAbi, delegatedTo, relayLive, type Leverage } from '@longshort/shared';
import { arena, GAS, publicClient } from './clients';
import { RPC_URL } from './config';
import * as mera from './mera';
import { timedTx, useWallet, type TxResult } from './wallet';
import { api } from './api';
import { authed, signIn } from './auth';
import { useSettings } from './settings';
import { relayTx, sponsorAccount, warmRelay } from './relay';
import { recordReceipt } from './journey';

const LAST_CLASS = 'ls.class';
/** The class this player last picked; a newcomer starts as the low-risk Tank. */
export const lastLeverage = (): Leverage => {
  try {
    const v = Number(localStorage.getItem(LAST_CLASS));
    const hit = LEVERAGES.find((l) => l === v);
    if (hit) return hit;
  } catch {}
  return CLASSES.tank.leverage;
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

async function mainCtx(newEntry = false) {
  // The version check is a keeper round trip: let it run while the passkey prompt is up.
  const health = REAL_TRADING ? api<any>('/health') : undefined;
  health?.catch(() => {});
  if (newEntry) await useWallet.getState().authorizeEntry();
  else await useWallet.getState().ensureUnlocked();
  const sponsored = relayLive(ADDR.relayDelegate) && useWallet.getState().kind !== 'injected';
  const [status] = await Promise.all([
    health,
    signIn(), // a seated player's connection must speak for them (lobby heartbeats, party follow)
    sponsored ? useWallet.getState().refresh() : useWallet.getState().ensureGas(), // passkey/guest: silent refill when nearly dry
  ]);
  if (status && (!status.realTrading || status.chainId!==ADDR.chainId || status.arena?.toLowerCase()!==ADDR.arena.toLowerCase())) throw new Error('The app is updating. Reload before playing.');
  if (sponsored && !REAL_TRADING && useWallet.getState().usd === 0n) await useWallet.getState().faucet().catch(() => {});
  const w = useWallet.getState();
  if (!w.main || !w.address) throw new Error('Connect a wallet first');
  return { w, client: w.main as WalletClient, account: (w.main.account ?? w.address) as any };
}

/** A receipt's logs: carried by the send when it has them, otherwise read from the chain. */
const logsOf = async (tx: TxResult) => tx.logs ?? (await publicClient.getTransactionReceipt({ hash: tx.hash })).logs;

/** Sponsor pays when the flag is on and this signer is a local key. Returns undefined to self-pay. */
async function maybeRelay(client: WalletClient, sponsor: boolean, target: Address, functionName: string, args: readonly unknown[], value = 0n): Promise<TxResult | undefined> {
  if (!sponsor || value !== 0n) return;
  const data = encodeFunctionData({ abi: arenaAbi, functionName, args } as never);
  const tx = await relayTx(sponsorAccount(client.account), target, data);
  if (tx.status !== 'success') throw new Error('Transaction reverted. Refresh the trading balance before retrying.');
  return tx;
}

/**
 * The key that will sign this match's trades, registered by the join tx. Nobody sends MON with it.
 * When the relay delegate is live the sponsor pays its gas; otherwise the keeper's gas station does
 * (keeper/src/gas.ts).
 * - passkey: a brand-new key derived from the passkey for this match only (one passkey, many keys)
 * - browser wallet: the per-browser session key
 * - guest: the guest key trades for itself
 */
const publishedHints = new Set<string>();
async function publishMatchKey(owner: Address, session: Address, label: string) {
  const key = `${owner.toLowerCase()}:${session.toLowerCase()}`;
  if (publishedHints.has(key)) return;
  await authed('/passkey/match-key', { chainId: ADDR.chainId, arena: ADDR.arena, session, label });
  if (useWallet.getState().address?.toLowerCase() !== owner.toLowerCase()) throw new Error('Account changed. Try again.');
  publishedHints.add(key);
}

async function sessionArgs(): Promise<{ session: `0x${string}`; value: bigint; label?: string }> {
  const w = useWallet.getState();
  if (w.kind === 'passkey') {
    const label = mera.nextMatchLabel();
    const session = mera.matchKey(label).address;
    // Save the public hint before funds move, including when the entry's response is lost.
    await publishMatchKey(w.address!, session, label);
    return { session, value: 0n, label };
  }
  if (w.kind !== 'injected' || !w.sessionAddress) return { session: zeroAddress, value: 0n };
  return { session: w.sessionAddress, value: 0n };
}

export async function createMatch(mode: Mode, entry: number, leverage: number, team = 0, rematch?: { source: number; token: string; duration: number; maxPlayers: number }, lease?: string): Promise<{ id: number; tx: TxResult }> {
  const allowBots = useSettings.getState().allowBots;
  const { w, client, account } = await mainCtx(true);
  if (w.usd < parseUnits(String(entry + TRADING_BUDGET),6)) throw new Error(`You need ${entry + TRADING_BUDGET} AUSD: entry plus trading balance`);
  const cfg = rematch ?? MODES[mode];
  // The approval moves no funds, so the match key's public hint is saved alongside it, not after it.
  const [, { session, value, label }] = await Promise.all([w.ensureAllowance(parseUnits(String(entry + TRADING_BUDGET), 6)), sessionArgs()]);
  const createArgs = [mode, parseUnits(String(entry), 6), cfg.duration, cfg.maxPlayers, team, leverage, session] as const;
  const relayed = await maybeRelay(client, relayLive(ADDR.relayDelegate) && w.kind !== 'injected', arena.address, 'createMatch', createArgs, value);
  const gas = relayed ? 0n : await gasFor('createMatch', est('createMatch', createArgs, w.address!, value), GAS.createMatch, true);
  const tx = relayed ?? await timedTx(() =>
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
  const ev = parseEventLogs({ abi: arenaAbi, logs: await logsOf(tx), eventName: 'MatchCreated' })[0];
  if (!ev) throw new Error('Match creation reverted');
  if (label) mera.bindMatch(Number(ev.args.id), label);
  const id = Number(ev.args.id);
  recordReceipt('entry', tx.hash, id);
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

async function matchInfo(id: number) {
  for (let attempt = 0; ; attempt++) {
    try { return await api<any>(`/match/${id}`); }
    catch (e) {
      if ((e as Error).message !== 'not found' || attempt === 11) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function joinMatch(id: number, team: number, leverage: number): Promise<TxResult> {
  const lookup = matchInfo(id);
  lookup.catch(() => {});
  const { w, client, account } = await mainCtx(true);
  const info = await lookup;
  if (!useSettings.getState().allowBots && (info.match.allow_bots || info.players.some((p: any) => p.bot))) throw new Error('Enable bot matching in Settings to join this lobby');
  if (info.match.rematch_of && !info.roster?.some((p: any) => p.addr === w.address?.toLowerCase() && p.team === team)) throw new Error('Rematch is reserved for the previous players and teams');
  if (w.usd < parseUnits(String(info.match.entry + TRADING_BUDGET),6)) throw new Error(`You need ${info.match.entry + TRADING_BUDGET} AUSD: entry plus trading balance`);
  const [, { session, value, label }] = await Promise.all([w.ensureAllowance(parseUnits(String(info.match.entry + TRADING_BUDGET), 6)), sessionArgs()]);
  const args = [BigInt(id), team, leverage, session] as const;
  await publicClient.simulateContract({ ...arena, account: w.address!, functionName: 'joinMatch', args, value });
  const relayed = await maybeRelay(client, relayLive(ADDR.relayDelegate) && w.kind !== 'injected', arena.address, 'joinMatch', args, value);
  const gas = relayed ? 0n : await gasFor('joinMatch', est('joinMatch', args, w.address!, value), GAS.joinMatch, true);
  const tx = relayed ?? await timedTx(() => client.writeContract({ ...arena, account, chain: activeChain, functionName: 'joinMatch', args, value, gas }));
  if (tx.status !== 'success') throw new Error('Match join reverted');
  if (label && tx.status === 'success') mera.bindMatch(id, label);
  recordReceipt('entry', tx.hash, id);
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
  const leaveArgs = [BigInt(id)] as const;
  const tx =
    (await maybeRelay(client, relayLive(ADDR.relayDelegate) && w.kind !== 'injected', arena.address, 'leave', leaveArgs)) ??
    (await timedTx(() => client.writeContract({ ...arena, account, chain: activeChain, functionName: 'leave', args: leaveArgs, gas: GAS.leave })));
  if (tx.status !== 'success') throw new Error('Leaving the round reverted. Check its current state before retrying.');
  mera.endMatch(id);
  void w.refresh();
  return tx;
}

// ─── in-match (session key / guest key, no pop-ups) ─────────────────────────
/** The key that signs trades for this match: its derived passkey key, or the browser/guest session key. */
const matchSigners = new Map<number, { owner: LocalAccount; label: string; client: WalletClient }>();
async function trader(id: number): Promise<WalletClient> {
  const w = useWallet.getState();
  if (w.kind === 'passkey') {
    await w.ensureUnlocked();
    const owner = useWallet.getState().address!;
    const ownerAccount = mera.ownerAccount()!;
    const cached = matchSigners.get(id);
    // Verify the chain once per unlocked keyring and seat; repeated trades add no recovery reads.
    if (cached?.owner === ownerAccount && cached.label === mera.labelFor(id)) return cached.client;
    const players = await publicClient.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(id)] });
    const seat = players.find((p) => p.addr.toLowerCase() === owner.toLowerCase());
    if (!seat || seat.session === zeroAddress) throw new Error('This passkey has no trading session in this match');
    const key = await mera.recoverMatchKey(id, seat.session, () => api<{ label: string } | null>(`/passkey/match-key/${owner}/${seat.session}`));
    const label = mera.labelFor(id)!;
    // Also migrate a validated legacy browser label before it is needed on a second device.
    await publishMatchKey(owner, seat.session, label);
    if (mera.ownerAccount() !== ownerAccount) throw new Error('Passkey session changed. Try again.');
    const client = createWalletClient({ account: key, chain: activeChain, transport: http(RPC_URL) });
    matchSigners.set(id, { owner: ownerAccount, label, client });
    return client;
  }
  if (!w.trader?.account) throw new Error('No session key');
  return w.trader;
}

/** Validate and publish an existing seat's label without placing a trade, and read its key's relay state. */
export async function prepareMatchRecovery(id: number) {
  if (useWallet.getState().kind !== 'passkey' || !mera.isUnlocked()) return;
  warmRelay((await trader(id)).account);
}

/** Guest and browser-wallet session keys: read the relay state before the bell so the first trade signs at once. */
export const warmTrading = () => warmRelay(useWallet.getState().trader?.account);

export async function tradeOpen(id: number, market: number, isLong: boolean, sizeBps: number) {
  const t = await trader(id);
  const args = [BigInt(id), market, isLong, sizeBps] as const;
  const relayed = await maybeRelay(t, relayLive(ADDR.relayDelegate), arena.address, 'open', args);
  // a flip also closes the old position, so it is costed separately from a fresh open
  const gas = relayed ? 0n : await gasFor('open', est('open', args, t.account!), GAS.open, REAL_TRADING);
  const tx = relayed ?? await timedTx(() => t.writeContract({ ...arena, account: t.account!, chain: activeChain, functionName: 'open', args, gas: gas + 40_000n }));
  if (tx.status !== 'success') throw new Error('Perpl order reverted');
  if (REAL_TRADING && !parseEventLogs({abi:arenaAbi,eventName:'Opened',logs:await logsOf(tx)}).some((e)=>e.args.id===BigInt(id))) throw new Error('Perpl did not fill this order. Refresh your position.');
  recordReceipt('trade', tx.hash, id);
  return tx;
}

export async function tradeClose(id: number) {
  const t = await trader(id);
  const args = [BigInt(id)] as const;
  const relayed = await maybeRelay(t, relayLive(ADDR.relayDelegate), arena.address, 'close', args);
  const gas = relayed ? 0n : await gasFor('close', est('close', args, t.account!), GAS.close, REAL_TRADING);
  const tx = relayed ?? await timedTx(() => t.writeContract({ ...arena, account: t.account!, chain: activeChain, functionName: 'close', args, gas }));
  if (tx.status !== 'success') throw new Error('Perpl close reverted');
  recordReceipt('trade', tx.hash, id);
  // The arena emits Closed only once the position is flat; without it Perpl filled part of the close.
  if (REAL_TRADING) return {...tx,partial:!parseEventLogs({abi:arenaAbi,eventName:'Closed',logs:await logsOf(tx)}).some((e)=>e.args.id===BigInt(id))};
  return tx;
}

export async function setClass(id: number, leverage: number) {
  rememberLeverage(leverage);
  const t = await trader(id);
  const args = [BigInt(id), leverage] as const;
  const relayed = await maybeRelay(t, relayLive(ADDR.relayDelegate), arena.address, 'setClass', args);
  if (relayed) return relayed;
  return timedTx(() => t.writeContract({ ...arena, account: t.account!, chain: activeChain, functionName: 'setClass', args, gas: GAS.setClass }));
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
  // A delegated account cannot spend its own MON below Monad's 10 MON reserve. Only an undelegated
  // key (funded by the old gas station, never sponsored) may still send the leftover home.
  if (relayLive(ADDR.relayDelegate)) {
    const code = await publicClient.getCode({ address: key.address }).catch(() => '0x');
    if (delegatedTo(code) !== 'empty') return 0n;
  }
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
    if (s === MatchState.CANCELLED) { mera.endMatch(id); return 'cancelled'; }
    if (s === MatchState.SETTLED) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('TooLate');
}
