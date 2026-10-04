'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { REAL_TRADING, MARGIN, MARKETS, MatchState, Mode, equityOf, feeFor, notionalFor, upnl, type Pos } from '@longshort/shared';
import { useMatch, type MatchView } from '@/lib/match';
import { useChainNow } from '@/lib/clock';
import { useScene, CLASS_COLOR, TEAM_COLOR, type Shot, type Slot } from '@/lib/scene';
import { cancelMatchmaking, joinAny, joinMatch, lastLeverage, prepareMatchRecovery, rematch, setClass, sweepMatchKey, tradeClose, tradeOpen, warmTrading } from '@/lib/actions';
import { formatEther } from 'viem';
import { useWallet } from '@/lib/wallet';
import { useSocket } from '@/lib/socket';
import * as mera from '@/lib/mera';
import { friendly } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { Hud } from '../hud/Hud';
import type { HudActions } from '../hud/TradePanel';
import { ClassSelect, MatchFound, Result, VsScreen, Waiting } from './Phases';

type Phase = 'loading' | 'waiting' | 'found' | 'select' | 'vs' | 'live' | 'settling' | 'result' | 'cancelled';

function phaseOf(m: MatchView, now: number): Phase {
  if (!m.loaded) return 'loading';
  if (m.state === MatchState.OPEN) return 'waiting';
  if (m.state === MatchState.CANCELLED) return 'cancelled';
  if (m.state === MatchState.SETTLED) return 'result';
  if (m.state === MatchState.CLOSING) return 'settling';
  const toStart = m.startAt - now;
  if (toStart > 12) return 'found';
  if (toStart > 4) return m.me && !m.me.out ? 'select' : 'vs';
  if (toStart > 0) return 'vs';
  return now < m.endAt ? 'live' : 'settling';
}

const slotOf = (p: MatchView['players'][number], teams: boolean, maxPnl: number): Slot => ({
  id: p.addr,
  name: p.name,
  character: p.character,
  leverage: p.leverage,
  color: teams ? TEAM_COLOR[p.team] : CLASS_COLOR[p.leverage],
  team: teams ? p.team : undefined,
  me: p.isMe,
  out: p.out,
  lead: maxPnl ? p.pnl / maxPnl : 0,
});

