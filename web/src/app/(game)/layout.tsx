import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';

/**
 * Everything that is the game: wallet, sockets, 3D stage, top bar. Kept out of the root layout so
 * the gate and shared-result pages don't ship the app's code to visitors without the access code.
 */
export const metadata: Metadata = {
  title: 'longshort.fun — PvP perp arena on Monad',
  description: 'Duel, squad up or survive the royale. Every trade is an onchain tx on Monad, priced by Perpl, settled by the ArenaCore contract.',
};

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
