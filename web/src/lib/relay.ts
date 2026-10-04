'use client';

import { isAddress, verifyTypedData, type Account, type Address, type Hash, type Hex, type LocalAccount, type Log } from 'viem';
import {
  ADDR,
  activeChain,
  delegatedTo,
  knownRelay,
  relayDelegateAbi,
  relayLive,
  relayTypes,
  RELAY_NAME,
  RELAY_VERSION,
} from '@longshort/shared';
import { publicClient } from './clients';
import { api } from './api';

export const sponsorLive = () => relayLive(ADDR.relayDelegate);

const pendingCalls = new Map<string, string>();
function readPending(key: string) {
  try { return localStorage.getItem(key) ?? pendingCalls.get(key); }
  catch { return pendingCalls.get(key); }
}
function writePending(key: string, value?: string) {
  if (value) pendingCalls.set(key, value); else pendingCalls.delete(key);
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* Optional retry cache. */ }
}

export function sponsorAccount(account: Account | null | undefined): LocalAccount {
  if (!account || account.type !== 'local') throw new Error('wallet cannot delegate');
  return account;
}

/** The receipt as the keeper saw it: status plus the arena's own events. Older keepers send only the hash. */
type KeeperReceipt = { status: 'success'; blockNumber: string; logs: Pick<Log, 'address' | 'topics' | 'data' | 'logIndex'>[] };
export interface RelayResult { hash: Hash; ms: number; status: 'success' | 'reverted'; logs?: Log[] }

// What the chain last said about an account: where its code points and its nonces. A trade then signs at
// once instead of reading three values per click. Our own successful calls advance it; anything that
// fails drops it, and relayTx's retry reads the chain again (another tab may have moved the nonce).
interface ChainState { who: ReturnType<typeof delegatedTo>; txNonce: number; execNonce: bigint | { error: unknown } }
const known = new Map<string, Promise<ChainState>>();
function chainState(address: Address): Promise<ChainState> {
  const key = address.toLowerCase();
  let state = known.get(key);
  if (!state) {
    state = Promise.all([
      publicClient.getCode({ address }),
      publicClient.getTransactionCount({ address }),
      publicClient.readContract({ address, abi: relayDelegateAbi, functionName: 'nonce' }).catch((error: unknown) => ({ error })),
    ]).then(([code, txNonce, execNonce]) => ({ who: delegatedTo(code), txNonce, execNonce }));
    known.set(key, state);
    const mine = state;
    state.catch(() => { if (known.get(key) === mine) known.delete(key); });
  }
  return state;
}
const forget = (address: Address) => known.delete(address.toLowerCase());

/** Read an account's delegation and nonces ahead of its first click (match start), so that click doesn't wait on them. */
export function warmRelay(account: Account | null | undefined) {
  if (!sponsorLive() || account?.type !== 'local') return;
  void chainState(account.address).catch(() => {});
}

/**
 * Ask the keeper to submit a call that the account itself signed. The first call also carries
 * the one-time EIP-7702 delegation. The keeper pays the gas; this account's MON does not move.
 */
export async function relayTx(account: LocalAccount, target: Address, data: Hex): Promise<RelayResult> {
  let last: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const t0 = performance.now();
      const { hash, receipt } = await post(account, target, data);
      // The keeper answers once the receipt exists; asking the RPC for it again costs the player another round trip.
      if (receipt) return { hash, ms: Math.round(performance.now() - t0), status: receipt.status, logs: receipt.logs as Log[] };
      const r = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 120 });
      return { hash, ms: Math.round(performance.now() - t0), status: r.status, logs: r.logs };
    } catch (e) {
      forget(account.address);
      last = e instanceof Error ? e : new Error(String(e));
      if (attempt === 0 && /nonce|BadSig|Expired|relay needs authorization/i.test(last.message)) continue;
      throw last;
    }
  }
  throw last ?? new Error('relay rejected');
}

