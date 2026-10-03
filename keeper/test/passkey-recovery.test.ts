import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { privateKeyToAccount } from 'viem/accounts';

const directory = mkdtempSync(join(tmpdir(), 'longshort-passkeys-'));
process.env.ENV_FILE = '.env.test-does-not-exist';
process.env.DB_PATH = join(directory, 'metadata.db');
process.env.RPC_URL = 'http://127.0.0.1:1';
process.env.KEEPER_KEY = `0x${'1'.repeat(64)}`;
process.env.BOT_MNEMONIC = 'test test test test test test test test test test test junk';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
delete process.env.GATE_PASSWORD;
const { ADDR, JOURNAL_NAMESPACE, JOURNAL_PRF_SALT } = await import('@longshort/shared');
const { pub } = await import('../src/chain');
const { db } = await import('../src/db');
const { startApi } = await import('../src/api');
const { signInMessage } = await import('../src/auth');
const owner = privateKeyToAccount(`0x${'2'.repeat(64)}`);
const other = privateKeyToAccount(`0x${'3'.repeat(64)}`);
const session = privateKeyToAccount(`0x${'4'.repeat(64)}`).address;
const server = startApi();
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as any).port}`;
after(() => { server.close(); db.close(); rmSync(directory, { recursive: true }); });
const post = async (path: string, body: object) => (await fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json();
const get = async (path: string) => (await fetch(base + path)).json();
const authenticate = async (account: typeof owner) => {
  const ts = Math.floor(Date.now() / 1000);
  const sig = await account.signMessage({ message: signInMessage(account.address, ts) });
  return (await post('/auth', { addr: account.address, ts, sig })).token as string;
};
const metadata = { chainId: ADDR.chainId, arena: ADDR.arena, session, label: 'v2:testnet:unique-public-label' };

test('only an authenticated owner writes public hints; a fresh browser reads the durable record without a token', async () => {
  assert.equal(await get(`/passkey/match-key/${owner.address}/${session}`), null);
  assert.match((await post('/passkey/match-key', { ...metadata, addr: owner.address })).error, /Sign in again/);
  const token = await authenticate(owner);
  assert.deepEqual(await post('/passkey/match-key', { ...metadata, addr: owner.address, token }), { ok: true });
  assert.deepEqual(await get(`/passkey/match-key/${owner.address}/${session}`), { label: metadata.label });
  // A second database connection observes the committed hint; its lifetime is independent of the browser.
  const fresh = new DatabaseSync(process.env.DB_PATH!);
  try {
    const row = fresh.prepare('SELECT * FROM passkey_match_keys').get() as Record<string, unknown>;
    assert.deepEqual(Object.keys(row).sort(), ['arena', 'chain_id', 'created_at', 'label', 'owner', 'session']);
    assert.equal(row.label, metadata.label);
    assert.equal(row.owner, owner.address.toLowerCase());
  } finally { fresh.close(); }
});

test('retries are idempotent and hints cannot be overwritten, borrowed across owners, or written for a different deployment', async () => {
  const token = await authenticate(owner);
  const body = { ...metadata, addr: owner.address, token };
  assert.deepEqual(await post('/passkey/match-key', body), { ok: true });
  assert.match((await post('/passkey/match-key', { ...body, label: 'replacement' })).error, /already exists/);
  assert.match((await post('/passkey/match-key', { ...body, addr: other.address })).error, /Sign in again/);
  assert.equal(await get(`/passkey/match-key/${other.address}/${session}`), null);
  assert.match((await post('/passkey/match-key', { ...body, chainId: ADDR.chainId + 1 })).error, /app is updating/);
  assert.match((await post('/passkey/match-key', { ...body, arena: other.address })).error, /app is updating/);
  assert.deepEqual(await get(`/passkey/match-key/${owner.address}/${session}`), { label: metadata.label });
});

test('malformed hints and addresses are rejected', async () => {
  const token = await authenticate(owner);
  const body = { ...metadata, addr: owner.address, token };
  for (const label of ['', '<script>', 'x'.repeat(161), { privateKey: 'not accepted' }]) {
    assert.match((await post('/passkey/match-key', { ...body, label })).error, /Invalid match key metadata/);
  }
  assert.match((await post('/passkey/match-key', { ...body, session: '0x' })).error, /Invalid match key metadata/);
  assert.match((await post('/passkey/match-key', { ...body, session: `0x${'0'.repeat(40)}` })).error, /Invalid match key metadata/);
  assert.match((await get(`/passkey/match-key/bad-owner/${session}`)).error, /Invalid match key address/);
});

const encrypted = { version: 1, namespace: JOURNAL_NAMESPACE, prfSalt: JOURNAL_PRF_SALT,
  nonce: Buffer.alloc(12, 4).toString('base64url'), ciphertext: Buffer.alloc(64, 5).toString('base64url') };
test('journal storage is authenticated, ciphertext-only, deployment-scoped and durable', async () => {
  const token = await authenticate(owner);
  const body = { addr: owner.address, owner: owner.address, token, chainId: ADDR.chainId, arena: ADDR.arena, matchId: 51 };
  assert.equal(await post('/journal/read', body), null);
  const original = pub.readContract;
  (pub as any).readContract = async () => [{ addr: owner.address }];
  try {
    const saved = await post('/journal/save', { ...body, expectedRevision: 0, envelope: encrypted });
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.envelope, encrypted);
    assert.deepEqual(await post('/journal/read', body), saved);
    const fresh = new DatabaseSync(process.env.DB_PATH!);
    try {
      const row = fresh.prepare('SELECT * FROM private_journals').get() as Record<string, unknown>;
      assert.deepEqual(Object.keys(row).sort(), ['arena', 'chain_id', 'envelope', 'match_id', 'owner', 'revision', 'updated_at']);
      assert.equal(row.envelope, JSON.stringify(encrypted));
    } finally { fresh.close(); }
    const otherToken = await authenticate(other);
    assert.equal(await post('/journal/read', { ...body, token: otherToken, addr: other.address, owner: other.address }), null);
    assert.match((await post('/journal/read', { ...body, token: otherToken })).error, /Sign in again/);
    assert.equal((await post('/journal/read', { ...body, owner: other.address })).code, 'OWNER_CHANGED');
    assert.equal((await post('/journal/read', { ...body, chainId: ADDR.chainId + 1 })).code, 'DEPLOYMENT_CHANGED');
    assert.equal((await post('/journal/save', { ...body, matchId: 52, expectedRevision: 0, envelope: { ...encrypted, thesis: 'never persist plaintext' } })).code, 'INVALID_JOURNAL');
    assert.equal((await post('/journal/save', { ...body, expectedRevision: 1, envelope: encrypted, reflection: 'not ciphertext' })).code, 'INVALID_JOURNAL');
    (pub as any).readContract = async () => [{ addr: other.address }];
    assert.equal((await post('/journal/save', { ...body, expectedRevision: 1, envelope: encrypted })).code, 'NOT_A_PLAYER');
    assert.deepEqual(await post('/journal/read', body), saved);
  } finally { (pub as any).readContract = original; }
});

test('journal saves use compare-and-swap; a stale or concurrent save cannot overwrite another device', async () => {
  const token = await authenticate(owner);
  const body = { addr: owner.address, owner: owner.address, token, chainId: ADDR.chainId, arena: ADDR.arena, matchId: 61, expectedRevision: 0, envelope: encrypted };
  const original = pub.readContract;
  (pub as any).readContract = async () => [{ addr: owner.address }];
  try {
    const results = await Promise.all([post('/journal/save', body), post('/journal/save', body)]);
    assert.equal(results.filter((r) => r.revision === 1).length, 1);
    assert.equal(results.filter((r) => r.code === 'JOURNAL_CONFLICT').length, 1);
    const newer = { ...encrypted, nonce: Buffer.alloc(12, 6).toString('base64url') };
    assert.equal((await post('/journal/save', { ...body, expectedRevision: 1, envelope: newer })).revision, 2);
    const stale = await fetch(base + '/journal/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, expectedRevision: 1 }) });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'JOURNAL_CONFLICT');
    assert.deepEqual((await post('/journal/read', body)).envelope, newer);
    for (const envelope of [{ ...encrypted, namespace: 'account' }, { ...encrypted, nonce: 'short' }, { ...encrypted, ciphertext: '' }, { ...encrypted, prfSalt: 'different' }])
      assert.equal((await post('/journal/save', { ...body, expectedRevision: 2, envelope })).code, 'INVALID_JOURNAL');
    const oversized = await fetch(base + '/journal/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, envelope: { ...encrypted, ciphertext: 'A'.repeat(40_000) } }) });
    assert.equal(oversized.status, 413);
  } finally { (pub as any).readContract = original; }
});
