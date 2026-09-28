'use client';
import { create } from 'zustand';
import {
  createWalletClient,
  custom,
  http,
  maxUint256,
  nonceManager,
  numberToHex,
  parseEther,
  type Account,
  type Hash,
  type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ADDR, activeChain, erc20Abi } from '@longshort/shared';
import { publicClient, GAS } from './clients';
import { RPC_URL } from './config';
import { api } from './api';
import { useSocket } from './socket';
import * as mera from './mera';
import { friendly } from './errors';

type Kind = 'injected' | 'guest' | 'passkey';
const LS = { kind: 'ls.kind', guest: 'ls.guest.v1', session: 'ls.session.v1', passkeyAddr: 'ls.passkey.owner' };

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {}
  },
};

function localAccount(key: string) {
  let pk = store.get(key) as `0x${string}` | null;
  if (!pk) {
    pk = generatePrivateKey();
    store.set(key, pk);
  }
  return privateKeyToAccount(pk, { nonceManager });
}
const localClient = (account: Account) => createWalletClient({ account, chain: activeChain, transport: http(RPC_URL) });

interface WalletState {
  address?: `0x${string}`;
  kind?: Kind;
  connecting: boolean;
  error?: string;
  mon: bigint;
  usd: bigint;
  allowance: bigint;
  sessionMon: bigint;
  main?: WalletClient;
  /** Signs trades without wallet pop-ups: the guest key itself, or a per-browser session key. */
  trader?: WalletClient;
  sessionAddress?: `0x${string}`;
  /** Passkey accounts: keys are derived on unlock and wiped on lock. */
  locked: boolean;
  connectInjected: () => Promise<void>;
  connectPasskey: (opts?: { create?: boolean; username?: string }) => Promise<void>;
  /** Prompts the passkey (from a user click) if the keyring is locked. */
  ensureUnlocked: () => Promise<void>;
  lock: () => void;
  connectGuest: () => Promise<void>;
  disconnect: () => void;
  restore: () => Promise<void>;
  refresh: () => Promise<void>;
  faucet: () => Promise<void>;
  ensureAllowance: () => Promise<void>;
  /** Passkey/guest accounts: top up network fees from the faucet when nearly dry, silently. */
  ensureGas: () => Promise<void>;
}

export interface TxResult {
  hash: Hash;
  ms: number;
  status: 'success' | 'reverted';
}

/** Send + wait, measuring wall-clock confirmation latency (shown in the HUD). */
export async function timedTx(send: () => Promise<Hash>): Promise<TxResult> {
  const t0 = performance.now();
  const hash = await send();
  const r = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 120 });
  return { hash, ms: Math.round(performance.now() - t0), status: r.status };
}

declare global {
  interface Window {
    ethereum?: any;
  }
}

async function switchChain() {
  const eth = window.ethereum;
  const chainId = numberToHex(activeChain.id);
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch {
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: activeChain.name,
          nativeCurrency: activeChain.nativeCurrency,
          rpcUrls: [RPC_URL],
          blockExplorerUrls: activeChain.blockExplorers ? [activeChain.blockExplorers.default.url] : undefined,
        },
      ],
    });
  }
}

