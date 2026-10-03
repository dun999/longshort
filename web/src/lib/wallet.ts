'use client';
import { create } from 'zustand';
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  isAddress,
  nonceManager,
  numberToHex,
  parseEther,
  type Account,
  type Hash,
  type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ADDR, REAL_TRADING, OWNER_GAS_LOW, activeChain, erc20Abi, relayLive } from '@longshort/shared';
import { publicClient, GAS } from './clients';
import { RPC_URL } from './config';
import { api } from './api';
import { saveToken, useSocket } from './socket';
import * as mera from './mera';
import { friendly } from './errors';
import { relayTx, sponsorAccount } from './relay';
import { recordReceipt } from './journey';

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

/** Stake is still dripped. MON is dripped only while players pay their own gas. */
function needsFunds() {
  const { usd, mon } = useWallet.getState();
  return usd === 0n || (!relayLive(ADDR.relayDelegate) && mon === 0n);
}

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
  claimOpen: boolean;
  claimBusy: boolean;
  claim?: { status: string; amount: string; before?: string; after?: string; balance: string; tx?: Hash; eligible?: boolean };
  claimError?: string;
  checkClaim: () => Promise<void>;
  connectInjected: (opts?: { legacy?: boolean }) => Promise<void>;
  connectPasskey: (opts?: { create?: boolean; username?: string }) => Promise<void>;
  /** Prompts the passkey (from a user click) if the keyring is locked. */
  ensureUnlocked: (opts?: { verify?: boolean }) => Promise<void>;
  authorizeEntry: () => Promise<void>;
  lock: () => void;
  connectGuest: (opts?: { legacy?: boolean }) => Promise<void>;
  disconnect: () => void;
  restore: () => Promise<void>;
  refresh: () => Promise<void>;
  faucet: () => Promise<void>;
  ensureAllowance: (amount: bigint) => Promise<void>;
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
  claimOpen: false,
  claimBusy: false,

  async connectPasskey(opts = {}) {
    set({ connecting: true, error: undefined });
    try {
      const owner = await mera.unlock(opts);
      set({ address: owner.address, kind: 'passkey', main: localClient(owner), trader: undefined, sessionAddress: undefined, locked: false });
      store.set(LS.kind, 'passkey');
      store.set(LS.passkeyAddr, owner.address);
      await get().refresh();
      if (REAL_TRADING) await get().checkClaim();
      else {
        if (needsFunds()) await get().faucet();
      }
    } catch (e) {
      set({ error: friendly(e) });
    } finally {
      set({ connecting: false });
    }
  },

  async ensureUnlocked(opts = {}) {
    if (get().kind !== 'passkey') return;
    if (mera.isUnlocked() && !opts.verify) return mera.touch();
    const expected = get().address;
    const owner = await mera.unlock();
    if (expected && owner.address.toLowerCase() !== expected.toLowerCase()) {
      mera.lock();
      throw new Error('Choose the passkey for this account. Sign out to use a different account.');
    }
    store.set(LS.passkeyAddr, owner.address);
    set({ address: owner.address, main: localClient(owner), locked: false });
    await get().refresh();
  },

  async authorizeEntry() {
    if (REAL_TRADING && get().kind !== 'passkey') throw new Error('New Duels use a passkey account. Existing accounts can still finish rounds and recover capital.');
    if (get().kind !== 'passkey') return;
    await get().ensureUnlocked();
    if (mera.consumeEntryApproval()) return;
    await get().ensureUnlocked({ verify: true });
    if (!mera.consumeEntryApproval()) throw new Error('Entry approval expired. Verify your passkey again.');
  },

  lock() {
    mera.lock();
  },

  async connectInjected(opts = {}) {
    if (REAL_TRADING && !opts.legacy) { set({ error: 'Sign in with a passkey to play. Existing wallet access is on the recovery page.' }); return; }
    if (!window.ethereum) {
      set({ error: 'Open this page in the browser where your existing wallet is installed.' });
      return;
    }
    set({ connecting: true, error: undefined });
    try {
      const [address] = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as `0x${string}`[];
      await switchChain();
      const main = createWalletClient({ account: address, chain: activeChain, transport: custom(window.ethereum) });
      const savedSession = store.get(LS.session);
      const session = REAL_TRADING ? (savedSession ? privateKeyToAccount(savedSession as `0x${string}`, { nonceManager }) : undefined) : localAccount(LS.session);
      mera.lock();
      set({ address, kind: 'injected', main, trader: session ? localClient(session) : main, sessionAddress: session?.address, locked: false, claimOpen: false });
      store.set(LS.kind, 'injected');
      await get().refresh();
    } catch (e) {
      set({ error: friendly(e) });
    } finally {
      set({ connecting: false });
    }
  },

  async connectGuest(opts = {}) {
    if (REAL_TRADING && (!opts.legacy || !store.get(LS.guest))) { set({ error: 'No existing guest account found in this browser. New accounts use passkeys.' }); return; }
    set({ connecting: true, error: undefined });
    try {
      const account = localAccount(LS.guest);
      const client = localClient(account);
      mera.lock();
      set({ address: account.address, kind: 'guest', main: client, trader: client, sessionAddress: undefined, locked: false, claimOpen: false });
      store.set(LS.kind, 'guest');
      await get().refresh();
      if (!REAL_TRADING) {
        if (needsFunds()) await get().faucet();
      }
    } catch (e) {
      set({ error: friendly(e) });
    } finally {
      set({ connecting: false });
    }
  },

  disconnect() {
    const address = get().address;
    if (address) saveToken(address, undefined);
    mera.lock();
    store.set(LS.kind, null);
    set({ address: undefined, kind: undefined, main: undefined, trader: undefined, sessionAddress: undefined, locked: false, usd: 0n, mon: 0n, allowance: 0n, claim: undefined, claimOpen: false, claimError: undefined });
  },

  async restore() {
    const kind = store.get(LS.kind) as Kind | null;
    if (kind === 'guest') return get().connectGuest({ legacy: true });
    if (kind === 'passkey') {
      // no silent passkey prompts: show the (public) owner address, unlock on the next action
      const addr = store.get(LS.passkeyAddr) as `0x${string}` | null;
      if (addr && isAddress(addr)) {
        set({ address: addr, kind: 'passkey', locked: !mera.isUnlocked() });
        await get().refresh();
      }
      return;
    }
    if (kind === 'injected' && window.ethereum) {
      const accts = (await window.ethereum.request({ method: 'eth_accounts' }).catch(() => [])) as string[];
      if (accts.length) return get().connectInjected({ legacy: true });
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
    if (get().address === address) set({ mon, usd, allowance, sessionMon });
  },

  async checkClaim() {
    const { address } = get();
    if (!REAL_TRADING || !address) return;
    try {
      const claim = await api<NonNullable<WalletState['claim']>>(`/faucet/${address}`);
      if (get().address !== address) return;
      set({ claim, claimOpen: claim.eligible === true || claim.status === 'pending', claimError: undefined });
    } catch (e) {
      if (get().address === address) set({ claimError: friendly(e), claimOpen: get().usd === 0n });
    }
  },

  async faucet() {
    const { address } = get();
    if (!address) return;
    if (REAL_TRADING) {
      if (get().kind !== 'passkey') throw new Error('Welcome AUSD is claimed from a passkey account. Existing accounts can recover their trading capital.');
      if (get().claimBusy) return;
      set({ claimBusy: true, claimError: undefined, claimOpen: true });
      try {
        const health = await api<any>('/health');
        if (!health.realTrading || health.chainId!==ADDR.chainId || health.arena?.toLowerCase()!==ADDR.arena.toLowerCase()) throw new Error('The app is updating. Reload before claiming.');
        const { authed } = await import('./auth');
        const result = await authed<NonNullable<WalletState['claim']>>('/faucet', {});
        if (get().address !== address) return;
        set({ claim: result, usd: BigInt(result.balance) });
        if (result.status === 'confirmed' && result.tx) recordReceipt('funding', result.tx);
        await get().refresh();
      } catch (e) {
        if (get().address === address) {
          const claim = await api<NonNullable<WalletState['claim']>>(`/faucet/${address}`).catch(() => undefined);
          if (get().address === address) set({ ...(claim ? {claim} : {}), claimError: friendly(e) });
        }
        throw e;
      } finally {
        set({ claimBusy: false });
      }
      return;
    }
    const r = await api<{ note?: string }>('/faucet', { addr: address });
    if (r.note) useSocket.setState({ toast: r.note });
    await get().refresh();
  },

  async ensureGas() {
    if (relayLive(ADDR.relayDelegate)) return; // the sponsor pays; a drip would just sit on the player
    const { address, kind } = get();
    if (!address || kind === 'injected') return; // a browser wallet manages its own gas
    await get().refresh();
    if (get().mon >= parseEther(OWNER_GAS_LOW)) return;
    await get().faucet().catch(() => {});
  },

  async ensureAllowance(amount) {
    const { main, address, allowance, kind } = get();
    if (!main || !address) throw new Error('Sign in before approving an entry');
    if (amount <= 0n) throw new Error('Invalid entry amount');
    // Replace even a legacy unlimited approval with this entry plus its trading budget.
    if (allowance === amount) return;
    let tx: TxResult;
    if (relayLive(ADDR.relayDelegate) && kind !== 'injected') {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ADDR.arena, amount] });
      tx = await relayTx(sponsorAccount(main.account), ADDR.stake, data);
    } else {
      tx = await timedTx(() =>
        main.writeContract({ account: main.account ?? address, chain: activeChain, address: ADDR.stake, abi: erc20Abi, functionName: 'approve', args: [ADDR.arena, amount], gas: GAS.approve }),
      );
    }
    if (tx.status !== 'success') throw new Error('Entry approval reverted. Retry before joining.');
    recordReceipt('approval', tx.hash);
    await get().refresh();
  },
}));

// keep the store in sync when the keyring auto-locks (idle timeout / page hidden)
if (typeof window !== 'undefined')
  mera.onLock(() => {
    if (useWallet.getState().kind === 'passkey') useWallet.setState({ main: undefined, locked: true });
  });
