import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { createWalletClient, http, verifyMessage, verifyTypedData } from 'viem';

// WebAuthn is a deterministic fixture here. Signing and derivation use the actual Mera SDK.
const storage = new Map<string, string>();
let denyStorage = false;
const localStorage = {
  getItem: (key: string) => { if (denyStorage) throw new Error('storage denied'); return storage.get(key) ?? null; },
  setItem: (key: string, value: string) => { if (denyStorage) throw new Error('storage denied'); storage.set(key, value); },
  removeItem: (key: string) => { if (denyStorage) throw new Error('storage denied'); storage.delete(key); },
};
let seed = 7;
let prompts = 0;
let lastRequest: any;
let pendingCredential: (() => Promise<unknown>) | undefined;
let createNeedsAssertion = false;
const events = new Map<string, () => void>();
const credential = () => ({
  type: 'public-key', rawId: new Uint8Array([seed, 2, 3]).buffer,
  response: { getTransports: () => ['internal'] },
  getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: new Uint8Array(32).fill(seed).buffer } } }),
});
const ceremony = async (request: any) => {
  prompts++;
  lastRequest = request.publicKey;
  if (createNeedsAssertion && request.publicKey.user) return { ...credential(), getClientExtensionResults: () => ({ prf: { enabled: true } }) };
  return pendingCredential ? pendingCredential() : credential();
};
Object.defineProperties(globalThis, {
  window: { value: { isSecureContext: true, PublicKeyCredential: class {}, localStorage, addEventListener: (name: string, handler: () => void) => events.set(name, handler) }, configurable: true },
  localStorage: { value: localStorage, configurable: true },
  location: { value: { hostname: 'longshort.fun' }, configurable: true },
  navigator: { value: { credentials: { create: ceremony, get: ceremony } }, configurable: true },
});
const mera = await import('../src/lib/mera');
const { useWallet } = await import('../src/lib/wallet');
const { publicClient } = await import('../src/lib/clients');
const { ADDR } = await import('@longshort/shared');

beforeEach(() => {
  mera.lock();
  storage.clear();
  denyStorage = false;
  seed = 7;
  prompts = 0;
  pendingCredential = undefined;
  createNeedsAssertion = false;
  useWallet.setState({ kind: undefined, address: undefined, main: undefined, locked: false });
});
afterEach(() => mera.lock());

test('the same passkey recovers owner and registered round signer after all browser metadata is cleared', async () => {
  const owner = await mera.unlock({ create: true });
  assert.equal(owner.address, '0x0D27a17191e525E3546a70E6C24e69301617b616', 'the original owner derivation remains compatible');
  const label = mera.nextMatchLabel();
  const original = mera.matchKey(label);
  mera.bindMatch(42, label);
  assert.equal(prompts, 1);
  const ownerAddress = owner.address;
  const tradingAddress = original.address;
  mera.lock();
  storage.clear();

  const recoveredOwner = await mera.unlock();
  assert.equal(recoveredOwner.address, ownerAddress);
  assert.equal(lastRequest.allowCredentials, undefined, 'a fresh browser can discover the passkey');
  assert.equal(mera.labelFor(42), undefined);
  const recovered = await mera.recoverMatchKey(42, tradingAddress, async () => ({ label }));
  assert.equal(recovered.address, tradingAddress);
  const message = 'resume this live round';
  assert.equal(await verifyMessage({ address: tradingAddress, message, signature: await recovered.signMessage({ message }) }), true);
  assert.equal(prompts, 2, 'trading did not add a ceremony after the one recovery prompt');
  assert.equal(mera.labelFor(42), label);
  assert.deepEqual([...storage.keys()].sort(), ['ls.passkey.credential', 'ls.passkey.matchKeys']);
  assert.deepEqual(Object.keys(JSON.parse(storage.get('ls.passkey.credential')!)), ['credentialId']);
});

