'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet';
import { onChainEvent, startSocket, useSocket } from '@/lib/socket';
import { startAuth } from '@/lib/auth';
import { useScene } from '@/lib/scene';
import { TopBar } from './TopBar';
import { initLang } from '@/lib/i18n';
import { music } from '@/lib/music';
import { Invites } from './lobby/Invites';
import { DepositDialog } from './DepositDialog';
import { initSettings } from '@/lib/settings';
import { useWakeLock } from '@/lib/wakeLock';
import { startJourney } from '@/lib/journey';

const Stage = dynamic(() => import('./three/Stage'), { ssr: false });

/** Reading pages get the game sub-menu treatment: the 3D world blurs and darkens behind the content. */
const DIMMED = ['/stats', '/rules', '/profile', '/leaderboard', '/recover', '/demo'];

function Flash() {
  const flash = useScene((s) => s.flash);
  const shakeAt = useScene((s) => s.shakeAt);
  if (!flash) return null;
  return <div key={shakeAt} className="flash" style={{ background: `radial-gradient(circle, transparent 30%, ${flash})` }} />;
}

function Toast() {
  const toast = useSocket((s) => s.toast);
  useEffect(() => {
    startJourney();
    if (!toast) return;
    const t = setTimeout(() => useSocket.setState({ toast: undefined }), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          role="status"
          aria-live="polite"
          className="app-toast panel fixed left-1/2 z-50 -translate-x-1/2 px-4 py-3 text-sm"
        >
          {toast}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [invitesOpen, setInvitesOpen] = useState(false);
  const address = useWallet((s) => s.address);
  const joinMatch = useSocket((s) => s.joinMatch);
  const router = useRouter();
  const path = usePathname();
  useWakeLock(path === '/play' || path === '/practice' || /^\/match\/\d+\/?$/.test(path));
  const dimmed = DIMMED.some((p) => path.startsWith(p)) || path.endsWith('/report');
  // the fight HUD and the result screen sit on a plain, solid background
  const off = useScene((s) => s.shot === 'arena' || s.shot === 'result');
  useEffect(() => {
    startSocket();
    startAuth();
    void useWallet.getState().restore().catch(() => {});
    initLang();
    initSettings();
  }, []);
  // soundtrack: the match track from the VS screen through the fight, menu music elsewhere
  useEffect(() => {
    music.arm();
  }, []);
  useEffect(
    () =>
      useScene.subscribe((s) => {
        music.setTrack(s.shot === 'vs' || s.shot === 'arena' ? 'match' : 'menu');
        music.setIntensity(s.intensity);
      }),
    [],
  );
  useEffect(() => useSocket.getState().hello(address?.toLowerCase()), [address]);
  useEffect(()=>onChainEvent((e)=>{
    if (['TradingAccountCreated','PlayerLeft','CollateralReturned','Settled','Cancelled'].includes(e.name)) void useWallet.getState().refresh();
  }),[]);
  // the keeper sent us to a lobby (party leader seated there) → follow; the match screen takes the seat
  useEffect(() => {
    if (joinMatch && path !== `/match/${joinMatch.matchId}`) router.push(`/match/${joinMatch.matchId}`);
  }, [joinMatch, path, router]);
  return (
    <>
      {/* the landing page brings its own lightweight figures canvas; one WebGL context per page */}
      {path !== '/' && (
        <div className={`stage-wrap ${dimmed ? 'dimmed' : ''} ${off ? 'off' : ''}`}>
          <Stage />
        </div>
      )}
      <div className="scanlines" />
      <Flash />
      <div className="ui flex flex-col">
        <TopBar onInvites={() => setInvitesOpen(true)} />
        <main className="relative flex-1 pe-none [&>*]:pointer-events-auto">{children}</main>
      </div>
      <Invites open={invitesOpen} onClose={() => setInvitesOpen(false)} />
      <DepositDialog />
      <Toast />
    </>
  );
}
