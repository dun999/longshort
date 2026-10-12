import type { Metadata } from 'next';
import { Saira_Extra_Condensed } from 'next/font/google';
import { requireGate } from '@/lib/gate-server';
import { GateSession } from '@/components/GateSession';
import { PitchDeck } from '@/components/pitch/PitchDeck';

export const dynamic = 'force-dynamic';

// the deck's display face, self-hosted like the app's own fonts
const display = Saira_Extra_Condensed({ subsets: ['latin'], weight: ['800'], variable: '--pitch-display' });

export const metadata: Metadata = {
  title: 'Pitch · longshort.fun',
  description: 'longshort.fun: PvP Bitcoin trading battles on Monad, with real Perpl orders, passkey accounts and gas paid for the player.',
};

export default async function PitchPage() {
  const { expiresAt } = await requireGate('/pitch');
  return (
    <div className={display.variable}>
      <GateSession expiresAt={expiresAt} />
      <PitchDeck />
    </div>
  );
}
