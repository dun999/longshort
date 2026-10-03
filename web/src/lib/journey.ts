'use client';
import { create } from 'zustand';
import type { Hash } from 'viem';
import { ADDR } from '@longshort/shared';

type Purpose = 'account' | 'journal';
export interface Ceremony { purpose: Purpose; operation: 'create' | 'get'; startedMs: number; finishedMs?: number; completed?: boolean }
export interface JourneyReceipt { kind: 'funding' | 'approval' | 'entry' | 'trade'; hash: Hash; elapsedMs: number; actions: number; ceremonies: number; matchId?: number }
interface JourneyState { startedAt: string; actions: number; ceremonies: Ceremony[]; receipts: JourneyReceipt[] }
export const useJourney = create<JourneyState>(() => ({ startedAt: '', actions: 0, ceremonies: [], receipts: [] }));
const elapsed = () => Math.round(performance.now());
let started = false;
/** Counts trusted activations of controls, including keyboard clicks. Memory only, no analytics upload. */
export function startJourney() {
  if (started || typeof document === 'undefined') return;
  started = true;
  useJourney.setState({ startedAt: new Date(performance.timeOrigin).toISOString() });
  document.addEventListener('click', (event) => {
    if (event.isTrusted && event.target instanceof Element && event.target.closest('button,a,input[type=submit],select'))
      useJourney.setState((s) => ({ actions: s.actions + 1 }));
  }, { capture: true });
}
export function beginCeremony(purpose: Purpose, operation: Ceremony['operation']) {
  const entry: Ceremony = { purpose, operation, startedMs: elapsed() };
  useJourney.setState((s) => ({ ceremonies: [...s.ceremonies, entry] }));
  return (completed: boolean) => useJourney.setState((s) => ({ ceremonies: s.ceremonies.map((c) => c === entry ? { ...c, finishedMs: elapsed(), completed } : c) }));
}
export function recordReceipt(kind: JourneyReceipt['kind'], hash: Hash, matchId?: number) {
  useJourney.setState((s) => s.receipts.some((r) => r.hash === hash) ? {} : ({
    receipts: [...s.receipts, { kind, hash, matchId, elapsedMs: elapsed(), actions: s.actions, ceremonies: s.ceremonies.length }],
  }));
}
export function journeyEvidence() {
  const { startedAt, actions, ceremonies, receipts } = useJourney.getState();
  return { version: 1, hostname: location.hostname, chainId: ADDR.chainId, arena: ADDR.arena, startedAt,
    browser: navigator.userAgent, actions, ceremonies, receipts,
    measurement: 'Elapsed from this page navigation. Trusted control activations and WebAuthn API ceremonies; OS biometric sheets require observation. Receipts are recorded after successful confirmation.' };
}
