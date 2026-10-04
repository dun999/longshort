'use client';
import { API_URL } from './config';

export function returnToGate() {
  if (typeof window === 'undefined' || window.location.pathname === '/gate') return;
  window.location.replace(`/gate?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}

export function handleGateResponse(response: Response): boolean {
  if (response.status !== 401 && response.status !== 503) return false;
  // A wallet's 401 needs wallet-token renewal, not a new access code.
  if (!['GATE_REQUIRED', 'GATE_UNAVAILABLE'].includes(response.headers.get('x-longshort-gate') ?? '')) return false;
  returnToGate();
  return true;
}

export async function checkGate() {
  try { return !handleGateResponse(await fetch(API_URL + '/gate', { cache: 'no-store' })); }
  catch { return true; } // Connection failures use the normal reconnect flow.
}
