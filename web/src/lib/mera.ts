'use client';
/*
 * One passkey, many keys.
 *
 * A single passkey ceremony (Face ID / Touch ID / PIN) returns 32 bytes of WebAuthn PRF
 * entropy through Mera. From that one secret we derive purpose-separated secp256k1 keys
 * with HKDF-SHA256 — no key material is written to storage:
 *
 *   PRF ─┬─ HKDF("longshort/owner/v1")        → Owner key   (holds stake, joins matches, signs profile)
 *        └─ HKDF("longshort/trade-root/v1")   → trade root  (memory only)
 *              └─ HKDF("longshort/match/<n>") → Match key n (registered onchain as that match's session key;
 *                                                            signs trades with no prompts; can only trade
 *                                                            inside that one match, never move the stake)
 *
 * Keys live in Mera signing sessions, which zero their key material on end(). Everything is
 * wiped on lock(), after an idle timeout, and on pagehide.
 */
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, createSecp256k1SigningSession, isMeraError, type Secp256k1SigningSession } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { nonceManager, type Address, type LocalAccount } from 'viem';
import { ADDR } from '@longshort/shared';
import { measuredPasskeyClient } from './passkeyClient';

const SALT = new TextEncoder().encode('longshort.fun/passkey-accounts');
const LOCK_AFTER_MS = 30 * 60 * 1000;
const ENTRY_APPROVAL_MS = 2 * 60 * 1000;
const LS = { credential: 'ls.passkey.credential', labels: 'ls.passkey.matchKeys' };

const derive = (ikm: Uint8Array, info: string) => hkdf(sha256, ikm, SALT, new TextEncoder().encode(info), 32);

interface Keyring {
  credentialId: string;
  owner: LocalAccount;
  ownerSession: Secp256k1SigningSession;
  tradeRoot: Uint8Array;
  matchKeys: Map<string, { account: LocalAccount; session: Secp256k1SigningSession }>;
  boundLabels: Map<number, string>;
  entryApprovalUntil: number;
}
let ring: Keyring | null = null;
let opening: Promise<LocalAccount> | undefined;
let revision = 0;
let lockTimer: ReturnType<typeof setTimeout> | undefined;
let lastUse = 0;
let pins = 0;

/** Marks the keyring as in use: the idle lock counts from the last use, not from unlock. */
export const touch = () => void (lastUse = Date.now());

/** Keeps the keyring open while a match runs (a Face ID sheet mid-fight would cost the round). Returns the release. */
export function pin() {
  pins++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pins = Math.max(0, pins - 1);
    touch();
  };
}

function scheduleLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    if (pins > 0 || Date.now() - lastUse < LOCK_AFTER_MS) return scheduleLock();
    lock();
  }, 60_000);
}
const listeners = new Set<() => void>();
export const onLock = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

function store() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function passkeySupported() {
  return typeof window !== 'undefined' && window.isSecureContext && 'credentials' in navigator && typeof window.PublicKeyCredential !== 'undefined';
}

/** Zero every derived key and forget the trade root. */
export function lock() {
  revision++;
  if (!ring) return;
  ring.ownerSession.end();
  for (const k of ring.matchKeys.values()) k.session.end();
  ring.tradeRoot.fill(0);
  ring = null;
  clearTimeout(lockTimer);
  for (const fn of listeners) fn();
}

export const isUnlocked = () => !!ring;

function keyFrom(bytes: Uint8Array) {
  try {
    const session = createSecp256k1SigningSession({ privateKey: bytes });
    return { session, account: toViemAccount(session, { nonceManager }) as unknown as LocalAccount };
  } finally {
    bytes.fill(0);
  }
}

/**
 * Creates a new passkey (create=true) or asks the device for an existing one, then derives the keyring.
 * One biometric prompt either way (some authenticators need a second on first creation).
 */
export function unlock(opts: { create?: boolean; username?: string } = {}): Promise<LocalAccount> {
  opening ??= unlockPasskey(opts).finally(() => (opening = undefined));
  return opening;
}

async function unlockPasskey(opts: { create?: boolean; username?: string }): Promise<LocalAccount> {
  if (!passkeySupported()) throw new Error('Passkeys need a secure (https or localhost) browser context.');
  const startRevision = revision;
  const rp = { id: location.hostname, name: 'longshort.fun' };
  const measured = measuredPasskeyClient('account');
  let credentialId: string;
  let prf: Uint8Array;
  try {
    if (opts.create) {
      const name = opts.username?.trim() || 'trader';
      const res = await createPasskeyWithPrfOutput({ rp, user: { name, displayName: name }, webAuthnClient: measured.client });
      prf = res.prfOutput;
      credentialId = res.credentialId;
      write(LS.credential, JSON.stringify({ credentialId: res.credentialId, transports: res.transports }));
    } else {
      // Discoverable credentials reconstruct access even if browser metadata is absent or corrupt.
      const res = await getPasskeyPrfOutput({ rpId: rp.id, webAuthnClient: measured.client });
      prf = res.prfOutput;
      credentialId = res.credentialId;
      write(LS.credential, JSON.stringify({ credentialId: res.credentialId }));
    }
  } catch (e) {
    if (isMeraError(e) && e.code === 'PRF_UNAVAILABLE') throw new Error('This device/browser passkey does not support PRF. Try Chrome, Safari 18+, or a phone passkey.');
    if (isMeraError(e) && e.code === 'PASSKEY_OPERATION_FAILED') throw new Error('Passkey prompt was cancelled or unavailable.');
    throw e;
  } finally {
    measured.dispose();
  }
  let owner: ReturnType<typeof keyFrom> | undefined;
  try {
    if (revision !== startRevision) throw new Error('Passkey session was cancelled. Sign in again.');
    owner = keyFrom(derive(prf, 'longshort/owner/v1'));
    if (!opts.create && ring?.credentialId === credentialId && ring.owner.address.toLowerCase() === owner.account.address.toLowerCase()) {
      // Fresh consent for the same account need not discard a live round or unsaved journal draft.
      owner.session.end();
      ring.entryApprovalUntil = Date.now() + ENTRY_APPROVAL_MS;
      touch();
      return ring.owner;
    }
    lock();
    const tradeRoot = derive(prf, 'longshort/trade-root/v1');
    ring = { credentialId, owner: owner.account, ownerSession: owner.session, tradeRoot, matchKeys: new Map(), boundLabels: new Map(), entryApprovalUntil: Date.now() + ENTRY_APPROVAL_MS };
    touch();
    scheduleLock();
    return owner.account;
  } catch (e) {
    owner?.session.end();
    throw e;
  } finally {
    prf.fill(0);
  }
}

