'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MARKETS, MODES, MARGIN, explorerTx, fmtPx, fmtUsd, payouts, type MarketSymbol, STAKE } from '@longshort/shared';
import Link from 'next/link';
import type { FeedItem, MatchView } from '@/lib/match';
import { useScene } from '@/lib/scene';
import { sfx } from '@/lib/sfx';
import { PriceChart } from './PriceChart';
import { Scoreboard } from './Scoreboard';
import { TradePanel, type Fill, type HudActions } from './TradePanel';
import { Positions } from './Positions';
import { Hint, PanelHeader } from '../ui/Hint';
import { useT } from '@/lib/i18n';

export function TimerRing({ left, total }: { left: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / total));
  const hot = left <= 10;
  return (
    <div className="relative grid h-11 w-11 place-items-center">
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="4" fill="none" />
        <circle cx="32" cy="32" r={r} stroke={hot ? '#d25a55' : '#e7e1d3'} strokeWidth="4" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} strokeLinecap="butt" style={{ transition: 'stroke-dashoffset .25s linear' }} />
      </svg>
      <span className={`num text-sm font-bold ${hot ? 'text-red animate-pulse' : ''}`}>{Math.max(0, Math.ceil(left))}</span>
    </div>
  );
}

function KillFeed({ feed }: { feed: FeedItem[] }) {
  const items = [...feed].reverse().slice(0, 30);
  return (
    <div className="scroll-thin grid max-h-full content-start gap-0.5 overflow-x-hidden overflow-y-auto">
      <AnimatePresence initial={false}>
        {items.map((f) => (
          <motion.a
            key={f.id}
            href={f.tx ? explorerTx(f.tx) : undefined}
            target="_blank"
            rel="noreferrer"
            layout
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            className={`flex items-baseline gap-2 border-l-2 bg-white/[0.02] px-1.5 py-0.5 text-[11px] hover:bg-white/[0.05] ${f.tone === 'up' ? 'border-green' : f.tone === 'down' ? 'border-red' : f.tone === 'warn' ? 'border-gold' : 'border-line'}`}
          >
            {f.who && <b className="shrink-0 font-semibold text-white">{f.who}</b>}
            <span className={`num truncate ${f.tone === 'up' ? 'up' : f.tone === 'down' ? 'down' : f.tone === 'warn' ? 'text-gold font-bold' : 'text-muted'}`}>{f.text}</span>
          </motion.a>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Order latency, framed the way players already read network quality: as ping. */
function Ping({ fills, simulated }: { fills: Fill[]; simulated?: boolean }) {
  const t = useT();
  const ok = fills.filter((f) => f.ok);
  const last = ok[0];
  const tone = (ms: number) => (ms < 700 ? 'var(--green)' : ms < 1500 ? 'var(--gold)' : 'var(--red)');
  const recent = ok.slice(0, 12).reverse();
  const max = Math.max(800, ...recent.map((f) => f.ms));
  return (
    <div className="grid gap-2">
      <PanelHeader title={t('hud.ping')} sub={t('hud.pingSub')} hint="Every order you place settles on Monad. This is how long each one took to confirm, from click to fill. Click a row to see its proof." />
      <div className="flex items-end justify-between gap-3">
        <motion.div key={last?.id ?? 0} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="num text-[26px] leading-none font-bold" style={{ color: last && !simulated ? tone(last.ms) : 'var(--dim)' }}>
          {simulated ? t('hud.instant') : last ? last.ms : '––'}
          {!simulated && <span className="ml-1 text-[12px] font-medium text-dim">ms</span>}
        </motion.div>
        <div className="flex h-7 items-end gap-[3px]" aria-hidden>
          {Array.from({ length: 12 }, (_, i) => {
            const f = recent[i - (12 - recent.length)];
            return <i key={i} className="block w-[5px]" style={{ height: f && !simulated ? `${Math.max(12, (f.ms / max) * 100)}%` : '12%', background: f && !simulated ? tone(f.ms) : 'var(--line-hi)' }} />;
          })}
        </div>
      </div>
      <div className="grid gap-1">
        {fills.slice(0, 4).map((f) => (
          <a key={f.id} href={f.hash ? explorerTx(f.hash) : undefined} target="_blank" rel="noreferrer" className={`num flex justify-between gap-2 text-[11px] ${f.ok ? 'text-muted hover:text-white' : 'text-red'}`}>
            <span className="truncate">{f.label}</span>
            {f.ok && !simulated && <span className="shrink-0">{f.ms} ms</span>}
          </a>
        ))}
        {!fills.length && <span className="text-[11px] text-dim">{t('hud.pingEmpty')}</span>}
      </div>
    </div>
  );
}

export function Hud({ m, now, actions, live }: { m: MatchView; now: number; actions: HudActions; live: boolean }) {
  const t = useT();
  const [market, setMarket] = useState(m.me?.pos?.market ?? 0);
  const [fills, setFills] = useState<Fill[]>([]);
  const onFill = useCallback((f: Fill) => setFills((x) => [f, ...x].slice(0, 20)), []);
  const cfg = MODES[m.mode];
  const left = m.endAt - now;
  const pay = payouts(m.mode, m.entry, m.maxPlayers);

  // countdown beeps in the last 5 seconds
  const lastBeep = useRef(0);
  useEffect(() => {
    const s = Math.ceil(left);
    if (live && s <= 5 && s > 0 && s !== lastBeep.current) {
      lastBeep.current = s;
      sfx.beep(s === 1);
    }
  }, [left, live]);

  // FX on knockouts
  const outs = useRef(new Set<string>());
  useEffect(() => {
    for (const p of m.players) {
      if (!p.out || outs.current.has(p.addr)) continue;
      outs.current.add(p.addr);
      if (p.isMe) {
        sfx.boom();
        useScene.getState().shake('rgba(210,90,85,0.45)');
      } else {
        sfx.close();
        useScene.getState().shake('rgba(201,162,74,0.15)');
      }
    }
  }, [m.players]);

  // arena energy follows how close the fight is
  useEffect(() => {
    const spread = Math.max(...m.players.map((p) => p.pnl), 0) - Math.min(...m.players.map((p) => p.pnl), 0);
    useScene.getState().set({ intensity: Math.min(1, 0.3 + spread / 200) });
  }, [m.players]);

  const danger = !!m.me?.pos && !m.me.out && m.me.equity < MARGIN * 0.35;

  return (
    <>
      {danger && <div className="danger-vignette" />}
      <div className="hud-grid">
        {/* header */}
        <div className="panel col-span-full flex flex-wrap items-center gap-x-6 gap-y-1 px-3 py-1.5">
          <div className="flex items-center gap-1" title="Time left in the match">
            <TimerRing left={live ? left : m.duration} total={m.duration} />
          </div>
          <div>
            <div className="panel-title">
              {actions.simulated ? t('hud.practice') : t('hud.ranked', { id: m.id })}
            </div>
            <div className="font-display text-lg leading-tight font-bold tracking-[0.12em] uppercase">{cfg.name}</div>
          </div>
          <Kv k={t('hud.entry')} v={`${m.entry} ${STAKE}`} />
          <Kv k={t('hud.pot')} v={`${pay.pot} ${STAKE}`} />
          <Kv k={t('hud.first')} v={`${pay.first.toFixed(2)} ${STAKE}`} accent />
          <Hint text="Everyone starts with 1,000 USD of virtual margin. The best final equity wins the pot of real stakes, paid by the contract at the bell. Equity = 1,000 + realized PnL + open PnL." />
          {m.me && <Kv k={t('hud.equity')} v={<span className={m.me.pnl >= 0 ? 'up' : 'down'}>{fmtUsd(m.me.equity)}</span>} />}
          <div className="ml-auto flex items-center gap-2 text-[11px] text-dim">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green" />
            <span title="Live prices from Perpl on Monad: the same feed every trade fills at">{t('hud.prices')}</span> · {MARKETS.map((s) => `${s} ${m.prices[s as MarketSymbol]?.toPrecision(6) ?? '…'}`).join(' · ')}
          </div>
        </div>
        {/* left: scoreboard */}
        <div className="hud-left panel scroll-thin flex flex-col gap-3 overflow-y-auto p-2">
          <Scoreboard m={m} now={now} />
          <MatchStats m={m} left={left} />
        </div>
        {/* center: chart + controls */}
        <div className="hud-center grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(200px,1fr)_auto_auto] gap-1.5">
          <div className="panel min-h-0 p-1">
            <PriceChart
              market={MARKETS[market]}
              pos={m.me?.pos && m.me.pos.market === market ? m.me.pos : null}
              realized={m.me?.realized}
              trades={m.trades}
              players={m.players}
            />
          </div>
          <Positions m={m} />
          {m.me ? (
            <TradePanel me={m.me} market={market} setMarket={setMarket} prices={m.prices} actions={actions} live={live} onFill={onFill} />
          ) : (
            <SpectatorBar market={market} setMarket={setMarket} prices={m.prices} mode={cfg.name} />
          )}
        </div>
        {/* right: feed */}
        <div className="hud-right grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-1.5">
          {m.me ? (
            <div className="panel p-2">
              <Ping fills={fills} simulated={actions.simulated} />
            </div>
          ) : (
            <div />
          )}
          <div className="panel flex min-h-0 flex-col gap-1.5 p-2">
            <PanelHeader title={t('hud.feed')} sub={t('hud.feedSub')} hint="A live log of every open, close, liquidation and elimination in this match, read from contract events. Click any line to see the transaction." />
            <KillFeed feed={m.feed} />
          </div>
        </div>
      </div>
    </>
  );
}

function Kv({ k, v, accent }: { k: string; v: React.ReactNode; accent?: boolean }) {
  return (
    <div>
      <div className="panel-title !text-[9px]">{k}</div>
      <div className={`num text-sm font-semibold ${accent ? 'text-gold' : ''}`}>{v}</div>
    </div>
  );
}

function MatchStats({ m, left }: { m: MatchView; left: number }) {
  const t = useT();
  const count = (k: FeedItem['kind']) => m.feed.filter((f) => f.kind === k).length;
  const flat = m.players.filter((p) => !p.pos && !p.out).length;
  const rows: [string, React.ReactNode][] = [
    [t('hud.trades'), count('open')],
    [t('hud.closes'), count('close')],
    [t('hud.liqs'), count('liquidated') + count('eliminated')],
    [t('hud.inPos'), `${m.players.length - flat - m.players.filter((p) => p.out).length}/${m.players.length}`],
    [t('hud.bestPnl'), m.players.length ? fmtUsd(Math.max(...m.players.map((p) => p.pnl)), true) : '–'],
    [t('hud.timeLeft'), `${Math.max(0, Math.ceil(left))}s`],
  ];
  return (
    <div className="mt-auto grid gap-0.5 border-t border-line pt-2">
      <PanelHeader title={t('hud.stats')} />
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between text-[11px]">
          <span className="text-dim">{k}</span>
          <span className="num">{v}</span>
        </div>
      ))}
    </div>
  );
}

function SpectatorBar({ market, setMarket, prices, mode }: { market: number; setMarket: (m: number) => void; prices: Record<MarketSymbol, number | undefined>; mode: string }) {
  const t = useT();
  return (
    <div className="panel flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="font-display text-xs font-bold tracking-[0.2em] text-muted uppercase">{t('hud.spectating')}</span>
      <div className="flex gap-1">
        {MARKETS.map((mk, i) => (
          <button key={mk} className={`chip ${market === i ? 'on' : ''}`} onClick={() => (sfx.click(), setMarket(i))}>
            {mk} <span className="num text-[10px] opacity-70">{prices[mk] ? fmtPx(prices[mk]!) : '…'}</span>
          </button>
        ))}
      </div>
      <Link href="/play" className="gbtn sm ml-auto">
        {t('hud.queue', { mode })}
      </Link>
    </div>
  );
}
