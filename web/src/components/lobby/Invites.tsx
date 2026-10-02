'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { shortAddr } from '@longshort/shared';
import { useSocket } from '@/lib/socket';
import { sfx } from '@/lib/sfx';
import { useT } from '@/lib/i18n';
import { useDialog } from '@/lib/useDialog';

export function Invites({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { invites, rematchInvites, send, dismissInvite } = useSocket();
  const t = useT();
  const dismissRematch = (id: number) => useSocket.setState({ rematchInvites: useSocket.getState().rematchInvites.filter((i) => i.matchId !== id) });
  const router = useRouter();
  const panel = useDialog(open, onClose);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (invites.length) sfx.found();
  }, [invites.length]);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && <motion.div className="dialog-overlay fixed inset-0 z-[60] flex bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="invites-title" className="invite-panel dialog-panel panel m-auto w-full max-w-[420px] outline-none" style={{ background: 'var(--panel-solid)' }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-heading flex items-center justify-between gap-3 p-4">
          <h2 id="invites-title" className="panel-title">{t('invite.title')}</h2>
          <button className="dialog-close" onClick={onClose} aria-label={t('ui.close')}>×</button>
        </div>
        <div className="dialog-content scroll-thin grid min-h-0 gap-3 overflow-y-auto px-4 pb-4">
        {!invites.length && !rematchInvites.length && <p className="py-4 text-sm text-muted">{t('invite.empty')}</p>}
      <AnimatePresence>
        {rematchInvites.map((i) => (
          <motion.div key={`rematch-${i.matchId}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="panel min-w-0 p-3">
            <div className="panel-title">{t('rs.rematch')}</div>
            <p className="mt-1 text-sm">{t('rs.invite', { id: i.sourceId })}</p>
            <div className="mt-3 flex gap-2">
              <button className="gbtn green sm flex-1" onClick={() => { dismissRematch(i.matchId); onClose(); useSocket.setState({ joinMatch: { matchId: i.matchId, team: i.team } }); }}>{t('rs.accept')}</button>
              <button className="gbtn ghost sm" onClick={() => dismissRematch(i.matchId)}>{t('rs.decline')}</button>
            </div>
          </motion.div>
        ))}
        {invites.map((i) => (
          <motion.div key={i.partyId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="panel min-w-0 p-3">
            <div className="panel-title">{t('invite.party')}</div>
            <div className="mt-1 break-words text-sm">
              <b className="text-violet">{i.fromName ?? shortAddr(i.from)}</b> {t('invite.body')}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="gbtn green sm flex-1"
                onClick={() => {
                  sfx.lockIn();
                  send({ t: 'party:join', partyId: i.partyId });
                  dismissInvite(i.partyId);
                  onClose();
                  router.push('/play');
                }}
              >
                {t('rs.accept')}
              </button>
              <button className="gbtn ghost sm" onClick={() => dismissInvite(i.partyId)}>
                {t('rs.decline')}
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
        </div>
      </div>
      </motion.div>}
    </AnimatePresence>, document.body,
  );
}
