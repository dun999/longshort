'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { REAL_TRADING, MARGIN, FEE_BPS, MARKETS, feeFor, fmtPx, fmtUsd, liqPrice, notionalFor, upnl, type MarketSymbol } from '@longshort/shared';
import type { PlayerView } from '@/lib/match';
import { sfx } from '@/lib/sfx';
import { useScene } from '@/lib/scene';
import { Hint } from '../ui/Hint';
import { friendly } from '@/lib/errors';
import { useT } from '@/lib/i18n';

export interface HudActions {
  open: (market: number, isLong: boolean, sizeBps: number) => Promise<{ ms: number; hash?: string }>;
  close: () => Promise<{ ms: number; hash?: string; partial?:boolean }>;
  simulated?: boolean;
}

export interface Fill {
  id: number;
  label: string;
  ms: number;
  hash?: string;
  ok: boolean;
}

const SIZES = [2500, 5000, 10_000];
const kUsd = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : fmtUsd(n));

export function TradePanel({
  me,
  market,
  setMarket,
  prices,
  actions,
  live,
  onFill,
}: {
  me?: PlayerView;
  market: number;
  setMarket: (m: number) => void;
  prices: Record<MarketSymbol, number | undefined>;
  actions: HudActions;
  live: boolean;
  onFill: (f: Fill) => void;
}) {
  const t = useT();
  const [size, setSize] = useState(5000);
  const [pending, setPending] = useState<string | null>(null);
  const pos = me?.pos ?? null;
  const posPx = pos ? prices[MARKETS[pos.market]] : undefined;
  const real = REAL_TRADING && !actions.simulated;
  const btcOnly = REAL_TRADING; // every live match trades BTC, and Practice mirrors it
  const notional = me ? notionalFor(Math.max(0, real ? me.equity : MARGIN + me.realized), me.leverage, size) * (real ? 0.95 : 1) : 0;
  const canTrade = live && !!me && !me.out && !pending;
  const marketPx = prices[MARKETS[market]];
  const canOpen = canTrade && Number.isFinite(marketPx) && !!marketPx && marketPx > 0;
  const canClose = canTrade && !!pos && (real || (Number.isFinite(posPx) && !!posPx && posPx > 0));

  const run = useCallback(
    async (label: string, fn: () => Promise<{ ms: number; hash?: string;partial?:boolean }>) => {
      setPending(label);
      try {
        const r = await fn();
        sfx.confirm();
        onFill({ id: Date.now(), label: r.partial ? `${label}: ${t('live.partial')}` : label, ms: r.ms, hash: r.hash, ok: true });
      } catch (e) {
        sfx.error();
        onFill({ id: Date.now(), label: `${label}: ${friendly(e)}`, ms: 0, ok: false });
      } finally {
        setPending(null);
      }
    },
    [onFill,t],
  );

  const go = useCallback(
    (isLong: boolean) => {
      if (!canOpen) return;
      isLong ? sfx.long() : sfx.short();
      useScene.getState().shake(isLong ? 'rgba(74,163,124,0.12)' : 'rgba(210,90,85,0.12)');
      void run(`${isLong ? 'LONG' : 'SHORT'} ${MARKETS[market]} ${size / 100}%`, () => actions.open(market, isLong, size));
    },
    [canOpen, run, actions, market, size],
  );
  const shut = useCallback(() => {
    if (!canClose || !pos) return;
    sfx.close();
    void run(`CLOSE ${MARKETS[pos.market]}`, actions.close);
  }, [canClose, pos, run, actions]);

  // on phones the dock is pinned to the bottom; the HUD sizes the chart to the height it leaves free
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dock.current;
    const hud = el?.closest<HTMLElement>('.hud');
    if (!el || !hud) return;
    const measure = () => {
      const fixed = getComputedStyle(el).position === 'fixed';
      hud.style.setProperty('--dock', `${fixed ? el.offsetHeight : 0}px`);
      document.documentElement.style.setProperty('--trade-dock-height', `${fixed ? el.offsetHeight : 0}px`);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      hud.style.removeProperty('--dock');
      document.documentElement.style.removeProperty('--trade-dock-height');
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches('input,textarea,select') || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'q') go(true);
      else if (k === 'e') go(false);
      else if (k === ' ' || k === 'x') (e.preventDefault(), shut());
      else if (['1', '2', '3'].includes(k) && (!btcOnly || k === '1')) setMarket(Number(k) - 1);
      else if (k === 'z') setSize(2500);
      else if (k === 'c') setSize(10_000);
      else if (k === 'v') setSize(5000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, shut, setMarket, btcOnly]);

  return (
    <div className="dock panel" ref={dock}>
      <PositionStrip me={me} px={posPx} real={real} />
      <div className={`dock-pick ${btcOnly ? 'one' : ''}`}>
        {/* BTC only: no greyed-out ETH/MON, the chart header already names the market */}
        {!btcOnly && (
          <div className="seg" aria-label={t('hud.market')}>
            {MARKETS.map((m, i) => (
              <button key={m} className={market === i ? 'on' : ''} onClick={() => (sfx.click(), setMarket(i))}>
                <span>
                  {m} <span className="seg-px num">{prices[m] ? fmtPx(prices[m]!) : '…'}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {btcOnly && <span className="dock-label">{t('hud.size')}</span>}
        <div className="seg" aria-label={t('hud.sizeShare')} title={t('hud.sizeShare')}>
          {SIZES.map((sz, i) => (
            <button key={sz} className={size === sz ? 'on' : ''} onClick={() => (sfx.click(), setSize(sz))}>
              <span>
                {sz / 100}% <span className="kbd">{'ZVC'[i]}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="dock-go">
        <button className="trade-btn long" disabled={!canOpen} onClick={() => go(true)}>
          {pending?.startsWith('LONG') ? '…' : '▲ Long'}
          <small>
            <span className="kbd">Q</span> <span className="dock-why">{t('hud.betUp')}</span>
            {me ? `${kUsd(notional)} · ${me.leverage}x` : ''}
          </small>
        </button>
        <button className="gbtn ghost dock-close" disabled={!canClose} onClick={shut}>
          <span className="grid text-center leading-tight">
            {t('hud.close')}
            <span className="text-[12px] font-medium tracking-normal text-muted">{t('hud.lockPnl')}</span>
            <span className="kbd mx-auto mt-0.5">SPACE</span>
          </span>
        </button>
        <button className="trade-btn short" disabled={!canOpen} onClick={() => go(false)}>
          {pending?.startsWith('SHORT') ? '…' : 'Short ▼'}
          <small>
            <span className="kbd">E</span> <span className="dock-why">{t('hud.betDown')}</span>
            {me ? `${kUsd(notional)} · ${me.leverage}x` : ''}
          </small>
        </button>
      </div>
      <div className="dock-foot">
        <span>{real ? t('live.execution') : t('hud.fills', { bp: FEE_BPS, fee: fmtUsd(feeFor(notional)) })}</span>
        <Hint text="Pick a market and how much of your equity to use, then go LONG (profit if price rises) or SHORT (profit if price falls). CLOSE locks in your PnL. A new trade closes the open one first. Keyboard: 1-3 market, Z/V/C size, Q long, E short, Space close." />
      </div>
    </div>
  );
}

/**
 * Your open trade in one line, right above the buttons: side, live PnL and how far price is from
 * knocking you out (the meter drains from full at entry to empty at the liquidation price).
 */
function PositionStrip({ me, px, real }: { me?: PlayerView; px?: number; real: boolean }) {
  const t = useT();
  const pos = me?.pos;
  if (!me || me.out || !pos)
    return <div className={`ps ps-idle ${me?.out ? 'down' : ''}`}>{t(!me ? 'hud.spectating' : me.out ? 'hud.outNow' : 'hud.flatHint')}</div>;
  const pnl = real ? me.pnl - me.realized : px ? upnl(pos, px) : 0;
  const liq = liqPrice(me.realized, pos);
  const dist = px ? Math.abs(px - liq) / px : 1;
  const full = Math.abs(pos.entryPx - liq) / pos.entryPx || 1;
  const safe = Math.max(0, Math.min(1, dist / full));
  const risk = safe < 0.2 ? 'hot' : safe < 0.45 ? 'warn' : '';
  return (
    <motion.div key={`${pos.market}-${pos.isLong}-${pos.entryPx}`} className={`ps ${pos.isLong ? 'long' : 'short'}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <span className="ps-side">
        {pos.isLong ? '▲ Long' : '▼ Short'} {MARKETS[pos.market]}
      </span>
      <span className="ps-meta num">
        {kUsd(pos.notional)} · {me.leverage}x · {t('hud.entryAt', { px: fmtPx(pos.entryPx) })}
      </span>
      <b className={`ps-pnl num ${pnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(pnl, true)}</b>
      {real ? <span className="ps-liq text-muted">{t('live.isolated')}</span> : <span className={`ps-liq ${risk}`} title={`${t('hud.liqPrice')} ${fmtPx(liq)}`}>
        <i>
          <b style={{ width: `${safe * 100}%` }} />
        </i>
        <span className="num">{t('hud.toLiq', { p: (dist * 100).toFixed(1) })}</span>
      </span>}
    </motion.div>
  );
}
