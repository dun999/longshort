'use client';
import { useState } from 'react';
import { explorerAddr } from '@longshort/shared';
import { authed } from '@/lib/auth';
import type { MatchView } from '@/lib/match';
import { useWallet } from '@/lib/wallet';
import { useT } from '@/lib/i18n';
import { friendly } from '@/lib/errors';

export function TradingCapital({id,accounts,onRecovered}: {id:number;accounts:MatchView['accounts'];onRecovered?:()=>void}) {
  const t=useT(); const address=useWallet((s)=>s.address?.toLowerCase());
  const [pending,setPending]=useState(false); const [message,setMessage]=useState<string>();
  const account=accounts?.find((a)=>a.addr===address);
  if(!account) return null;
  const outstanding=Math.max(0,(account.final_balance??account.budget)-account.returned);
  const recover=async()=>{
    setPending(true); setMessage(undefined);
    try {const result=await authed<{pending:boolean}>('/recover',{id});await useWallet.getState().refresh();onRecovered?.();setMessage(t(result.pending?'capital.retry':'capital.recovered'));}
    catch(e){setMessage(friendly(e));}finally{setPending(false);}
  };
  return <div className="my-3 border border-line p-3 text-xs">
    <div className="text-muted">{t('capital.title')}</div>
    <div className="num mt-1 text-green">{account.returned.toFixed(2)} AUSD {t('capital.returned')}</div>
    <p className="mt-1 text-[10px] text-dim">{t('capital.separate')}</p>
    {outstanding>0.000001 && <button className="gbtn ghost sm mt-2" disabled={pending} onClick={()=>void recover()}>{t(pending?'capital.pending':'capital.recover',{amount:outstanding.toFixed(2)})}</button>}
    <a className="mt-2 block text-[10px] text-muted underline" href={explorerAddr(account.account)} target="_blank" rel="noreferrer">Perpl #{account.account_id} ↗</a>
    {message && <p role="status" className="mt-2 text-muted">{message}</p>}
  </div>;
}
