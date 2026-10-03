'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ITextWatermarkPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { MARKETS, fmtPx, liqPrice, type MarketSymbol, type Pos } from '@longshort/shared';
import { useSocket, type Tick } from '@/lib/socket';
import type { TradeRow } from '@/lib/match';
import { useT } from '@/lib/i18n';

const UP = '#4aa37c';
const DOWN = '#d25a55';
const TFS = [
  { s: 5, label: '5s' },
  { s: 15, label: '15s' },
  { s: 60, label: '1m' },
] as const;
const PRECISION: Record<MarketSymbol, { precision: number; minMove: number }> = {
  BTC: { precision: 1, minMove: 0.1 },
  ETH: { precision: 2, minMove: 0.01 },
  MON: { precision: 5, minMove: 0.00001 },
};

type Candle = CandlestickData<UTCTimestamp>;
interface Flow { ts: number; notional: number; isLong: boolean }

/** OHLC candles from Perpl mark ticks. Empty buckets carry the last close forward, like a real feed. */
function buildCandles(ticks: Tick[], tf: number, max = 180): Candle[] {
  if (!ticks.length) return [];
  const byBucket = new Map<number, Candle>();
  for (const t of ticks) {
    const b = (Math.floor(t.t / 1000 / tf) * tf) as UTCTimestamp;
    const c = byBucket.get(b);
    if (!c) byBucket.set(b, { time: b, open: t.px, high: t.px, low: t.px, close: t.px });
    else {
      c.high = Math.max(c.high, t.px);
      c.low = Math.min(c.low, t.px);
      c.close = t.px;
    }
  }
  const keys = [...byBucket.keys()].sort((a, b) => a - b);
  const out: Candle[] = [];
  for (let b = keys[0]; b <= keys.at(-1)!; b += tf) {
    const c = byBucket.get(b);
    const prev = out.at(-1);
    if (c) out.push(prev ? { ...c, open: prev.close, high: Math.max(c.high, prev.close), low: Math.min(c.low, prev.close) } : c);
    else if (prev) out.push({ time: b as UTCTimestamp, open: prev.close, high: prev.close, low: prev.close, close: prev.close });
  }
  return out.slice(-max);
}

