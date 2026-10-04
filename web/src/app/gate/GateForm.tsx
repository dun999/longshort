'use client';
import { useState, type FormEvent } from 'react';

export function GateForm({ next, error, available }: { next: string; error: boolean; available: boolean }) {
  const [message, setMessage] = useState(error ? 'That code is not right. Try again.' : '');
  const [busy, setBusy] = useState(false);
  async function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/gate/enter', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ password: String(form.get('password') ?? ''), next }), cache: 'no-store',
      });
      const result = await res.json();
      if (!res.ok) { setMessage(result.error); return; }
      // A full navigation discards any previously cached public app/router state.
      window.location.replace(result.next);
    } catch { setMessage('Could not connect. Please try again.'); }
    finally { setBusy(false); }
  }
  return (
    <form className="gate-form" method="post" action="/gate/enter" onSubmit={enter}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="gate-pw" className="gate-label">Access code</label>
      <div className="gate-row">
        <input id="gate-pw" name="password" type="password" autoComplete="current-password" autoFocus required maxLength={256} disabled={!available || busy} className={`gate-input ${message ? 'bad' : ''}`} placeholder="Enter the code you were given" />
        <button type="submit" className="btn-play gate-btn" disabled={!available || busy}>{busy ? 'Checking…' : 'Enter'}</button>
      </div>
      {!available && <p className="gate-msg" role="status">Access is temporarily unavailable. Please try again later.</p>}
      {message && <p className="gate-msg bad" role="alert">{message}</p>}
    </form>
  );
}
