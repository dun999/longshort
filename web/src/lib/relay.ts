'use client';

import { type Account, type Address, type Hash, type Hex, type LocalAccount } from 'viem';
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

export function sponsorAccount(account: Account | null | undefined): LocalAccount {
  if (!account || account.type !== 'local') throw new Error('wallet cannot delegate');
  return account;
}

/**
 * Ask the keeper to submit a call that the account itself signed. The first call also carries
 * the one-time EIP-7702 delegation. The keeper pays the gas; this account's MON does not move.
 */
export async function relayTx(account: LocalAccount, target: Address, data: Hex): Promise<{ hash: Hash; ms: number; status: 'success' | 'reverted' }> {
  let last: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const t0 = performance.now();
      const hash = await post(account, target, data);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 120 });
      return { hash, ms: Math.round(performance.now() - t0), status: receipt.status };
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
      if (attempt === 0 && /nonce|BadSig|Expired|relay needs authorization/i.test(last.message)) continue;
      throw last;
    }
  }
  throw last ?? new Error('relay rejected');
}

async function post(account: LocalAccount, target: Address, data: Hex): Promise<Hash> {
  const delegate = ADDR.relayDelegate;
  if (!delegate) throw new Error('relay off');
  const storageKey = `ls.pendingRelay:${activeChain.id}:${delegate}:${account.address}`;
  const submit = async (body: any) => {
    try { return (await api<{hash:Hash}>('/relay',body)).hash; }
    catch(e) {
      if (/Expired|BadSig|BadCall|NotLive|NotOpen|NoPosition|revert|gas limit|relay dry|already used/i.test((e as Error).message)) localStorage.removeItem(storageKey);
      throw e;
    }
  };
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    const body = JSON.parse(saved);
    const hash = await submit(body);
    await publicClient.waitForTransactionReceipt({hash});
    localStorage.removeItem(storageKey);
    if (body.target.toLowerCase()===target.toLowerCase() && body.data===data) return hash;
    throw new Error('Previous transaction confirmed. Refresh your position before trading again.');
  }
  let nonceErr: unknown;
  const [code, txNonce, nonceRead] = await Promise.all([
    publicClient.getCode({ address: account.address }),
    publicClient.getTransactionCount({ address: account.address }),
    publicClient.readContract({ address: account.address, abi: relayDelegateAbi, functionName: 'nonce' }).catch((e: unknown) => {
      nonceErr = e;
      return null;
    }),
  ]);
  const who = delegatedTo(code);
  const delegated = who !== 'empty' && who !== 'other' && who.toLowerCase() === delegate.toLowerCase();
  const migrating = who !== 'empty' && who !== 'other' && knownRelay(who);
  if (who === 'other' || (who !== 'empty' && !delegated && !migrating)) throw new Error('account has unexpected code');
  if ((delegated || migrating) && nonceRead === null) throw nonceErr instanceof Error ? nonceErr : new Error('nonce');
  const execNonce = delegated || migrating ? nonceRead! : 0n;
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
  localStorage.setItem(storageKey,JSON.stringify(body));
  const hash = await submit(body);
  // The keeper has confirmed the receipt; a lost response leaves the original signed request for retry.
  localStorage.removeItem(storageKey);
  return hash;
}
