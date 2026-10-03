import {
  createPublicClient,
  createWalletClient,
  nonceManager,
  type Account,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ADDR, REAL_TRADING, activeChain, arenaAbi, monadTestnet } from '@longshort/shared';
import { env } from './env';
import { rpcTransport } from './rpc';

export const pub = createPublicClient({ chain: activeChain, transport: rpcTransport(env.rpcUrl, env.rpcBackupUrl, { timeout: 10_000, retryCount: 2 }) });
export const perplPub = createPublicClient({ chain: monadTestnet, transport: rpcTransport(env.perplRpcUrl, env.perplRpcBackupUrl, { timeout: 8000 }) });

export const keeperAccount = privateKeyToAccount(env.keeperKey, { nonceManager });
export const walletFor = (account: Account) =>
  createWalletClient({ account, chain: activeChain, transport: rpcTransport(env.rpcUrl, env.rpcBackupUrl) });
export const keeper = walletFor(keeperAccount);

// Own nonce sequence. Sharing the settlement key here collides with settle/liquidate.
let relayerAccount: ReturnType<typeof privateKeyToAccount> | undefined;
let relayerWallet: ReturnType<typeof walletFor> | undefined;
export function relayer() {
  if (!env.relayerKey) throw new Error('relay not configured');
  if (!relayerWallet || !relayerAccount) {
    relayerAccount = privateKeyToAccount(env.relayerKey, { nonceManager });
    relayerWallet = walletFor(relayerAccount);
  }
  return { account: relayerAccount, wallet: relayerWallet };
}

/** Fallback limits if estimation fails. Monad bills the gas *limit*; see estimateGas() for the normal path. */
export const GAS = {
  createMatch: REAL_TRADING ? 750_000n : 300_000n,
  joinMatch: REAL_TRADING ? 700_000n : 160_000n,
  setClass: 60_000n,
  open: REAL_TRADING ? 900_000n : 190_000n,
  close: REAL_TRADING ? 500_000n : 90_000n,
  liquidate: 120_000n,
  eliminate: REAL_TRADING ? 1_200_000n : 250_000n,
  settle: REAL_TRADING ? 5_000_000n : 350_000n,
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
