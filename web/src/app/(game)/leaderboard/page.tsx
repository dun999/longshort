'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { fmtUsd, level, shortAddr, STAKE } from '@longshort/shared';
import { EnvioBadge, EnvioMark, envioLeaderboard, envioSync, useIndexed } from '@/lib/envio';
import { useScene } from '@/lib/scene';
import { PlayerMark } from '@/components/PlayerMark';
import { BackButton } from '@/components/ui/BackButton';
import { CornerArrow, NotchBlock, NotchChip, Pill } from '@/components/ui/Notch';
import { useWallet } from '@/lib/wallet';
import { PlayerSearch } from '@/components/PlayerSearch';

export default function Leaderboard() {
  const { data } = useIndexed<any[]>(envioLeaderboard, '/leaderboard', 10_000);
  const me = useWallet((s) => s.address?.toLowerCase());
  const [humans, setHumans] = useState(true); // labelled bots stay one tap away
  const rows = (data ?? []).filter((r) => !humans || !r.bot);
  const top = rows.slice(0, 3);
  const live = (data as any)?.source === 'envio';
  const leader = top[0];
  const { data: sync } = useIndexed<any>(envioSync, null, 4000);
  const best = (score: (r: any) => number) => rows.reduce<any>((m, r) => (score(r) > 0 && (!m || score(r) > score(m)) ? r : m), null);
  const insights = [
    { k: `Top earner · net ${STAKE}`, r: best((r) => r.earned), v: (r: any) => `+${r.earned.toFixed(2)} ${STAKE}` },
    { k: 'Biggest volume', r: best((r) => r.volume), v: (r: any) => fmtUsd(r.volume) },
    { k: 'Most matches', r: best((r) => r.matches), v: (r: any) => `${r.matches} · ${r.matches ? Math.round((r.wins / r.matches) * 100) : 0}% won` },
  ];
  useEffect(() => useScene.getState().set({ shot: 'backdrop', slots: [] }), []);

  return (
    <div className="ranks-page mx-auto grid grid-cols-[minmax(0,1fr)] max-w-5xl gap-4 px-4 py-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="panel-title">Season 0 · testnet</span>
            <EnvioBadge source={(data as any)?.source} />
          </div>
          <h1 className="font-display text-4xl font-bold tracking-[0.12em] uppercase">Ranks</h1>
        </div>
        <BackButton />
      </div>
      <div className="panel p-3"><PlayerSearch /></div>
      {data && (
        <div className="panel grid grid-cols-[minmax(0,1fr)] gap-3 p-4 sm:p-6">
          <NotchBlock
            tone="light"
            glow={live}
            className="px-6 pt-6 pb-4"
            chips={{
              tr: leader ? (
                <NotchChip tone="light" href={`/profile/${leader.addr}`} title="Open the leader's profile" className="h-12 w-14 justify-center">
                  <CornerArrow />
                </NotchChip>
              ) : undefined,
              bl: (
                <NotchChip tone="light" title="XP, wins and payouts are computed by Envio HyperIndex from Settled events">
                  <EnvioMark size={14} /> {live ? 'Ranked by Envio' : 'Keeper index · Envio offline'}
                </NotchChip>
              ),
            }}
          >
            <div className="pr-[var(--n-tr-w)] text-[10px] font-semibold tracking-[0.16em] text-black/55 uppercase">Season leader</div>
            {leader ? (
              <div className="flex flex-wrap items-center justify-center gap-5 py-6">
                <PlayerMark addr={leader.addr} size={88} />
                <div className="min-w-0 text-center sm:text-left">
                  <Link href={`/profile/${leader.addr}`} className={`rank-leader-name font-display block truncate text-4xl font-bold tracking-wide hover:underline sm:text-5xl ${leader.name ? 'uppercase' : ''}`}>
                    {leader.name ?? shortAddr(leader.addr)}
                  </Link>
                  <div className="num mt-1 text-sm text-black/60">
                    {leader.xp} XP · Lv {level(leader.xp)} · {leader.wins}W {leader.losses}L
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-black/60">No ranked matches yet. Win one to take the top spot.</div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:ml-[var(--n-bl-w)] sm:grid-cols-3 max-sm:mb-[var(--n-bl-h)]">
              {insights.map((x) => (
                <div key={x.k} className="min-w-0">
                  <div className="text-[10px] font-semibold tracking-[0.14em] text-black/55 uppercase">{x.k}</div>
                  {x.r ? (
                    <>
                      <div className="num truncate text-xl font-bold">{x.v(x.r)}</div>
                      <Link href={`/profile/${x.r.addr}`} className="block truncate text-[11px] text-black/60 hover:underline">
                        {x.r.name ?? shortAddr(x.r.addr)}
                      </Link>
                    </>
                  ) : (
                    <div className="text-[11px] text-black/50">no one yet</div>
                  )}
                </div>
              ))}
            </div>
          </NotchBlock>

          <NotchBlock
            tone="dark"
            glow={live}
            delay={0.12}
            className="px-6 pt-4 pb-6"
            chips={{
              tl: (
                <NotchChip tone="dark" className="h-12 justify-center">
                  <span className="num">{rows.length}</span> ranked
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
            <div className="text-[10px] font-semibold tracking-[0.16em] text-dim uppercase sm:ml-[var(--n-tl-w)] max-sm:mt-[var(--n-tl-h)]">Chasing the crown</div>
            {/* a podium, not a tie: #3 a step lower and smaller on the left, #2 higher and bigger on the right */}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start gap-4 py-6">
              {[3, 2].map((place) => {
                const r = top[place - 1];
                const second = place === 2;
                const color = second ? '#a3a8b0' : '#9a6b3f';
                return (
                  <div key={place} className={`flex min-w-0 flex-col items-center gap-1 text-center ${second ? '' : 'pt-8'}`}>
                    <span className={`font-display font-bold ${second ? 'text-5xl' : 'text-2xl'}`} style={{ color }}>
                      #{place}
                    </span>
                    {r ? (
                      <>
                        <PlayerMark addr={r.addr} size={second ? 72 : 44} />
                        <Link href={`/profile/${r.addr}`} className={`rank-runner-name max-w-full truncate font-semibold hover:text-gold ${second ? 'text-lg' : 'text-sm'}`}>
                          {r.name ?? shortAddr(r.addr)}
                        </Link>
                        <span className="num text-xs text-muted">
                          {r.xp} XP · {r.wins}W {r.losses}L
                        </span>
                      </>
                    ) : (
                      <span className={`grid place-items-center text-xs text-dim ${second ? 'h-[104px]' : 'h-[72px]'}`}>Open seat</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="notch-footer pr-[var(--n-br-w)] text-[11px] text-dim max-sm:mb-[var(--n-br-h)]">XP: +50 a win, −20 a loss (floor 1000), computed from Settled events.</div>
          </NotchBlock>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Pill on={humans} onClick={() => setHumans(true)}>
              Humans
            </Pill>
            <Pill on={!humans} onClick={() => setHumans(false)}>
              Include bots
            </Pill>
            <Pill>Season 0</Pill>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="font-semibold text-[var(--text)]">Pipeline:</span>
            {['Settled events', sync?.hyperSync ? 'Envio HyperSync' : 'Envio HyperIndex', 'XP & wins', 'this table'].map((x) => (
              <span key={x} className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" /> {x}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="rank-mobile grid gap-2" aria-label="Player rankings">
        {rows.map((r, i) => (
          <details key={r.addr} className={`rank-row panel ${r.addr === me ? 'border-violet' : ''}`}>
            <summary className="rank-summary">
              <span className="font-display text-lg font-bold text-dim">#{i + 1}</span>
              <div className="min-w-0">
                <Link href={`/profile/${r.addr}`} className="rank-player flex items-start gap-2 font-semibold hover:text-violet">
                  <PlayerMark addr={r.addr} size={24} className="shrink-0" />
                  <span>{r.name ?? shortAddr(r.addr)}{r.bot ? <small className="ml-2 text-dim">BOT</small> : null}</span>
                </Link>
                <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-violet">{r.xp} XP</span>
                  <span className="text-muted">{r.matches ? Math.round((r.wins / r.matches) * 100) : 0}% wins</span>
                </div>
              </div>
              <span className="rank-expand text-muted" aria-hidden>▾</span>
            </summary>
            <dl className="grid grid-cols-2 gap-3 border-t border-line p-3 text-xs">
              {[
                ['Level', level(r.xp)], ['Wins / losses', `${r.wins} / ${r.losses}`],
                ['Volume', fmtUsd(r.volume)], [`Net ${STAKE}`, `${r.earned >= 0 ? '+' : ''}${r.earned.toFixed(2)}`],
              ].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="num mt-1 break-words font-semibold">{value}</dd></div>)}
            </dl>
          </details>
        ))}
        {!rows.length && <div className="panel p-6 text-center text-sm text-muted">No ranked matches yet. Be the first.</div>}
      </div>
      <div className="rank-table-wrap panel overflow-x-auto p-2">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="panel-title text-left">
              {['#', 'Trader', 'Lvl', 'XP', 'W / L', 'Win %', 'Volume', `Net ${STAKE}`].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <motion.tr key={r.addr} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 20) * 0.02 }} className={`border-t border-line ${r.addr === me ? 'bg-violet/10' : ''}`}>
                <td className="font-display px-3 py-2 font-bold text-dim">{i + 1}</td>
                <td className="px-3 py-2">
                  <PlayerMark addr={r.addr} size={18} className="mr-2 inline-block align-middle" />
                  <Link href={`/profile/${r.addr}`} className="font-semibold hover:text-violet">
                    {r.name ?? shortAddr(r.addr)}
                  </Link>
                  {r.bot ? <span className="ml-2 border border-line px-1 text-[9px] text-dim">BOT</span> : null}
                </td>
                <td className="num px-3 py-2">{level(r.xp)}</td>
                <td className="num px-3 py-2 text-violet">{r.xp}</td>
                <td className="num px-3 py-2">
                  {r.wins} / {r.losses}
                </td>
                <td className="num px-3 py-2">{r.matches ? Math.round((r.wins / r.matches) * 100) : 0}%</td>
                <td className="num px-3 py-2 text-muted">{fmtUsd(r.volume)}</td>
                <td className={`num px-3 py-2 ${r.earned >= 0 ? 'up' : 'down'}`}>{r.earned >= 0 ? '+' : ''}{r.earned.toFixed(2)}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="p-6 text-center text-sm text-muted">No ranked matches yet. Be the first.</div>}
      </div>
    </div>
  );
}
