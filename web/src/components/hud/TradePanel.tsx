'use client';
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FEE_BPS, MARKETS, feeFor, fmtPx, fmtUsd, liqPrice, notionalFor, upnl, type MarketSymbol } from '@longshort/shared';
import type { PlayerView } from '@/lib/match';
import { sfx } from '@/lib/sfx';
import { useScene } from '@/lib/scene';
import { Hint, PanelHeader } from '../ui/Hint';
import { friendly } from '@/lib/errors';
import { useT } from '@/lib/i18n';

export interface HudActions {
  open: (market: number, isLong: boolean, sizeBps: number) => Promise<{ ms: number; hash?: string }>;
  close: () => Promise<{ ms: number; hash?: string }>;
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
  const px = prices[MARKETS[market]];
  const pos = me?.pos ?? null;
  const posPx = pos ? prices[MARKETS[pos.market]] : undefined;
  const equity = me?.equity ?? 0;
  const notional = me ? notionalFor(Math.max(0, 1000 + me.realized), me.leverage, size) : 0;
  const canTrade = live && !!me && !me.out && !pending;

  const run = useCallback(
    async (label: string, fn: () => Promise<{ ms: number; hash?: string }>) => {
      setPending(label);
      try {
        const r = await fn();
        sfx.confirm();
        onFill({ id: Date.now(), label, ms: r.ms, hash: r.hash, ok: true });
      } catch (e) {
        sfx.error();
        onFill({ id: Date.now(), label: `${label}: ${friendly(e)}`, ms: 0, ok: false });
      } finally {
        setPending(null);
      }
    },
    [onFill],
  );

  const go = useCallback(
    (isLong: boolean) => {
      if (!canTrade) return;
      isLong ? sfx.long() : sfx.short();
      useScene.getState().shake(isLong ? 'rgba(74,163,124,0.12)' : 'rgba(210,90,85,0.12)');
      void run(`${isLong ? 'LONG' : 'SHORT'} ${MARKETS[market]} ${size / 100}%`, () => actions.open(market, isLong, size));
    },
    [canTrade, run, actions, market, size],
  );
  const shut = useCallback(() => {
    if (!canTrade || !pos) return;
    sfx.close();
    void run(`CLOSE ${MARKETS[pos.market]}`, actions.close);
  }, [canTrade, pos, run, actions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'q') go(true);
      else if (k === 'e') go(false);
      else if (k === ' ' || k === 'x') (e.preventDefault(), shut());
      else if (['1', '2', '3'].includes(k)) setMarket(Number(k) - 1);
      else if (k === 'z') setSize(2500);
      else if (k === 'c') setSize(10_000);
      else if (k === 'v') setSize(5000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, shut, setMarket]);

  const pnl = pos && posPx ? upnl(pos, posPx) : 0;
  const liq = pos ? liqPrice(me!.realized, pos) : 0;
  const liqDist = pos && posPx ? Math.abs(posPx - liq) / posPx : 1;