function read(key: string) {
  try { return store()?.getItem(key) ?? null; } catch { return null; }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) store()?.removeItem(key);
    else store()?.setItem(key, value);
  } catch { /* Browser storage is an optional cache, never a prerequisite for signing. */ }
}

export const hasSavedPasskey = () => !!read(LS.credential);
export function forgetPasskey() {
  lock();
  write(LS.credential, null);
  write(LS.labels, null);
}

/** Owner account, if unlocked. */
export const ownerAccount = () => ring?.owner ?? null;
/** Public metadata from the verified credential, never from an untrusted cache. */
export const currentCredential = () => ring?.credentialId ?? null;

function labels(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(read(LS.labels) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, label]) => validLabel(label))) : {};
  } catch {
    return {};
  }
}

/** Derives (or re-derives) the trading key for a label. Needs the keyring unlocked. */
export function matchKey(label: string): LocalAccount {
  if (!ring) throw new Error('Passkey locked — unlock to trade.');
  if (!validLabel(label)) throw new Error('Invalid match key metadata');
  touch();
  const hit = ring.matchKeys.get(label);
  if (hit) return hit.account;
  const k = keyFrom(derive(ring.tradeRoot, `longshort/match/${label}`));
  ring.matchKeys.set(label, k);
  return k.account;
}

/** A public, deployment-scoped label; random bytes avoid dependence on a browser counter. */
export function nextMatchLabel() {
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v2:${ADDR.chainId}:${ADDR.arena.toLowerCase()}:${nonce}`;
}

function validLabel(label: unknown): label is string {
  return typeof label === 'string' && /^[a-zA-Z0-9:/._-]{1,160}$/.test(label);
}
function cacheKey(matchId: number) {
  return `${ADDR.chainId}:${ADDR.arena.toLowerCase()}:${ring?.owner.address.toLowerCase()}:${matchId}`;
}

/** Local hints improve latency; durable public hints are saved before the entry transaction. */
export function bindMatch(matchId: number, label: string) {
  if (!ring || !validLabel(label)) throw new Error('Passkey locked or invalid match key');
  ring.boundLabels.set(matchId, label);
  const all = labels();
  all[cacheKey(matchId)] = label;
  write(LS.labels, JSON.stringify(all));
}
export const labelFor = (matchId: number) => ring?.boundLabels.get(matchId) ?? labels()[cacheKey(matchId)] ?? labels()[String(matchId)];

/** Neither the local cache nor the keeper can substitute a signer for the registered onchain session. */
export async function recoverMatchKey(matchId: number, registered: Address, lookup: () => Promise<{ label: string } | null>): Promise<LocalAccount> {
  const current = ring;
  if (!current) throw new Error('Passkey locked — unlock to resume this match.');
  const verify = (label: unknown) => {
    if (ring !== current) throw new Error('Passkey session changed. Try again.');
    if (!validLabel(label)) return null;
    const existing = current.matchKeys.has(label);
    const account = matchKey(label);
    if (account.address.toLowerCase() === registered.toLowerCase()) return account;
    if (!existing) {
      current.matchKeys.get(label)?.session.end();
      current.matchKeys.delete(label);
    }
    return null;
  };
  const cached = labelFor(matchId);
  const hit = verify(cached);
  if (hit) {
    current.boundLabels.set(matchId, cached!);
    return hit;
  }
  const hint = await lookup();
  const recovered = verify(hint?.label);
  if (!recovered) throw new Error('This match’s trading key could not be recovered. Retry with the passkey used to join.');
  bindMatch(matchId, hint!.label);
  return recovered;
}

/** One paid entry immediately after verification. Later entries require another passkey ceremony. */
export function consumeEntryApproval() {
  if (!ring || Date.now() >= ring.entryApprovalUntil) return false;
  ring.entryApprovalUntil = 0;
  return true;
}

export function endMatch(matchId: number) {
  const label = labelFor(matchId);
  if (!ring || !label) return;
  ring.matchKeys.get(label)?.session.end();
  ring.matchKeys.delete(label);
}

/** Every key this passkey has produced in this session, for the "Keys" panel. */
export function describeKeys(): { purpose: string; address: string }[] {
  if (!ring) return [];
  const byLabel = [...ring.boundLabels.entries()];
  return [
    { purpose: 'Owner · stake, joins, profile', address: ring.owner.address },
    ...[...ring.matchKeys.entries()].map(([label, k]) => {
      const m = byLabel.find(([, l]) => l === label)?.[0];
      return { purpose: m ? `Match #${m} · trading` : 'Next match · trading', address: k.account.address };
    }),
  ];
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', lock);
