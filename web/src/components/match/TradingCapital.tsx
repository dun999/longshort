'use client';
import { useState } from 'react';
import { explorerAddr } from '@longshort/shared';
import { authed } from '@/lib/auth';
import type { MatchView } from '@/lib/match';
import { useWallet } from '@/lib/wallet';
import { useT } from '@/lib/i18n';
import { friendly } from '@/lib/errors';

/** Your trading account in this match: what came back to the wallet, and a recovery if some is still out. */
export function useCapital(id: number, accounts: MatchView['accounts'], onRecovered?: () => void) {
  const t = useT();
  const address = useWallet((s) => s.address?.toLowerCase());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const account = accounts?.find((a) => a.addr === address);
  const outstanding = account ? Math.max(0, (account.final_balance ?? account.budget) - account.returned) : 0;
  const recover = async () => {
    setPending(true); setMessage(undefined);
    try { const result = await authed<{ pending: boolean }>('/recover', { id }); await useWallet.getState().refresh(); onRecovered?.(); setMessage(t(result.pending ? 'capital.retry' : 'capital.recovered')); }
    catch (e) { setMessage(friendly(e)); } finally { setPending(false); }
  };
  return { account, outstanding: outstanding > 0.000001 ? outstanding : 0, recover, pending, message };
}

export function TradingCapital({id,accounts,onRecovered}: {id:number;accounts:MatchView['accounts'];onRecovered?:()=>void}) {
  const t=useT();
  const {account,outstanding,recover,pending,message}=useCapital(id,accounts,onRecovered);
  if(!account) return null;
  return <div className="w-full border border-line p-3 text-left text-[13px]">
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{t('capital.title')}</span>
      <span className="fig font-semibold text-green">{account.returned.toFixed(2)} AUSD {t('capital.returned')}</span>
    </div>
    <p className="mt-1.5 text-[12px] leading-snug text-dim">
      {t('capital.separate')}{' '}
      <a className="whitespace-nowrap text-muted underline" href={explorerAddr(account.account)} target="_blank" rel="noreferrer">Perpl #{account.account_id} ↗</a>
    </p>
    {outstanding>0 && <button className="gbtn ghost sm mt-2" disabled={pending} onClick={()=>void recover()}>{t(pending?'capital.pending':'capital.recover',{amount:outstanding.toFixed(2)})}</button>}
    {message && <p role="status" className="mt-2 text-muted">{message}</p>}
  </div>;
}
