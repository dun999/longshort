'use client';
import Link from 'next/link';
import { explorerTx } from '@longshort/shared';
import { journeyEvidence, useJourney } from '@/lib/journey';
import { useWallet } from '@/lib/wallet';
import { describeKeys } from '@/lib/mera';

export default function DemoEvidence() {
  const journey = useJourney();
  const { address, locked } = useWallet();
  const first = journey.receipts.find((r) => r.kind === 'approval' || r.kind === 'entry');
  const entry = journey.receipts.find((r) => r.kind === 'entry');
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...journeyEvidence(), owner: address, signingKeys: describeKeys() }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'longshort-demo-evidence.json'; link.click(); URL.revokeObjectURL(url);
  };
  return <main className="mx-auto grid max-w-3xl gap-4 px-4 py-8">
    <section className="panel grid gap-3 p-5">
      <div className="panel-title">Live demo evidence</div>
      <h1 className="font-display text-3xl font-bold uppercase">From landing to confirmation</h1>
      <p className="text-xs leading-relaxed text-muted">This tab measures elapsed time from its page navigation, trusted control activations, and actual WebAuthn ceremonies. Funding is a separate transfer. The first owner-authorized transaction is an approval or entry with a successful receipt.</p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <dt className="text-muted">First owner transaction</dt><dd className="num">{first ? `${(first.elapsedMs / 1000).toFixed(2)}s · ${first.actions} actions · ${first.ceremonies} ceremonies` : 'Awaiting confirmed transaction'}</dd>
        <dt className="text-muted">First Duel entry</dt><dd className="num">{entry ? `${(entry.elapsedMs / 1000).toFixed(2)}s · ${entry.actions} actions · ${entry.ceremonies} ceremonies` : 'Awaiting confirmed entry'}</dd>
        <dt className="text-muted">Account</dt><dd className="num break-all text-xs">{address ?? 'Signed out'}{address ? locked ? ' · locked' : ' · unlocked' : ''}</dd>
        <dt className="text-muted">Ceremonies in this tab</dt><dd>{journey.ceremonies.length} attempted · {journey.ceremonies.filter((c) => c.completed).length} completed</dd>
      </dl>
      <p className="text-[11px] text-dim">A WebAuthn API call can display multiple OS sheets. Record visible biometric prompts separately. Measurements restart after a reload; download evidence before clearing storage.</p>
      <button className="gbtn ghost sm justify-self-start" onClick={download}>Download public demo evidence</button>
    </section>
    <section className="panel grid gap-3 p-5">
      <h2 className="panel-title">Confirmed receipts in this tab</h2>
      {journey.receipts.length ? journey.receipts.map((r) => <a key={r.hash} href={explorerTx(r.hash)} target="_blank" rel="noreferrer" className="num break-all border-t border-line pt-3 text-xs text-muted underline">{r.kind}{r.matchId ? ` · match #${r.matchId}` : ''} · {(r.elapsedMs / 1000).toFixed(2)}s · {r.hash} ↗</a>) : <p className="text-xs text-muted">No successful receipts captured yet.</p>}
    </section>
    <section className="panel grid gap-3 p-5">
      <h2 className="panel-title">Stateless recovery check</h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
        <li>Download this tab’s evidence after creating an account, claiming AUSD, and entering a Duel.</li>
        <li>During the round, clear browser storage and reload. Sign in using the same passkey and reopen the match from its URL.</li>
        <li>Check the owner, balance and position, then confirm another trade. Confirm long, short and close add no ceremonies while unlocked.</li>
        <li>Save a private journal in your match report. Open a fresh browser profile on longshort.fun, use the same synced passkey, and read the saved note.</li>
        <li>Compare public history and receipts. Verify a later entry asks again and that cancelling verification leaves the live position visible.</li>
      </ol>
      <Link href="/play" className="link text-xs">Return to Duel →</Link>
    </section>
  </main>;
}
