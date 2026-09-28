'use client';
import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { sfx } from '@/lib/sfx';

/** Game-style "ESC · BACK" for sub-screens: click or press Esc to return to where you came from (or the lobby). */
export function BackButton({ fallback = '/play' }: { fallback?: string }) {
  const router = useRouter();
  const back = useCallback(() => {
    sfx.click();
    // history.length > 1 means there is a previous in-app page to return to
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(fallback);
  }, [router, fallback]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; // let Esc clear fields
      if (document.querySelector('[role="dialog"], [aria-expanded="true"]')) return; // an open menu/dialog closes first
      back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back]);
  return (
    <button className="gbtn ghost sm shrink-0" onClick={back} onMouseEnter={sfx.hover} title="Back (Esc)">
      <span className="kbd mr-1">Esc</span> Back
    </button>
  );
}
