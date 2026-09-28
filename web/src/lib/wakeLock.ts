'use client';
import { useEffect } from 'react';

/** Keep the visible game awake; browsers release the lock when a tab is hidden. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let disposed = false;
    let pending = false;
    let lock: WakeLockSentinel | undefined;
    const acquire = async () => {
      if (disposed || pending || (lock && !lock.released) || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (disposed) await next.release();
        else lock = next;
      } catch {
        // Battery saver / unsupported policies must never interrupt a match.
      } finally {
        pending = false;
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    document.addEventListener('pointerdown', acquire);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', acquire);
      document.removeEventListener('pointerdown', acquire);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
