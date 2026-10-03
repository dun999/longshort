'use client';
/*
 * Sign-in with the keeper: one signature from the account's own key buys a token this browser keeps, so the
 * live connection can speak for the address (parties, invites, "follow your leader") and matchmaking can hold
 * seats for it. Guest and unlocked passkey accounts sign silently; a browser wallet asks once.
 */
import { api } from './api';
import { saveToken, tokenFor, useSocket } from './socket';
import { useWallet } from './wallet';

const message = (addr: string, ts: number) => `Sign in to longshort.fun\n\nNo transaction, no cost.\n\n${addr.toLowerCase()}\n${ts}`;

const pending = new Map<string, Promise<string>>();

/** This address's sign-in token, signing in first if there isn't one (may prompt a browser wallet or passkey). */
export function signIn(expected?: string): Promise<string> {
  const addr = useWallet.getState().address?.toLowerCase();
  if (!addr || (expected && expected.toLowerCase() !== addr)) return Promise.reject(new Error('Account changed. Sign in again.'));
  const cached = tokenFor(addr);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(addr);
  if (existing) return existing;
  const task = (async () => {
    await useWallet.getState().ensureUnlocked(); // passkey: one biometric prompt if locked
    const { main, address } = useWallet.getState();
    if (!main || address?.toLowerCase() !== addr) throw new Error('Connect a wallet first');
    const ts = Math.floor(Date.now() / 1000);
    const sig = await main.signMessage({ account: main.account ?? address!, message: message(addr, ts) });
    const { token } = await api<{ token: string }>('/auth', { addr, ts, sig });
    if (useWallet.getState().address?.toLowerCase() !== addr) throw new Error('Account changed. Sign in again.');
    saveToken(addr, token);
    useSocket.getState().hello(addr);
    return token;
  })().finally(() => pending.delete(addr));
  pending.set(addr, task);
  return task;
}

/** POST to the keeper as the signed-in player; an expired token is renewed once. */
export async function authed<T = any>(path: string, body: object): Promise<T> {
  const addr = useWallet.getState().address?.toLowerCase();
  if (!addr) throw new Error('Sign in first.');
  const call = async () => {
    const token = await signIn(addr);
    if (useWallet.getState().address?.toLowerCase() !== addr) throw new Error('Account changed. Sign in again.');
    return api<T>(path, { ...body, addr, token });
  };
  try {
    return await call();
  } catch (e) {
    if (!addr || !/Sign in again/.test((e as Error).message)) throw e;
    saveToken(addr, undefined);
    return call();
  }
}

/** Keep the connection signed in: silently where the account can sign without asking, and on party actions. */
let started = false;
export function startAuth() {
  if (started || typeof window === 'undefined') return;
  started = true;
  let tried = '';
  const check = () => {
    const w = useWallet.getState();
    const s = useSocket.getState();
    const addr = w.address?.toLowerCase();
    if (!addr || !s.connected || s.verified || pending.has(addr)) return;
    if (s.authWanted) {
      // the player just acted (created, joined, invited): asking is expected now
      void signIn().catch(() => useSocket.setState({ authWanted: false, toast: 'Sign in to use parties' }));
      return;
    }
    const silent = w.kind === 'guest' || (w.kind === 'passkey' && !!w.main);
    if (!silent || tokenFor(addr) || tried === addr) return;
    tried = addr;
    void signIn().catch(() => {});
  };
  useWallet.subscribe(check);
  useSocket.subscribe(check);
}
