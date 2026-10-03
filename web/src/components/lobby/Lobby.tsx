'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { REAL_TRADING, TRADING_BUDGET, CLASSES, ENTRY_TIERS, MODES, Mode, classOf, payouts, shortAddr, type ClassId, STAKE } from '@longshort/shared';
import { Hint, PanelHeader } from '../ui/Hint';
import { useWallet } from '@/lib/wallet';
import { useSocket } from '@/lib/socket';
import { useApi } from '@/lib/api';
import { useScene, CLASS_COLOR, type Slot } from '@/lib/scene';
import { cancelMatchmaking, lastLeverage, partyPlay, quickPlay, rememberLeverage } from '@/lib/actions';
import { sfx } from '@/lib/sfx';
import { friendly } from '@/lib/errors';
import { useT, type Key } from '@/lib/i18n';
import { ConnectDialog } from '../ConnectDialog';
import { Guide, guideSeen } from './Guide';
import { PlayerSearch } from '../PlayerSearch';
import { useDialog } from '@/lib/useDialog';

type LobbyMode = Mode | 'practice';
const MODE_LIST: LobbyMode[] = REAL_TRADING ? [Mode.DUEL, 'practice'] : [Mode.DUEL, Mode.SQUAD, Mode.ROYALE, 'practice'];

const MODE_INFO: Record<string, { desc: Key }> = {
  duel: { desc: 'mode.duel' },
  squad: { desc: 'mode.squad' },
  royale: { desc: 'mode.royale' },
  practice: { desc: 'mode.practice' },
};
const modeCfg = (m: LobbyMode) => (m === 'practice' ? { key: 'practice', name: 'Practice', tagline: 'vs bot · live prices · no stake', maxPlayers: 2, duration: 60 } : MODES[m]);

/** Mode "art": the seats each mode fills, as class-coloured pips (you are the bright one). */
function Seats({ n, me = -1 }: { n: number; me?: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="block h-6 w-3 -skew-x-12" style={{ background: i === me ? 'var(--accent)' : 'rgba(231,229,224,0.16)', boxShadow: i === me ? '0 0 12px rgba(231,225,211,0.45)' : undefined }} />
      ))}
    </div>
  );
}
function ModeArt({ mode }: { mode: LobbyMode }) {
  const t = useT();
  const vs = <span className="font-display text-xs font-bold tracking-widest text-dim">VS</span>;
  if (mode === Mode.DUEL)
    return (
      <div className="flex items-center justify-center gap-3">
        <Seats n={1} me={0} />
        {vs}
        <Seats n={1} />
      </div>
    );
  if (mode === Mode.SQUAD)
    return (
      <div className="flex items-center justify-center gap-3">
        <Seats n={3} me={1} />
        {vs}
        <Seats n={3} />
      </div>
    );
  if (mode === Mode.ROYALE)
    return (
      <div className="flex justify-center">
        <Seats n={8} me={3} />
      </div>
    );
  return (
    <div className="flex items-center justify-center gap-3">
      <Seats n={1} me={0} />
      <span className="font-display text-xs font-bold tracking-widest text-dim">{t('lb.vsBot')}</span>
    </div>
  );
}

