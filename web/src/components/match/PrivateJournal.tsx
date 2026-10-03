'use client';
import { useEffect, useRef, useState } from 'react';
import { validJournalEnvelope, type JournalNote, type JournalRecord } from '@longshort/shared';
import { ApiError } from '@/lib/api';
import { authed } from '@/lib/auth';
import { friendly } from '@/lib/errors';
import { decryptJournal, encryptJournal, journalContext, lockJournal, onJournalLock, openJournal } from '@/lib/journal';
import { useWallet } from '@/lib/wallet';
import { useT } from '@/lib/i18n';

const blank: JournalNote = { thesis: '', reflection: '' };
function checked(value: JournalRecord | null) {
  if (value && (!Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isFinite(value.updatedAt) || !validJournalEnvelope(value.envelope)))
    throw new Error('The saved journal format is invalid.');
  return value;
}

export function PrivateJournal({ id }: { id: number }) {
  const t = useT();
  const { address, kind } = useWallet();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<JournalNote>(blank);
  const [record, setRecord] = useState<JournalRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [newer, setNewer] = useState<{ note: JournalNote; record: JournalRecord | null }>();
  const epoch = useRef(0);
  const opening = useRef(false);
  useEffect(() => {
    const clear = () => { epoch.current++; setReady(false); setBusy(false); setDraft(blank); setRecord(null); setDirty(false); setError(undefined); setConflict(false); setNewer(undefined); };
    clear();
    const remove = onJournalLock(clear);
    const lifecycle = epoch;
    return () => { remove(); lifecycle.current++; };
  }, [address, id]);
  if (!address || kind !== 'passkey') return null;
  const context = journalContext(address, id);
  const read = async () => checked(await authed<JournalRecord | null>('/journal/read', context));
  const open = async () => {
    if (opening.current) return;
    opening.current = true;
    const current = epoch.current;
    setBusy(true); setError(undefined);
    try {
      await useWallet.getState().ensureUnlocked();
      // Re-verifying the owner may clear the previous journal. Use the new epoch below.
      const verified = epoch.current;
      if (useWallet.getState().address !== address) throw new Error('Account changed. Open the journal again.');
      await openJournal(address);
      const saved = await read();
      const note = saved ? await decryptJournal(context, saved.envelope) : blank;
      if (verified !== epoch.current) return;
      setRecord(saved); setDraft(note); setReady(true); setDirty(false);
    } catch (e) { if (useWallet.getState().address === address) setError(friendly(e)); }
    finally { opening.current = false; if (useWallet.getState().address === address && current <= epoch.current) setBusy(false); }
  };
  const save = async () => {
    const current = epoch.current;
    setBusy(true); setError(undefined); setConflict(false);
    try {
      const envelope = await encryptJournal(context, draft);
      const expectedRevision = record?.revision ?? 0;
      let saved: JournalRecord;
      try {
        saved = checked(await authed<JournalRecord>('/journal/save', { ...context, expectedRevision, envelope }))!;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'JOURNAL_CONFLICT') { setConflict(true); throw e; }
        // A lost response may hide a committed save. Confirm the exact ciphertext before calling it saved.
        const remote = await read().catch(() => null);
        if (!remote || remote.revision !== expectedRevision + 1 || JSON.stringify(remote.envelope) !== JSON.stringify(envelope)) throw e;
        saved = remote;
      }
      if (saved.revision !== expectedRevision + 1 || JSON.stringify(saved.envelope) !== JSON.stringify(envelope)) throw new Error('The saved journal response did not match your encrypted note.');
      if (current !== epoch.current) return;
      setRecord(saved); setDirty(false);
    } catch (e) { if (current === epoch.current) setError(friendly(e)); }
    finally { if (current === epoch.current) setBusy(false); }
  };
  const review = async () => {
    const current = epoch.current;
    setBusy(true); setError(undefined);
    try {
      const saved = await read();
      const note = saved ? await decryptJournal(context, saved.envelope) : blank;
      if (current === epoch.current) setNewer({ record: saved, note });
    } catch (e) { if (current === epoch.current) setError(friendly(e)); }
    finally { if (current === epoch.current) setBusy(false); }
  };
  return <section className="panel grid gap-3 p-4" aria-labelledby={`journal-${id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><div className="panel-title">{t('journal.private')}</div><h2 id={`journal-${id}`} className="font-display text-xl font-bold uppercase">{t('journal.title')}</h2></div>
      {ready && <button className="gbtn ghost sm" disabled={busy} onClick={lockJournal}>{t('journal.lock')}</button>}
    </div>
    <p className="text-xs leading-relaxed text-muted">{t('journal.body')}</p>
    {!ready ? <button className="gbtn sm justify-self-start" disabled={busy} onClick={() => void open()}>{t(busy ? 'journal.opening' : 'journal.open')}</button> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['thesis', 'reflection'] as const).map((field) => <label key={field} className="grid gap-2 text-xs text-muted">
          {t(`journal.${field}`)}
          <textarea maxLength={1500} rows={5} disabled={busy} value={draft[field]} onChange={(e) => { setDraft({ ...draft, [field]: e.target.value }); setDirty(true); }}
            className="min-w-0 resize-y border border-line bg-black/20 p-3 text-[16px] text-white outline-none focus:border-[var(--accent)]" />
        </label>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="gbtn sm" disabled={busy || !dirty || conflict} onClick={() => void save()}>{t(busy ? 'journal.saving' : 'journal.save')}</button>
        <p className={`text-xs ${dirty ? 'text-gold' : 'text-muted'}`} role="status">{t(dirty ? 'journal.unsaved' : record ? 'journal.saved' : 'journal.empty')}{!dirty && record ? ` · ${new Date(record.updatedAt).toLocaleString()}` : ''}</p>
      </div>
      {conflict && !newer && <button className="gbtn ghost sm justify-self-start" disabled={busy} onClick={() => void review()}>{t('journal.review')}</button>}
      {newer && <div className="grid gap-3 border border-gold/40 p-3">
        <h3 className="panel-title">{t('journal.newer')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">{(['thesis', 'reflection'] as const).map((field) => <div key={field}><div className="text-xs text-dim">{t(`journal.${field}`)}</div><p className="mt-2 whitespace-pre-wrap break-words text-sm">{newer.note[field] || '—'}</p></div>)}</div>
        <div className="flex flex-wrap gap-2">
          <button className="gbtn ghost sm" onClick={() => { setDraft(newer.note); setRecord(newer.record); setDirty(false); setConflict(false); setNewer(undefined); setError(undefined); }}>{t('journal.useSaved')}</button>
          <button className="gbtn ghost sm" onClick={() => { setRecord(newer.record); setDirty(true); setConflict(false); setNewer(undefined); setError(undefined); }}>{t('journal.keepDraft')}</button>
        </div>
      </div>}
      <p className="text-[11px] text-dim">{t('journal.memory')}</p>
    </>}
    {error && <p className="text-xs text-red" role="alert">{error}</p>}
  </section>;
}
