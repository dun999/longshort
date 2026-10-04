import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { gateConfig, safeNext } from '@/lib/gate';
import { GateForm } from './GateForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'longshort.fun · private preview', robots: { index: false, follow: false } };

export default async function Gate({ searchParams }: { searchParams: Promise<{ next?: string; e?: string }> }) {
  const { next, e } = await searchParams;
  return (
    <main className="gate">
      <div className="gate-top">
        <Logo />
        <span className="gate-kicker">
          <i /> Season 0 · private preview
        </span>
      </div>

      <div className="gate-body">
        <h1 className="gate-title">
          <span>Out</span>
          <span>trade</span>
          <span className="outline">them.</span>
        </h1>
        <GateForm next={safeNext(next)} error={!!e} available={gateConfig().ready} />
      </div>

    </main>
  );
}