function QueueCard({ mode, entry, locked, onOpen }: { mode: LobbyMode; entry: number; locked: boolean; onOpen: () => void }) {
  const t = useT();
  const cfg = modeCfg(mode);
  const { data: live } = useApi<any[]>('/matches?state=live', 5000);
  return (
    <motion.div data-tour="mode" initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="lobby-queue panel pointer-events-auto absolute top-3 left-3 grid w-[270px] gap-2 p-2.5 sm:p-3">
      {/* phones: one compact row */}
      <div className="flex items-center gap-3 sm:hidden">
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg leading-none font-bold tracking-[0.08em] uppercase">{cfg.name}</div>
          <div className="num mt-1 truncate text-[10px] text-muted">
            {cfg.maxPlayers}p · {cfg.duration}s · {mode === 'practice' ? t('lb.free') : `${entry} ${STAKE}`}
            {!!live?.length && <span className="text-red"> · ● {t('lb.live', { n: live.length })}</span>}
          </div>
        </div>
        <button className="gbtn ghost sm shrink-0" disabled={locked} onClick={() => (sfx.click(), onOpen())}>
          {t(locked ? 'lb.leaderPicks' : 'lb.change')}
        </button>
      </div>
      <div className="hidden sm:block">
        <PanelHeader title={t('lb.gameMode')} hint="What you'll queue into when you press PLAY. Duel is 1v1, Squad is 3v3 with your party, Royale is 8-player elimination, and Practice is free against a bot." />
      </div>
      <div className="hidden sm:block">
        <div className="font-display text-2xl leading-none font-bold tracking-[0.08em] uppercase">{cfg.name}</div>
        <div className="mt-1 text-[11px] text-muted">{cfg.tagline}</div>
      </div>
      <div className="num hidden grid-cols-3 border-y border-line py-1.5 text-center text-[10px] sm:grid">
        <div>
          <div className="text-dim uppercase">{t('lb.players')}</div>
          <div className="text-[12px] text-[var(--text)]">{cfg.maxPlayers}</div>
        </div>
        <div>
          <div className="text-dim uppercase">{t('lb.length')}</div>
          <div className="text-[12px] text-[var(--text)]">{cfg.duration}s</div>
        </div>
        <div>
          <div className="text-dim uppercase">{t('lb.entry')}</div>
          <div className="text-[12px] text-[var(--text)]">{mode === 'practice' ? t('lb.free') : `${entry} ${STAKE}`}</div>
        </div>
      </div>
      <div className="hidden items-center gap-2 sm:flex">
        <button className="gbtn ghost sm flex-1" disabled={locked} onMouseEnter={sfx.hover} onClick={() => (sfx.click(), onOpen())}>
          {t(locked ? 'lb.leaderPicksMode' : 'lb.changeMode')}
        </button>
        {!!live?.length && (
          <button className="text-[10px] tracking-wider text-red uppercase hover:underline" onClick={() => (sfx.click(), onOpen())} title={t('lb.liveTitle')}>
            ● {t('lb.live', { n: live.length })}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function ModeSelect({
  open,
  mode,
  entry,
  onPick,
  onClose,
}: {
  open: boolean;
  mode: LobbyMode;
  entry: number;
  onPick: (m: LobbyMode, entry: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [m, setM] = useState<LobbyMode>(mode);
  const [e, setE] = useState(entry);
  const panel = useDialog(open, onClose);
  useEffect(() => {
    if (open) (setM(mode), setE(entry));
  }, [open, mode, entry]);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const pay = m === 'practice' ? null : payouts(m, e, MODES[m].maxPlayers);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="mode-title"
          className="mode-select pointer-events-auto fixed inset-x-0 bottom-0 z-40 bg-[rgba(12,13,16,0.94)] backdrop-blur-md"
        >
          <div ref={panel} tabIndex={-1} className="mode-select-content mx-auto grid max-w-6xl gap-5 px-6 py-6 outline-none">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="panel-title">{t('ms.kicker')}</div>
                <h2 id="mode-title" className="font-display text-3xl font-bold tracking-[0.1em] uppercase">{t('ms.title')}</h2>
              </div>
              <button className="gbtn ghost sm shrink-0" onClick={onClose}>
                {t('ms.back')}
              </button>
            </div>
            <div className="mode-select-body scroll-thin grid content-start gap-4 overflow-y-auto">
            <div className="grid gap-3 md:grid-cols-4">
              {MODE_LIST.map((x, i) => {
                const cfg = modeCfg(x);
                const on = m === x;
                return (
                  <motion.button
                    key={String(x)}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    whileHover={{ y: -4 }}
                    onMouseEnter={sfx.hover}
                    onClick={() => (sfx.select(), setM(x))}
                    aria-pressed={on}
                    className={`mode-option panel grid min-w-0 content-start gap-3 p-4 text-left ${on ? 'bg-[var(--panel-hi)]!' : ''}`}
                    style={on ? { borderColor: 'var(--accent)', boxShadow: 'inset 0 -3px 0 var(--accent)' } : undefined}
                  >
                    <div className="mode-art grid h-24 place-items-center overflow-hidden border border-line bg-black/20">
                      <ModeArt mode={x} />
                    </div>
                    <div className="mode-copy">
                      <div className="font-display text-xl font-bold tracking-[0.1em] uppercase">{cfg.name}</div>
                      <div className="num text-[11px] text-dim">
                        {t('ms.meta', { n: cfg.maxPlayers, s: cfg.duration })}
                      </div>
                    </div>
                    <p className="text-xs leading-relaxed text-muted">{t(MODE_INFO[cfg.key].desc)}</p>
                  </motion.button>
                );
              })}
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
              <div className="panel grid content-start gap-2 p-4">
                <PanelHeader title={t('ms.stake')} sub={t('ms.stakeSub')} hint="Every player escrows the same stake in the ArenaCore contract. Winners are paid from the pot minus a 2.5% rake. This stake is the most you can lose." />
                {m === 'practice' ? (
                  <p className="text-sm text-muted">{t('ms.practiceFree')}</p>
                ) : (
                  <>
                    <div className="seg block">
                      {ENTRY_TIERS.map((tier) => (
                        <button key={tier} className={e === tier ? 'on' : ''} onClick={() => (sfx.click(), setE(tier))}>
                          <span>{tier} {STAKE}</span>
                        </button>
                      ))}
                    </div>
                    {pay && (
                      <div className="num mt-1 text-sm">
                        {t('ms.pot')} {pay.pot} {STAKE} · {t(m === Mode.SQUAD ? 'ms.each' : 'ms.first')} <span className="text-gold">{pay.first.toFixed(2)}</span>
                        {m === Mode.ROYALE && (
                          <>
                            {' '}
                            · {t('ms.second')} {pay.second!.toFixed(2)} · {t('ms.third')} {pay.third!.toFixed(2)}
                          </>
                        )}{' '}
                        · {t('ms.rake')}
                      </div>
                    )}
                    <p className="text-[11px] text-dim">
                      {t('ms.onlyStake')} <Link href="/rules" className="link">{t('lb.rules')}</Link>
                    </p>
                  </>
                )}
              </div>
              <LivePanel />
            </div>
            </div>
            <div className="mode-confirm flex justify-end border-t border-line pt-3">
              <button className="btn-play" onClick={() => (sfx.lockIn(), onPick(m, e), onClose())}>
                {t('ms.confirm')}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Lobby() {
  const router = useRouter();
  const search = useSearchParams();
  const { address, kind, usd, claimOpen } = useWallet();
  const { party, online, send } = useSocket();
  const me = address?.toLowerCase();
  const [mode, setMode] = useState<LobbyMode>(Mode.DUEL);
  const [entry, setEntry] = useState<number>(5);
  const [lev, setLev] = useState<number>(REAL_TRADING ? 5 : 25);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [connect, setConnect] = useState(false);
  const [queuedAt, setQueuedAt] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);
  const [guide, setGuide] = useState(false);
  const t = useT();
  useEffect(() => setLev(lastLeverage()), []);
  // first visit: the how-to-play tour opens once the lobby has laid out; /play?guide=1 reopens it
  useEffect(() => {
    if (search.get('guide') === '1') return setGuide(true);
    if (guideSeen()) return;
    const t = setTimeout(() => setGuide(true), 900);
    return () => clearTimeout(t);
  }, [search]);
  // landing page deep-links: /play?mode=duel|squad|royale
  useEffect(() => {
    const m = Object.entries(MODES).find(([, v]) => v.key === search.get('mode'));
    if (m && (!REAL_TRADING || Number(m[0]) === Mode.DUEL)) setMode(Number(m[0]) as Mode);
  }, [search]);

  const inParty = !!party && party.members.length > 1;
  const leader = !party || party.leader === me;
  const effMode: LobbyMode = inParty && !leader ? (party!.mode as Mode) : mode;
  const effEntry = inParty && !leader ? party!.entry : entry;

  // join via invite link
  useEffect(() => {
    const pid = search.get('party');
    if (pid && me) send({ t: 'party:join', partyId: pid });
  }, [search, me, send]);

  // leader broadcasts selection to party
  useEffect(() => {
    if (party && leader && mode !== 'practice') send({ t: 'party:set', mode, entry });
  }, [mode, entry, party?.id, leader, send]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 3D lobby: pedestals for me + party + invite slots ──────────────────
  const slotsKey = JSON.stringify([effMode, lev, party?.members, me]);
  useEffect(() => {
    const members = party?.members ?? (me ? [{ addr: me, name: undefined, ready: false, leverage: lev }] : []);
    const mine = members.find((m) => m.addr === me);
    const others = members.filter((m) => m.addr !== me);
    const toSlot = (m: { addr: string; name?: string; leverage: number }, isMe: boolean): Slot => ({
      name: isMe ? 'YOU' : (m.name ?? shortAddr(m.addr)),
      leverage: isMe ? lev : m.leverage,
      color: CLASS_COLOR[isMe ? lev : m.leverage],
      me: isMe,
    });
    const cap = effMode === Mode.SQUAD ? 3 : effMode === Mode.DUEL ? 2 : effMode === 'practice' ? 2 : 3;
    const slots: Slot[] = others.map((m) => toSlot(m, false));
    if (me) slots.splice(Math.floor(slots.length / 2), 0, toSlot(mine ?? { addr: me, leverage: lev }, true));
    else slots.push({ empty: true, color: '#626873', name: t('lb.slotSignIn') });
    if (effMode === 'practice') slots.push({ name: 'Sparring bot', leverage: 25, color: '#626873' });
    while (slots.length < cap && effMode !== 'practice') slots.push({ empty: true, color: '#626873', name: t(effMode === Mode.DUEL ? 'lb.slotRival' : 'lb.slotInvite') });
    useScene.getState().set({ shot: queuedAt ? 'queue' : 'lobby', slots, intensity: 0.25 });
  }, [slotsKey, queuedAt, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickClass = (l: number) => {
    sfx.lockIn();
    setLev(l);
    rememberLeverage(l);
    if (party) send({ t: 'party:ready', ready: true, leverage: l });
  };

  // cancel while queueing: the join tx may still land, so a cancelled queue is cancelled onchain right after
  const cancelQ = useRef(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [cancelQueued, setCancelQueued] = useState(false);
  useEffect(() => () => void (busyRef.current && (cancelQ.current = true)), []); // leaving the page mid-queue cancels too

  const findMatch = async () => {
    if (!address) return setConnect(true);
    if (effMode === 'practice') return router.push('/practice');
    setErr(undefined);
    setBusy(true);
    cancelQ.current = false;
    setCancelQueued(false);
    setQueuedAt(Date.now());
    sfx.queue();
    try {
      if (inParty && effMode === Mode.DUEL && party!.members.length > 2) throw new Error('Duel parties are 2 players: switch to Squad or Royale');
      // the keeper picks the lobby; party members follow on their own once the leader is seated
      const id = await (inParty ? partyPlay : quickPlay)(effMode as Mode, effEntry, lev, () => cancelQ.current);
      if (cancelQ.current) {
        await cancelMatchmaking(id);
        useSocket.setState({ toast: t('mm.cancelled') });
        setQueuedAt(null);
        setBusy(false);
        return;
      }
      router.push(`/match/${id}`);
    } catch (e) {
      if (cancelQ.current) {
        // cancelled before any stake moved (still waiting for a lobby)
        useSocket.setState({ toast: t('mm.cancelled') });
        setQueuedAt(null);
        setBusy(false);
        return;
      }
      sfx.error();
      setErr(friendly(e));
      setQueuedAt(null);
      setBusy(false);
    }
  };

  const pay = effMode === 'practice' ? null : payouts(effMode, effEntry, MODES[effMode].maxPlayers);
  const lowFunds = address && effMode !== 'practice' && Number(usd) / 1e6 < effEntry + TRADING_BUDGET;

  const cfg = modeCfg(effMode);
  return (
    <div className="lobby pointer-events-none! relative">
      {/* desktop: corner panels; phone: stacked at the top (see .lobby-top) */}
      <div className="lobby-top">
        <QueueCard mode={effMode} entry={effEntry} locked={inParty && !leader} onOpen={() => setPicker(true)} />
        <SocialDrawer me={me} online={online} />
      </div>
      <div className="lobby-footer">
      {!REAL_TRADING && <Loadout lev={lev} onClass={pickClass} />}

      {/* the one primary action */}
      <div className="lobby-cta pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-1.5">
        <AnimatePresence>
          {queuedAt && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="font-display text-xs tracking-[0.4em] text-muted uppercase">
              {t(cancelQueued ? 'mm.cancelling' : 'lb.locking')}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.button
          data-tour="play"
          className="btn-play pointer-events-auto min-w-[280px]"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          animate={busy ? { opacity: [1, 0.7, 1] } : {}}
          transition={busy ? { repeat: Infinity, duration: 1.2 } : {}}
          disabled={busy || (inParty && !leader) || !!lowFunds}
          onClick={findMatch}
          onMouseEnter={sfx.hover}
        >
          <span className="grid text-center leading-tight">
            {t(!address ? 'nav.signIn' : inParty && !leader ? 'lb.ready' : busy ? 'lb.queueing' : 'lb.play')}
            <span className="sub">{!address ? t('lb.signInSub') : inParty && !leader ? t('lb.waitLeader') : `${cfg.name}${pay ? ` · ${effEntry} ${STAKE}` : ''}`}</span>
          </span>
        </motion.button>
        <div className="lobby-payout num pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 text-[12px] text-muted">
          {pay ? (
            <>
              {t('lb.winUpTo')} <span className="text-gold">{pay.first.toFixed(2)} {STAKE}</span> · {t(REAL_TRADING ? 'live.entry' : 'lb.maxLoss')} {effEntry} {STAKE}
              <Hint text="PLAY escrows your stake in the arena contract and finds a lobby (or opens one). When enabled in Settings, sparring bots fill empty seats after ~12s. During the match every trade is an onchain transaction." />
            </>
          ) : (
            <>{t('lb.freePractice')}</>
          )}
        </div>
          {lowFunds && (
            <div className="lobby-funding pointer-events-auto flex w-full max-w-sm flex-wrap items-center justify-center gap-2 border border-gold/40 bg-[var(--panel-solid)] px-3 py-2 text-[12px]">
              <span className="text-gold">{t('lb.notEnough', { stake: STAKE })}</span>
              <button className="link" onClick={() => REAL_TRADING ? useWallet.setState({claimOpen:true}) : void useWallet.getState().faucet().catch((e) => setErr(friendly(e)))}>
                {t('lb.getFunds')}
              </button>
            </div>
          )}
        {REAL_TRADING && pay && <p className="pointer-events-auto max-w-sm px-3 text-center text-[11px] text-gold">{t('live.budget',{amount:TRADING_BUDGET,total:effEntry+TRADING_BUDGET})}</p>}
        {err && <span className="pointer-events-auto max-w-md text-center text-xs text-red">{err}</span>}
        {busy && queuedAt ? (
          <button className="guide-link pointer-events-auto" disabled={cancelQueued} onClick={() => (sfx.click(), (cancelQ.current = true), setCancelQueued(true))}>
            {t(cancelQueued ? 'mm.cancelling' : 'mm.cancel')}
          </button>
        ) : (
          <button className="guide-link pointer-events-auto" onClick={() => (sfx.click(), setGuide(true))}>
            {t('nav.howto')}
          </button>
        )}
      </div>
      </div>

      <ModeSelect
        open={picker}
        mode={effMode}
        entry={effEntry}
        onClose={() => setPicker(false)}
        onPick={(m, e) => {
          setMode(m);
          setEntry(e);
        }}
      />
      <ConnectDialog open={connect} onClose={() => setConnect(false)} />
      <Guide open={guide && !claimOpen} onClose={() => setGuide(false)} />
    </div>
  );
}

/** Bottom-left loadout: your class, a real leverage parameter in the contract. */
function Loadout({ lev, onClass }: { lev: number; onClass: (l: number) => void }) {
  const t = useT();
  const id = classOf(lev);
  return (
    <motion.div data-tour="class" initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="lobby-loadout panel pointer-events-auto absolute bottom-3 left-3 grid w-[270px] gap-2.5 p-2 sm:p-3">
      <div>
        <div className="hidden sm:block">
          <PanelHeader title={t('lb.class')} sub={t('lb.leverage')} hint="Your class is your leverage, a real parameter in the contract. Higher leverage means bigger positions and bigger PnL swings, but you get liquidated on a smaller price move. You can switch until the match starts." />
        </div>
        <div className="seg block sm:mt-1.5">
          {(Object.keys(CLASSES) as ClassId[]).filter((id) => !REAL_TRADING || id === 'tank').map((id) => {
            const k = CLASSES[id];
            const on = lev === k.leverage;
            return (
              <button key={id} onMouseEnter={sfx.hover} onClick={() => onClass(k.leverage)} className={`px-1! text-[12px]! ${on ? 'on' : ''}`}>
                <span>
                  {k.name} {k.leverage}x
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 text-[10px] text-muted sm:text-[11px]">
          <span className="sm:hidden">{t('lb.classPrefix')}</span>
          {REAL_TRADING ? t('live.class') : t('lb.liq', { role: t(`role.${id}`), pct: `~${(90 / CLASSES[id].leverage).toFixed(1)}%` })}
        </div>
      </div>
    </motion.div>
  );
}

/** Collapsible social drawer (party, online, invites): out of the way until needed. */
function SocialDrawer({ me, online }: { me?: string; online: string[] }) {
  const t = useT();
  const party = useSocket((s) => s.party);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'party' | 'online'>('party');
  const panel = useDialog(open, () => setOpen(false));
  return (
    <div data-tour="party" className="lobby-social pointer-events-auto absolute top-3 right-3 flex w-[280px] flex-col items-end gap-1.5">
      <button aria-expanded={open} aria-haspopup="dialog" className="panel flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left" onClick={() => (sfx.click(), setOpen((o) => !o))}>
        <span className="phead">
          <h3>{t('lb.party')}</h3>
        </span>
        <span className="num ml-auto text-[11px] text-muted">
          <span className="text-green">●</span> {t('lb.online', { n: online.length })} · {party?.members.length ?? 1}/3
        </span>
        <span className="text-dim">{open ? '▴' : '▾'}</span>
      </button>
      {typeof document !== 'undefined' && createPortal(<AnimatePresence>
        {open && (
          <motion.div className="dialog-overlay pointer-events-auto fixed inset-0 z-[60] flex bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="social-title" className="social-panel dialog-panel panel m-auto w-full max-w-[420px] outline-none" style={{ background: 'var(--panel-solid)' }} onClick={(e) => e.stopPropagation()}>
              <div className="dialog-heading flex items-center justify-between gap-3 px-4 pt-3">
                <h2 id="social-title" className="panel-title">{t('lb.party')}</h2>
                <button className="dialog-close" onClick={() => setOpen(false)} aria-label={t('ui.close')}>×</button>
              </div>
              <div className="flex gap-2 border-b border-line px-4 pb-3" role="group" aria-label={t('lb.party')}>
                <button className={`chip flex-1 justify-center ${tab === 'party' ? 'on' : ''}`} aria-pressed={tab === 'party'} onClick={() => setTab('party')}>{t('pt.title')}</button>
                <button className={`chip flex-1 justify-center ${tab === 'online' ? 'on' : ''}`} aria-pressed={tab === 'online'} onClick={() => setTab('online')}>{t('pt.onlineTitle', { n: online.length })}</button>
              </div>
              <div className="dialog-content scroll-thin min-h-0 overflow-y-auto p-3">
                {tab === 'party' ? <PartyPanel me={me} /> : <OnlinePanel me={me} online={online} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}

function PartyPanel({ me }: { me?: string }) {
  const { party, send } = useSocket();
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [kick, setKick] = useState<string>();
  const t = useT();
  if (!me) return <div className="panel p-2.5 text-xs text-muted">{t('pt.signIn')}</div>;
  if (!party)
    return (
      <div className="panel grid gap-2 p-2.5">
        <PanelHeader title={t('pt.title')} sub={t('pt.sub')} hint="A party queues together. In Squad you're on the same team, in Duel you face each other, and in Royale you share a lobby. Up to 3 players; the leader picks the mode." />
        <p className="text-xs text-muted">{t('pt.pitch')}</p>
        <button className="gbtn sm" onClick={() => (sfx.click(), send({ t: 'party:create' }))}>
          {t('pt.create')}
        </button>
      </div>
    );
  const link = typeof window !== 'undefined' ? `${location.origin}/play?party=${party.id}` : '';
  return (
    <div className="panel grid gap-1.5 p-2.5">
      <div className="flex items-center justify-between">
        <PanelHeader title={t('pt.count', { n: party.members.length })} hint="Share the invite link or invite someone online. The ★ leader chooses the mode and presses PLAY for everyone." />
        <button className="text-[11px] text-dim hover:text-red" onClick={() => send({ t: 'party:leave' })}>
          {t('pt.leave')}
        </button>
      </div>
      {party.members.map((m) => (
        <div key={m.addr} className="party-member text-sm">
          <span className="party-color h-2 w-2 shrink-0" style={{ background: CLASS_COLOR[m.leverage] }} />
          <span className={`party-name ${m.addr === me ? 'text-violet' : ''}`}>{m.name ?? shortAddr(m.addr)}</span>
          {party.leader === m.addr && <span className="party-leader text-[12px] text-gold">{t('pt.leader')}</span>}
          <span className="party-class text-[12px] text-dim">
            {CLASSES[classOf(m.leverage)].name} {m.leverage}x
          </span>
          {party.leader === me && m.addr !== me && (
            <button
              className={`party-kick min-h-[44px] border px-2 py-1 text-[12px] tracking-wider uppercase ${kick === m.addr ? 'border-red text-red' : 'border-line text-dim hover:text-red'}`}
              onClick={() => {
                if (kick !== m.addr) return (setKick(m.addr), setTimeout(() => setKick(undefined), 3000));
                sfx.click();
                send({ t: 'party:kick', addr: m.addr });
                setKick(undefined);
              }}
              aria-label={`Remove ${m.name ?? shortAddr(m.addr)} from the party`}
            >
              {t(kick === m.addr ? 'pt.confirm' : 'pt.kick')}
            </button>
          )}
        </div>
      ))}
      <button
        className="chip justify-center"
        onClick={() => {
          void navigator.clipboard?.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {t(copied ? 'pt.copied' : 'pt.copy')}
      </button>
      <div className="scroll-thin grid max-h-28 gap-0.5 overflow-y-auto text-xs">
        {party.chat.slice(-12).map((c, i) => (
          <div key={i} className={c.from === 'system' ? 'text-dim italic' : ''}>
            {c.from !== 'system' && <b className="text-violet">{c.from}: </b>}
            {c.text}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (msg.trim()) send({ t: 'party:chat', text: msg.trim() });
          setMsg('');
        }}
      >
        <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('pt.chat')} className="w-full border border-line bg-black/30 px-2 py-1.5 text-sm outline-none focus:border-violet" />
      </form>
    </div>
  );
}

function OnlinePanel({ me, online }: { me?: string; online: string[] }) {
  const t = useT();
  const { party, send } = useSocket();
  const [sent, setSent] = useState<string[]>([]);
  const invite = (to: string) => {
    sfx.click();
    if (!party) {
      send({ t: 'party:create' });
      setTimeout(() => send({ t: 'party:invite', to }), 300);
    } else send({ t: 'party:invite', to });
    setSent((s) => [...s, to]);
  };
  return (
    <div className="panel flex min-h-0 flex-col gap-1.5 p-2.5">
      <PanelHeader title={t('pt.onlineTitle', { n: online.length })} sub={t('pt.onlineSub')} />
      <PlayerSearch online={online} me={me} onInvite={invite} sent={sent} />
    </div>
  );
}

function LivePanel() {
  const t = useT();
  const { data: live } = useApi<any[]>('/matches?state=live', 3000);
  const { data: open } = useApi<any[]>('/matches?state=open', 3000);
  const rows = useMemo(() => {
    // a lobby can appear in both polls while it flips open → live; keep the live copy
    const liveIds = new Set((live ?? []).map((m) => m.id));
    return [...(open ?? []).filter((m) => !liveIds.has(m.id)).map((m) => ({ ...m, tag: 'open' })), ...(live ?? []).map((m) => ({ ...m, tag: 'live' }))].slice(0, 5);
  }, [open, live]);
  return (
    <div className="panel grid gap-1 p-2.5">
      <PanelHeader title={t('lb.watch')} sub={t('lb.watchSub')} hint="Open lobbies are waiting for players, and you can join one. Live matches are in progress; open one to spectate every trade as it happens." />
      {!rows.length && <span className="text-xs text-dim">{t('lb.noMatches')}</span>}
      {rows.map((m) => (
        <Link key={m.id} href={`/match/${m.id}`} className="flex items-center gap-2 border border-line px-2 py-1 text-[11px] hover:border-[var(--line-hi)]" onMouseEnter={sfx.hover}>
          <span className={`px-1 text-[9px] font-bold tracking-widest uppercase ${m.tag === 'live' ? 'text-red' : 'text-green'}`}>{m.tag}</span>
          <span className="font-display font-semibold tracking-wider uppercase">{MODES[m.mode as Mode].name}</span>
          <span className="text-dim">#{m.id}</span>
          <span className="num ml-auto text-muted">
            {m.players.length}/{m.max_players} · {m.entry} {STAKE}
          </span>
          <span className="text-muted">{m.tag === 'live' ? 'watch' : 'join'} →</span>
        </Link>
      ))}
    </div>
  );
}
