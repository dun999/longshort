import { defineChain } from 'viem';
import { monadTestnet } from 'viem/chains';
import addresses from './addresses.json' with { type: 'json' };

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
};
/** Stake token symbol: AUSD on testnet, tUSD on the local faucet token. */
export const STAKE = ADDR.stakeSymbol ?? 'tUSD';
