'use client';
import { useState } from 'react';
export function Wordmark() {
 const [replay,setReplay]=useState(0);
 return <a href="/" className="wordmark" aria-label="longshort.fun home" onMouseEnter={()=>setReplay(x=>x+1)}><span aria-hidden="true" className="logo-stage" key={replay}><span className="logo-front">longshort.f<span className="logo-u">u<i/></span></span><span className="logo-n">n</span></span></a>;
}
export function Coin({symbol}:{symbol:string}){return <span className={`coin coin-${symbol.toLowerCase()}`} aria-hidden="true">{symbol==='BTC'?'₿':symbol==='ETH'?'Ξ':symbol==='MON'?'◈':'A'}</span>}