  return (
    <div className="grid gap-1.5">
      {/* position card */}
      <AnimatePresence mode="wait">
        {pos ? (
          <motion.div
            key={`${pos.market}-${pos.isLong}-${pos.entryPx}`}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            className="panel grid grid-cols-2 gap-x-4 gap-y-0.5 px-3 py-1.5 sm:grid-cols-[auto_repeat(5,minmax(0,1fr))]"
            style={{ borderColor: pos.isLong ? 'rgba(74,163,124,0.5)' : 'rgba(210,90,85,0.5)' }}
          >
            <div className="flex items-center gap-1.5 self-center">
              <span className="phead">
                <h3>{t('hud.yourPos')}</h3>
              </span>
              <Hint text="Your open trade. Unrealized PnL moves with the Perpl price. If the price reaches the liquidation price, you're knocked out of the match with zero equity. A new LONG or SHORT closes this one first." />
            </div>
            <Stat k={t('hud.pos')} v={<span className={pos.isLong ? 'up' : 'down'}>{pos.isLong ? '▲ LONG' : '▼ SHORT'} {MARKETS[pos.market]}</span>} />
            <Stat k={t('hud.size')} v={fmtUsd(pos.notional)} />
            <Stat k={t('hud.entryMark')} v={`${fmtPx(pos.entryPx)} → ${posPx ? fmtPx(posPx) : '…'}`} />
            <Stat k={t('hud.liqPrice')} v={<span className={liqDist < 0.005 ? 'text-gold' : ''}>{fmtPx(liq)}</span>} />
            <Stat k={t('hud.unrealized')} v={<span className={`text-sm font-bold ${pnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(pnl, true)}</span>} />
          </motion.div>
        ) : (
          <motion.div key="flat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="panel px-3 py-1.5 text-xs text-muted">
            {me ? t(me.out ? 'hud.outNow' : 'hud.noPos') : t('hud.spectating')}
          </motion.div>
        )}
      </AnimatePresence>

      {/* controls */}
      <div className="hud-order panel grid min-w-0 gap-2 p-2">
        <div className="hud-order-head">
        <PanelHeader
          title={t('hud.order')}
          sub={t(actions.simulated ? 'hud.orderPractice' : 'hud.orderSub')}
          hint="Choose a market and how much of your equity to use, then go LONG (profit if price rises) or SHORT (profit if price falls). CLOSE locks in your PnL. Keyboard: 1-3 market, Z/V/C size, Q long, E short, Space close."
        />
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="grid gap-1">
            <span className="seg-label text-[9px] tracking-[0.14em] text-dim uppercase">{t('hud.market')}</span>
            <div className="seg">
              {MARKETS.map((m, i) => (
                <button key={m} className={market === i ? 'on' : ''} onClick={() => (sfx.click(), setMarket(i))}>
                  <span>
                    {m} <span className="seg-px num text-[10px] opacity-70">{prices[m] ? fmtPx(prices[m]!) : '…'}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto grid gap-1">
            <span className="seg-label text-[9px] tracking-[0.14em] text-dim uppercase">{t('hud.sizeShare')}</span>
            <div className="seg">
              {SIZES.map((sz, i) => (
                <button key={sz} className={size === sz ? 'on' : ''} onClick={() => (sfx.click(), setSize(sz))}>
                  <span>
                    {sz / 100}% <span className="kbd ml-1 !border-current/40 opacity-60">{'ZVC'[i]}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <button className="trade-btn long" disabled={!canTrade} onClick={() => go(true)}>
            {pending?.startsWith('LONG') ? '…' : '▲ Long'}
            <small>
              <span className="kbd">Q</span> <span className="hidden sm:inline">{t('hud.betUp')}</span>
              {me ? `${kUsd(notional)} · ${me.leverage}x` : ''}
            </small>
          </button>
          <button className="gbtn ghost h-[52px] px-4" disabled={!canTrade || !pos} onClick={shut}>
            <span className="grid text-center leading-tight">
              {t('hud.close')}
              <span className="text-[9px] font-medium tracking-wider opacity-60">{t('hud.lockPnl')}</span>
              <span className="kbd mx-auto mt-0.5">SPACE</span>
            </span>
          </button>
          <button className="trade-btn short" disabled={!canTrade} onClick={() => go(false)}>
            {pending?.startsWith('SHORT') ? '…' : 'Short ▼'}
            <small>
              <span className="kbd">E</span> <span className="hidden sm:inline">{t('hud.betDown')}</span>
              {me ? `${kUsd(notional)} · ${me.leverage}x` : ''}
            </small>
          </button>
        </div>
        <div className="hud-order-foot flex flex-wrap justify-between gap-2 text-[10px] text-dim">
          <span>
            {t('hud.fills', { bp: FEE_BPS, fee: fmtUsd(feeFor(notional)) })}
          </span>
          <span className="num">
            equity {fmtUsd(equity)} {px ? `· mark ${fmtPx(px)}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="panel-title !text-[9px]">{k}</div>
      <div className="num text-sm">{v}</div>
    </div>
  );
}