async function post(account: LocalAccount, target: Address, data: Hex): Promise<{ hash: Hash; receipt?: KeeperReceipt }> {
  const delegate = ADDR.relayDelegate;
  if (!delegate) throw new Error('relay off');
  const storageKey = `ls.pendingRelay:${activeChain.id}:${delegate}:${account.address}`;
  const submit = async (body: any) => {
    try { return await api<{ hash: Hash; receipt?: KeeperReceipt }>('/relay', body); }
    catch(e) {
      if (/Expired|BadSig|BadCall|NotLive|NotOpen|NoPosition|revert|gas limit|relay dry|already used/i.test((e as Error).message)) writePending(storageKey);
      throw e;
    }
  };
  const saved = readPending(storageKey);
  if (saved) {
    let body: any;
    try {
      body = JSON.parse(saved);
      if (saved.length > 20_000 || body.from?.toLowerCase() !== account.address.toLowerCase() || !isAddress(body.target) ||
          !/^0x(?:[0-9a-fA-F]{2})*$/.test(body.data) || !/^\d{1,30}$/.test(String(body.nonce)) || !/^\d{1,20}$/.test(String(body.deadline)) ||
          !await verifyTypedData({ address: account.address, domain: { name: RELAY_NAME, version: RELAY_VERSION, chainId: activeChain.id, verifyingContract: account.address },
            types: relayTypes, primaryType: 'Execute', message: { target: body.target, data: body.data, nonce: BigInt(body.nonce), deadline: BigInt(body.deadline) }, signature: body.signature }))
        throw new Error('Invalid saved transaction');
    } catch { writePending(storageKey); throw new Error('Saved transaction data could not be verified. Review your position and try again.'); }
    const sent = await submit(body);
    if (!sent.receipt) await publicClient.waitForTransactionReceipt({hash:sent.hash});
    writePending(storageKey);
    forget(account.address);
    if (body.target.toLowerCase()===target.toLowerCase() && body.data===data) return sent;
    throw new Error('Previous transaction confirmed. Refresh your position before trading again.');
  }
  const { who, txNonce, execNonce: nonceRead } = await chainState(account.address);
  const delegated = who !== 'empty' && who !== 'other' && who.toLowerCase() === delegate.toLowerCase();
  const migrating = who !== 'empty' && who !== 'other' && knownRelay(who);
  if (who === 'other' || (who !== 'empty' && !delegated && !migrating)) throw new Error('account has unexpected code');
  if ((delegated || migrating) && typeof nonceRead !== 'bigint') throw nonceRead.error instanceof Error ? nonceRead.error : new Error('nonce');
  const execNonce = delegated || migrating ? nonceRead as bigint : 0n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const signature = await account.signTypedData({
    domain: { name: RELAY_NAME, version: RELAY_VERSION, chainId: activeChain.id, verifyingContract: account.address },
    types: relayTypes,
    primaryType: 'Execute',
    message: { target, data, nonce: execNonce, deadline },
  });
  let authorization: { address: Address; chainId: number; nonce: string; r: Hex; s: Hex; yParity: number } | undefined;
  if (!delegated) {
    if (!account.signAuthorization) throw new Error('wallet cannot delegate');
    const signed = await account.signAuthorization({ contractAddress: delegate, chainId: activeChain.id, nonce: txNonce });
    if (signed.yParity !== 0 && signed.yParity !== 1) throw new Error('bad authorization');
    authorization = {
      address: signed.address,
      chainId: Number(signed.chainId),
      nonce: String(signed.nonce),
      r: signed.r,
      s: signed.s,
      yParity: signed.yParity,
    };
  }
  const body = {
    from: account.address,
    target,
    data,
    nonce: execNonce.toString(),
    deadline: deadline.toString(),
    signature,
    ...(authorization ? { authorization } : {}),
  };
  writePending(storageKey, JSON.stringify(body));
  const sent = await submit(body);
  // The keeper has confirmed the receipt; a lost response leaves the original signed request for retry.
  writePending(storageKey);
  // A confirmed execute bumped the nonce, and an authorization (applied even if the call reverts) delegated the account.
  known.set(account.address.toLowerCase(), Promise.resolve({ who: delegate, txNonce: delegated ? txNonce : txNonce + 1, execNonce: execNonce + 1n }));
  return sent;
}