test('a changed local label falls back to durable metadata, while a changed durable label is rejected', async () => {
  await mera.unlock();
  const label = mera.nextMatchLabel();
  const registered = mera.matchKey(label).address;
  mera.bindMatch(5, 'wrong-local-label');
  assert.equal((await mera.recoverMatchKey(5, registered, async () => ({ label }))).address, registered);
  await assert.rejects(mera.recoverMatchKey(6, registered, async () => ({ label: 'wrong-server-label' })), /could not be recovered/);
  await assert.rejects(mera.recoverMatchKey(7, registered, async () => ({ label: '<invalid>' })), /could not be recovered/);
  await assert.rejects(mera.recoverMatchKey(8, registered, async () => null), /could not be recovered/);
});

test('another passkey cannot reconstruct a seat, and a pending lookup cannot revive a locked keyring', async () => {
  await mera.unlock();
  const label = mera.nextMatchLabel();
  const registered = mera.matchKey(label).address;
  mera.lock();
  seed = 8;
  await mera.unlock();
  await assert.rejects(mera.recoverMatchKey(9, registered, async () => ({ label })), /could not be recovered/);
  await assert.rejects(mera.recoverMatchKey(9, registered, async () => { mera.lock(); return { label }; }), /session changed/);
  assert.equal(mera.isUnlocked(), false);
});

test('unavailable or malformed browser storage does not prevent passkey signing or in-memory round recovery', async () => {
  storage.set('ls.passkey.credential', '{broken');
  storage.set('ls.passkey.matchKeys', 'null');
  await mera.unlock();
  const label = mera.nextMatchLabel();
  const account = mera.matchKey(label);
  denyStorage = true;
  mera.bindMatch(11, label);
  const recovered = await mera.recoverMatchKey(11, account.address, async () => { throw new Error('cache should suffice'); });
  assert.equal(recovered.address, account.address);
  mera.lock();
  await mera.unlock();
  assert.ok(await mera.ownerAccount()!.signMessage({ message: 'storage is optional' }));
});

test('verification permits only one entry for two minutes; expired approval does not silently renew', async () => {
  await mera.unlock();
  assert.equal(mera.consumeEntryApproval(), true);
  assert.equal(mera.consumeEntryApproval(), false);
  await mera.unlock();
  const now = Date.now;
  try {
    const later = now() + 120_001;
    Date.now = () => later;
    assert.equal(mera.consumeEntryApproval(), false);
  } finally { Date.now = now; }
});

test('ceremony measurements include the real Mera creation fallback and cancelled attempts', async () => {
  const { useJourney } = await import('../src/lib/journey');
  useJourney.setState({ ceremonies: [] });
  createNeedsAssertion = true;
  await mera.unlock({ create: true });
  assert.equal(prompts, 2);
  assert.deepEqual(useJourney.getState().ceremonies.map((c) => [c.operation, c.completed]), [['create', true], ['get', true]]);
  pendingCredential = async () => { throw new DOMException('Cancelled', 'NotAllowedError'); };
  await assert.rejects(mera.unlock(), /cancelled or unavailable/);
  assert.equal(useJourney.getState().ceremonies.at(-1)?.completed, false);
});

test('idle timeout ends keys; an active round pin holds them until the round releases it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const owner = await mera.unlock();
  t.mock.timers.tick(30 * 60 * 1000);
  assert.equal(mera.isUnlocked(), false);
  await assert.rejects(async () => owner.signMessage({ message: 'expired' }), /ended/);
  await mera.unlock();
  const release = mera.pin();
  t.mock.timers.tick(31 * 60 * 1000);
  assert.equal(mera.isUnlocked(), true);
  release();
  t.mock.timers.tick(30 * 60 * 1000);
  assert.equal(mera.isUnlocked(), false);
});

test('ending a round closes its Mera signer; pagehide closes all signing sessions', async () => {
  const owner = await mera.unlock();
  const label = mera.nextMatchLabel();
  const round = mera.matchKey(label);
  mera.bindMatch(12, label);
  mera.endMatch(12);
  await assert.rejects(async () => round.signMessage({ message: 'after settlement' }), /ended/);
  const next = mera.matchKey(mera.nextMatchLabel());
  events.get('pagehide')!();
  await assert.rejects(async () => owner.signMessage({ message: 'after pagehide' }), /ended/);
  await assert.rejects(async () => next.signMessage({ message: 'after pagehide' }), /ended/);
});

