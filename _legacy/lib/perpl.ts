import { createPublicClient, http, formatUnits } from 'viem';
import { monadTestnet } from 'viem/chains';
import rawAbi from './perpl-abi.json';
import type {Abi} from 'viem';
import type {Market,Price} from './game';
export const AUSD='0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC' as const;
export const EXCHANGE='0x1964C32f0bE608E7D29302AFF5E61268E72080cc' as const;
export const MARKET_IDS:Record<Market,bigint>={BTC:16n,ETH:32n,MON:64n};
export const client=(rpc='https://testnet-rpc.monad.xyz')=>createPublicClient({chain:monadTestnet,transport:http(rpc,{timeout:8000,retryCount:1})});
export async function prices(rpc?:string):Promise<Price[]>{
 const c=client(rpc);const block=await c.getBlockNumber();
 const r=await Promise.allSettled(Object.entries(MARKET_IDS).map(async([symbol,id])=>{const data=await c.readContract({address:EXCHANGE,abi:rawAbi as Abi,functionName:'getPerpetualInfo',args:[id],blockNumber:block}) as {markPNS:bigint;markTimestamp:bigint;priceDecimals:bigint};const timestamp=Number(data.markTimestamp)*1000;return {symbol:symbol as Market,price:Number(formatUnits(data.markPNS,Number(data.priceDecimals))),timestamp,source:'perpl' as const,stale:Date.now()-timestamp>10000}}));
 return r.flatMap(v=>v.status==='fulfilled'?[v.value]:[]);
}
