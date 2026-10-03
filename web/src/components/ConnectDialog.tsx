'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { REAL_TRADING, STAKE } from '@longshort/shared';
import Link from 'next/link';
import { useWallet } from '@/lib/wallet';
import { signIn } from '@/lib/auth';
import { hasSavedPasskey, passkeySupported } from '@/lib/mera';
import { sfx } from '@/lib/sfx';
import { useT } from '@/lib/i18n';
import { useDialog } from '@/lib/useDialog';

export function ConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { connectInjected, connectGuest, connectPasskey, connecting, error, address } = useWallet();
  const [username, setUsername] = useState('');
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [supported, setSupported] = useState(true);
  const panel = useDialog(open, onClose);
  useEffect(() => {
    setSaved(hasSavedPasskey());
    setSupported(passkeySupported());
  }, [open]);
  useEffect(() => {
    if (address && open) onClose();
  }, [address, open, onClose]);
  // portalled: the top bar's backdrop-filter would otherwise trap this fixed overlay inside the bar
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="dialog-overlay fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            className="connect-panel dialog-panel panel m-auto w-full max-w-[460px] p-5 outline-none sm:p-6"
            style={{ background: 'var(--panel-solid)' }}
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-heading flex items-center justify-between gap-3">
              <div><div className="panel-title">{t('cd.kicker')}</div>
                <h2 id="connect-title" className="font-display mt-1 text-2xl font-bold tracking-wide uppercase">{t('cd.title')}</h2>
              </div>
              <button className="dialog-close" aria-label={t('ui.close')} onClick={onClose}>×</button>
            </div>

            {/* primary: Mera passkey */}
            <div className="mt-5 grid gap-2 border border-[var(--line-hi)] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-bold tracking-[0.12em] uppercase">{t('cd.passkey')}</span>
                <span className="text-[10px] tracking-wider text-gold uppercase">{t('cd.recommended')}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted">
                {t('cd.passkeyBody')}
              </p>
              {!supported ? (
                <p className="text-[11px] text-gold">{t('cd.unsupported')}</p>
              ) : creating || !saved ? (
                <div className="grid gap-2">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/[^\w.-]/g, '').slice(0, 20))}
                    placeholder={t('cd.callsign')}
                    aria-label={t('cd.callsign')}
                    className="min-h-[44px] min-w-0 border border-line bg-black/30 px-3 py-2 text-[16px] outline-none focus:border-[var(--accent)]"
                  />
                  <button className="btn-play sm w-full" disabled={connecting} onClick={() => (sfx.lockIn(), void connectPasskey({ create: true, username }))}>
                    {t(connecting ? 'cd.waiting' : 'cd.create')}
                  </button>
                  {saved && (
                    <button className="text-[11px] text-dim hover:text-[var(--text)]" onClick={() => setCreating(false)}>
                      {t('cd.haveOne')}
                    </button>
                  )}
                  {!saved && (
                    <button className="gbtn ghost sm w-full !min-h-[44px]" disabled={connecting} onClick={() => (sfx.click(), void connectPasskey())}>
                      {t('cd.usedBefore')}
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid gap-2">
                  <button className="btn-play sm w-full" disabled={connecting} onClick={() => (sfx.lockIn(), void connectPasskey())}>
                    {t(connecting ? 'cd.waiting' : 'cd.signInPasskey')}
                  </button>
                  <button className="text-[11px] text-dim hover:text-[var(--text)]" onClick={() => setCreating(true)}>
                    {t('cd.createNew')}
                  </button>
                </div>
              )}
            </div>

            {!REAL_TRADING && <><div className="my-4 flex items-center gap-3 text-[10px] tracking-[0.2em] text-dim uppercase">
              <span className="h-px flex-1 bg-[var(--line)]" /> {t('cd.or')} <span className="h-px flex-1 bg-[var(--line)]" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="gbtn ghost sm" disabled={connecting} onClick={() => (sfx.click(), void connectInjected().then(() => signIn()).catch(() => {}))}>
                {t('cd.wallet')}
              </button>
              <button className="gbtn ghost sm" disabled={connecting} onClick={() => (sfx.click(), void connectGuest())}>
                {t('cd.guest')}
              </button>
            </div></>}
            <p className="mt-3 text-[10px] leading-relaxed text-dim">
              {t(REAL_TRADING ? 'cd.liveFooter' : 'cd.footer', { stake: STAKE })}
            </p>
            {REAL_TRADING && <Link href="/recover" onClick={onClose} className="mt-3 block text-[11px] text-dim underline">{t('cd.legacy')}</Link>}
            {error && <p className="mt-3 text-xs text-red">{error}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
