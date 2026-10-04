'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { formatEther, formatUnits } from 'viem';
import { REAL_TRADING, level, levelProgress, shortAddr, STAKE } from '@longshort/shared';
import { useWallet } from '@/lib/wallet';
import { useApi } from '@/lib/api';
import { sfx } from '@/lib/sfx';
import { useT, type Key } from '@/lib/i18n';
import { ConnectDialog } from './ConnectDialog';
import { Logo } from './Logo';
import { PlayerMark } from './PlayerMark';
import { SettingsDialog } from './Settings';
import { describeKeys } from '@/lib/mera';
import { friendly } from '@/lib/errors';
import { useSocket } from '@/lib/socket';

const NAV: { href: string; label: Key }[] = [
  { href: '/play', label: 'nav.play' },
  { href: '/leaderboard', label: 'nav.ranks' },
  { href: '/stats', label: 'nav.stats' },
  { href: '/rules', label: 'nav.rules' },
];

/** Close a popover on an outside press or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => (document.removeEventListener('pointerdown', away), window.removeEventListener('keydown', esc));
  }, [open, close]);
  return ref;
}

export function TopBar({ onInvites }: { onInvites: () => void }) {
  const t = useT();
  const path = usePathname();
  const { address, kind, usd, mon, refresh, balanceReady } = useWallet();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const inviteCount = useSocket((s) => s.invites.length + s.rematchInvites.length);
  const { data: prof } = useApi<any>(address ? `/profile/${address}` : null, 10_000);
  useEffect(() => {
    if (!address) return;
    const i = setInterval(refresh, 8000);
    return () => clearInterval(i);
  }, [address, refresh]);
  const xp = prof?.profile?.xp ?? 1000;
  if (path === '/') return null; // the title screen is full-bleed

  return (
    <header className="topbar relative z-40 flex items-center gap-5 border-b border-line bg-[rgba(12,13,16,0.9)] px-4 backdrop-blur-md">
      <Logo />
      <nav className="hidden items-center gap-1 lg:flex">
        {NAV.map((n) => {
          const on = path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              onMouseEnter={sfx.hover}
              className={`font-display relative px-3 py-1.5 text-[12px] font-semibold tracking-[0.16em] uppercase transition-colors ${on ? 'text-white' : 'text-muted hover:text-white'}`}
            >
              {t(n.label)}
              {on && <span className="absolute inset-x-3 -bottom-[9px] h-[2px] bg-[var(--accent)]" />}
            </Link>
          );
        })}
        {inviteCount > 0 && <button className="gbtn ghost sm" onClick={onInvites}>{t('invite.count', { n: inviteCount })}</button>}
      </nav>
      <div className="topbar-actions ml-auto flex min-w-0 shrink-0 items-center gap-3">
        {address ? (
          <PlayerMenu address={address} name={prof?.profile?.name ?? shortAddr(address)} kind={kind} xp={xp} usd={usd} mon={mon} ready={balanceReady} onSettings={() => setSettings(true)} />
        ) : (
          <>
            {/* signed out there's no account menu: a gear opens settings (phones use the menu) */}
            <button className="desktop-settings chip h-8 w-8 justify-center !p-0" onClick={() => (sfx.click(), setSettings(true))} aria-label={t('set.title')} title={t('set.title')}>
              <SettingsIcon />
            </button>
            <button className="gbtn sm whitespace-nowrap" onClick={() => (sfx.click(), setOpen(true))}>
              {t('nav.signIn')}
            </button>
          </>
        )}
        <MobileNav path={path} onSettings={() => setSettings(true)} onInvites={onInvites} inviteCount={inviteCount} />
      </div>
      <ConnectDialog open={open} onClose={() => setOpen(false)} />
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </header>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M2 4h7M12 4h2M2 12h2M7 12h7" />
      <path d="M10.5 2.5v3M5.5 10.5v3" />
    </svg>
  );
}

