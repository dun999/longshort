'use client';
import { useEffect } from 'react';
import { checkGate, returnToGate } from '@/lib/gate-client';

export function GateSession({ expiresAt }: { expiresAt: number | null }) {
  useEffect(() => {
    if (!expiresAt) return;
    const expiry = setTimeout(returnToGate, Math.max(0, expiresAt - Date.now()));
    const visible = () => { if (document.visibilityState === 'visible') void checkGate(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', visible);
    return () => {
      clearTimeout(expiry);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pageshow', visible);
    };
  }, [expiresAt]);
  return null;
}
