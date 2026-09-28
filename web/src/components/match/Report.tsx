'use client';
import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { ColorType, LineSeries, LineStyle, createChart, type UTCTimestamp } from 'lightweight-charts';
import { CLASSES, MARGIN, MARKETS, MODES, Mode, STAKE, classOf, explorerTx, fmtPx, fmtUsd, shortAddr } from '@longshort/shared';
import { EnvioBadge, envioMatch, useIndexed } from '@/lib/envio';
import { useWallet } from '@/lib/wallet';
import { useScene, TEAM_COLOR } from '@/lib/scene';
import { lastLeverage, quickPlay } from '@/lib/actions';
import { sfx } from '@/lib/sfx';
import { PlayerMark } from '../PlayerMark';
import { PanelHeader } from '../ui/Hint';
import { BackButton } from '../ui/BackButton';
import { awards, compute, type Row, type Stats } from '@/lib/matchStats';

const LINE = ['#e7e1d3', '#6f8fd0', '#cf8a52', '#4aa37c', '#c46a5e', '#b3a27a', '#8f7fc4', '#6f9fc0'];

function EquityChart({ stats }: { stats: Stats[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || !stats.length) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8a909a', fontFamily: 'var(--font-jet)', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.035)' } },
      rightPriceScale: { borderColor: '#242831' },
      timeScale: { borderColor: '#242831', timeVisible: true, secondsVisible: true },
      handleScroll: false,
      handleScale: false,
    });
    stats.forEach((s, i) => {
      const line = c.addSeries(LineSeries, { color: LINE[i % LINE.length], lineWidth: 2, lineType: 1, title: s.name.replace(/^bot·/, ''), priceLineVisible: false });
      // one point per second, strictly increasing
      const pts = new Map<number, number>();
      for (const p of s.curve) pts.set(p.time, p.value);
      line.setData([...pts].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
      if (i === 0) line.createPriceLine({ price: MARGIN, color: '#626873', lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'start', axisLabelVisible: false });
    });
    c.timeScale().fitContent();
    return () => c.remove();
  }, [stats]);
  return <div ref={el} className="h-[260px] w-full" />;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function Report({ id }: { id: number }) {
  const { data } = useIndexed<{ match: any; players: any[]; trades: Row[] }>(() => envioMatch(id), `/match/${id}`);
  const me = useWallet((s) => s.address?.toLowerCase());
  const router = useRouter();
  useEffect(() => useScene.getState().set({ shot: 'backdrop', slots: [] }), []);
  const stats = useMemo(() => (data?.match ? compute(data.match, data.players, data.trades) : []), [data]);
  if (!data?.match) return <div className="grid h-[60vh] place-items-center font-display tracking-[0.4em] text-muted uppercase">Loading report #{id}…</div>;

  const m = data.match;
  const mode = m.mode as Mode;
  const pot = m.entry * data.players.length;
  const mine = stats.find((s) => s.addr === me);
  const ranked = [...stats].sort((a, b) => b.payout - a.payout || b.finalEquity - a.finalEquity);
  const start = m.start_at ?? data.trades[0]?.ts ?? 0;
  const awardList = awards(stats);
  const outcome = !mine ? null : mine.result === 'win' ? 'Victory' : mine.result === 'loss' ? 'Defeat' : mine.result === 'draw' ? 'Draw' : null;
  const again = async () => {
    sfx.click();
    const next = await quickPlay(mode, m.entry, lastLeverage()).catch(() => null);
    router.push(next ? `/match/${next}` : '/play');
  };

  return (
    <div className="mx-auto grid grid-cols-[minmax(0,1fr)] max-w-6xl gap-3 px-4 py-6">
      {/* header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="panel-title">Match report · #{m.id}</span>
            <EnvioBadge source={data.source} />
          </div>
          <div className="font-display text-3xl font-bold tracking-[0.1em] uppercase">
            {MODES[mode].name}
            {outcome && <span className={`ml-3 ${outcome === 'Victory' ? 'text-gold' : outcome === 'Defeat' ? 'text-red' : 'text-muted'}`}>· {outcome}</span>}
          </div>
          <div className="num text-[11px] text-dim">{m.start_at ? new Date(m.start_at * 1000).toLocaleString() : ''}</div>
        </div>
        {[
          ['Players', data.players.length],
          ['Length', `${m.duration}s`],
          ['Pot', `${pot} ${STAKE}`],
          ['Rake', `${(m.rake ?? 0).toFixed(2)} ${STAKE}`],
          ['Onchain trades', data.trades.filter((t) => t.kind === 'open').length],
        ].map(([k, v]) => (
          <div key={k as string}>
            <div className="panel-title">{k}</div>
            <div className="num text-lg font-semibold">{v}</div>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {m.settle_tx && (
            <a className="gbtn ghost sm" href={explorerTx(m.settle_tx)} target="_blank" rel="noreferrer">
              Settlement tx ↗
            </a>
          )}
          <button className="btn-play sm" onClick={again}>
            Play again
          </button>
          <BackButton />
        </div>
      </motion.div>

      {/* standings + equity curve */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="panel grid content-start gap-2 p-3">
          <PanelHeader title="Standings" sub="paid by the contract" hint="Final order after settlement. Payouts were transferred onchain by ArenaCore in the settlement transaction." />
          {ranked.map((s, i) => (
            <div key={s.addr} className={`flex items-center gap-2 border px-2 py-1.5 ${s.addr === me ? 'border-[var(--line-hi)] bg-[var(--panel-hi)]' : 'border-line'}`}>
              <span className="font-display w-5 text-center font-bold text-dim">{i + 1}</span>
              <PlayerMark addr={s.addr} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">
                  {s.name} {s.addr === me && <span className="text-[9px] text-[var(--accent)]">YOU</span>} {s.bot && <span className="text-[9px] text-dim">BOT</span>}
                </div>
                <div className="text-[10px] tracking-wider text-dim uppercase">
                  {mode !== Mode.ROYALE && <span style={{ color: TEAM_COLOR[s.team] }}>{s.team ? 'Bravo' : 'Alpha'} · </span>}
                  {CLASSES[classOf(s.leverage)].name} {s.leverage}x{s.out ? ` · ${s.out}` : ''}
                </div>
              </div>
              <div className="num text-right text-[12px]">
                <div className={s.finalEquity >= MARGIN ? 'up' : 'down'}>{fmtUsd(s.finalEquity - MARGIN, true)}</div>
                <div className={s.payout ? 'text-gold' : 'text-dim'}>
                  {s.payout ? `+${s.payout.toFixed(2)}` : '0'} {STAKE}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="panel grid content-start gap-2 p-3">
          <PanelHeader title="Equity over time" sub="realized, from onchain events" hint="Each line is a player's equity (1,000 starting margin plus realized PnL minus fees), stepping at every close. The dashed line is the starting 1,000." />
          <EquityChart stats={stats} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {stats.map((s, i) => (
              <span key={s.addr} className="flex items-center gap-1.5">
                <i className="inline-block h-[3px] w-4" style={{ background: LINE[i % LINE.length] }} />
                {s.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* awards */}
      {awardList.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {awardList.map((a, i) => (
            <motion.div key={a.k} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }} className="panel flex items-center gap-3 p-3" style={{ boxShadow: 'inset 3px 0 0 var(--gold)' }}>
              <PlayerMark addr={a.who.addr} size={40} />
              <div className="min-w-0">
                <div className="font-display text-sm font-bold tracking-[0.12em] text-gold uppercase">{a.k}</div>
                <div className="truncate text-[12px]">{a.who.name}</div>
                <div className="text-[10px] text-dim">
                  {a.d} · <span className="num text-[var(--text)]">{a.v}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* per-player stats */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-2">
        {stats.map((s) => (
          <div key={s.addr} className="panel grid gap-2 p-3">
            <div className="flex items-center gap-2">
              <PlayerMark addr={s.addr} size={28} />
              <span className="font-semibold">{s.name}</span>
              <span className={`ml-auto font-display text-xs font-bold tracking-widest uppercase ${s.result === 'win' ? 'text-gold' : s.result === 'loss' ? 'text-red' : 'text-muted'}`}>{s.result ?? '…'}</span>
            </div>
            <div className="num grid grid-cols-4 gap-2 text-center text-[11px]">
              {(
                [
                  ['Trades', s.opens],
                  ['Win rate', s.closes ? `${Math.round((s.wins / s.closes) * 100)}%` : '–'],
                  ['Volume', fmtUsd(s.volume)],
                  ['Fees', fmtUsd(s.fees)],
                  ['Best', s.best !== null ? fmtUsd(s.best, true) : '–'],
                  ['Worst', s.worst !== null ? fmtUsd(s.worst, true) : '–'],
                  ['Avg hold', s.avgHold !== null ? `${Math.round(s.avgHold)}s` : '–'],
                  ['Long / short', `${s.longs} / ${s.shorts}`],
                ] as [string, React.ReactNode][]
              ).map(([k, v]) => (
                <div key={k} className="border border-line py-1.5">
                  <div className="text-[9px] tracking-wider text-dim uppercase">{k}</div>
                  <div className="text-[12px]">{v}</div>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-dim">
              Markets: {[...s.markets].map((i) => MARKETS[i]).join(', ') || 'none'} · XP {s.xp >= 0 ? '+' : ''}
              {s.xp}
            </div>
          </div>
        ))}
      </div>

      {/* trade log */}
      <div className="panel p-2">
        <div className="px-1 pb-2">
          <PanelHeader title="Trade log" sub={`${data.trades.length} onchain events`} hint="Every open, close, liquidation and elimination in this match, in order. Click a row to open its transaction on the Monad explorer." />
        </div>
        <div className="scroll-thin max-h-[360px] overflow-auto">
          <table className="num w-full min-w-[760px] text-[11px]">
            <thead className="sticky top-0 bg-[var(--panel-solid)] text-left text-[9px] tracking-[0.12em] text-dim uppercase">
              <tr>
                {['Time', 'Player', 'Action', 'Market', 'Size', 'Price', 'PnL', 'Fee', 'Tx'].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data.trades]
                .sort((a, b) => a.ts - b.ts)
                .map((t, i) => {
                  const who = stats.find((s) => s.addr === t.addr);
                  const action = t.kind === 'open' ? (t.is_long ? '▲ LONG' : '▼ SHORT') : t.kind.toUpperCase();
                  const tone = t.kind === 'open' ? (t.is_long ? 'up' : 'down') : t.kind === 'close' ? ((t.pnl ?? 0) >= 0 ? 'up' : 'down') : 'text-gold';
                  return (
                    <tr key={`${t.tx}${i}`} className="cursor-pointer border-t border-line hover:bg-white/[0.03]" onClick={() => window.open(explorerTx(t.tx), '_blank')}>
                      <td className="px-2 py-1 text-dim">+{mmss(Math.max(0, t.ts - start))}</td>
                      <td className="px-2 py-1 font-sans">
                        {who && <PlayerMark addr={who.addr} size={14} className="mr-1.5 inline-block align-middle" />}
                        {who?.name ?? shortAddr(t.addr)}
                      </td>
                      <td className={`px-2 py-1 font-semibold ${tone}`}>{action}</td>
                      <td className="px-2 py-1">{t.market !== null ? MARKETS[t.market] : '–'}</td>
                      <td className="px-2 py-1">{t.notional ? fmtUsd(t.notional) : '–'}</td>
                      <td className="px-2 py-1">{t.price ? fmtPx(t.price) : '–'}</td>
                      <td className={`px-2 py-1 ${t.kind === 'close' ? ((t.pnl ?? 0) >= 0 ? 'up' : 'down') : 'text-dim'}`}>{t.kind === 'close' ? fmtUsd(t.pnl ?? 0, true) : '–'}</td>
                      <td className="px-2 py-1 text-dim">{t.fee ? fmtUsd(t.fee) : '–'}</td>
                      <td className="px-2 py-1 text-muted">{t.tx.slice(0, 10)}… ↗</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
