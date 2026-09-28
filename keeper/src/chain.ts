import {
  createPublicClient,
  createWalletClient,
  http,
  nonceManager,
  type Account,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ADDR, activeChain, arenaAbi, monadTestnet } from '@longshort/shared';
import { env } from './env';

export const pub = createPublicClient({ chain: activeChain, transport: http(env.rpcUrl, { timeout: 10_000, retryCount: 2 }) });
export const perplPub = createPublicClient({ chain: monadTestnet, transport: http(env.perplRpcUrl, { timeout: 8000 }) });

export const keeperAccount = privateKeyToAccount(env.keeperKey, { nonceManager });
export const walletFor = (account: Account) =>
  createWalletClient({ account, chain: activeChain, transport: http(env.rpcUrl) });
export const keeper = walletFor(keeperAccount);

/** Fallback limits if estimation fails. Monad bills the gas *limit*; see estimateGas() for the normal path. */
export const GAS = {
  createMatch: 300_000n,
  joinMatch: 160_000n,
  setClass: 60_000n,
  open: 190_000n,
  close: 90_000n,
  liquidate: 120_000n,
  eliminate: 250_000n,
  settle: 350_000n,
  cancel: 300_000n,
  approve: 70_000n,
  transfer: 70_000n,
  oracleSet: 60_000n,
} as const;

/** Estimate + 20% buffer (falls back to the table above). Cached per key when `cache` is set. */
const gasCache = new Map<string, bigint>();
export async function estimateGas(key: keyof typeof GAS, req: Record<string, unknown>, cache = false): Promise<bigint> {
  if (cache && gasCache.has(key)) return gasCache.get(key)!;
  try {
    const g = ((await pub.estimateContractGas(req as any)) * 120n) / 100n;
    if (cache) gasCache.set(key, g);
    return g;
  } catch {
    return GAS[key];
  }
}

export const arena = { address: ADDR.arena, abi: arenaAbi } as const;

export async function chainNow() {
  const b = await pub.getBlock({ blockTag: 'latest' });
  return Number(b.timestamp);
}

export const log = (scope: string, ...a: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), `[${scope}]`, ...a);

/** Fire a tx, log failures instead of throwing (keeper loops must never die). */
export async function send(scope: string, fn: () => Promise<Hash>): Promise<Hash | undefined> {
  try {
    return await fn();
  } catch (e) {
    const msg = (e as Error).message.split('\n').find((l) => /reverted|Error|error/.test(l)) ?? (e as Error).message;
    log(scope, 'tx failed:', msg.slice(0, 160));
  }
}
