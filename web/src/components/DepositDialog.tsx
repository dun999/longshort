'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { formatUnits } from 'viem';
import qrcode from 'qrcode-generator';
import { ADDR, STAKE, explorerAddr, shortAddr } from '@longshort/shared';
import { useWallet } from '@/lib/wallet';
import { useDialog } from '@/lib/useDialog';
import { useT } from '@/lib/i18n';

/** Your account address as a QR code, drawn as one SVG path (no images, crisp at any size). */
function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return <div className="deposit-qr" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Deposit testnet AUSD from anywhere: the address, a QR code, and the balance updating the moment it lands. */
export function DepositDialog() {
  const t = useT();
  const { address, depositOpen, usd, refresh } = useWallet();
  const open = depositOpen && !!address;
  const close = () => useWallet.setState({ depositOpen: false });
  const panel = useDialog(open, close);
  const [copied, setCopied] = useState(false);
  const start = useRef<bigint | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return (start.current = null), undefined;
    start.current ??= useWallet.getState().usd;
    const i = setInterval(() => void refresh().catch(() => {}), 4000);
    return () => clearInterval(i);
  }, [open, refresh]);
  if (!mounted) return null;
  const received = start.current !== null && usd > start.current ? usd - start.current : 0n;
  const copy = () => {
    void navigator.clipboard?.writeText(address!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="dialog-overlay fixed inset-0 z-[80] flex bg-black/75 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deposit-title"
            className="dialog-panel panel relative m-auto w-full max-w-[420px] p-5 outline-none sm:p-6"
            style={{ background: 'var(--panel-solid)', borderTop: '2px solid var(--accent)' }}
            initial={{ y: 12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-heading flex items-center justify-between">
              <span className="panel-title">{t('dep.kicker')}</span>
              <button className="dialog-close -mr-2" onClick={close} aria-label={t('ui.close')}>×</button>
            </div>
            <h2 id="deposit-title" className="font-display mt-1 text-2xl font-bold tracking-[0.06em] uppercase">{t('dep.title', { stake: STAKE })}</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">{t('dep.body', { stake: STAKE })}</p>
            <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
              <Qr text={address!} />
              <div className="grid min-w-0 gap-2">
                <div className="panel-title">{t('dep.address')}</div>
                <div className="num text-[12px] leading-snug break-all text-white">{address}</div>
                <button className="gbtn sm justify-self-start" onClick={copy}>{t(copied ? 'dep.copied' : 'dep.copy')}</button>
              </div>
            </div>
            <div className="mt-4 border-y border-line py-3" aria-live="polite">
              <div className="flex items-baseline justify-between gap-3">
                <span className="panel-title">{t('dep.balance')}</span>
                <span className="num text-lg text-white">{Number(formatUnits(usd, 6)).toFixed(2)} <span className="text-xs text-muted">{STAKE}</span></span>
              </div>
              <div className={`mt-1 text-[11px] ${received ? 'text-green' : 'text-dim'}`}>
                {received ? t('dep.received', { amount: Number(formatUnits(received, 6)).toFixed(2), stake: STAKE }) : t('dep.waiting')}
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-gold">{t('dep.only', { stake: STAKE, token: shortAddr(ADDR.stake) })}</p>
            <a className="mt-2 block text-[11px] text-muted underline" href={explorerAddr(address!)} target="_blank" rel="noreferrer">
              {t('dep.explorer')} ↗
            </a>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