test('signing in cannot finish after a lock cancels the passkey ceremony', async () => {
  let resolve!: (value: unknown) => void;
  pendingCredential = () => new Promise((r) => { resolve = r; });
  const unlocking = mera.unlock();
  mera.lock();
  resolve(credential());
  await assert.rejects(unlocking, /cancelled/);
  assert.equal(mera.isUnlocked(), false);
});

test('a wrong passkey cannot silently change the account during entry authorization', async () => {
  const owner = await mera.unlock();
  useWallet.setState({ address: owner.address, kind: 'passkey', locked: false });
  seed = 8;
  await assert.rejects(useWallet.getState().ensureUnlocked({ verify: true }), /Choose the passkey for this account/);
  assert.equal(useWallet.getState().address, owner.address);
  assert.equal(mera.isUnlocked(), false);
});

test('token approval replaces an unlimited allowance with the exact entry budget and stops on a reverted receipt', async () => {
  let approval: any;
  const originalRead = publicClient.readContract;
  const originalBalance = publicClient.getBalance;
  const originalWait = publicClient.waitForTransactionReceipt;
  const delegate = ADDR.relayDelegate;
  try {
    ADDR.relayDelegate = undefined;
    (publicClient as any).readContract = async () => 0n;
    (publicClient as any).getBalance = async () => 0n;
    (publicClient as any).waitForTransactionReceipt = async () => ({ status: 'success' });
    useWallet.setState({ address: `0x${'1'.repeat(40)}`, kind: 'passkey', allowance: (1n << 256n) - 1n,
      main: { writeContract: async (call: any) => { approval = call; return `0x${'a'.repeat(64)}`; } } as any });
    await useWallet.getState().ensureAllowance(105_000_000n);
    assert.equal(approval.functionName, 'approve');
    assert.deepEqual(approval.args, [ADDR.arena, 105_000_000n]);
    (publicClient as any).waitForTransactionReceipt = async () => ({ status: 'reverted' });
    await assert.rejects(useWallet.getState().ensureAllowance(120_000_000n), /approval reverted/);
  } finally {
    (publicClient as any).readContract = originalRead;
    (publicClient as any).getBalance = originalBalance;
    (publicClient as any).waitForTransactionReceipt = originalWait;
    ADDR.relayDelegate = delegate;
  }
});

test('sponsored signing survives denied storage and retries the same signed request after a lost response', async () => {
  const { relayTx } = await import('../src/lib/relay');
  // The CJS web workspace loads shared through require; mutate that fixture instance.
  const { ADDR: relayAddr, activeChain, relayTypes, RELAY_NAME, RELAY_VERSION } = createRequire(import.meta.url)('@longshort/shared') as typeof import('@longshort/shared');
  const owner = await mera.unlock();
  const originals = { fetch: globalThis.fetch, code: publicClient.getCode, nonce: publicClient.getTransactionCount, read: publicClient.readContract, wait: publicClient.waitForTransactionReceipt, delegate: relayAddr.relayDelegate };
  const requests: any[] = [];
  try {
    relayAddr.relayDelegate = `0x${'d'.repeat(40)}`;
    denyStorage = true;
    (publicClient as any).getCode = async () => undefined;
    (publicClient as any).getTransactionCount = async () => 0;
    (publicClient as any).readContract = async () => 0n;
    (publicClient as any).waitForTransactionReceipt = async () => ({ status: 'success' });
    globalThis.fetch = (async (_input: unknown, options: any) => {
      const body = JSON.parse(options.body); requests.push(body);
      assert.equal(await verifyTypedData({ address: owner.address,
        domain: { name: RELAY_NAME, version: RELAY_VERSION, chainId: activeChain.id, verifyingContract: owner.address },
        types: relayTypes, primaryType: 'Execute', message: { target: body.target, data: body.data, nonce: BigInt(body.nonce), deadline: BigInt(body.deadline) }, signature: body.signature }), true);
      if (requests.length === 1) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ hash: `0x${'b'.repeat(64)}` }), { status: 200 });
    }) as typeof fetch;
    await assert.rejects(relayTx(owner, ADDR.arena, '0x1234'), /Failed to fetch/);
    assert.equal((await relayTx(owner, ADDR.arena, '0x1234')).status, 'success');
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(prompts, 1);
    assert.ok(![...storage.keys()].some((key) => key.includes('pendingRelay')));
  } finally {
    globalThis.fetch = originals.fetch; (publicClient as any).getCode = originals.code;
    (publicClient as any).getTransactionCount = originals.nonce; (publicClient as any).readContract = originals.read;
    (publicClient as any).waitForTransactionReceipt = originals.wait; relayAddr.relayDelegate = originals.delegate;
  }
});

