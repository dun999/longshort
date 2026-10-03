import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { sha256 } from '@noble/hashes/sha2';
import { JOURNAL_PRF_SALT } from '@longshort/shared';

// Deterministic, salt-sensitive WebAuthn fixture; Mera, HKDF and WebCrypto AES-GCM are real.
const storage = new Map<string, string>();
let seed = 3;
let selectedSeed: number | undefined;
const salts: Uint8Array[] = [];
const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
let waitCredential: (() => Promise<unknown>) | undefined;
const ceremony = async (options: any) => {
  const salt = new Uint8Array(options.publicKey.extensions.prf.eval.first);
  salts.push(salt.slice());
  const entropy = new Uint8Array(33 + salt.length); entropy.fill(selectedSeed ?? seed, 0, 33); entropy.set(salt, 33);
  const credential = { type: 'public-key', rawId: new Uint8Array([selectedSeed ?? seed, 8, 9]).buffer,
    response: { getTransports: () => ['internal'] }, getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: sha256(entropy).buffer } } }) };
  return waitCredential ? waitCredential() : credential;
};
Object.defineProperties(globalThis, {
  window: { value: { isSecureContext: true, PublicKeyCredential: class {}, localStorage, addEventListener: () => {} }, configurable: true },
  location: { value: { hostname: 'longshort.fun' }, configurable: true },
  navigator: { value: { credentials: { create: ceremony, get: ceremony } }, configurable: true },
});
const mera = await import('../src/lib/mera');
const journal = await import('../src/lib/journal');
const { useJourney } = await import('../src/lib/journey');
beforeEach(() => { mera.lock(); journal.lockJournal(); seed = 3; selectedSeed = undefined; waitCredential = undefined; storage.clear(); salts.length = 0; useJourney.setState({ ceremonies: [], receipts: [], actions: 0 }); });
afterEach(() => mera.lock());

test('a separate PRF namespace encrypts notes and reconstructs after storage loss without changing the owner', async () => {
  const owner = await mera.unlock({ create: true });
  const context = journal.journalContext(owner.address, 12);
  let extractable: boolean | undefined;
  const deriveKey = crypto.subtle.deriveKey.bind(crypto.subtle);
  crypto.subtle.deriveKey = (async (...args: Parameters<SubtleCrypto['deriveKey']>) => { extractable = args[3]; return deriveKey(...args); }) as SubtleCrypto['deriveKey'];
  try { await journal.openJournal(owner.address); } finally { crypto.subtle.deriveKey = deriveKey; }
  assert.equal(extractable, false);
  assert.equal(Buffer.from(salts[1]).toString('base64url'), JOURNAL_PRF_SALT);
  assert.notDeepEqual(salts[0], salts[1]);
  const note = { thesis: 'BTC momentum above the mark', reflection: 'I closed early · catatan pribadi 🔒' };
  const encrypted = await journal.encryptJournal(context, note);
  assert.equal(JSON.stringify(encrypted).includes(note.thesis), false);
  const again = await journal.encryptJournal(context, note);
  assert.notEqual(encrypted.nonce, again.nonce);
  assert.notEqual(encrypted.ciphertext, again.ciphertext);
  mera.lock(); storage.clear();
  await assert.rejects(journal.decryptJournal(context, encrypted), /locked/);
  assert.equal((await mera.unlock()).address, owner.address);
  await journal.openJournal(owner.address);
  assert.deepEqual(await journal.decryptJournal(context, encrypted), note);
  assert.ok([...storage.values()].every((value) => !value.includes(note.thesis) && !value.includes(note.reflection)));
  assert.deepEqual(useJourney.getState().ceremonies.map((c) => [c.purpose, c.operation, c.completed]), [
    ['account', 'create', true], ['journal', 'get', true], ['account', 'get', true], ['journal', 'get', true],
  ]);
});

