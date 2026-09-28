// Direct Perpl price reads (ported from legacy lib/perpl.ts). Used for charts; the contract reads the same feed.
import { formatUnits, type PublicClient } from 'viem';
import { MARKETS, PERPL_IDS, type MarketSymbol } from './game';

export const PERPL_EXCHANGE = '0x1964C32f0bE608E7D29302AFF5E61268E72080cc' as const;
export const perplAbi = [
  {
    type: 'function',
    name: 'getPerpetualInfo',
    stateMutability: 'view',
    inputs: [{ name: 'perpId', type: 'uint256' }],
    outputs: [
      {
        name: 'info',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'priceDecimals', type: 'uint256' },
          { name: 'lotDecimals', type: 'uint256' },
          { name: 'linkFeedId', type: 'bytes32' },
          { name: 'priceTolPer100K', type: 'uint256' },
          { name: 'marginTol', type: 'uint256' },
          { name: 'marginTolDecimals', type: 'uint256' },
          { name: 'refPriceMaxAgeSec', type: 'uint256' },
          { name: 'positionBalanceCNS', type: 'uint256' },
          { name: 'insuranceBalanceCNS', type: 'uint256' },
          { name: 'markPNS', type: 'uint256' },
          { name: 'markTimestamp', type: 'uint256' },
          { name: 'lastPNS', type: 'uint256' },
          { name: 'lastTimestamp', type: 'uint256' },
          { name: 'oraclePNS', type: 'uint256' },
          { name: 'oracleTimestampSec', type: 'uint256' },
          { name: 'longOpenInterestLNS', type: 'uint256' },
          { name: 'shortOpenInterestLNS', type: 'uint256' },
          { name: 'fundingStartBlock', type: 'uint256' },
          { name: 'fundingRatePct100k', type: 'int16' },
          { name: 'absFundingClampPctPer100K', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'basePricePNS', type: 'uint256' },
          { name: 'maxBidPriceONS', type: 'uint256' },
          { name: 'minBidPriceONS', type: 'uint256' },
          { name: 'maxAskPriceONS', type: 'uint256' },
          { name: 'minAskPriceONS', type: 'uint256' },
          { name: 'numOrders', type: 'uint256' },
          { name: 'ignOracle', type: 'bool' },
        ],
      },
    ],
  },
] as const;

export interface PerplPrice {
  symbol: MarketSymbol;
  price: number;
  timestamp: number; // ms
}

/** Same selection rule as PerplOracle.sol: the fresher of mark and oracle price. */
export async function readPerplPrices(client: PublicClient): Promise<PerplPrice[]> {
  const res = await Promise.allSettled(
    MARKETS.map(async (symbol) => {
      const i = await client.readContract({
        address: PERPL_EXCHANGE,
        abi: perplAbi,
        functionName: 'getPerpetualInfo',
        args: [PERPL_IDS[symbol]],
      });
      const useOracle = i.oracleTimestampSec > i.markTimestamp && i.oraclePNS > 0n;
      const raw = useOracle ? i.oraclePNS : i.markPNS;
      const ts = useOracle ? i.oracleTimestampSec : i.markTimestamp;
      return { symbol, price: Number(formatUnits(raw, Number(i.priceDecimals))), timestamp: Number(ts) * 1000 };
    }),
  );
  return res.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}
