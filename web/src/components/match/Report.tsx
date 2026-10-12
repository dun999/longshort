'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ColorType, LineSeries, LineStyle, createChart, type UTCTimestamp } from 'lightweight-charts';
import { MARGIN, MARKETS, MODES, Mode, REAL_TRADING, STAKE, explorerTx, fmtPx, fmtUsd, shortAddr, CHARACTER_INFO, characterOf } from '@longshort/shared';
import { EnvioBadge, envioMatch, useIndexed } from '@/lib/envio';
import { useWallet } from '@/lib/wallet';
import { useScene } from '@/lib/scene';
import { lastLeverage, quickPlay } from '@/lib/actions';
import { sfx } from '@/lib/sfx';
import { PlayerMark } from '../PlayerMark';
import { PanelHeader } from '../ui/Hint';
import { BackButton } from '../ui/BackButton';
import { awards, compute, totals, winMargin, type Row, type Stats } from '@/lib/matchStats';
import { ordinal, rankedCode, shareText, type CardData } from '@/lib/shareLink';
import type { MatchView } from '@/lib/match';
import { TradingCapital } from './TradingCapital';
import { PrivateJournal } from './PrivateJournal';
import { ShareIcon, ShareSheet } from './ShareSheet';
import { friendly } from '@/lib/errors';

const LINE = ['#e7e1d3', '#6f8fd0', '#cf8a52', '#4aa37c', '#c46a5e', '#b3a27a', '#8f7fc4', '#6f9fc0'];
const TEAM_NAME = ['Alpha', 'Bravo'];

export interface ReportData {
  match: any;
  players: any[];
  trades: Row[];
  accounts?: MatchView['accounts'];
  fills?: any[];
  source?: 'envio' | 'keeper';
}

