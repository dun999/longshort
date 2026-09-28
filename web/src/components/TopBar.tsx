'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { formatEther, formatUnits } from 'viem';
import { level, levelProgress, shortAddr, STAKE } from '@longshort/shared';
import { useWallet } from '@/lib/wallet';
import { useApi } from '@/lib/api';
import { sfx } from '@/lib/sfx';
import { useT, type Key } from '@/lib/i18n';
import { ConnectDialog } from './ConnectDialog';
import { PlayerMark } from './PlayerMark';
import { SettingsDialog } from './Settings';
import { describeKeys } from '@/lib/mera';
import { friendly } from '@/lib/errors';

const NAV: { href: string; label: Key }[] = [
  { href: '/play', label: 'nav.play' },
  { href: '/leaderboard', label: 'nav.ranks' },
  { href: '/stats', label: 'nav.stats' },
  { href: '/information', label: 'nav.rules' },
];

export function Logo() {
  return (
    <Link href="/" className="font-display flex items-center gap-2 text-lg font-bold tracking-[0.12em] uppercase" onMouseEnter={sfx.hover}>
      <span className="relative grid h-8 w-8 place-items-center" style={{ clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)', background: 'var(--accent)' }}>
        <span className="h-3 w-3 bg-[var(--bg)]" style={{ clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)' }} />
      </span>
      <span>
        long<span className="text-violet">short</span>
        <span className="text-dim">.fun</span>
      </span>
    </Link>
  );
}

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

export function TopBar() {
  const t = useT();
  const path = usePathname();
  const { address, kind, usd, mon, refresh } = useWallet();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const { data: prof } = useApi<any>(address ? `/profile/${address}` : null, 10_000);
  useEffect(() => {
    if (!address) return;
    const i = setInterval(refresh, 8000);
    return () => clearInterval(i);
  }, [address, refresh]);
  const xp = prof?.profile?.xp ?? 1000;
  if (path === '/' || path === '/gate') return null; // title screen and gate are full-bleed

  return (
    <header className="relative z-20 flex h-12 items-center gap-5 border-b border-line bg-[rgba(12,13,16,0.9)] px-4 backdrop-blur-md">
      <Logo />
      <nav className="hidden items-center gap-1 md:flex">
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
      </nav>
      <div className="ml-auto flex items-center gap-3">
        {address ? (
          <PlayerMenu address={address} name={prof?.profile?.name ?? shortAddr(address)} kind={kind} xp={xp} usd={usd} mon={mon} onSettings={() => setSettings(true)} />
        ) : (
          <>
            {/* signed out there's no account menu: a gear opens settings (phones use the menu) */}
            <button className="chip hidden h-8 w-8 justify-center !p-0 md:inline-flex" onClick={() => (sfx.click(), setSettings(true))} aria-label={t('set.title')} title={t('set.title')}>
              <SettingsIcon />
            </button>
            <button className="gbtn sm whitespace-nowrap" onClick={() => (sfx.click(), setOpen(true))}>
              {t('nav.signIn')}
            </button>
          </>
        )}
        <MobileNav path={path} onSettings={() => setSettings(true)} />
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
function PlayerMenu({ address, name, kind, xp, usd, mon, onSettings }: { address: string; name: string; kind?: string; xp: number; usd: bigint; mon: bigint; onSettings: () => void }) {
  const t = useT();
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
        title={name}
        className={`flex h-9 items-center gap-2.5 border px-2 transition-colors ${open ? 'border-[var(--line-hi)] bg-[var(--panel-hi)]' : 'border-line bg-white/[0.02] hover:border-[var(--line-hi)]'}`}
      >
        <span className="relative">
          <PlayerMark addr={address} size={26} />
          <span className="hex absolute -right-2 -bottom-1.5 scale-[0.8]">{lvl}</span>
        </span>
        <span className="ml-1 hidden max-w-[120px] truncate text-[12px] font-semibold sm:block">{name}</span>
        <span className="num hidden text-[11px] text-muted md:block">
          {stake.toFixed(2)} {STAKE}
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
            className="panel scroll-thin absolute top-[calc(100%+8px)] right-0 z-50 grid max-h-[calc(100dvh-64px)] w-72 gap-3 overflow-y-auto p-3"
            style={{ background: 'var(--panel-solid)' }}
          >
            <div className="flex items-center gap-2.5">
              <PlayerMark addr={address} size={40} />
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
            <div className={`num grid gap-2 text-center ${injected ? 'grid-cols-2' : ''}`}>
              <div className="border border-line py-1.5">
                <div className="text-[9px] tracking-wider text-dim uppercase">{t('acct.balance')}</div>
                <div className="text-[13px]">
                  {stake.toFixed(2)} <span className="text-dim">{STAKE}</span>
                </div>
              </div>
              {/* passkey and guest accounts are topped up automatically; only a browser wallet manages its own gas */}
              {injected && (
                <div className="border border-line py-1.5">
                  <div className="text-[9px] tracking-wider text-dim uppercase">{t('acct.fees')}</div>
                  <div className="text-[13px]">
                    {gas.toFixed(3)} <span className="text-dim">MON</span>
                  </div>
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
                  <button className="gbtn sm w-full" onClick={() => void ensureUnlocked().then(() => setKeys(describeKeys()))}>
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
                    <p className="text-[10px] leading-relaxed text-dim">Derived on your device from one Face ID / PIN; never stored. Each match gets its own trading key, which can only trade in that match.</p>
                    <button className="text-[10px] tracking-wider text-dim uppercase hover:text-[var(--text)]" onClick={() => (lock(), setKeys([]))}>
                      {t('acct.lockNow')}
                    </button>
                  </>
                )}
              </details>
            )}
            <div className="grid gap-1 border-t border-line pt-2.5">
              <Link href={`/profile/${address}`} className="gbtn ghost sm w-full" onClick={() => setOpen(false)}>
                {t('acct.profile')}
              </Link>
              <button
                className="gbtn ghost sm w-full"
                onClick={() => {
                  setMsg(t('acct.sending'));
                  faucet().then(
                    () => setMsg(t('acct.fundsSent')),
                    (e) => setMsg(friendly(e)),
                  );
                }}
              >
                {t('acct.funds')}
              </button>
              <button className="gbtn ghost sm flex w-full items-center justify-center gap-2" onClick={() => (sfx.click(), setOpen(false), onSettings())}>
                <SettingsIcon />
                {t('set.title')}
              </button>
              <button className="w-full py-1.5 text-[11px] tracking-wider text-dim uppercase hover:text-red" onClick={() => (disconnect(), setOpen(false))}>
                {t(passkey ? 'acct.signOut' : guest ? 'acct.disconnectGuest' : 'acct.disconnectWallet')}
              </button>
              {msg && <span className="text-center text-[11px] text-muted">{msg}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Phones: the nav links live behind a menu button (the inline nav needs tablet width). */
function MobileNav({ path, onSettings }: { path: string; onSettings: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  useEffect(() => setOpen(false), [path]);
  return (
    <div ref={ref} className="relative md:hidden">
      <button
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => (sfx.click(), setOpen((o) => !o))}
        className={`grid h-[40px] w-[44px] place-items-center border transition-colors ${open ? 'border-[var(--line-hi)] bg-[var(--panel-hi)]' : 'border-line'}`}
      >
        <svg viewBox="0 0 18 14" width="18" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          {open ? <path d="M3 1l12 12M15 1L3 13" /> : <path d="M1 1h16M1 7h16M1 13h10" />}
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="panel scroll-thin absolute top-[calc(100%+8px)] right-0 z-50 grid max-h-[calc(100dvh-64px)] w-64 overflow-y-auto p-1.5"
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
