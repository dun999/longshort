'use client';
/*
 * One passkey, many keys.
 *
 * A single passkey ceremony (Face ID / Touch ID / PIN) returns 32 bytes of WebAuthn PRF
 * entropy through Mera. From that one secret we derive purpose-separated secp256k1 keys
 * with HKDF-SHA256 — nothing is ever written to storage:
 *
 *   PRF ─┬─ HKDF("longshort/owner/v1")        → Owner key   (holds stake, joins matches, signs profile)
 *        └─ HKDF("longshort/trade-root/v1")   → trade root  (memory only)
 *              └─ HKDF("longshort/match/<n>") → Match key n (registered onchain as that match's session key;
 *                                                            signs trades with no prompts; can only trade
 *                                                            inside that one match, never move the stake)
 *
 * Keys live in Mera signing sessions, which zero their key material on end(). Everything is
 * wiped on lock(), after an idle timeout, and when the page is hidden/closed.
 */
import { createPasskeyWithPrfOutput, getPasskeyPrfOutput, createSecp256k1SigningSession, isMeraError, type Secp256k1SigningSession } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { nonceManager, type LocalAccount } from 'viem';

const SALT = new TextEncoder().encode('longshort.fun/passkey-accounts');
const LOCK_AFTER_MS = 30 * 60 * 1000;
const LS = { credential: 'ls.passkey.credential', labels: 'ls.passkey.matchKeys', counter: 'ls.passkey.counter' };

const derive = (ikm: Uint8Array, info: string) => hkdf(sha256, ikm, SALT, new TextEncoder().encode(info), 32);

interface Keyring {
  owner: LocalAccount;
  ownerSession: Secp256k1SigningSession;
  tradeRoot: Uint8Array;
  matchKeys: Map<string, { account: LocalAccount; session: Secp256k1SigningSession }>;
}
let ring: Keyring | null = null;
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
export async function unlock(opts: { create?: boolean; username?: string } = {}): Promise<LocalAccount> {
  if (!passkeySupported()) throw new Error('Passkeys need a secure (https or localhost) browser context.');
  const rp = { id: location.hostname, name: 'longshort.fun' };
  let prf: Uint8Array;
  try {
    if (opts.create) {
      const name = opts.username?.trim() || 'trader';
      const res = await createPasskeyWithPrfOutput({ rp, user: { name, displayName: name } });
      store()?.setItem(LS.credential, JSON.stringify({ credentialId: res.credentialId, transports: res.transports }));
      prf = res.prfOutput;
    } else {
      const saved = store()?.getItem(LS.credential);
      const res = await getPasskeyPrfOutput({ rpId: rp.id, credential: saved ? JSON.parse(saved) : undefined });
      prf = res.prfOutput;
    }
  } catch (e) {
    if (isMeraError(e) && e.code === 'PRF_UNAVAILABLE') throw new Error('This device/browser passkey does not support PRF. Try Chrome, Safari 18+, or a phone passkey.');
    if (isMeraError(e) && e.code === 'PASSKEY_OPERATION_FAILED') throw new Error('Passkey prompt was cancelled or unavailable.');
    throw e;
  }
  lock();
  const owner = keyFrom(derive(prf, 'longshort/owner/v1'));
  const tradeRoot = derive(prf, 'longshort/trade-root/v1');
  prf.fill(0);
  ring = { owner: owner.account, ownerSession: owner.session, tradeRoot, matchKeys: new Map() };
  touch();
  scheduleLock();
  window.addEventListener('pagehide', lock, { once: true });
  return owner.account;
}

export const hasSavedPasskey = () => !!store()?.getItem(LS.credential);
export function forgetPasskey() {
  lock();
  store()?.removeItem(LS.credential);
  store()?.removeItem(LS.labels);
}

/** Owner account, if unlocked. */
export const ownerAccount = () => ring?.owner ?? null;

function labels(): Record<string, string> {
  try {
    return JSON.parse(store()?.getItem(LS.labels) ?? '{}');
  } catch {
    return {};
  }
}

/** Derives (or re-derives) the trading key for a label. Needs the keyring unlocked. */
export function matchKey(label: string): LocalAccount {
  if (!ring) throw new Error('Passkey locked — unlock to trade.');
  touch();
  const hit = ring.matchKeys.get(label);
  if (hit) return hit.account;
  const k = keyFrom(derive(ring.tradeRoot, `longshort/match/${label}`));
  ring.matchKeys.set(label, k);
  return k.account;
}

/** A never-used label for the next match (the match id isn't known until the join tx lands). */
export function nextMatchLabel() {
  const s = store();
  const n = Number(s?.getItem(LS.counter) ?? '0') + 1;
  s?.setItem(LS.counter, String(n));
  return `k${n}-${Date.now().toString(36)}`;
}

/** Remembers which derived key is registered for which match (labels only; never key material). */
export function bindMatch(matchId: number, label: string) {
  const all = labels();
  all[String(matchId)] = label;
  store()?.setItem(LS.labels, JSON.stringify(all));
}
export const labelFor = (matchId: number) => labels()[String(matchId)];

/** Every key this passkey has produced in this session, for the "Keys" panel. */
export function describeKeys(): { purpose: string; address: string }[] {
  if (!ring) return [];
  const byLabel = Object.entries(labels());
  return [
    { purpose: 'Owner · stake, joins, profile', address: ring.owner.address },
    ...[...ring.matchKeys.entries()].map(([label, k]) => {
      const m = byLabel.find(([, l]) => l === label)?.[0];
      return { purpose: m ? `Match #${m} · trading` : 'Next match · trading', address: k.account.address };
    }),
  ];
}
