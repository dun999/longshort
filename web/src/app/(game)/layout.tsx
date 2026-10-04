import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import { requireGate } from '@/lib/gate-server';
import { GateSession } from '@/components/GateSession';

export const dynamic = 'force-dynamic';

/**
 * Everything that is the game: wallet, sockets, 3D stage, top bar. Kept out of the root layout so
 * the gate and shared-result pages don't ship the app's code to visitors without the access code.
 */
export const metadata: Metadata = {
  title: 'longshort.fun — PvP perp arena on Monad',
  description: 'Duel, squad up or survive the royale. Every trade is an onchain tx on Monad, priced by Perpl, settled by the ArenaCore contract.',
};

export default async function GameLayout({ children }: { children: React.ReactNode }) {
  const { expiresAt } = await requireGate();
  return <><GateSession expiresAt={expiresAt} /><Providers>{children}</Providers></>;
}
