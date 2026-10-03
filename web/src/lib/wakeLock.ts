'use client';
import { useEffect } from 'react';

/** Keep the visible game awake; browsers release the lock when a tab is hidden. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let disposed = false;
    let pending = false;
    let retryPending = false;
    let retriedRelease = false;
    let lock: WakeLockSentinel | undefined;
    const acquire = async () => {
      if (disposed || (lock && !lock.released) || document.visibilityState !== 'visible') return;
      if (pending) {
        retryPending = true;
        return;
      }
      pending = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (disposed || document.visibilityState !== 'visible') await next.release();
        else if (!next.released) {
          lock = next;
          next.addEventListener('release', () => {
            if (lock !== next) return;
            lock = undefined;
            // Recover once if the browser drops a visible lock; do not loop in battery saver.
            if (!retriedRelease && !disposed && document.visibilityState === 'visible') {
              retriedRelease = true;
              void acquire();
            }
          }, { once: true });
        }
      } catch {
        // Battery saver / unsupported policies must never interrupt a match.
      } finally {
        pending = false;
        if (retryPending) {
          retryPending = false;
          void acquire();
        }
      }
    };
    const resume = () => {
      retriedRelease = false;
      void acquire();
    };
    resume();
    document.addEventListener('visibilitychange', resume);
    document.addEventListener('pointerdown', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', resume);
      document.removeEventListener('pointerdown', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