test('changed ciphertext, nonce, deployment, owner and match identity cannot decrypt the original note', async () => {
  const owner = await mera.unlock(); await journal.openJournal(owner.address);
  const context = journal.journalContext(owner.address, 21);
  const encrypted = await journal.encryptJournal(context, { thesis: 'private', reflection: '' });
  const replace = (value: string) => (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
  await assert.rejects(journal.decryptJournal(context, { ...encrypted, ciphertext: replace(encrypted.ciphertext) }), /authenticated/);
  await assert.rejects(journal.decryptJournal(context, { ...encrypted, nonce: replace(encrypted.nonce) }), /authenticated/);
  await assert.rejects(journal.decryptJournal({ ...context, matchId: 22 }, encrypted), /authenticated/);
  await assert.rejects(journal.decryptJournal({ ...context, arena: `0x${'a'.repeat(40)}` }, encrypted), /deployment changed/);
  await assert.rejects(journal.decryptJournal({ ...context, chainId: context.chainId + 1 }, encrypted), /deployment changed/);
  await assert.rejects(journal.decryptJournal({ ...context, owner: `0x${'b'.repeat(40)}` }, encrypted), /locked/);
  mera.lock(); seed++;
  const different = await mera.unlock(); await journal.openJournal(different.address);
  await assert.rejects(journal.decryptJournal(journal.journalContext(different.address, 21), encrypted), /authenticated/);
});

test('a different credential or a late assertion cannot unlock the private journal', async () => {
  const owner = await mera.unlock();
  selectedSeed = 9;
  await assert.rejects(journal.openJournal(owner.address), /session changed/);
  assert.equal(journal.journalIsUnlocked(owner.address), false);
  selectedSeed = undefined;
  let complete!: (value: unknown) => void;
  waitCredential = () => new Promise((resolve) => { complete = resolve; });
  const pending = journal.openJournal(owner.address);
  mera.lock();
  complete({ type: 'public-key', rawId: new Uint8Array([seed, 8, 9]).buffer,
    getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(1).buffer } } }) });
  await assert.rejects(pending, /session changed/);
  assert.equal(journal.journalIsUnlocked(owner.address), false);
});

test('fresh verification for the same owner renews only entry consent and preserves the open journal and round signer', async () => {
  const owner = await mera.unlock(); await journal.openJournal(owner.address);
  const context = journal.journalContext(owner.address, 25);
  const note = { thesis: 'Keep the open draft private', reflection: '' };
  const encrypted = await journal.encryptJournal(context, note);
  const label = mera.nextMatchLabel(), signer = mera.matchKey(label);
  mera.bindMatch(25, label);
  assert.equal(mera.consumeEntryApproval(), true);
  assert.equal(await mera.unlock(), owner);
  assert.equal(mera.consumeEntryApproval(), true); assert.equal(mera.consumeEntryApproval(), false);
  assert.equal(journal.journalIsUnlocked(owner.address), true);
  assert.deepEqual(await journal.decryptJournal(context, encrypted), note);
  assert.equal(mera.matchKey(label), signer);
  assert.ok(await signer.signMessage({ message: 'still the same round' }));
});

test('locking during encryption or decryption discards results, and oversized notes never produce ciphertext', async () => {
  const owner = await mera.unlock(); await journal.openJournal(owner.address);
  const context = journal.journalContext(owner.address, 31);
  await assert.rejects(journal.encryptJournal(context, { thesis: 'x'.repeat(1501), reflection: '' }), /limited/);
  await assert.rejects(journal.encryptJournal(context, { thesis: '界'.repeat(1500), reflection: '界'.repeat(1500) }), /too long/);
  const encrypted = await journal.encryptJournal(context, { thesis: 'kept private', reflection: '' });
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  crypto.subtle.encrypt = (async (...args: Parameters<SubtleCrypto['encrypt']>) => { const output = await encrypt(...args); journal.lockJournal(); return output; }) as SubtleCrypto['encrypt'];
  try { await assert.rejects(journal.encryptJournal(context, { thesis: 'late', reflection: '' }), /locked before encryption/); } finally { crypto.subtle.encrypt = encrypt; }
  await journal.openJournal(owner.address);
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  crypto.subtle.decrypt = (async (...args: Parameters<SubtleCrypto['decrypt']>) => { const output = await decrypt(...args); mera.lock(); return output; }) as SubtleCrypto['decrypt'];
  try { await assert.rejects(journal.decryptJournal(context, encrypted), /locked before decryption/); } finally { crypto.subtle.decrypt = decrypt; }
});
