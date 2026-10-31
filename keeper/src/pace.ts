import { db } from './db';

// With nobody around, the chain pollers used to watch an empty arena at full speed, about seven RPC requests a
// second. They now run at full speed only while a socket is open, a request came in during the last minute, or a
// lobby or round is open. Otherwise they sleep longer, and wake the moment someone shows up.
const IDLE_AFTER_MS = 60_000;
let sockets = 0;
let lastSeen = Date.now(); // a fresh boot counts as activity
let wakers: (() => void)[] = [];
const openMatch = db.prepare('SELECT 1 FROM matches WHERE state IN (0, 1, 4) LIMIT 1');

/** A lobby is filling or a round is running (or closing). */
export const matchesOpen = () => openMatch.get() !== undefined;
export const busy = () => sockets > 0 || Date.now() - lastSeen < IDLE_AFTER_MS || matchesOpen();

/** Someone is here: sleeping pollers wake now instead of finishing their idle wait. */
export function touch() {
  lastSeen = Date.now();
  const woken = wakers;
  wakers = [];
  for (const wake of woken) wake();
}

export function setSockets(n: number) {
  sockets = n;
  touch();
}

/** Wait `fast` ms while busy, otherwise up to `slow` ms (cut short by activity). */
export function pause(fast: number, slow: number): Promise<void> {
  if (busy()) return new Promise((resolve) => setTimeout(resolve, fast));
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      wakers = wakers.filter((w) => w !== wake);
      resolve();
    };
    const timer = setTimeout(wake, slow);
    wakers.push(wake);
  });
}