export const useWallet = create<WalletState>((set, get) => ({
  connecting: false,
  mon: 0n,
  usd: 0n,
  allowance: 0n,
  sessionMon: 0n,
  locked: false,

  async connectPasskey(opts = {}) {
    set({ connecting: true, error: undefined });
    try {
      const owner = await mera.unlock(opts);
      set({ address: owner.address, kind: 'passkey', main: localClient(owner), trader: undefined, sessionAddress: undefined, locked: false });
      store.set(LS.kind, 'passkey');
      store.set(LS.passkeyAddr, owner.address);
      await get().refresh();
      if (get().usd === 0n || get().mon === 0n) await get().faucet();
      await get().ensureAllowance();
    } catch (e) {
      set({ error: friendly(e) });
    } finally {
      set({ connecting: false });
    }
  },

  async ensureUnlocked() {
    if (get().kind !== 'passkey') return;
    if (mera.isUnlocked()) return mera.touch();
    const owner = await mera.unlock();
    if (owner.address.toLowerCase() !== get().address?.toLowerCase()) {
      // a different passkey was picked: switch to that account
      store.set(LS.passkeyAddr, owner.address);
    }
    set({ address: owner.address, main: localClient(owner), locked: false });
    await get().refresh();
  },

  lock() {
    mera.lock();
  },

  async connectInjected() {
    if (!window.ethereum) {
      set({ error: 'No browser wallet found — try “Play as guest”.' });
      return;
    }
    set({ connecting: true, error: undefined });
    try {
      const [address] = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as `0x${string}`[];
      await switchChain();
      const main = createWalletClient({ account: address, chain: activeChain, transport: custom(window.ethereum) });
      const session = localAccount(LS.session);
      set({ address, kind: 'injected', main, trader: localClient(session), sessionAddress: session.address });
      store.set(LS.kind, 'injected');
      await get().refresh();
    } catch (e) {
      set({ error: friendly(e) });
    } finally {
      set({ connecting: false });
    }
  },

  async connectGuest() {
    set({ connecting: true, error: undefined });
    const account = localAccount(LS.guest);
    const client = localClient(account);
    set({ address: account.address, kind: 'guest', main: client, trader: client, sessionAddress: undefined });
    store.set(LS.kind, 'guest');
    try {
      await get().refresh();
      if (get().usd === 0n || get().mon === 0n) await get().faucet();
      await get().ensureAllowance();
    } catch (e) {
      set({ error: friendly(e) });
    } finally {
      set({ connecting: false });
    }
  },

  disconnect() {
    if (get().kind === 'passkey') mera.lock();
    store.set(LS.kind, null);
    set({ address: undefined, kind: undefined, main: undefined, trader: undefined, sessionAddress: undefined, locked: false });
  },

  async restore() {
    const kind = store.get(LS.kind) as Kind | null;
    if (kind === 'guest') return get().connectGuest();
    if (kind === 'passkey') {
      // no silent passkey prompts: show the (public) owner address, unlock on the next action
      const addr = store.get(LS.passkeyAddr) as `0x${string}` | null;
      if (addr) {
        set({ address: addr, kind: 'passkey', locked: !mera.isUnlocked() });
        await get().refresh();
      }
      return;
    }
    if (kind === 'injected' && window.ethereum) {
      const accts = (await window.ethereum.request({ method: 'eth_accounts' }).catch(() => [])) as string[];
      if (accts.length) return get().connectInjected();
    }
  },

  async refresh() {
    const { address, sessionAddress } = get();
    if (!address) return;
    const [mon, usd, allowance, sessionMon] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
      publicClient.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'allowance', args: [address, ADDR.arena] }),
      sessionAddress ? publicClient.getBalance({ address: sessionAddress }) : Promise.resolve(0n),
    ]);
    set({ mon, usd, allowance, sessionMon });
  },

  async faucet() {
    const { address } = get();
    if (!address) return;
    const r = await api<{ note?: string }>('/faucet', { addr: address });
    if (r.note) useSocket.setState({ toast: r.note });
    await get().refresh();
  },

  async ensureGas() {
    const { address, kind } = get();
    if (!address || kind === 'injected') return; // a browser wallet manages its own gas
    await get().refresh();
    if (get().mon >= parseEther('0.03')) return;
    await get().faucet().catch(() => {});
  },

  async ensureAllowance() {
    const { main, address, allowance } = get();
    if (!main || !address || allowance > 10n ** 12n) return;
    await timedTx(() =>
      main.writeContract({ account: main.account ?? address, chain: activeChain, address: ADDR.stake, abi: erc20Abi, functionName: 'approve', args: [ADDR.arena, maxUint256], gas: GAS.approve }),
    );
    await get().refresh();
  },
}));

// keep the store in sync when the keyring auto-locks (idle timeout / page hidden)
if (typeof window !== 'undefined')
  mera.onLock(() => {
    if (useWallet.getState().kind === 'passkey') useWallet.setState({ main: undefined, locked: true });
  });
