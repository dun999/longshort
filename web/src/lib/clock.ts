'use client';
import { useEffect, useState } from 'react';
import { publicClient } from './clients';

// Chain time = local time + offset (block timestamps are what the contract checks).
let offset = 0;
let synced = false;
async function sync() {
  const b = await publicClient.getBlock({ blockTag: 'latest' }).catch(() => null);
  if (b) {
    offset = Number(b.timestamp) - Date.now() / 1000;
    synced = true;
  }
}
if (typeof window !== 'undefined') {
  void sync();
  setInterval(sync, 10_000);
}
export const chainNow = () => Date.now() / 1000 + offset;
export const isSynced = () => synced;

/** Re-renders every `ms` with the current chain time (fractional seconds). */
export function useChainNow(ms = 250) {
  const [now, setNow] = useState(chainNow);
  useEffect(() => {
    const t = setInterval(() => setNow(chainNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
