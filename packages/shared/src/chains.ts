import { defineChain } from 'viem';
import { monadTestnet } from 'viem/chains';
import deployment from './addresses.json' with { type: 'json' };
import localDeployment from './addresses.local.json' with { type: 'json' };

// The existing virtual-arena regression suite uses mocked local contracts, regardless of the active deployment.
const addresses = typeof process !== 'undefined' && process.env.NODE_ENV === 'test' && process.env.TEST_CHAIN_PROFILE === 'local'
  ? localDeployment : deployment;

export const anvil = defineChain({
  id: 31337,
  name: 'Local (anvil)',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'], webSocket: ['ws://127.0.0.1:8545'] } },
});

export { monadTestnet };
export const activeChain = addresses.chainId === monadTestnet.id ? monadTestnet : anvil;
export const explorerTx = (hash: string) =>
  activeChain.id === monadTestnet.id ? `https://testnet.monadscan.com/tx/${hash}` : `#tx-${hash}`;
export const explorerAddr = (a: string) =>
  activeChain.id === monadTestnet.id ? `https://testnet.monadscan.com/address/${a}` : `#addr-${a}`;

export const ADDR = addresses as {
  chainId: number;
  deployBlock: number;
  arena: `0x${string}`;
  stake: `0x${string}`;
  perplOracle: `0x${string}`;
  mockOracle: `0x${string}`;
  perplExchange: `0x${string}`;
  mockOracleActive: boolean;
  stakeSymbol?: string;
  /** EIP-7702 delegate. Absent until that deployment has a sponsor contract. */
  relayDelegate?: `0x${string}`;
  realTrading?: boolean;
  tradingBudget?: number;
  previousRelayDelegates?: `0x${string}`[];
};
/** Stake token symbol: AUSD on testnet, tUSD on the local faucet token. */
export const STAKE = ADDR.stakeSymbol ?? 'tUSD';
export const REAL_TRADING = ADDR.realTrading === true;
export const TRADING_BUDGET = REAL_TRADING ? (ADDR.tradingBudget ?? 100) : 0;
/** Players per party, the leader included: live matches pair you with one friend. */
export const PARTY_MAX = REAL_TRADING ? 2 : 3;
export const knownRelay = (who: string) => ADDR.previousRelayDelegates?.some((a) => a.toLowerCase() === who.toLowerCase()) === true;

// Owners need enough for an approval plus a buffered createMatch transaction.
// 0.03 MON can fall below the local signer's fee cap for a new lobby on Monad.
export const OWNER_GAS_LOW = '0.08';
