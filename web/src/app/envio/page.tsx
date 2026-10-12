import type { Metadata } from 'next';
import { requireGate } from '@/lib/gate-server';
import { GateSession } from '@/components/GateSession';
import { EnvioExplainer } from '@/components/envio/EnvioExplainer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'How Envio feeds the leaderboard · longshort.fun',
  description: 'Live: how Envio HyperIndex turns Monad events from the arena, Perpl and AUSD into the leaderboard, profiles, match reports and stats.',
};

/** envio.longshort.fun lands here: the same access session as the game, none of the game's code. */
export default async function EnvioPage() {
  const { expiresAt } = await requireGate('/envio');
  return (
    <>
      <GateSession expiresAt={expiresAt} />
      <EnvioExplainer />
    </>
  );
}
