'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { shortAddr } from '@longshort/shared';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

interface Player { addr: string; name: string | null; bot: number }

/** Server search includes unranked and offline players; wallet addresses disambiguate names. */
export function PlayerSearch({ online = [], me, onInvite, sent = [] }: { online?: string[]; me?: string; onInvite?: (addr: string) => void; sent?: string[] }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Player[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('ready');
  const addresses = online.filter((a) => a !== me).join(',');
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setRows([]);
    const timer = setTimeout(() => {
      const path = query.trim() ? `/profiles?q=${encodeURIComponent(query.trim())}` : `/profiles?addresses=${addresses}`;
      api<Player[]>(path).then((data) => {
        if (!cancelled) { setRows(data.filter((p) => p.addr !== me)); setState('ready'); }
      }, () => { if (!cancelled) setState('error'); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, addresses, me]);
  return (
    <div className="grid min-h-0 gap-2">
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('pt.search')} aria-label={t('pt.search')} maxLength={42} className="w-full min-w-0 border border-line bg-black/30 px-2 py-2 text-sm outline-none focus:border-violet" />
      <div className="scroll-thin grid max-h-52 gap-2 overflow-y-auto" aria-live="polite">
        {state !== 'ready' && <span className="text-xs text-dim">{t(state === 'loading' ? 'pt.searching' : 'pt.searchError')}</span>}
        {state === 'ready' && !rows.length && query.trim() && <span className="text-xs text-dim">{t('pt.noResults')}</span>}
        {rows.map((p) => (
          <div key={p.addr} className="flex min-w-0 items-center gap-2 text-sm">
            <span className={`h-2 w-2 shrink-0 rounded-full ${online.includes(p.addr) ? 'bg-green' : 'bg-gray-600'}`} />
            <Link href={`/profile/${p.addr}`} className="min-w-0 hover:text-violet" title={p.addr}>
              <span className="block truncate">{p.name ?? shortAddr(p.addr)} {p.bot ? '· BOT' : ''}</span>
              <span className="num block text-[10px] text-dim">{shortAddr(p.addr)}</span>
            </Link>
            {onInvite && me && !p.bot && (online.includes(p.addr) ? (
              <button className="chip ml-auto shrink-0 text-[10px]!" disabled={sent.includes(p.addr)} onClick={() => onInvite(p.addr)}>{t(sent.includes(p.addr) ? 'pt.sent' : 'pt.inviteBtn')}</button>
            ) : <span className="ml-auto text-[10px] text-dim">{t('pt.offline')}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}