/** Compact player chip; the details live in a dropdown so the bar stays clean. */
function PlayerMenu({ address, name, kind, xp, usd, mon, ready, onSettings }: { address: string; name: string; kind?: string; xp: number; usd: bigint; mon: bigint; ready: boolean; onSettings: () => void }) {
  const t = useT();
  const router = useRouter();
  const guest = kind === 'guest';
  const passkey = kind === 'passkey';
  const injected = kind === 'injected';
  const locked = useWallet((s) => s.locked);
  const [keys, setKeys] = useState<{ purpose: string; address: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string>();
  const ref = useDismiss(open, () => setOpen(false));
  const { faucet, disconnect, ensureUnlocked, lock } = useWallet();
  useEffect(() => {
    if (open && passkey) setKeys(describeKeys());
  }, [open, passkey, locked]);
  const lvl = level(xp);
  const pct = Math.round(levelProgress(xp) * 100);
  const stake = Number(formatUnits(usd, 6));
  const gas = Number(formatEther(mon));
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => (sfx.click(), setOpen((o) => !o))}
        onMouseEnter={sfx.hover}
        aria-expanded={open}
        aria-label={ready ? `${name} · ${stake.toFixed(2)} ${STAKE}` : name}
        title={name}
        className={`player-chip flex h-9 items-center gap-2.5 border px-2 transition-colors ${open ? 'border-[var(--line-hi)] bg-[var(--panel-hi)]' : 'border-line bg-white/[0.02] hover:border-[var(--line-hi)]'}`}
      >
        <span className="relative">
          <PlayerMark addr={address} size={26} />
          <span className="hex absolute -right-2 -bottom-1.5 scale-[0.8]">{lvl}</span>
        </span>
        <span className="ml-1 hidden max-w-[120px] truncate text-[12px] font-semibold lg:block">{name}</span>
        <span className="num text-[11px] text-muted" aria-live="polite">
          {ready ? stake.toFixed(2) : '···'} <span className="balance-unit">{STAKE}</span>
        </span>
        <span className="text-[10px] text-dim">{open ? '▴' : '▾'}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="account-popover panel scroll-thin absolute top-[calc(100%+8px)] right-0 z-50 grid max-h-[calc(100dvh-64px)] w-72 gap-2.5 overflow-y-auto p-3"
            style={{ background: 'var(--panel-solid)' }}
          >
            <div className="flex items-center gap-2.5">
              <PlayerMark addr={address} size={34} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 truncate font-semibold">
                  {name}
                  {guest && <span className="text-[9px] tracking-widest text-gold uppercase">guest</span>}
                  {passkey && <span className="border border-green/50 px-1 text-[9px] tracking-widest text-green uppercase">passkey</span>}
                </div>
                <button className="num text-[10px] text-dim hover:text-[var(--text)]" onClick={() => void navigator.clipboard?.writeText(address)} title={t('acct.copy')}>
                  {shortAddr(address)} ⧉
                </button>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5">
                  <span className="hex">{lvl}</span> {t('acct.level', { n: lvl })}
                </span>
                <span className="num text-dim">{t('acct.toNext', { xp, n: 100 - pct })}</span>
              </div>
              <div className="bar mt-1.5">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="acct-figures num">
              <div>
                <span>{t('acct.balance')}</span>
                <b>
                  {ready ? stake.toFixed(2) : '···'} <span className="text-dim">{STAKE}</span>
                </b>
              </div>
              {/* passkey and guest accounts are topped up automatically; only a browser wallet manages its own gas */}
              {injected && (
                <div>
                  <span>{t('acct.fees')}</span>
                  <b>
                    {gas.toFixed(3)} <span className="text-dim">MON</span>
                  </b>
                </div>
              )}
            </div>
            {passkey && (
              <details className="acct-sec grid gap-1.5 border-t border-line pt-2.5">
                <summary className="flex cursor-pointer items-center justify-between">
                  <span className="phead">
                    <h3>{t('acct.security')}</h3>
                  </span>
                  <span className={`text-[10px] tracking-wider uppercase ${locked ? 'text-gold' : 'text-green'}`}>{t(locked ? 'acct.locked' : 'acct.unlocked')} ▾</span>
                </summary>
                {locked ? (
                  <button className="gbtn sm w-full" onClick={() => void ensureUnlocked().then(() => setKeys(describeKeys())).catch((e) => setMsg(friendly(e)))}>
                    {t('acct.unlock')}
                  </button>
                ) : (
                  <>
                    {keys.map((k) => (
                      <div key={k.address} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-muted">{k.purpose}</span>
                        <span className="num shrink-0 text-dim">{shortAddr(k.address)}</span>
                      </div>
                    ))}
                    <p className="text-[10px] leading-relaxed text-dim">{t('session.policy')}</p>
                    <button className="text-[10px] tracking-wider text-dim uppercase hover:text-[var(--text)]" onClick={() => (lock(), setKeys([]))}>
                      {t('acct.lockNow')}
                    </button>
                  </>
                )}
              </details>
            )}
            <div className="acct-menu">
              <Link href={`/profile/${address}`} className="acct-item" onClick={() => setOpen(false)}>
                {t('acct.profile')}
              </Link>
              <Link href="/demo" className="acct-item" onClick={() => setOpen(false)}>Demo evidence</Link>
              {REAL_TRADING && injected && <Link href="/recover" className="acct-item" onClick={() => setOpen(false)}>Account recovery</Link>}
              {!injected && (
                <button className="acct-item" onClick={() => (sfx.click(), setOpen(false), useWallet.setState({ depositOpen: true }))}>
                  {t('acct.deposit', { stake: STAKE })}
                </button>
              )}
              {guest && <GuestKey />}
              <button
                className="acct-item"
                onClick={() => {
                  if (REAL_TRADING) { useWallet.setState({claimOpen:true}); setOpen(false); router.push('/play'); return; }
                  setMsg(t('acct.sending'));
                  faucet().then(
                    () => setMsg(t('acct.fundsSent')),
                    (e) => setMsg(friendly(e)),
                  );
                }}
              >
                {t('acct.funds')}
              </button>
              {/* phones already have Settings in the menu button; the wrapper keeps the unlayered .acct-item display from beating the utility */}
              <div className="max-lg:hidden">
                <button className="acct-item" onClick={() => (sfx.click(), setOpen(false), onSettings())}>
                  {t('set.title')}
                  <SettingsIcon />
                </button>
              </div>
              <button className="acct-item out" onClick={() => (disconnect(), setOpen(false))}>
                {t(passkey ? 'acct.signOut' : guest ? 'acct.disconnectGuest' : 'acct.disconnectWallet')}
              </button>
              {msg && <span className="pt-1 text-center text-[11px] text-muted">{msg}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Guest accounts live in this browser only: show the key on purpose, behind a warning, so it can be kept. */
function GuestKey() {
  const t = useT();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const key = shown ? useWallet.getState().exportGuestKey() : undefined;
  if (!shown)
    return (
      <button className="acct-item" onClick={() => (sfx.click(), setShown(true))}>
        {t('acct.exportKey')}
      </button>
    );
  return (
    <div className="mx-3 my-2.5 grid gap-2 border border-gold/40 p-2.5 text-[11px]">
      <p className="leading-relaxed text-gold">{t('acct.exportWarn')}</p>
      <code className="num block bg-black/40 p-2 text-[11px] break-all select-all">{key}</code>
      <div className="flex gap-2">
        <button className="gbtn sm flex-1" onClick={() => (void navigator.clipboard?.writeText(key ?? ''), setCopied(true), setTimeout(() => setCopied(false), 1500))}>
          {t(copied ? 'dep.copied' : 'dep.copy')}
        </button>
        <button className="gbtn ghost sm flex-1" onClick={() => setShown(false)}>{t('acct.hideKey')}</button>
      </div>
    </div>
  );
}

/** Phones: the nav links live behind a menu button (the inline nav needs tablet width). */
function MobileNav({ path, onSettings, onInvites, inviteCount }: { path: string; onSettings: () => void; onInvites: () => void; inviteCount: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  useEffect(() => setOpen(false), [path]);
  return (
    <div ref={ref} className="relative lg:hidden">
      <button
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => (sfx.click(), setOpen((o) => !o))}
        className={`menu-btn relative grid h-[44px] w-[44px] place-items-center border transition-colors ${open ? 'border-[var(--line-hi)] bg-[var(--panel-hi)]' : 'border-line'}`}
      >
        <svg viewBox="0 0 18 14" width="18" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          {open ? <path d="M3 1l12 12M15 1L3 13" /> : <path d="M1 1h16M1 7h16M1 13h10" />}
        </svg>
        {inviteCount > 0 && <span className="invite-badge num" aria-label={t('invite.count', { n: inviteCount })}>{inviteCount > 9 ? '9+' : inviteCount}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="mobile-nav panel scroll-thin absolute top-[calc(100%+8px)] right-0 z-50 grid max-h-[calc(100dvh-64px)] w-64 overflow-y-auto p-1.5"
            style={{ background: 'var(--panel-solid)' }}
          >
            {NAV.map((n) => {
              const on = path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={`mnav-link ${on ? 'on' : ''}`}>
                  {t(n.label)}
                  {on && <i />}
                </Link>
              );
            })}
            <Link href="/play?guide=1" className="mnav-link">
              {t('nav.howto')}
            </Link>
            {inviteCount > 0 && <button className="mnav-link w-full" onClick={() => (setOpen(false), onInvites())}>{t('invite.count', { n: inviteCount })} →</button>}
            <button className="mnav-link w-full" onClick={() => (sfx.click(), setOpen(false), onSettings())}>
              {t('set.title')}
              <SettingsIcon />
            </button>
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}
