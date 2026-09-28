export const RULES = Object.freeze({ entry:20, margin:14, stake:6, leverage:5, seconds:60, winXP:50, lossXP:-20, dailyXP:10, startingXP:1000 });
export type Market = 'ETH'|'BTC'|'MON';
export type Side = 'long'|'short';
export type Price = {symbol:Market;price:number;timestamp:number;source:'perpl';stale:boolean};
export type Position = {market:Market;side:Side;entry:number;notional:number;openedAt:number};
export function level(xp:number){return 1+Math.floor((Math.max(1000,xp)-1000)/100)}
export function pnl(position:Position|null,price:number){return position ? position.notional*((price-position.entry)/position.entry)*(position.side==='long'?1:-1):0}
export function outcome(a:number,b:number,aTraded:boolean,bTraded:boolean):'win'|'loss'|'draw'{if(!aTraded&&!bTraded)return 'draw';if(!aTraded)return 'loss';if(!bTraded)return 'win';return Math.abs(a-b)<.000001?'draw':a>b?'win':'loss'}
export function payout(net:number,result:'win'|'loss'|'draw'){return Math.max(0,14+net)+(result==='win'?12:result==='draw'?6:0)}
export const signed=(n:number,digits=2)=>`${n>=0?'+':'−'}${Math.abs(n).toFixed(digits)}`;
export const priceFormat=(n:number)=>n<1?n.toFixed(5):n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
