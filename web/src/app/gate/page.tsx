import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { safeNext } from '@/lib/gate';

export const metadata: Metadata = { title: 'longshort.fun · private preview', robots: { index: false, follow: false } };

export default async function Gate({ searchParams }: { searchParams: Promise<{ next?: string; e?: string }> }) {
  const { next, e } = await searchParams;
  return (
    <main className="gate">
      <div className="gate-top">
        <Logo />
        <span className="gate-kicker">
          <i /> Season 0 · private preview
        </span>
      </div>

      <div className="gate-body">
        <h1 className="gate-title">
          <span>Out</span>
          <span>trade</span>
          <span className="outline">them.</span>
        </h1>
        <form className="gate-form" method="post" action="/gate/enter">
          <input type="hidden" name="next" value={safeNext(next)} />
          <label htmlFor="gate-pw" className="gate-label">
            Access code
          </label>
          <div className="gate-row">
            <input id="gate-pw" name="password" type="password" autoComplete="current-password" autoFocus required className={`gate-input ${e ? 'bad' : ''}`} placeholder="Enter the code you were given" />
            <button type="submit" className="btn-play gate-btn">
              Enter
            </button>
          </div>
          {e && <p className="gate-msg bad">That code is not right. Try again.</p>}
        </form>
      </div>

    </main>
  );
}
