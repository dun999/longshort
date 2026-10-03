'use client';
import Link from 'next/link';
import { useState } from 'react';
import { explorerAddr } from '@longshort/shared';
import { formatUnits } from 'viem';
import { useWallet } from '@/lib/wallet';
import { useApi } from '@/lib/api';
import { authed } from '@/lib/auth';
import { friendly } from '@/lib/errors';

export default function RecoverAccount() {
  const { address, kind, connecting, error, usd, connectGuest, connectInjected, disconnect } = useWallet();
  const { data, reload } = useApi<{ matches: { id: number; state: number }[] }>(address ? `/profile/${address}` : null, 5000);
  const [pending, setPending] = useState<number>();
  const [message, setMessage] = useState<string>();
  const recover = async (id: number) => {
    setPending(id); setMessage(undefined);
    try { const result = await authed<{ pending: boolean }>('/recover', { id }); await useWallet.getState().refresh(); reload(); setMessage(result.pending ? 'The position is still closing. Try recovery again shortly.' : 'Recovery confirmed. Your balance is updated.'); }
    catch (e) { setMessage(friendly(e)); }
    finally { setPending(undefined); }
  };
  return <main className="mx-auto grid max-w-2xl gap-4 px-4 py-8">
    <div className="panel grid gap-3 p-5">
      <div className="panel-title">Existing accounts</div>
      <h1 className="font-display text-3xl font-bold uppercase">Recover your account</h1>
      <p className="text-sm leading-relaxed text-muted">Live matches use a Mera passkey, or a guest account kept in this browser. If you played with a browser wallet, you can still view its balance, finish an active round, and return remaining trading capital here.</p>
      <p className="text-xs text-dim">A guest account lives only in the browser that holds its key, so export the key from the account menu to keep it. Passkey accounts recover with the passkey on any device.</p>
      <div className="flex flex-wrap gap-2">
        <button className="gbtn ghost sm" disabled={connecting} onClick={() => void connectGuest()}>Open guest in this browser</button>
        <button className="gbtn ghost sm" disabled={connecting} onClick={() => void connectInjected({ legacy: true })}>Open existing wallet</button>
      </div>
      {error && <p role="alert" className="text-xs text-red">{error}</p>}
      <Link href="/play" className="link text-xs" onClick={() => { if (kind !== 'passkey') disconnect(); }}>Play with a passkey →</Link>
    </div>
    {address && <section className="panel grid gap-3 p-5">
      <a href={explorerAddr(address)} target="_blank" rel="noreferrer" className="num break-all text-xs text-muted underline">{address} ↗</a>
      <div className="num text-2xl">{formatUnits(usd, 6)} AUSD</div>
      <Link href={`/profile/${address}`} className="link text-xs">View account history →</Link>
      {data?.matches.map((match) => <div key={match.id} className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-sm">
        <Link className="link" href={match.state === 2 || match.state === 3 ? `/match/${match.id}/report` : `/match/${match.id}`}>Match #{match.id} · {match.state === 2 ? 'settled' : match.state === 3 ? 'cancelled' : 'active'}</Link>
        {(match.state === 2 || match.state === 3) && <button className="gbtn ghost sm ml-auto" disabled={pending !== undefined} onClick={() => void recover(match.id)}>{pending === match.id ? 'Recovering…' : 'Return trading capital'}</button>}
      </div>)}
      {message && <p role="status" className="text-xs text-muted">{message}</p>}
    </section>}
  </main>;
}
