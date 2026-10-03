'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { formatUnits } from 'viem';
import { usePathname } from 'next/navigation';
import { REAL_TRADING, explorerTx } from '@longshort/shared';
import { useWallet } from '@/lib/wallet';
import { useT } from '@/lib/i18n';

const dollars = (value?: string) => Number(formatUnits(BigInt(value ?? '0'),6)).toLocaleString('en-US',{maximumFractionDigits:2});

export function ClaimAUSDDialog() {
  const t = useT();
  const path = usePathname();
  const { address, connecting, claimOpen, claimBusy, claim, claimError, usd, faucet } = useWallet();
  const [mounted,setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const confirmed = claim?.status === 'confirmed';
  const open = path === '/play' && REAL_TRADING && !!address && !connecting && claimOpen;
  const dismiss = () => { if (!useWallet.getState().claimBusy) useWallet.setState({ claimOpen: false }); };
  useEffect(()=>setMounted(true),[]);
  useEffect(()=>{
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if(e.key==='Escape') dismiss();
      if(e.key==='Tab') {
        const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]');
        if(!nodes?.length) return;
        const first=nodes[0],last=nodes[nodes.length-1];
        if(e.shiftKey && (document.activeElement===first || document.activeElement===panel.current)) {e.preventDefault();last.focus();}
        else if(!e.shiftKey && document.activeElement===last) {e.preventDefault();first.focus();}
      }
    };
    const overflow=document.body.style.overflow; document.body.style.overflow='hidden';
    document.addEventListener('keydown',handle);
    return ()=>{document.removeEventListener('keydown',handle);document.body.style.overflow=overflow;previous?.focus();};
  },[open]);
  if(!mounted) return null;
  return createPortal(<AnimatePresence>{open && (
    <motion.div className="dialog-overlay fixed inset-0 z-[80] flex bg-black/75 backdrop-blur-sm" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
      <motion.div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="claim-ausd-title" aria-describedby="claim-ausd-body" className="dialog-panel panel relative m-auto w-full max-w-[420px] p-5 outline-none sm:p-6" style={{background:'var(--panel-solid)',borderTop:'2px solid var(--accent)'}} initial={{y:12,scale:0.98}} animate={{y:0,scale:1}}>
        <div className="dialog-heading flex items-center justify-between">
          <span className="panel-title">{t('claim.kicker')}</span>
          <button className="-mr-2 grid h-[44px] w-[44px] shrink-0 place-items-center text-xl text-muted hover:text-white disabled:opacity-40" onClick={dismiss} disabled={claimBusy} aria-label={t('claim.dismiss')}>×</button>
        </div>
        <h2 id="claim-ausd-title" className="font-display mt-1 text-2xl font-bold tracking-[0.06em] uppercase">{t(confirmed?'claim.confirmed':'claim.title')}</h2>
        <p id="claim-ausd-body" className="mt-2 text-xs leading-relaxed text-muted">{t(confirmed?'claim.doneBody':'claim.body')}</p>
        <div className="my-5 border-y border-line py-5" aria-live="polite">
          <div className="panel-title">{t(confirmed?'claim.balance':'claim.grant')}</div>
          <div className={`num mt-2 flex items-baseline gap-2 ${confirmed?'text-green':'text-white'}`}>
            <span className="text-[clamp(2rem,9vw,3rem)] font-semibold leading-none tracking-tight">{confirmed?Number(formatUnits(usd,6)).toFixed(2):dollars(claim?.amount??'200000000')}</span>
            <span className="text-sm text-muted">AUSD</span>
          </div>
          {confirmed && claim?.before !== undefined ? <div className="num mt-3 text-xs text-muted">{dollars(claim.before)} → {dollars(claim.after)} AUSD <span className="text-green">(+{dollars(claim.amount)})</span></div> : <div className="mt-3 flex justify-between gap-3 text-[11px] text-muted"><span>{t('claim.balance')}</span><span className="num">{Number(formatUnits(usd,6)).toFixed(2)} AUSD</span></div>}
        </div>
        {!confirmed && <p className="mb-5 text-xs leading-relaxed text-muted">{t('claim.cost')}</p>}
        {claimError && <p role="alert" className="mb-3 text-xs text-red">{claimError}</p>}
        {confirmed ? <button className="btn-play sm min-h-12 w-full !px-4 !text-[13px] !tracking-[0.12em]" onClick={dismiss}>{t('claim.play')}</button> :
          <button className="btn-play sm min-h-12 w-full !px-4 !text-[13px] !tracking-[0.12em]" disabled={claimBusy} onClick={()=>void faucet().catch(()=>{})}>{t(claimBusy?'claim.pending':claim?.status==='pending'?'claim.check':'claim.action',{amount:dollars(claim?.amount??'200000000')})}</button>}
        {claim?.tx && <a className="mt-3 block text-center text-xs text-muted underline" href={explorerTx(claim.tx)} target="_blank" rel="noreferrer">{t('claim.transaction')} ↗</a>}
        {!confirmed && <button className="mt-3 block w-full text-center text-xs text-muted underline" onClick={() => useWallet.setState({ claimOpen: false, depositOpen: true })}>{t('claim.deposit')}</button>}
        <p className="mt-4 text-center text-[10px] text-dim">{t('claim.testnet')}</p>
      </motion.div>
    </motion.div>
  )}</AnimatePresence>,document.body);
}