export function MatchScreen({ id }: { id: number }) {
  const t = useT();
  const m = useMatch(id);
  const now = useChainNow(200);
  const phase = phaseOf(m, now);
  const router = useRouter();
  const address = useWallet((s) => s.address);
  const locked = useWallet((s) => s.kind === 'passkey' && s.locked);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  // ─── 3D scene direction ─────────────────────────────────────────────────
  const teams = m.mode !== Mode.ROYALE;
  const sceneKey = `${phase}|${m.players.map((p) => `${p.addr}${p.leverage}${p.out ? 1 : 0}`).join()}|${m.maxPlayers}|${m.results?.length ?? 0}`;
  useEffect(() => {
    const set = useScene.getState().set;
    const maxPnl = Math.max(1, ...m.players.map((p) => Math.abs(p.pnl)));
    const all = m.players.map((p) => slotOf(p, teams, maxPnl));
    const shots: Record<Phase, Shot> = { loading: 'queue', waiting: 'queue', found: 'lobby', select: 'select', vs: 'vs', live: 'arena', settling: 'arena', result: 'result', cancelled: 'lobby' };
    let slots = all;
    if (phase === 'waiting') {
      const empties = Array.from({ length: Math.max(0, m.maxPlayers - all.length) }, (_, i): Slot => ({ empty: true, color: '#626873', name: 'searching…', team: teams ? (all.filter((s) => s.team === 0).length + i < m.maxPlayers / 2 ? 0 : 1) : undefined }));
      slots = [...all, ...empties];
    } else if (phase === 'select' && m.me) {
      slots = [{ ...slotOf(m.me, false, maxPnl), color: CLASS_COLOR[m.me.leverage] }];
    } else if (phase === 'result' && m.results?.length) {
      const paid = new Set(m.results.filter((r) => r.payout > 0).map((r) => r.addr));
      slots = m.players.filter((p) => paid.has(p.addr)).map((p) => ({ ...slotOf(p, false, maxPnl), color: '#c9a24a', lead: 1 }));
    }
    set({ shot: shots[phase], slots, intensity: phase === 'live' ? 0.5 : 0.25 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey]);

  // ─── passkey: no idle lock from queue to the bell ────────────────────────
  const active = ['waiting', 'found', 'select', 'vs', 'live', 'settling'].includes(phase) && !!m.me;
  const pinSession = ['found', 'select', 'vs', 'live'].includes(phase) && !!m.me;
  useEffect(() => (pinSession ? mera.pin() : undefined), [pinSession]);
  useEffect(() => {
    if (!active || locked || useWallet.getState().kind !== 'passkey') return;
    let current = true;
    void prepareMatchRecovery(id).catch((e) => { if (current) setErr(friendly(e)); });
    return () => { current = false; };
  }, [active, locked, id, address]);
  useEffect(() => void (active && warmTrading()), [active, address]);

  // ─── lobby guard heartbeat: bots only fill a lobby whose players are actually here ─
  const send = useSocket((s) => s.send);
  useEffect(() => {
    if (!active) return;
    const beat = () => send({ t: 'watch', matchId: id });
    beat();
    const i = setInterval(beat, 4000);
    return () => clearInterval(i);
  }, [active, id, send]);

  // ─── key lifecycle: a settled match's passkey trading key returns its leftover gas ─
  const swept = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (phase !== 'result' || !m.me || swept.current === id) return;
    swept.current = id;
    sweepMatchKey(id)
      .then((amt) => amt > 0n && console.info(`[longshort] match key swept ${formatEther(amt)} MON back to the owner`))
      .catch(() => {})
      .finally(() => mera.endMatch(id));
  }, [phase, m.me, id]);

  // ─── party follow: auto-join where the keeper sent us (leader seated here, or a rematch we accepted) ─
  // Only the keeper's own message counts: a shared link can't make this browser stake.
  const follow = useSocket((s) => s.joinMatch);
  const joinTried = useRef(false);
  useEffect(() => {
    if (follow?.matchId !== id || joinTried.current || !address || !m.loaded) return;
    useSocket.getState().clearJoin();
    if (m.me || m.state !== MatchState.OPEN) return;
    joinTried.current = true;
    setBusy(true);
    joinMatch(id, follow.team, lastLeverage())
      .catch((e) => setErr(friendly(e)))
      .finally(() => (setBusy(false), m.refresh()));
  }, [follow, address, m, id]);

  // ─── optimistic trades: the HUD shows the order the moment you click, the chain state replaces it ─
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const mRef = useRef(m);
  mRef.current = m;
  const actions: HudActions = useMemo(
    () => ({
      open: (market, isLong, size) => {
        const { me, prices } = mRef.current;
        const px = prices[MARKETS[market]];
        if (!REAL_TRADING && me && px) setGhost({ kind: 'open', market, isLong, size, px, base: me.pos, at: Date.now() });
        return tradeOpen(id, market, isLong, size).then(
          (r) => (mRef.current.refresh(), r),
          (e) => (setGhost(null), Promise.reject(e)),
        );
      },
      close: () => {
        const { me } = mRef.current;
        if (!REAL_TRADING && me?.pos) setGhost({ kind: 'close', base: me.pos, at: Date.now() });
        return tradeClose(id).then(
          (r) => (mRef.current.refresh(), r),
          (e) => (setGhost(null), Promise.reject(e)),
        );
      },
    }),
    [id],
  );
  // drop the ghost once the chain shows a different position than the one it replaced (or after 10s)
  const chainPos = m.me?.pos ?? null;
  useEffect(() => {
    if (!ghost) return;
    if (!samePos(chainPos, ghost.base)) return setGhost(null);
    const t = setTimeout(() => setGhost(null), Math.max(0, 10_000 - (Date.now() - ghost.at)));
    return () => clearTimeout(t);
  }, [chainPos, ghost]);
  const view = useMemo(() => (ghost ? withGhost(m, ghost) : m), [m, ghost]);

  const pick = (lev: number) => {
    setBusy(true);
    setClass(id, lev)
      .catch((e) => setErr(friendly(e)))
      .finally(() => (setBusy(false), m.refresh()));
  };

  const again = async () => {
    setBusy(true);
    try {
      const next = await rematch(id);
      router.push(`/match/${next}`);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  // cancel means cancel: while it resolves, no phase change (a lobby filling mid-cancel) pulls you into the match
  const [cancelling, setCancelling] = useState(false);
  const leave = async () => {
    setBusy(true);
    setCancelling(true);
    try {
      await cancelMatchmaking(id);
      useSocket.setState({ toast: t('mm.cancelled') });
      router.push('/play');
    } catch (e) {
      setErr(friendly(e));
      setBusy(false);
      setCancelling(false);
    }
  };

  return (
    <div className="relative min-h-[calc(100dvh-64px)]">
      {active && locked && (
        <div role="status" className="panel relative z-40 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">{t('session.locked')}</div>
            <p className="mt-1 text-xs text-muted">{t(phase === 'waiting' || phase === 'found' || phase === 'select' ? 'session.resumeWaiting' : 'session.resumeBody')}</p>
          </div>
          <button className="gbtn sm" disabled={busy} onClick={async () => {
            setBusy(true);
            setErr(undefined);
            try { await useWallet.getState().ensureUnlocked(); }
            catch (e) { setErr(friendly(e)); }
            finally { setBusy(false); }
          }}>
            {t('session.resume')}
          </button>
        </div>
      )}
      <AnimatePresence mode="wait">
        {cancelling && phase !== 'result' && (
          <motion.div key="x" className="grid h-[60vh] place-items-center text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="panel grid gap-1 px-10 py-6">
              <div className="font-display text-2xl font-bold tracking-[0.2em] uppercase">{t('mm.cancelling')}</div>
              <div className="text-sm text-muted">{t('mm.cancellingBody')}</div>
            </div>
          </motion.div>
        )}
        {!cancelling && phase === 'loading' && (
          <motion.div key="l" className="grid h-[60vh] place-items-center font-display tracking-[0.4em] text-muted uppercase" exit={{ opacity: 0 }}>
            {t('mm.loading', { id })}
          </motion.div>
        )}
        {!cancelling && phase === 'waiting' && (
          <Waiting
            key="w"
            m={m}
            now={now}
            onLeave={m.me ? leave : undefined}
            onJoin={!m.me && address && !m.rematchOf ? () => (setBusy(true), joinAny(id, m.mode, m.entry, lastLeverage()).catch((e) => setErr(friendly(e))).finally(() => (setBusy(false), m.refresh()))) : undefined}
            leaving={busy}
          />
        )}
        {!cancelling && phase === 'found' && <MatchFound key="f" m={m} />}
        {!cancelling && phase === 'select' && <ClassSelect key="s" m={m} left={m.startAt - 4 - now} onPick={pick} pending={busy} />}
        {!cancelling && phase === 'vs' && <VsScreen key="v" m={m} left={m.startAt - now} />}
        {!cancelling && (phase === 'live' || phase === 'settling') && (
          <motion.div key="h" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
            <Hud m={view} now={now} actions={actions} live={phase === 'live'} />
            {phase === 'settling' && (
              <div className="pointer-events-none fixed inset-0 z-30 grid place-items-center bg-black/40">
                <motion.div initial={{ scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="panel px-10 py-6 text-center">
                  <div className="font-display text-4xl font-bold tracking-[0.2em] uppercase">{t('mm.time')}</div>
                  <div className="mt-1 text-sm text-muted">{t('mm.settling')}</div>
                </motion.div>
              </div>
            )}
          </motion.div>
        )}
        {phase === 'result' && <Result key="r" m={m} onAgain={again} busy={busy} />}
        {!cancelling && phase === 'cancelled' && (
          <motion.div key="c" {...{ initial: { opacity: 0 }, animate: { opacity: 1 } }} className="grid h-[60vh] place-items-center text-center">
            <div className="panel p-8">
              <div className="font-display text-3xl font-bold uppercase">{t('mm.cancelledTitle')}</div>
              <p className="mt-2 text-sm text-muted">{t('mm.cancelledBody')}</p>
              <button className="gbtn mt-4" onClick={() => router.push('/play')}>
                {t('mm.backLobby')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {err && (
        <button onClick={() => setErr(undefined)} className="panel fixed right-4 bottom-4 z-50 max-w-sm px-4 py-3 text-left text-xs text-red">
          {err}
        </button>
      )}
    </div>
  );
}

type Ghost = { at: number; base: Pos | null } & ({ kind: 'open'; market: number; isLong: boolean; size: number; px: number } | { kind: 'close' });

const samePos = (a: Pos | null, b: Pos | null) => (!a && !b) || (!!a && !!b && a.market === b.market && a.isLong === b.isLong && a.entryPx === b.entryPx);

/** Your row as the contract will have it once the pending order lands (same math: close first, fee per side). */
function withGhost(m: MatchView, g: Ghost): MatchView {
  const me = m.me;
  if (!me || me.out) return m;
  let realized = me.realized;
  const pricer = (p: Pos) => m.prices[MARKETS[p.market]];
  if (me.pos) {
    const px = pricer(me.pos);
    if (px) realized += upnl(me.pos, px) - feeFor(me.pos.notional);
  }
  let pos: Pos | null = null;
  if (g.kind === 'open') {
    const notional = notionalFor(Math.max(0, MARGIN + realized), me.leverage, g.size);
    realized -= feeFor(notional);
    pos = { market: g.market, isLong: g.isLong, notional, entryPx: g.px };
  }
  const equity = equityOf(realized, pos, pos ? pricer(pos) : undefined);
  const next = { ...me, realized, pos, equity, pnl: equity - MARGIN };
  return { ...m, me: next, players: m.players.map((p) => (p.isMe ? next : p)) };
}