export function PriceChart({
  market,
  pos,
  realized,
  trades = [],
  players = [],
  real = false,
  leverage,
}: {
  market: MarketSymbol;
  real?: boolean;
  /** your leverage, shown beside the market so it is never a surprise */
  leverage?: number;
  pos?: Pos | null;
  realized?: number;
  trades?: TradeRow[];
  players?: { addr: string; name: string; isMe: boolean }[];
}) {
  const t = useT();
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const watermark = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const [tf, setTf] = useState<number>(5);
  const [hover, setHover] = useState<Candle | null>(null);
  const ticks = useSocket((s) => s.prices[market]);
  const events = useSocket((s) => s.events);
  const mIdx = MARKETS.indexOf(market);

  const data = useMemo(() => buildCandles(ticks, tf), [ticks, tf]);

  // arena order flow on this market: live socket events (all matches) + this match's indexed trades
  const flow = useMemo<Flow[]>(() => {
    const seen = new Map<string, Flow>();
    for (const e of events) {
      if (e.name !== 'Opened' || Number(e.args.market) !== mIdx) continue;
      seen.set(`${e.tx}:${String(e.args.player).toLowerCase()}`, { ts: e.ts, notional: Number(BigInt(e.args.notional) / 10n ** 12n) / 1e6, isLong: !!e.args.isLong });
    }
    for (const t of trades) {
      if (t.kind !== 'open' || t.market !== mIdx) continue;
      const key = `${t.tx}:${t.addr}`;
      if (!seen.has(key)) seen.set(key, { ts: t.ts, notional: t.notional ?? 0, isLong: !!t.is_long });
    }
    return [...seen.values()];
  }, [events, trades, mIdx]);

  // ─── create ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8a909a', fontFamily: 'var(--font-jet)', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.035)' } },
      rightPriceScale: { borderColor: '#242831', scaleMargins: { top: 0.1, bottom: 0.24 } },
      timeScale: { borderColor: '#242831', timeVisible: true, secondsVisible: true, rightOffset: 4, barSpacing: 9, minBarSpacing: 3 },
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: { color: '#626873', labelBackgroundColor: '#2a2f38', style: LineStyle.Dashed },
        vertLine: { color: '#626873', labelBackgroundColor: '#2a2f38', style: LineStyle.Dashed },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    });
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
      priceLineColor: '#8a909a',
      priceLineStyle: LineStyle.Dotted,
    });
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    markers.current = createSeriesMarkers(candles.current, []);
    watermark.current = createTextWatermark(c.panes()[0], {
      horzAlign: 'center',
      vertAlign: 'center',
      lines: [{ text: '', color: 'rgba(231,229,224,0.045)', fontSize: 64, fontStyle: '700' }],
    });
    c.subscribeCrosshairMove((p) => {
      const d = p.time && candles.current ? (p.seriesData.get(candles.current) as Candle | undefined) : undefined;
      setHover(d ?? null);
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = candles.current = volume.current = null;
      markers.current = watermark.current = null;
      lines.current = [];
    };
  }, []);

  // ─── market / timeframe ────────────────────────────────────────────────
  useEffect(() => {
    candles.current?.applyOptions({ priceFormat: { type: 'price', ...PRECISION[market] } });
    watermark.current?.applyOptions({ lines: [{ text: `${market}-PERP`, color: 'rgba(231,229,224,0.045)', fontSize: 64, fontStyle: '700' }] });
    chart.current?.timeScale().applyOptions({ secondsVisible: tf < 60 });
    chart.current?.timeScale().scrollToRealTime();
  }, [market, tf]);

  // ─── data ──────────────────────────────────────────────────────────────
  // fill the pane while history is short; once there's plenty, show the latest ~120 bars and follow the live edge
  const framed = useRef('');
  useEffect(() => {
    const ts = chart.current?.timeScale();
    if (!ts || !data.length) return;
    const key = `${market}:${tf}`;
    if (data.length < 120) ts.fitContent();
    else if (framed.current !== key) ts.setVisibleLogicalRange({ from: data.length - 120, to: data.length + 4 });
    framed.current = key;
  }, [data, market, tf]);

  useEffect(() => {
    candles.current?.setData(data);
    const vol = new Map<number, { v: number; buy: number }>();
    for (const f of flow) {
      const b = Math.floor(f.ts / tf) * tf;
      const cur = vol.get(b) ?? { v: 0, buy: 0 };
      cur.v += f.notional;
      if (f.isLong) cur.buy += f.notional;
      vol.set(b, cur);
    }
    volume.current?.setData(
      data.map((c) => {
        const v = vol.get(c.time);
        return { time: c.time, value: v?.v ?? 0, color: v && v.buy >= v.v / 2 ? 'rgba(74,163,124,0.45)' : 'rgba(210,90,85,0.45)' };
      }),
    );
  }, [data, flow, tf]);

  // ─── markers: this match's opens/closes on this market ─────────────────
  useEffect(() => {
    if (!markers.current || !data.length) return;
    const first = data[0].time;
    const nameOf = (a: string) => {
      const p = players.find((x) => x.addr === a);
      return p ? (p.isMe ? 'YOU' : p.name.replace(/^bot·/, '').slice(0, 8)) : '';
    };
    const opens = trades.filter((t) => t.kind === 'open');
    const ms: SeriesMarker<Time>[] = [];
    for (const t of trades) {
      // a close/liq belongs to the market of that player's latest open before it
      const mk = t.kind === 'open' ? t.market : opens.filter((o) => o.addr === t.addr && o.ts <= t.ts).at(-1)?.market;
      if (mk !== mIdx || t.ts < first) continue;
      const time = (Math.floor(t.ts / tf) * tf) as UTCTimestamp;
      const who = nameOf(t.addr);
      const mine = who === 'YOU';
      // only your own fills are labelled; rivals are small unlabelled arrows (keeps busy bars readable)
      if (t.kind === 'open')
        ms.push(
          t.is_long
            ? { time, position: 'belowBar', shape: 'arrowUp', color: UP, size: mine ? 1.2 : 0.6, text: mine ? 'YOU L' : undefined }
            : { time, position: 'aboveBar', shape: 'arrowDown', color: DOWN, size: mine ? 1.2 : 0.6, text: mine ? 'YOU S' : undefined },
        );
      else if (t.kind === 'close' && mine) ms.push({ time, position: 'aboveBar', shape: 'circle', color: '#c9cdd4', size: 0.7, text: 'X' });
      else if (t.kind === 'liquidated') ms.push({ time, position: 'aboveBar', shape: 'square', color: '#c9a24a', size: 0.8, text: `${who} LIQ` });
    }
    ms.sort((a, b) => (a.time as number) - (b.time as number));
    markers.current.setMarkers(ms);
  }, [trades, players, data, mIdx, tf]);

  // ─── position lines ────────────────────────────────────────────────────
  useEffect(() => {
    const s = candles.current;
    if (!s) return;
    for (const l of lines.current) s.removePriceLine(l);
    lines.current = [];
    if (pos) {
      lines.current.push(s.createPriceLine({ price: pos.entryPx, color: pos.isLong ? UP : DOWN, lineWidth: 1, lineStyle: LineStyle.Solid, title: `ENTRY ${pos.isLong ? 'L' : 'S'}` }));
      if (!real) lines.current.push(s.createPriceLine({ price: liqPrice(realized ?? 0, pos), color: '#c9a24a', lineWidth: 1, lineStyle: LineStyle.Dashed, title: 'LIQ' }));
    }
  }, [pos, realized, market, real]);

  const last = data.at(-1);
  const shown = hover ?? last;
  const chg = last && data.length > 1 ? ((last.close - data[0].open) / data[0].open) * 100 : 0;
  const up = shown ? shown.close >= shown.open : true;

  return (
    <div className="pc">
      <div className="pc-head">
        <span className="pc-sym">{market}-PERP</span>
        {leverage && <span className="pc-lev" title={t('hud.leverage')}>{leverage}x</span>}
        {shown && <span className={`pc-px num ${up ? 'up' : 'down'}`}>{fmtPx(shown.close)}</span>}
        {!hover && last && (
          <span className={`pc-chg num ${chg >= 0 ? 'up' : 'down'}`}>
            {chg >= 0 ? '+' : ''}
            {chg.toFixed(3)}%
          </span>
        )}
        {hover && (
          <span className={`pc-ohlc num ${up ? 'up' : 'down'}`}>
            <span>O</span> {fmtPx(hover.open)} <span>H</span> {fmtPx(hover.high)} <span>L</span> {fmtPx(hover.low)}
          </span>
        )}
        <span className="pc-src">Perpl mark</span>
        <div className="seg pc-tf" title={t('hud.candle')}>
          {TFS.map((x) => (
            <button key={x.s} onClick={() => setTf(x.s)} className={tf === x.s ? 'on' : ''}>
              <span>{x.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pc-body">
        <div ref={el} className="h-full w-full" />
        <div className="pc-vol">{t('hud.arenaVol')}</div>
      </div>
    </div>
  );
}