function EquityChart({ stats }: { stats: Stats[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || !stats.length) return;
    // the chart draws on a canvas, which can't resolve a CSS variable: hand it the real family
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-inter').trim() || 'system-ui, sans-serif';
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9299a5', fontFamily: font, fontSize: 11, attributionLogo: false },
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
  return <div ref={el} className="rp-chart" />;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const ausd = (n: number) => `${n.toFixed(2)} ${STAKE}`;

export function Report({ id }: { id: number }) {
  const { data, reload } = useIndexed<ReportData>(() => envioMatch(id, { finalized: true }), `/match/${id}`, 5000);
  useEffect(() => useScene.getState().set({ shot: 'backdrop', slots: [] }), []);
  if (!data?.match) return <div className="grid h-[60vh] place-items-center font-display tracking-[0.4em] text-muted uppercase">Loading report #{id}…</div>;

  const m = data.match;
  if (m.state !== 2) return <div className="mx-auto grid max-w-xl gap-3 px-4 py-12">
    <div className="panel grid gap-3 p-5">
      <h1 className="font-display text-2xl font-bold uppercase">{m.state === 3 ? 'Round cancelled' : 'Round has not settled'}</h1>
      <p className="text-sm text-muted">{m.state === 3 ? 'This round ended before trading. View the round to check returned funds.' : 'The final result and payout appear after the settlement transaction confirms. Your round and any position remain live until then.'}</p>
      <Link className="gbtn sm justify-self-start" href={`/match/${id}`}>View round #{id} →</Link>
    </div>
  </div>;
  return <ReportView id={id} data={data} reload={reload} />;
}

/** The settled match: who won and by how much, the match totals, one scoreboard, then the onchain proof. */
export function ReportView({ id, data, reload }: { id: number; data: ReportData; reload: () => unknown }) {
  const me = useWallet((s) => s.address?.toLowerCase());
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [entryError, setEntryError] = useState<string>();
  const [sharing, setSharing] = useState<{ code: string; text: string } | null>(null);
  const stats = useMemo(() => compute(data.match, data.players, data.trades, data.fills), [data]);

  const m = data.match;
  const mode = m.mode as Mode;
  const pot = m.entry * data.players.length;
  const mine = stats.find((s) => s.addr === me);
  const ranked = [...stats].sort((a, b) => b.payout - a.payout || b.finalEquity - a.finalEquity);
  const top = ranked[0];
  const start = m.start_at ?? data.trades[0]?.ts ?? 0;
  const awardList = awards(stats);
  const sum = totals(stats);
  const paid = stats.reduce((s, p) => s + p.payout, 0);
  const closes = data.trades.filter((t) => t.kind === 'close').length;
  const accountOf = (addr: string) => data.accounts?.find((a) => a.addr === addr);
  const budget = data.accounts?.[0]?.budget;
  const draw = stats.some((s) => s.result === 'draw');
  const outcome = draw ? 'draw' : !mine ? 'over' : mine.result === 'win' ? 'win' : mine.result === 'loss' ? 'loss' : 'over';
  const gap = winMargin(stats.map((s) => ({ team: s.team, equity: s.finalEquity })));
  const rank = mine ? ranked.indexOf(mine) + 1 : 0;

  // the whole result in one sentence
  const line = (() => {
    if (draw) return `Dead heat · entries refunded`;
    if (!top) return '';
    const winner = mode === Mode.SQUAD ? `${TEAM_NAME[top.team]} team` : top.name;
    if (outcome === 'win') {
      if (mode === Mode.DUEL) return `You won ${ausd(mine!.payout)} · beat ${ranked[1]?.name ?? 'your rival'} by ${fmtUsd(gap)}`;
      if (mode === Mode.SQUAD) return `Your team won by ${fmtUsd(gap)} · ${ausd(mine!.payout)} to you`;
      return `You won ${ausd(mine!.payout)} · ${ordinal(rank)} of ${stats.length}`;
    }
    if (outcome === 'loss') {
      if (mode === Mode.ROYALE) return `${ordinal(rank)} of ${stats.length} · ${top.name} won ${ausd(top.payout)}`;
      return `${winner} won${mode === Mode.DUEL ? ` ${ausd(top.payout)}` : ''} · you lost by ${fmtUsd(gap)}`;
    }
    return `${winner} won${mode === Mode.SQUAD ? '' : ` ${ausd(top.payout)}`}`;
  })();

  const again = async () => {
    if (joining) return;
    sfx.click();
    if (!me) return router.push('/play');
    setJoining(true); setEntryError(undefined);
    try { const next = await quickPlay(mode, m.entry, lastLeverage()); router.push(`/match/${next}`); }
    catch (e) { setEntryError(friendly(e)); }
    finally { setJoining(false); }
  };
  // your result (or the winner's) as a link whose card unfurls wherever it's posted
  const share = () => {
    const who = mine ?? top;
    if (!who) return;
    sfx.click();
    const card: CardData = {
      outcome: who.result === 'win' || who.result === 'loss' || who.result === 'draw' ? who.result : 'over',
      roi: ((who.finalEquity - MARGIN) / MARGIN) * 100,
      equity: who.finalEquity,
      payout: who.payout,
      name: who.name,
      addr: who.addr,
      leverage: who.leverage,
      character: who.character ?? undefined,
      mode,
      rival: mode === Mode.DUEL ? stats.find((s) => s.addr !== who.addr)?.name : undefined,
      place: ranked.indexOf(who) + 1,
      of: stats.length,
      award: awardList.find((a) => a.who.addr === who.addr)?.k,
      practice: false,
      id,
    };
    setSharing({ code: rankedCode(id, who.addr), text: shareText(card, !!mine) });
  };

  const tiles: [string, string, string][] = [
    ['Pot', ausd(pot), `${stats.length} players × ${m.entry.toFixed(2)}`],
    ['Prize paid', ausd(paid), `after ${(m.rake ?? 0).toFixed(2)} rake`],
    ['Total volume', fmtUsd(sum.volume), REAL_TRADING ? 'filled on Perpl' : 'notional traded'],
    ['Fees paid', fmtUsd(sum.fees), REAL_TRADING ? 'Perpl trading fees' : 'trading fees'],
    ['Trades', String(sum.trades), `${closes} closed`],
    ['Length', `${m.duration}s`, MODES[mode].name],
  ];

  return (
    <div className="rp">
      {/* the result, in words */}
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel rp-head">
        <div className="rp-meta">
          <span>#{m.id} · {MODES[mode].name}{m.start_at ? ` · ${new Date(m.start_at * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</span>
          <EnvioBadge source={data.source} />
        </div>
        <h1 className={`rp-outcome ${outcome}`}>{outcome === 'win' ? 'Victory' : outcome === 'loss' ? 'Defeat' : outcome === 'draw' ? 'Draw' : 'Final result'}</h1>
        <p className="rp-line fig">{line}</p>
        <div className="rp-actions">
          <button className="btn-play sm" disabled={joining} onClick={again}>
            {joining ? 'Confirming entry…' : 'Play again'}
          </button>
          <button className="gbtn ghost sm" onClick={share} onMouseEnter={sfx.hover}>
            <ShareIcon /> Share
          </button>
          <BackButton />
        </div>
        {m.settle_tx && (
          <a className="vx-proof" href={explorerTx(m.settle_tx)} target="_blank" rel="noreferrer" title="The prize was paid by the arena contract. Open the settlement to check it yourself.">
            <i>✓</i> Verified result <span>proof ↗</span>
          </a>
        )}
      </motion.header>
      {entryError && <p role="alert" className="panel p-3 text-sm text-red">{entryError}</p>}

      {/* match totals */}
      <section className="rp-totals" aria-label="Match totals">
        {tiles.map(([k, v, sub], i) => (
          <motion.div key={k} className="rp-tile" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.03 }}>
            <span>{k}</span>
            <b className="fig">{v}</b>
            <em>{sub}</em>
          </motion.div>
        ))}
      </section>

      {/* one row per player: the result, the money, the trading */}
      <section className="panel rp-board">
        <PanelHeader title="Scoreboard" sub="paid by the contract" hint="Final order after settlement. Trading PnL is the change in each player's trading capital, Perpl fees included. The prize is the pot after rake, transferred by the arena in the settlement transaction." />
        <div className="rp-grid" role="table" aria-label="Scoreboard">
          <div className="rp-row rp-th" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Player</span>
            <span role="columnheader">Prize</span>
            <div className="rp-cells">
              <span role="columnheader">Trading PnL</span>
              <span role="columnheader">Trades</span>
              <span role="columnheader">Volume</span>
              <span role="columnheader">Fees</span>
              {REAL_TRADING && <span role="columnheader">Capital back</span>}
            </div>
          </div>
          {ranked.map((s, i) => {
            const acct = accountOf(s.addr);
            const pnl = s.finalEquity - MARGIN;
            return (
              <div key={s.addr} role="row" className={`rp-row ${s.addr === me ? 'me' : ''} ${s.payout > 0 ? 'paid' : ''}`}>
                <span className="rp-rank fig" role="cell">{i + 1}</span>
                <div className="rp-who" role="cell">
                  <PlayerMark addr={s.addr} size={30} />
                  <div className="min-w-0">
                    <div className="rp-name">
                      <span className="truncate">{s.name}</span>
                      {s.addr === me && <em className="you">You</em>}
                      {s.bot && <em>Bot</em>}
                    </div>
                    <div className="rp-class">
                      {mode !== Mode.ROYALE && `${TEAM_NAME[s.team]} · `}
                      {CHARACTER_INFO[characterOf(s.addr, s.character)].name} · {s.leverage}x{s.out ? ` · ${s.out}` : ''}
                    </div>
                  </div>
                </div>
                <b className={`rp-prize fig ${s.payout > 0 ? 'text-gold' : 'text-dim'}`} role="cell" title={s.payout.toFixed(6)}>
                  {s.payout > 0 ? `+${ausd(s.payout)}` : `0 ${STAKE}`}
                </b>
                <div className="rp-cells fig">
                  <span role="cell" data-k="Trading PnL" className={pnl > 0.005 ? 'up' : pnl < -0.005 ? 'down' : ''} title={pnl.toFixed(6)}>{fmtUsd(pnl, true)}</span>
                  <span role="cell" data-k="Trades">{s.opens}</span>
                  <span role="cell" data-k="Volume" title={s.volume.toFixed(6)}>{fmtUsd(s.volume)}</span>
                  <span role="cell" data-k="Fees" title={s.fees.toFixed(6)}>{fmtUsd(s.fees)}</span>
                  {REAL_TRADING && (
                    <span role="cell" data-k="Capital back" title={acct ? acct.returned.toFixed(6) : undefined}>
                      {!acct ? '–' : acct.final_balance === null && !acct.returned ? 'Pending' : ausd(acct.returned)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="rp-note">
          Each player paid {m.entry.toFixed(2)} {STAKE} to enter
          {REAL_TRADING && budget !== undefined ? ` and traded a ${budget.toFixed(2)} ${STAKE} budget in their own Perpl account.` : '.'}
        </p>
        <TradingCapital id={id} accounts={data.accounts} onRecovered={() => void reload()} />
      </section>

      <section className="panel rp-equity">
        <PanelHeader title="Equity over time" sub="realized, from onchain events" hint={`Each line starts at ${MARGIN}, then records realized PnL and fees. The last point is the actual final balance. The dashed line is the starting balance.`} />
        <EquityChart stats={stats} />
        <div className="rp-legend">
          {stats.map((s, i) => (
            <span key={s.addr}>
              <i style={{ background: LINE[i % LINE.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      </section>

      {awardList.length > 0 && (
        <section className="rp-awards" aria-label="Awards">
          {awardList.map((a, i) => (
            <motion.div key={a.k} className="rp-award" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}>
              <PlayerMark addr={a.who.addr} size={30} />
              <div className="min-w-0">
                <b>{a.k}</b>
                <span className="truncate">{a.who.name}</span>
                <em className="fig">{a.d} · {a.v}</em>
              </div>
            </motion.div>
          ))}
        </section>
      )}

      {mine && <PrivateJournal id={id} />}

      {/* everything above, as it happened onchain */}
      <details className="panel rp-proof">
        <summary>
          <span>Onchain proof</span>
          <em className="fig">
            {data.trades.length} trade events{REAL_TRADING && data.fills?.length ? ` · ${data.fills.length} Perpl fills` : ''}
          </em>
        </summary>
        {REAL_TRADING && !!data.fills?.length && <div className="rp-proof-part">
          <PanelHeader title="Perpl executions" sub={`${data.fills.length} confirmed fills`} hint="Execution prices, sizes and fees decoded from actual Perpl transaction logs. A single order can fill against several makers." />
          <div className="scroll-thin max-h-[300px] overflow-auto"><table className="rp-table fig min-w-[660px]">
            <thead><tr>{['Player','Action','BTC price','Notional AUSD','Fee AUSD','Transaction'].map((h)=><th key={h}>{h}</th>)}</tr></thead>
            <tbody>{data.fills.map((f)=><tr key={`${f.tx}:${f.log_index}`}><td>{stats.find((s)=>s.addr===f.addr)?.name??shortAddr(f.addr)}</td><td>{['Long','Short','Close long','Close short'][f.order_type]}</td><td>{fmtPx(f.price)}</td><td>{f.notional.toFixed(6)}</td><td>{f.fee.toFixed(6)}</td><td><a className="num underline" href={explorerTx(f.tx)} target="_blank" rel="noreferrer">{f.tx.slice(0,10)}… ↗</a></td></tr>)}</tbody>
          </table></div>
        </div>}
        <div className="rp-proof-part">
          <PanelHeader title="Trade log" sub={`${data.trades.length} onchain events`} hint="Every open, close, liquidation and elimination in this match, in order. Click a row to open its transaction on the Monad explorer." />
          <div className="scroll-thin max-h-[360px] overflow-auto">
            <table className="rp-table fig min-w-[760px]">
              <thead>
                <tr>{['Time', 'Player', 'Action', 'Market', 'Size', 'Price', 'PnL', 'Fee', 'Tx'].map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {[...data.trades]
                  .sort((a, b) => a.ts - b.ts)
                  .map((t, i) => {
                    const who = stats.find((s) => s.addr === t.addr);
                    const action = t.kind === 'open' ? (t.is_long ? '▲ Long' : '▼ Short') : t.kind[0].toUpperCase() + t.kind.slice(1);
                    const tone = t.kind === 'open' ? (t.is_long ? 'up' : 'down') : t.kind === 'close' ? ((t.pnl ?? 0) >= 0 ? 'up' : 'down') : 'text-gold';
                    return (
                      <tr key={`${t.tx}${i}`} className="cursor-pointer hover:bg-white/[0.03]" onClick={() => window.open(explorerTx(t.tx), '_blank')}>
                        <td className="text-dim">+{mmss(Math.max(0, t.ts - start))}</td>
                        <td>
                          {who && <PlayerMark addr={who.addr} size={14} className="mr-1.5 inline-block align-middle" />}
                          {who?.name ?? shortAddr(t.addr)}
                        </td>
                        <td className={`font-semibold ${tone}`}>{action}</td>
                        <td>{t.market !== null ? MARKETS[t.market] : '–'}</td>
                        <td>{t.notional ? fmtUsd(t.notional) : '–'}</td>
                        <td>{t.price ? fmtPx(t.price) : '–'}</td>
                        <td className={t.kind === 'close' ? ((t.pnl ?? 0) >= 0 ? 'up' : 'down') : 'text-dim'}>{t.kind === 'close' ? fmtUsd(t.pnl ?? 0, true) : '–'}</td>
                        <td className="text-dim">{t.fee ? fmtUsd(t.fee) : '–'}</td>
                        <td className="num text-muted">{t.tx.slice(0, 10)}… ↗</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </details>
      {sharing && <ShareSheet code={sharing.code} text={sharing.text} onClose={() => setSharing(null)} />}
    </div>
  );
}
