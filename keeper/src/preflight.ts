import { ADDR, REAL_TRADING, erc20Abi, perplTradingAbi, relayDelegateAbi } from '@longshort/shared';
import { arena, keeper, log, pub } from './chain';
import { env } from './env';

export async function preflight() {
  if (!REAL_TRADING) return;
  if (ADDR.chainId !== 10143 || await pub.getChainId() !== 10143) throw new Error('AUSD live mode is Monad testnet only');
  const addresses = [ADDR.arena,ADDR.stake,ADDR.perplExchange,ADDR.relayDelegate];
  if (addresses.some((a)=>!a)) throw new Error('AUSD relay is not configured');
  const code = await Promise.all(addresses.map((address)=>pub.getCode({address:address!})));
  if(code.some((c)=>!c || c==='0x')) throw new Error('Missing AUSD deployment code');
  const [token,exchange,budget,decimals,info,minimum,delegateArena,delegateStake,owner] = await Promise.all([
    pub.readContract({...arena,functionName:'stake'}),pub.readContract({...arena,functionName:'exchange'}),pub.readContract({...arena,functionName:'tradingBudget'}),
    pub.readContract({address:ADDR.stake,abi:erc20Abi,functionName:'decimals'}),
    pub.readContract({address:ADDR.perplExchange,abi:perplTradingAbi,functionName:'getExchangeInfo'}),
    pub.readContract({address:ADDR.perplExchange,abi:perplTradingAbi,functionName:'getMinAccountOpenCNS'}),
    pub.readContract({address:ADDR.relayDelegate!,abi:relayDelegateAbi,functionName:'arena'}),
    pub.readContract({address:ADDR.relayDelegate!,abi:relayDelegateAbi,functionName:'stake'}),pub.readContract({...arena,functionName:'owner'}),
  ]);
  const same = (a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
  if(!same(token,ADDR.stake)||!same(exchange,ADDR.perplExchange)||!same(info[4],ADDR.stake)||decimals!==6||info[3]!==6n||
    budget!==100_000_000n || minimum>budget || !same(delegateArena,ADDR.arena)||!same(delegateStake,ADDR.stake)||!same(owner,keeper.account.address))
    throw new Error('AUSD deployment bindings or collateral configuration do not match');
  if(!env.faucetKey || !env.relayerKey) throw new Error('Configure separate testnet funding and relay keys');
  log('preflight','Monad testnet · AUSD · isolated Perpl BTC · 100 AUSD trading budget');
}
