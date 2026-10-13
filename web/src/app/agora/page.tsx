import type { Metadata } from 'next';
import { requireGate } from '@/lib/gate-server';
import { GateSession } from '@/components/GateSession';
import { AgoraExplainer } from '@/components/agora/AgoraExplainer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Passkey, AUSD and Perpl in one round · longshort.fun',
  description: 'One real match, step by step: a Mera passkey account, AUSD as the only balance, and BTC orders on Perpl without a wallet, gas or a Perpl account.',
};

/** The Agora track explainer: the same access session as the game, none of the game's code. */
export default async function AgoraPage() {
  const { expiresAt } = await requireGate('/agora');
  return (
    <>
      <GateSession expiresAt={expiresAt} />
      <AgoraExplainer />
    </>
  );
}
