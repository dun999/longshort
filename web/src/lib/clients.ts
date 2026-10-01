import { createPublicClient, http } from 'viem';
import { ADDR, REAL_TRADING, activeChain, arenaAbi } from '@longshort/shared';
import { RPC_URL } from './config';

export const publicClient = createPublicClient({ chain: activeChain, transport: http(RPC_URL, { batch: { wait: 16 } }) });
export const arena = { address: ADDR.arena, abi: arenaAbi } as const;

/** Fallback limits if estimation fails (sized from a fork run against live Perpl, ~1.5x headroom). */
export const GAS = {
  createMatch: REAL_TRADING ? 750_000n : 300_000n,
  joinMatch: REAL_TRADING ? 700_000n : 160_000n,
  setClass: 60_000n,
  open: REAL_TRADING ? 900_000n : 190_000n,
  close: REAL_TRADING ? 500_000n : 90_000n,
  leave: 120_000n,
  approve: 70_000n,
  faucet: 90_000n,
} as const;
