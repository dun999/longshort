import { readFileSync, existsSync } from 'node:fs';
import { OWNER_GAS_LOW, REAL_TRADING, activeChain } from '@longshort/shared';

// Tiny .env loader (keeps deps at zero).
// ENV_FILE=.env.testnet npm start → run the same keeper against another network profile
const file = new URL(`../${process.env.ENV_FILE ?? '.env'}`, import.meta.url);
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

// Dedicated testnet token distributor; never put this key in a NEXT_PUBLIC variable or use it for match settlement.
const fundingFile = new URL(`../${process.env.FAUCET_ENV_FILE ?? '.env.funder.testnet'}`, import.meta.url);
if (REAL_TRADING && activeChain.id === 10143 && !process.env.FAUCET_KEY && existsSync(fundingFile)) {
  const match = readFileSync(fundingFile,'utf8').match(/^FAUCET_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
  if (match) process.env.FAUCET_KEY = match[1];
}

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

export const env = {
  rpcUrl: need('RPC_URL'),
  rpcBackupUrl: process.env.RPC_BACKUP_URL || undefined,
  /** Lowest-latency endpoint for sending transactions and reading their receipts; RPC_URL is its fallback. */
  txRpcUrl: process.env.TX_RPC_URL || undefined,
  perplRpcUrl: process.env.PERPL_RPC_URL ?? 'https://testnet-rpc.monad.xyz',
  perplRpcBackupUrl: process.env.PERPL_RPC_BACKUP_URL || (activeChain.id === 10143 ? process.env.RPC_BACKUP_URL : undefined),
  keeperKey: need('KEEPER_KEY') as `0x${string}`,
  botMnemonic: need('BOT_MNEMONIC'),
  botCount: Number(process.env.BOT_COUNT ?? 12),
  botFillAfter: Number(process.env.BOT_FILL_AFTER ?? 12),
  ambientEvery: Number(process.env.AMBIENT_MATCH_EVERY ?? 45),
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST, // e.g. 127.0.0.1 behind a reverse proxy; unset = every interface
  dbPath: process.env.DB_PATH ?? './longshort.db',
  faucetMon: process.env.FAUCET_MON ?? '0.5',
  botFundMon: process.env.BOT_FUND_MON ?? '0.5',
  botFundStake: process.env.BOT_FUND_STAKE ?? '1000',
  faucetStake: process.env.FAUCET_STAKE ?? '200',
  logRange: Number(process.env.LOG_RANGE ?? 100),
  // gas station (MON): players never pay network fees; see gas.ts
  gasTarget: process.env.GAS_TARGET ?? '0.1',
  gasLow: process.env.GAS_LOW ?? '0.04',
  gasCapPerMatch: process.env.GAS_CAP_PER_MATCH ?? '0.4',
  gasReserve: process.env.GAS_RESERVE ?? '0.5',
  // owner-level gas refill (joins, approvals) when a player runs nearly dry.
  // Unused once RELAYER_KEY is set and addresses.relayDelegate is deployed.
  faucetGasLow: process.env.FAUCET_GAS_LOW ?? OWNER_GAS_LOW,
  // Pays player gas. Must be a different key from KEEPER_KEY (nonce clashes).
  relayerKey: (process.env.RELAYER_KEY ?? '') as `0x${string}`,
  // most the relayer may spend on player gas in any hour (MON); one IP may use a quarter of it
  relayHourlyMon: process.env.RELAY_HOURLY_MON ?? '20',
  faucetKey: (process.env.FAUCET_KEY ?? '') as `0x${string}`,
};
