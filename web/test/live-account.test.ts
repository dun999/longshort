import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { privateKeyToAccount } from 'viem/accounts';

// This file intentionally checks the active testnet profile, not the virtual-arena regression profile.
process.env.TEST_CHAIN_PROFILE = 'live';
const storage = new Map<string, string>();
const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
Object.defineProperties(globalThis, {
  localStorage: { value: localStorage, configurable: true },
  window: { value: { localStorage, addEventListener: () => {} }, configurable: true },
});
const { REAL_TRADING } = await import('@longshort/shared');
const { useWallet } = await import('../src/lib/wallet');
const { publicClient } = await import('../src/lib/clients');
beforeEach(() => { storage.clear(); useWallet.getState().disconnect(); useWallet.setState({ error: undefined }); });

test('the live flow creates guest accounts with an exportable key and keeps browser wallets out of new entries', async () => {
  assert.equal(REAL_TRADING, true);
  const originalRead = publicClient.readContract, originalBalance = publicClient.getBalance, originalFetch = globalThis.fetch;
  try {
    (publicClient as any).readContract = async () => 0n;
    (publicClient as any).getBalance = async () => 0n;
    globalThis.fetch = (async () => new Response(JSON.stringify({ eligible: true, status: 'available', amount: '200000000', balance: '0' }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    await useWallet.getState().connectGuest();
    const key = storage.get('ls.guest.v1');
    assert.ok(key, 'a guest key is created in this browser');
    assert.equal(useWallet.getState().address, privateKeyToAccount(key as `0x${string}`).address);
    assert.equal(useWallet.getState().exportGuestKey(), key, 'the guest can export its own key');
    assert.equal(useWallet.getState().claimOpen, true, 'a fresh guest is offered the welcome claim');
    await useWallet.getState().authorizeEntry(); // guests enter without a passkey ceremony
    useWallet.getState().disconnect();
    await useWallet.getState().connectInjected();
    assert.equal(useWallet.getState().address, undefined, 'browser wallets cannot sign in to play');
    useWallet.setState({ kind: 'injected', address: `0x${'a'.repeat(40)}` });
    assert.equal(useWallet.getState().exportGuestKey(), undefined, 'only guests have a key to export');
    await assert.rejects(useWallet.getState().authorizeEntry(), /browser wallet/);
    await assert.rejects(useWallet.getState().faucet(), /browser wallet/);
    useWallet.getState().disconnect();
    storage.clear(); storage.set('ls.kind', 'guest');
    await useWallet.getState().restore();
    assert.equal(useWallet.getState().address, undefined);
    assert.equal(storage.has('ls.guest.v1'), false, 'restore never mints a replacement key for a missing guest');
  } finally {
    (publicClient as any).readContract = originalRead; (publicClient as any).getBalance = originalBalance; globalThis.fetch = originalFetch;
  }
});

test('existing guest recovery preserves the original account and balance without creating another secret or taking new funding', async () => {
  const key = `0x${'1'.repeat(64)}` as const;
  storage.set('ls.kind', 'guest'); storage.set('ls.guest.v1', key);
  const originalRead = publicClient.readContract, originalBalance = publicClient.getBalance, originalFetch = globalThis.fetch;
  try {
    (publicClient as any).readContract = async () => 123_000_000n;
    (publicClient as any).getBalance = async () => 0n;
    globalThis.fetch = (async () => { throw new Error('legacy restoration must not claim welcome funds'); }) as typeof fetch;
    await useWallet.getState().restore();
    assert.equal(useWallet.getState().address, privateKeyToAccount(key).address);
    assert.equal(useWallet.getState().usd, 123_000_000n);
    assert.equal(useWallet.getState().claimOpen, false);
    assert.equal(storage.get('ls.guest.v1'), key);
    assert.deepEqual([...storage.keys()].sort(), ['ls.guest.v1', 'ls.kind']);
  } finally { (publicClient as any).readContract = originalRead; (publicClient as any).getBalance = originalBalance; globalThis.fetch = originalFetch; }
});
