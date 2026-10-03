'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { REAL_TRADING, MARGIN, MARKETS, MAINT, Mode, MatchState, equityOf, feeFor, notionalFor, upnl, type MarketSymbol, type Pos, shortAddr } from '@longshort/shared';
import { useSocket, lastPx } from '@/lib/socket';
import { useWallet } from '@/lib/wallet';
import { useScene, TEAM_COLOR } from '@/lib/scene';
import { lastLeverage } from '@/lib/actions';
import type { FeedItem, MatchView, PlayerView, TradeRow } from '@/lib/match';
import { Hud } from '@/components/hud/Hud';
import type { HudActions } from '@/components/hud/TradePanel';
import { Result, VsScreen } from '@/components/match/Phases';
import { useT } from '@/lib/i18n';

const DURATION = 60;
const COUNTDOWN = 4;

interface Seat {
  addr: string;
  name: string;
  leverage: number;
  realized: number;
  pos: Pos | null;
  out: boolean;
}

/** Client-side practice using the contract's exact math on live Perpl prices, against a scripted bot. */
export default function Practice() {
  const t = useT();
  const ticks = useSocket((s) => s.prices);
  const connected = useSocket((s) => s.connected);
  const address = useWallet((s) => s.address?.toLowerCase()) ?? '0xyou';
  const prices = useMemo(() => Object.fromEntries(MARKETS.map((m) => [m, lastPx(ticks[m])])) as Record<MarketSymbol, number | undefined>, [ticks]);
  const pxRef = useRef(prices);
  pxRef.current = prices;

  const [run, setRun] = useState(0);
  const [startAt, setStartAt] = useState<number | null>(null);
  const pausedAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const botStep = useRef(0);

  useEffect(() => {
    setSeats([
      { addr: address, name: address.startsWith('0x') && address.length > 10 ? shortAddr(address) : 'Guest', leverage: lastLeverage(), realized: 0, pos: null, out: false },
      { addr: '0xbot', name: 'bot·Rex', leverage: REAL_TRADING ? lastLeverage() : 25, realized: 0, pos: null, out: false },
    ]);
    setFeed([]);
    setTrades([]);
    botStep.current = 0;
    pausedAt.current = null;
    setStartAt(null);
  }, [run, address]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 200);
    return () => clearInterval(t);
  }, []);

  // live matches trade BTC only, so Practice needs (and trades) only BTC as well
  const pricesReady = connected && (REAL_TRADING ? [MARKETS[0]] : MARKETS).every((m) => Number.isFinite(prices[m]) && prices[m]! > 0);
  const roundNow = pausedAt.current ?? now;
  const roundStart = startAt ?? now + COUNTDOWN;
  const endAt = roundStart + DURATION;
  const live = pricesReady && startAt !== null && roundNow >= roundStart && roundNow < endAt;
  const done = startAt !== null && roundNow >= endAt;
  // Do not run the countdown or bot against missing prices. A disconnect preserves round time.
  useEffect(() => {
    if (done) return;
    const at = Date.now() / 1000;
    if (!pricesReady) {
      if (startAt !== null && pausedAt.current === null) pausedAt.current = at;
    } else if (startAt === null) {
      setStartAt(at + COUNTDOWN);
    } else if (pausedAt.current !== null) {
      const downtime = at - pausedAt.current;
      pausedAt.current = null;
      setStartAt((s) => s === null ? at + COUNTDOWN : s + downtime);
    }
  }, [pricesReady, startAt, done]);

  const push = useCallback((who: string, text: string, tone: FeedItem['tone'], kind: FeedItem['kind']) => {
    setFeed((f) => [...f, { id: `${Date.now()}-${Math.random()}`, at: Date.now(), who, text, tone, kind }].slice(-60));
  }, []);

  const record = useCallback((row: Omit<TradeRow, 'ts' | 'tx'>) => setTrades((t) => [...t, { ...row, ts: Date.now() / 1000, tx: '' }]), []);

  const mutate = useCallback((i: number, fn: (s: Seat) => Seat) => setSeats((ss) => ss.map((s, j) => (j === i ? fn(s) : s))), []);

  const doClose = useCallback(
    (i: number) =>
      mutate(i, (s) => {
        if (!s.pos) return s;
        const px = pxRef.current[MARKETS[s.pos.market]];
        if (!Number.isFinite(px) || !px || px <= 0) return s;
        const gross = upnl(s.pos, px);
        const pnl = gross - feeFor(s.pos.notional);
        record({ kind: 'close', addr: s.addr, market: s.pos.market, is_long: Number(s.pos.isLong), notional: s.pos.notional, price: px, pnl: gross, fee: feeFor(s.pos.notional) });
        push(s.name, `closed ${MARKETS[s.pos.market]} ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`, pnl >= 0 ? 'up' : 'down', 'close');
        return { ...s, realized: s.realized + pnl, pos: null };
      }),
    [mutate, push, record],
  );

  const doOpen = useCallback(
    (i: number, market: number, isLong: boolean, sizeBps: number) => {
      const px = pxRef.current[MARKETS[market]];
      if (!Number.isFinite(px) || !px || px <= 0) throw new Error('Waiting for price feed');
      doClose(i);
      mutate(i, (s) => {
        const notional = notionalFor(Math.max(0, MARGIN + s.realized), s.leverage, sizeBps);
        record({ kind: 'open', addr: s.addr, market, is_long: Number(isLong), notional, price: px, pnl: null, fee: feeFor(notional) });
        push(s.name, `${isLong ? 'LONG' : 'SHORT'} ${MARKETS[market]} $${(notional / 1000).toFixed(1)}k @ ${px.toPrecision(6)}`, isLong ? 'up' : 'down', 'open');
        return { ...s, realized: s.realized - feeFor(notional), pos: { market, isLong, notional, entryPx: px } };
      });
    },
    [doClose, mutate, push, record],
  );

  // bot script (ported from the legacy practice mode) + liquidations
  useEffect(() => {
    if (!live) return;
    const t = roundNow - roundStart;
    const steps: [number, () => void][] = [
      [4, () => doOpen(1, REAL_TRADING ? 0 : 1, true, 10_000)],
      [22, () => doClose(1)],
      [27, () => doOpen(1, REAL_TRADING ? 0 : 2, false, 7_500)],
      [41, () => doOpen(1, 0, Math.random() < 0.5, 5_000)],
      [55, () => doClose(1)],
    ];
    while (botStep.current < steps.length && t >= steps[botStep.current][0]) steps[botStep.current++][1]();
    seats.forEach((s, i) => {
      if (s.out || !s.pos) return;
      const px = prices[MARKETS[s.pos.market]];
      if (px && MARGIN + s.realized + upnl(s.pos, px) <= MARGIN * MAINT) {
        mutate(i, (x) => ({ ...x, pos: null, realized: -MARGIN, out: true }));
        record({ kind: 'liquidated', addr: s.addr, market: s.pos.market, is_long: Number(s.pos.isLong), notional: s.pos.notional, price: px, pnl: null, fee: null });
        push(s.name, 'LIQUIDATED', 'warn', 'liquidated');
      }
    });
  }, [roundNow, live, roundStart, seats, prices, doOpen, doClose, mutate, push, record]);

  // close everything at the bell
  const settled = useRef(-1);
  useEffect(() => {
    if (done && settled.current !== run) {
      settled.current = run;
      doClose(0);
      doClose(1);
    }
  }, [done, run, doClose]);

  const players: PlayerView[] = seats.map((s, i) => {
    const px = s.pos ? prices[MARKETS[s.pos.market]] : undefined;
    const equity = s.out ? 0 : equityOf(s.realized, s.pos, px);
    return { addr: s.addr, name: s.name, bot: i === 1, team: i, leverage: s.leverage, out: s.out, outRank: 0, realized: s.realized, pos: s.pos, equity, pnl: equity - MARGIN, isMe: i === 0, session: '' };
  });
  const [a, b] = players;
  const win = done && a && b ? (a.equity > b.equity ? 'win' : a.equity < b.equity ? 'loss' : 'draw') : undefined;

  const m: MatchView = {
    id: 0,
    trades,
    loaded: true,
    mode: Mode.DUEL,
    state: done ? MatchState.SETTLED : MatchState.LIVE,
    entry: 0,
    maxPlayers: 2,
    nPlayers: 2,
    duration: DURATION,
    createdAt: roundStart,
    startAt: roundStart,
    endAt,
    round: 0,
    players,
    me: players[0],
    prices,
    feed,
    results: done && a && b ? [
      { addr: a.addr, result: win!, payout: 0, final_equity: a.equity, xp_delta: 0 },
      { addr: b.addr, result: win === 'win' ? 'loss' : win === 'loss' ? 'win' : 'draw', payout: 0, final_equity: b.equity, xp_delta: 0 },
    ] : undefined,
    refresh: () => {},
  };

  const actions: HudActions = useMemo(
    () => ({
      simulated: true,
      open: async (market, isLong, size) => (doOpen(0, market, isLong, size), { ms: 0 }),
      close: async () => (doClose(0), { ms: 0 }),
    }),
    [doOpen, doClose],
  );

  useEffect(() => {
    const phase = done ? 'result' : live ? 'arena' : !pricesReady ? 'backdrop' : 'vs';
    const slots = players.map((p) => ({ name: p.name, leverage: p.leverage, color: phase === 'result' ? (p.equity >= Math.max(...players.map((x) => x.equity)) ? '#c9a24a' : '#44474f') : TEAM_COLOR[p.team], team: p.team, me: p.isMe, out: p.out }));
    useScene.getState().set({ shot: phase, slots });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, live, pricesReady, seats.length]);

  if (!a || !b) return null;
  if (!done && (!pricesReady || startAt === null)) return (
    <div className="practice-wait grid place-items-center px-4 py-8">
      <div role="status" aria-live="polite" className="panel grid w-full max-w-sm gap-4 p-5" style={{ background: 'var(--panel-solid)' }}>
        <div className="panel-title">{t('mm.practiceBanner')}</div>
        <h1 className="font-display text-2xl font-bold">{t(startAt === null ? 'practice.waiting' : 'practice.paused')}</h1>
        <p className="text-sm leading-relaxed text-muted">{t(startAt === null ? 'practice.waitingBody' : 'practice.pausedBody')}</p>
        <Link href="/play" className="gbtn ghost">{t('nav.play')}</Link>
      </div>
    </div>
  );
  return (
    <div className="relative">
      <AnimatePresence mode="wait">
        {!live && !done && <VsScreen key="vs" m={m} left={roundStart - roundNow} note={t('mm.practiceBanner')} />}
        {(live || (done && !m.results)) && (
          <motion.div key="hud" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Hud m={m} now={now} actions={actions} live={live} />
          </motion.div>
        )}
        {done && m.results && <Result key="res" m={m} busy={false} onAgain={() => setRun((r) => r + 1)} />}
      </AnimatePresence>
    </div>
  );
}
