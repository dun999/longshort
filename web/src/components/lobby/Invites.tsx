'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { shortAddr } from '@longshort/shared';
import { useSocket } from '@/lib/socket';
import { sfx } from '@/lib/sfx';
import { useT } from '@/lib/i18n';

export function Invites() {
  const { invites, rematchInvites, send, dismissInvite } = useSocket();
  const t = useT();
  const dismissRematch = (id: number) => useSocket.setState({ rematchInvites: useSocket.getState().rematchInvites.filter((i) => i.matchId !== id) });
  const router = useRouter();
  useEffect(() => {
    if (invites.length) sfx.found();
  }, [invites.length]);
  return (
    <div className="fixed top-20 right-4 z-50 grid gap-2">
      <AnimatePresence>
        {rematchInvites.map((i) => (
          <motion.div key={`rematch-${i.matchId}`} initial={{ x: 300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 300, opacity: 0 }} className="panel w-72 p-4">
            <div className="panel-title">{t('rs.rematch')}</div>
            <p className="mt-1 text-sm">{t('rs.invite', { id: i.sourceId })}</p>
            <div className="mt-3 flex gap-2">
              <button className="gbtn green sm flex-1" onClick={() => { dismissRematch(i.matchId); useSocket.setState({ joinMatch: { matchId: i.matchId, team: i.team } }); }}>{t('rs.accept')}</button>
              <button className="gbtn ghost sm" onClick={() => dismissRematch(i.matchId)}>{t('rs.decline')}</button>
            </div>
          </motion.div>
        ))}
        {invites.map((i) => (
          <motion.div key={i.partyId} initial={{ x: 300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 300, opacity: 0 }} className="panel w-72 p-4">
            <div className="panel-title">Party invite</div>
            <div className="mt-1 text-sm">
              <b className="text-violet">{i.fromName ?? shortAddr(i.from)}</b> wants you on their squad.
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="gbtn green sm flex-1"
                onClick={() => {
                  sfx.lockIn();
                  send({ t: 'party:join', partyId: i.partyId });
                  dismissInvite(i.partyId);
                  router.push('/play');
                }}
              >
                Accept
              </button>
              <button className="gbtn ghost sm" onClick={() => dismissInvite(i.partyId)}>
                Decline
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
