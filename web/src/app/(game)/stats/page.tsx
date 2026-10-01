'use client';
import { useEffect, useState } from 'react';
import { ADDR, MODES, Mode, REAL_TRADING, explorerAddr, fmtUsd, STAKE } from '@longshort/shared';
import { useApi } from '@/lib/api';
import { EnvioBadge, EnvioMark, envioStats, envioSync, useIndexed } from '@/lib/envio';
import { useScene } from '@/lib/scene';
import { BackButton } from '@/components/ui/BackButton';
import { CornerArrow, NotchBlock, NotchChip, Pill } from '@/components/ui/Notch';

const amt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

function Stat({ k, v, sub, tone }: { k: string; v: React.ReactNode; sub?: string; tone: 'light' | 'dark' }) {
  return (
    <div className="min-w-0">
      <div className={`text-[10px] font-semibold tracking-[0.14em] uppercase ${tone === 'light' ? 'text-black/55' : 'text-dim'}`}>{k}</div>
      <div className="num truncate text-2xl font-bold">{v}</div>
      {sub && <div className={`truncate text-[11px] ${tone === 'light' ? 'text-black/55' : 'text-dim'}`}>{sub}</div>}
    </div>
  );
}

function DailyBars({ rows }: { rows: { d: string; trades: number; volume: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = [...rows].reverse();
  const max = Math.max(1, ...data.map((r) => r.trades));
  return (
    <div className="panel p-5">
      <div className="panel-title">Onchain trades per hour · last 24h (UTC)</div>
      <div className="relative mt-4 flex h-44 items-end gap-[2px] border-b border-line">
        {data.map((r, i) => (
          <div key={r.d} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="w-full rounded-t-[4px] transition-colors" style={{ height: `${(r.trades / max) * 100}%`, background: hover === i ? '#c9d3e6' : '#6f82a8', maxWidth: 48 }} />
            {hover === i && (
              <div className="panel absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 px-3 py-2 text-xs whitespace-nowrap">
                <div className="text-muted">{r.d}</div>
                <div className="num text-white">{r.trades} trades</div>
                <div className="num text-muted">{fmtUsd(r.volume)} notional</div>
              </div>
            )}
          </div>
        ))}
        {!data.length && <div className="m-auto text-sm text-dim">No trades yet</div>}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-dim">
        <span>{data[0]?.d}</span>
        <span>{data.at(-1)?.d}</span>
      </div>
    </div>
  );
}

export default function Stats() {
  const { data: s } = useApi<any>('/stats', 4000);
  const { data: e } = useIndexed<any>(envioStats, null, 5000);
  const { data: sync } = useIndexed<any>(envioSync, null, 4000);
  const live = e?.source === 'envio';
  useEffect(() => useScene.getState().set({ shot: 'backdrop', slots: [] }), []);
  const byMode = e?.byMode ?? s?.byMode ?? [];
  const staked = e?.staked ?? s?.escrow ?? 0;

  return (
    <div className="mx-auto grid grid-cols-[minmax(0,1fr)] max-w-6xl gap-4 px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="panel-title">Public, from the ArenaCore event index</span>
            <EnvioBadge source={e?.source} />
          </div>
          <h1 className="font-display text-4xl font-bold tracking-[0.12em] uppercase">Arena stats</h1>
        </div>
        <BackButton />
      </div>

      {s && (
        <div className="panel grid grid-cols-[minmax(0,1fr)] gap-3 p-4 sm:p-6">
          <NotchBlock
            tone="light"
            glow={live}
            className="px-6 pt-6 pb-4"
            chips={{
              tr: (
                <NotchChip tone="light" href={explorerAddr(ADDR.arena)} title="ArenaCore on the Monad explorer" className="h-12 w-14 justify-center">
                  <CornerArrow />
                </NotchChip>
              ),
              bl: (
                <NotchChip tone="light" title="Every number in this card comes from Envio HyperIndex">
                  <EnvioMark size={14} /> {live ? 'Indexed by Envio' : 'Keeper index · Envio offline'}
                </NotchChip>
              ),
            }}
          >
            <div className="pr-[var(--n-tr-w)] text-[10px] font-semibold tracking-[0.16em] text-black/55 uppercase">Matches settled onchain</div>
            <div className="grid place-items-center py-6 text-center">
              <div className="num text-7xl leading-none font-bold sm:text-8xl">{(e?.settled ?? s.settled).toLocaleString()}</div>
              <div className="mt-2 text-xs text-black/60">every one paid out by the contract, no operator in the loop</div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:ml-[var(--n-bl-w)] sm:grid-cols-3 max-sm:mb-[var(--n-bl-h)]">
              <Stat tone="light" k="Onchain trades" v={(e?.trades ?? s.trades).toLocaleString()} sub={`${s.trades24h} in the last 24h`} />
              <Stat tone="light" k="Paid out" v={`${amt(e?.paidOut ?? s.paidOut ?? 0)} ${STAKE}`} sub={`rake ${(e?.rake??s.rake??0).toFixed(2)} ${STAKE}`} />
              <Stat tone="light" k={REAL_TRADING?'Perpl notional':'Virtual notional'} v={fmtUsd(e?.volume ?? s.volume)} sub={`human: ${fmtUsd(s.humanVolume)}`} />
            </div>
          </NotchBlock>

          <NotchBlock
            tone="dark"
            glow={live}
            delay={0.12}
            className="px-6 pt-4 pb-6"
            chips={{
              tl: (
                <NotchChip tone="dark" title="Matches being played right now" className="h-12 min-w-14 justify-center">
                  <span className={`h-2 w-2 rounded-full ${s.live ? 'bg-green' : 'bg-[var(--dim)]'}`} /> {s.live} live
                </NotchChip>
              ),
              br: (
                <NotchChip tone="dark" title="Envio's indexer progress against the chain head">
                  <EnvioMark size={14} className="text-gold" />
                  {sync?.block ? (
                    <span className="num">
                      {sync.hyperSync ? 'HyperSync' : 'RPC'} · block {sync.block.toLocaleString()}
                      {sync.head - sync.block > 2 ? ` (${(sync.head - sync.block).toLocaleString()} behind)` : ' · in sync'}
                    </span>
                  ) : (
                    <span>sync status unavailable</span>
                  )}
                </NotchChip>
              ),
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:ml-[var(--n-tl-w)] sm:grid-cols-3 max-sm:mt-[var(--n-tl-h)]">
              <Stat tone="dark" k="Traders" v={e?.players ?? s.wallets + s.bots} sub={`${s.wallets} human · ${s.bots} labelled bots`} />
              <Stat tone="dark" k="Liquidations" v={e?.liquidations ?? s.liquidations} sub={e ? `${e.eliminations} royale eliminations` : undefined} />
              <Stat tone="dark" k="Matches created" v={e?.matches ?? s.matches} sub={`${s.txs.toLocaleString()} onchain txs in total`} />
            </div>
            <div className="grid place-items-center py-6 text-center">
              <div className="num text-6xl leading-none font-bold text-gold sm:text-7xl">
                {amt(staked + (e?.paidOut ?? 0) + (e?.rake ?? 0))}
                <span className="ml-2 text-3xl">{STAKE}</span>
              </div>
              <div className="mt-2 text-xs text-dim">
                staked into the arena · {amt(staked)} {STAKE} in escrow right now
              </div>
            </div>
            <div className="pr-[var(--n-br-w)] text-[11px] text-dim max-sm:mb-[var(--n-br-h)]">
              Contract{' '}
              <a className="link num" href={explorerAddr(ADDR.arena)} target="_blank" rel="noreferrer">
                {ADDR.arena.slice(0, 10)}…
              </a>{' '}
              on chain {ADDR.chainId}
            </div>
          </NotchBlock>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {[Mode.DUEL, Mode.SQUAD, Mode.ROYALE].map((m) => (
              <Pill key={m}>
                {MODES[m].name} · {byMode.find((b: any) => b.mode === m)?.n ?? 0}
              </Pill>
            ))}
            <Pill>{e?.cancelled ?? 0} cancelled</Pill>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="font-semibold text-[var(--text)]">Pipeline:</span>
            {['ArenaCore events', sync?.hyperSync ? 'Envio HyperSync' : 'Envio HyperIndex', 'GraphQL', 'this page'].map((x) => (
              <span key={x} className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" /> {x}
              </span>
            ))}
          </div>
        </div>
      )}
      {s && <DailyBars rows={s.daily} />}
    </div>
  );
}