test('authenticated actions and socket credentials survive denied storage, renew once, and clear on sign-out', async () => {
  const { authed } = await import('../src/lib/auth');
  const { saveToken, tokenFor } = await import('../src/lib/socket');
  const { activeChain } = await import('@longshort/shared');
  const owner = await mera.unlock();
  saveToken(owner.address, undefined);
  storage.clear(); denyStorage = true;
  const originalFetch = globalThis.fetch;
  let authCalls = 0, revoked = false;
  useWallet.setState({ address: owner.address, kind: 'passkey', locked: false,
    main: createWalletClient({ account: owner, chain: activeChain, transport: http() }) });
  try {
    globalThis.fetch = (async (input: any, options: any) => {
      const body = JSON.parse(options.body);
      if (String(input).endsWith('/auth')) {
        const message = `Sign in to longshort.fun\n\nNo transaction, no cost.\n\n${owner.address.toLowerCase()}\n${body.ts}`;
        assert.equal(await verifyMessage({ address: owner.address, message, signature: body.sig }), true);
        authCalls++;
        return new Response(JSON.stringify({ token: `fixture-token-${authCalls}` }));
      }
      assert.equal(body.addr, owner.address.toLowerCase());
      if (revoked && body.token === 'fixture-token-1') return new Response(JSON.stringify({ error: 'Sign in again' }), { status: 401 });
      assert.equal(body.token, `fixture-token-${authCalls}`);
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    assert.deepEqual(await authed('/journal/read', { owner: owner.address, matchId: 1 }), { ok: true });
    assert.deepEqual(await authed('/matchmake', { mode: 0, entry: 5 }), { ok: true });
    assert.equal(authCalls, 1);
    assert.equal(tokenFor(owner.address), 'fixture-token-1', 'the socket can send the same authenticated credential');
    revoked = true;
    assert.deepEqual(await authed('/journal/read', { owner: owner.address, matchId: 1 }), { ok: true });
    assert.equal(authCalls, 2);
    assert.equal(prompts, 1, 'auth renewal uses the unlocked Mera signer without another ceremony');
    assert.equal(storage.size, 0);
    useWallet.getState().disconnect();
    assert.equal(tokenFor(owner.address), undefined);
  } finally { globalThis.fetch = originalFetch; useWallet.getState().disconnect(); }
});

test('untrusted pending transaction metadata cannot submit an unsigned or substituted call', async () => {
  const { relayTx } = await import('../src/lib/relay');
  const { ADDR: relayAddr, activeChain } = createRequire(import.meta.url)('@longshort/shared') as typeof import('@longshort/shared');
  const owner = await mera.unlock();
  const delegate = relayAddr.relayDelegate;
  const originalFetch = globalThis.fetch;
  try {
    relayAddr.relayDelegate = `0x${'d'.repeat(40)}`;
    const key = `ls.pendingRelay:${activeChain.id}:${relayAddr.relayDelegate}:${owner.address}`;
    storage.set(key, JSON.stringify({ from: owner.address, target: ADDR.arena, data: '0x1234', nonce: '0', deadline: '9999999999', signature: `0x${'0'.repeat(130)}` }));
    globalThis.fetch = (async () => { throw new Error('an unverified call must not reach the API'); }) as typeof fetch;
    await assert.rejects(relayTx(owner, ADDR.arena, '0x1234'), /could not be verified/);
    assert.equal(storage.has(key), false);
  } finally { globalThis.fetch = originalFetch; relayAddr.relayDelegate = delegate; }
});
