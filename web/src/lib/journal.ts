'use client';
import { getPasskeyPrfOutput } from '@category-labs/mera';
import { ADDR, JOURNAL_NAMESPACE, JOURNAL_PRF_SALT, JOURNAL_MAX_BYTES, journalBinding, validJournalEnvelope,
  type JournalContext, type JournalEnvelope, type JournalNote } from '@longshort/shared';
import { currentCredential, onLock, ownerAccount, touch } from './mera';
import { measuredPasskeyClient } from './passkeyClient';

const encoder = new TextEncoder();
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let unlocked: { key: CryptoKey; owner: string } | undefined;
let epoch = 0;
const listeners = new Set<() => void>();
export const onJournalLock = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
export function lockJournal() { unlocked = undefined; epoch++; for (const fn of listeners) fn(); }
onLock(lockJournal);
export const journalIsUnlocked = (owner: string) => unlocked?.owner === owner.toLowerCase();
export const journalContext = (owner: string, matchId: number): JournalContext => ({ chainId: ADDR.chainId, arena: ADDR.arena, owner, matchId });

/** A separate PRF namespace and an explicit verification, even while trading is unlocked. */
export async function openJournal(owner: string) {
  const account = ownerAccount();
  const credentialId = currentCredential();
  if (!account || !credentialId || account.address.toLowerCase() !== owner.toLowerCase()) throw new Error('Sign in with this account’s passkey first.');
  const start = epoch;
  const measured = measuredPasskeyClient('journal');
  let output: Uint8Array | undefined;
  try {
    const result = await getPasskeyPrfOutput({ rpId: location.hostname, credential: { credentialId },
      prfSalt: bytes(JOURNAL_PRF_SALT), webAuthnClient: measured.client });
    output = result.prfOutput;
    if (result.credentialId !== credentialId || ownerAccount() !== account || epoch !== start) throw new Error('Passkey session changed. Open the journal again.');
    const material = await crypto.subtle.importKey('raw', new Uint8Array(output), 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256',
      salt: encoder.encode('longshort.fun/private-match-journal/hkdf/v1'),
      info: encoder.encode(`${JOURNAL_NAMESPACE}:${ADDR.chainId}:${ADDR.arena.toLowerCase()}:${owner.toLowerCase()}`),
    }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    if (ownerAccount() !== account || epoch !== start) throw new Error('Passkey session changed. Open the journal again.');
    unlocked = { key, owner: owner.toLowerCase() };
    touch();
  } finally { output?.fill(0); measured.dispose(); }
}
function keyFor(context: JournalContext) {
  if (!unlocked || unlocked.owner !== context.owner.toLowerCase()) throw new Error('Journal locked. Verify your passkey to open it.');
  if (context.chainId !== ADDR.chainId || context.arena.toLowerCase() !== ADDR.arena.toLowerCase()) throw new Error('Journal deployment changed.');
  journalBinding(context);
  touch();
  return unlocked;
}
function validNote(note: unknown): note is JournalNote {
  if (!note || typeof note !== 'object') return false;
  const value = note as Record<string, unknown>;
  return Object.keys(value).sort().join(',') === 'reflection,thesis' && typeof value.thesis === 'string' && typeof value.reflection === 'string' &&
    value.thesis.length <= 1_500 && value.reflection.length <= 1_500;
}
export async function encryptJournal(context: JournalContext, note: JournalNote): Promise<JournalEnvelope> {
  const session = keyFor(context);
  if (!validNote(note)) throw new Error('Journal notes are limited to 1,500 characters per field.');
  const plaintext = encoder.encode(JSON.stringify(note));
  try {
    if (plaintext.byteLength > JOURNAL_MAX_BYTES) throw new Error('Journal is too long. Shorten the notes before saving.');
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce,
      additionalData: encoder.encode(journalBinding(context)), tagLength: 128 }, session.key, plaintext);
    if (unlocked !== session) throw new Error('Journal locked before encryption finished.');
    return { version: 1, namespace: JOURNAL_NAMESPACE, prfSalt: JOURNAL_PRF_SALT, nonce: base64(nonce), ciphertext: base64(new Uint8Array(ciphertext)) };
  } finally { plaintext.fill(0); }
}
export async function decryptJournal(context: JournalContext, envelope: JournalEnvelope): Promise<JournalNote> {
  const session = keyFor(context);
  if (!validJournalEnvelope(envelope)) throw new Error('The saved journal format is invalid.');
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.nonce),
      additionalData: encoder.encode(journalBinding(context)), tagLength: 128 }, session.key, bytes(envelope.ciphertext));
  } catch { throw new Error('The journal could not be authenticated. Its data, match binding, or passkey differs.'); }
  try {
    if (unlocked !== session) throw new Error('Journal locked before decryption finished.');
    let note: unknown;
    try { note = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)); }
    catch { throw new Error('The saved journal contents are invalid.'); }
    if (!validNote(note)) throw new Error('The saved journal contents are invalid.');
    return note;
  } finally { new Uint8Array(plaintext).fill(0); }
}
