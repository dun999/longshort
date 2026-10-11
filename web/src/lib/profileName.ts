'use client';
/*
 * The player's public name: rivals, the leaderboard and share cards show it instead of an address.
 * The keeper keeps it under the account's address, signed by the account's own key, so signing in with
 * the same passkey on a fresh device brings it back with nothing stored in the browser.
 */
import { create } from 'zustand';
import { api } from './api';
import { useWallet } from './wallet';

export const validName = (name: string) => name === name.trim() && /^[\w .·-]{2,20}$/.test(name) && !/^bot/i.test(name);

const FIRST = ['Swift', 'Bold', 'Iron', 'Neon', 'Lucky', 'Silent', 'Rapid', 'Steel', 'Wild', 'Brave', 'Sly', 'Prime', 'Cosmic', 'Golden', 'Shadow', 'Turbo'];
const SECOND = ['Bull', 'Bear', 'Falcon', 'Wolf', 'Tiger', 'Shark', 'Viper', 'Raven', 'Comet', 'Hawk', 'Lynx', 'Fox', 'Cobra', 'Rhino', 'Orca', 'Mantis'];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
export const suggestName = () => `${pick(FIRST)}${pick(SECOND)}${10 + Math.floor(Math.random() * 90)}`;

interface NameState {
  addr?: string;
  /** undefined while loading or unknown; null once the keeper says this account has no name yet */
  name?: string | null;
  /** offered first, and used as the passkey's label when one is created */
  suggestion: string;
  /** "Later": no more asking until the next visit */
  deferred: boolean;
  save: (name: string) => Promise<void>;
}

export const useName = create<NameState>((set, get) => ({
  suggestion: suggestName(),
  deferred: false,
  async save(name) {
    const address = useWallet.getState().address;
    if (!address) throw new Error('Sign in first.');
    await useWallet.getState().ensureUnlocked();
    const { main, address: current } = useWallet.getState();
    if (!main || current !== address) throw new Error('Account changed. Sign in again.');
    const ts = Math.floor(Date.now() / 1000);
    const sig = await main.signMessage({ account: main.account ?? address, message: `longshort.fun name:${name} ts:${ts}` });
    await api('/profile', { addr: address, name, ts, sig });
    if (get().addr === address.toLowerCase()) set({ name });
  },
}));

/** Guest and passkey players who have no name yet are asked for one (browser wallets keep their address). */
export function useNeedsName() {
  const kind = useWallet((s) => s.kind);
  const name = useName((s) => s.name);
  return (kind === 'guest' || kind === 'passkey') && name === null;
}

let started = false;
export function startProfileName() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const load = async (addr?: string) => {
    useName.setState({ addr, name: undefined });
    if (!addr) return;
    const r = await api<{ profile?: { name: string | null } }>(`/profile/${addr}`).catch(() => null);
    if (r && useName.getState().addr === addr) useName.setState({ name: r.profile?.name ?? null });
  };
  let last: string | undefined;
  const check = () => {
    const addr = useWallet.getState().address?.toLowerCase();
    if (addr === last) return;
    last = addr;
    void load(addr);
  };
  useWallet.subscribe(check);
  check();
}
