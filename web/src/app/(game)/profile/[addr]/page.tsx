'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { MODES, Mode, explorerAddr, explorerTx, fmtUsd, level, levelProgress, shortAddr, STAKE } from '@longshort/shared';
import { api, useApi } from '@/lib/api';
import { EnvioBadge, envioProfile, useIndexed } from '@/lib/envio';
import { useScene } from '@/lib/scene';
import { useWallet } from '@/lib/wallet';
import { PlayerMark } from '@/components/PlayerMark';
import { BackButton } from '@/components/ui/BackButton';

export default function Profile({ params }: { params: Promise<{ addr: string }> }) {
  const { addr } = use(params);
  const { data, reload } = useApi<any>(`/profile/${addr}`, 10_000);
  const { data: ix } = useIndexed<any>(() => envioProfile(addr), null, 10_000, `profile:${addr.toLowerCase()}`);
  const { address, disconnect } = useWallet();
  const mine = address?.toLowerCase() === addr.toLowerCase();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string>();
  const [saving, setSaving] = useState(false);
  const p = data?.profile;
  useEffect(() => useScene.getState().set({ shot: 'backdrop', slots: [] }), []);

  const save = async () => {
    if (!address || saving) return;
    setSaving(true); setMsg(undefined);
    try {
      await useWallet.getState().ensureUnlocked();
      const { main, address: current } = useWallet.getState();
      if (!main || current !== address) throw new Error('Account changed. Sign in again.');
      const ts = Math.floor(Date.now() / 1000);
      const sig = await main.signMessage({ account: main.account ?? address, message: `longshort.fun name:${name} ts:${ts}` });
      await api('/profile', { addr: address, name, ts, sig });
      setMsg('Saved');
      reload();
    } catch (e) {
      setMsg((e as Error).message.split('\n')[0]);
    } finally { setSaving(false); }
  };

  const xp = p?.xp ?? 1000;
  return (
    <div className="profile-page mx-auto grid grid-cols-[minmax(0,1fr)] max-w-5xl gap-4 px-4 py-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="panel-title">{mine ? 'Your profile' : 'Player profile'}</div>
          <h1 className="font-display text-3xl font-bold tracking-[0.12em] uppercase">Profile</h1>
        </div>
        <BackButton />
      </div>
      <div className="profile-card panel flex flex-wrap items-center gap-6 p-5">
        <div className="profile-avatar relative">
          <PlayerMark addr={addr} size={72} />
          <span className="hex absolute -right-2 -bottom-2 scale-125" title={`Level ${level(xp)}`}>
            {level(xp)}
          </span>
        </div>
        <div className="profile-identity min-w-0 flex-1 sm:min-w-[220px]">
          <div className="profile-name font-display text-3xl font-bold tracking-wide">
            {p?.name ?? shortAddr(addr)} {p?.bot ? <span className="text-sm text-dim">BOT</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={explorerAddr(addr)} target="_blank" rel="noreferrer" className="num link text-xs" title={addr}>{shortAddr(addr)} ↗</a>
            <button className="profile-copy chip justify-center" aria-label="Copy address" title="Copy address" onClick={() => void navigator.clipboard?.writeText(addr)}>⧉</button>
          </div>
          <div className="bar mt-2 max-w-xs">
            <i style={{ width: `${levelProgress(xp) * 100}%` }} />
          </div>
          <div className="num mt-1 text-[11px] text-dim">
            {xp} XP · rank #{data?.rank ?? '–'}
          </div>
        </div>
        <div className="profile-metrics">
        {[
          ['Matches', p?.matches ?? 0],
          ['Wins', p?.wins ?? 0],
          ['Volume', fmtUsd(p?.volume ?? 0)],
          [`Net ${STAKE}`, (p?.earned ?? 0).toFixed(2)],
        ].map(([k, v]) => (
          <div key={k as string}>
            <div className="panel-title">{k}</div>
            <div className="num text-xl font-bold">{v}</div>
          </div>
        ))}
        </div>
      </div>
      {mine && (
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <span className="panel-title">Callsign</span>
          <input aria-label="Callsign" value={name} disabled={saving} onChange={(e) => setName(e.target.value)} placeholder={p?.name ?? 'pick a name'} maxLength={20} className="border border-line bg-black/30 px-3 py-2 text-sm outline-none focus:border-violet" />
          <button className="gbtn sm" onClick={save} disabled={saving || !/^[\w .·-]{2,20}$/.test(name) || /^bot/i.test(name)}>
            {saving ? 'Saving…' : 'Save callsign'}
          </button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
          <button className="ml-auto text-xs text-dim hover:text-red" onClick={disconnect}>
            Sign out
          </button>
        </div>
      )}
      <div className="panel min-w-0 p-2">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="panel-title">Match history · verified onchain</span>
          <EnvioBadge source={ix?.source} />
        </div>
        <p className="table-scroll-cue px-3 pb-2">Swipe to see all match details →</p>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {(ix?.matches ?? data?.matches ?? []).map((m: any) => (
              <tr key={m.id} className="border-t border-line">
                <td className="history-id px-3 py-2">
                  <Link href={m.state === 2 ? `/match/${m.id}/report` : `/match/${m.id}`} className="hover:text-violet">
                    #{m.id}
                  </Link>
                </td>
                <td className="font-display px-3 py-2 tracking-wider uppercase">{MODES[m.mode as Mode].name}</td>
                <td className="num px-3 py-2 text-muted">{m.leverage}x</td>
                <td className={`font-display px-3 py-2 font-bold uppercase ${m.result === 'win' ? 'text-gold' : m.result === 'loss' ? 'text-red' : 'text-muted'}`}>{m.result ?? (m.state === 1 ? 'live' : m.state === 0 ? 'lobby' : m.state === 3 ? 'refunded' : '…')}</td>
                <td className="num px-3 py-2">{m.final_equity ? fmtUsd(m.final_equity) : ''}</td>
                <td className="num px-3 py-2 text-gold">{m.payout ? `+${m.payout.toFixed(2)}` : ''}</td>
                <td className={`num px-3 py-2 ${m.xp_delta >= 0 ? 'up' : 'down'}`}>{m.result ? `${m.xp_delta >= 0 ? '+' : ''}${m.xp_delta} XP` : ''}</td>
                <td className="px-3 py-2 text-right">
                  {m.settle_tx && (
                    <a href={explorerTx(m.settle_tx)} target="_blank" rel="noreferrer" className="link text-xs">
                      tx ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!(ix?.matches ?? data?.matches)?.length && <div className="p-6 text-center text-sm text-muted">No matches yet.</div>}
      </div>
    </div>
  );
}
