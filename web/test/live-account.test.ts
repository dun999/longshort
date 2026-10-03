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

test('the live flow cannot create guest or browser-wallet accounts or spend from legacy accounts', async () => {
  assert.equal(REAL_TRADING, true);
  await useWallet.getState().connectGuest();
  assert.equal(useWallet.getState().address, undefined);
  assert.equal(storage.has('ls.guest.v1'), false);
  await useWallet.getState().connectInjected();
  assert.equal(useWallet.getState().address, undefined);
  storage.set('ls.kind', 'guest');
  await useWallet.getState().restore();
  assert.equal(useWallet.getState().address, undefined);
  assert.equal(storage.has('ls.guest.v1'), false, 'restore never mints a replacement key for a missing legacy guest');
  useWallet.setState({ kind: 'guest', address: `0x${'a'.repeat(40)}` });
  await assert.rejects(useWallet.getState().authorizeEntry(), /New Duels use a passkey/);
  await assert.rejects(useWallet.getState().faucet(), /claimed from a passkey/);
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
