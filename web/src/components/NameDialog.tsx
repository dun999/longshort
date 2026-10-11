'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { REAL_TRADING } from '@longshort/shared';
import { api } from '@/lib/api';
import { useName, useNeedsName, suggestName, validName } from '@/lib/profileName';
import { useWallet } from '@/lib/wallet';
import { useDialog } from '@/lib/useDialog';
import { friendly } from '@/lib/errors';
import { sfx } from '@/lib/sfx';
import { useT } from '@/lib/i18n';

type Status = 'checking' | 'free' | 'taken' | 'invalid';

/** A name being picked: starts from the suggestion and checks with the keeper that nobody else has it. */
export function useNameDraft(enabled = true, initial?: string) {
  const suggestion = useName((s) => s.suggestion);
  const [draft, setDraft] = useState(initial ?? suggestion);
  const [status, setStatus] = useState<Status>('checking');
  const addr = useWallet((s) => s.address);
  useEffect(() => {
    if (!enabled) return;
    if (!validName(draft)) return setStatus('invalid');
    setStatus('checking');
    let live = true;
    const t = setTimeout(() => {
      api<{ available: boolean }>(`/name/${encodeURIComponent(draft)}${addr ? `?addr=${addr}` : ''}`)
        .then((r) => live && setStatus(r.available ? 'free' : 'taken'))
        .catch(() => live && setStatus('free')); // the save checks again
    }, 250);
    return () => void ((live = false), clearTimeout(t));
  }, [draft, addr, enabled]);
  return { draft, setDraft, status, ok: status === 'free', shuffle: () => setDraft(suggestName()) };
}
export type NameDraft = ReturnType<typeof useNameDraft>;

export function NameField({ d, disabled }: { d: NameDraft; disabled?: boolean }) {
  const t = useT();
  const note = { checking: '…', free: `✓ ${t('name.free')}`, taken: t('name.taken'), invalid: t('name.rules') }[d.status];
  return (
    <div className="name-field grid gap-1.5">
      <label htmlFor="player-name" className="panel-title">{t('name.label')}</label>
      <div className="flex gap-2">
        <input
          id="player-name"
          value={d.draft}
          disabled={disabled}
          onChange={(e) => d.setDraft(e.target.value.replace(/[^\w .·-]/g, '').slice(0, 20))}
          maxLength={20}
          autoComplete="nickname"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby="player-name-note"
          className="min-h-[42px] min-w-0 flex-1 border border-line bg-black/30 px-3 py-2 text-[16px] font-semibold outline-none focus:border-[var(--accent)]"
        />
        <button type="button" className="name-shuffle chip w-[42px] shrink-0 justify-center" disabled={disabled} onClick={() => (sfx.click(), d.shuffle())} aria-label={t('name.shuffle')} title={t('name.shuffle')}>
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <circle cx="5.5" cy="5.5" r=".9" fill="currentColor" stroke="none" />
            <circle cx="10.5" cy="10.5" r=".9" fill="currentColor" stroke="none" />
            <circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
      <p id="player-name-note" aria-live="polite" className={`min-h-[15px] text-[11px] ${d.status === 'free' ? 'text-green' : d.status === 'taken' ? 'text-red' : 'text-dim'}`}>{note}</p>
    </div>
  );
}

// a round, the landing page and shared cards are no place to stop someone
const QUIET = [/^\/$/, /^\/match\//, /^\/practice/, /^\/gate/, /^\/s\//, /^\/recover/];

/** Right after a guest or passkey sign-in: pick the name rivals will see. The claim dialog asks instead when it is open. */
export function NameDialog() {
  const path = usePathname();
  const needs = useNeedsName();
  const deferred = useName((s) => s.deferred);
  const { connecting, claimOpen } = useWallet();
  const claimAsks = REAL_TRADING && path === '/play' && claimOpen;
  const open = needs && !deferred && !connecting && !claimAsks && !QUIET.some((re) => re.test(path));
  const later = () => useName.setState({ deferred: true });
  const panel = useDialog(open, later);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="dialog-overlay fixed inset-0 z-[80] flex bg-black/75 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="name-title"
            className="dialog-panel panel relative m-auto w-full max-w-[400px] p-5 outline-none sm:p-6"
            style={{ background: 'var(--panel-solid)', borderTop: '2px solid var(--accent)' }}
            initial={{ y: 12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
          >
            <NameForm onLater={later} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function NameForm({ onLater }: { onLater: () => void }) {
  const t = useT();
  const d = useNameDraft();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const save = async () => {
    if (!d.ok || busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      await useName.getState().save(d.draft);
      sfx.lockIn();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), void save())}>
      <div>
        <div className="panel-title">{t('name.kicker')}</div>
        <h2 id="name-title" className="font-display mt-1 text-2xl font-bold tracking-[0.06em] uppercase">{t('name.title')}</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">{t('name.body')}</p>
      </div>
      <NameField d={d} disabled={busy} />
      {err && <p role="alert" className="text-xs text-red">{err}</p>}
      <button type="submit" className="btn-play sm min-h-12 w-full !px-4 !text-[13px] !tracking-[0.12em]" disabled={!d.ok || busy}>
        <span className="truncate">{busy ? t('name.saving') : t('name.save', { name: d.draft })}</span>
      </button>
      <button type="button" className="justify-self-center text-xs text-muted underline" onClick={onLater}>{t('name.later')}</button>
    </form>
  );
}
