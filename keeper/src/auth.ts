import { randomBytes } from 'node:crypto';
import { isAddress, verifyMessage } from 'viem';
import { db } from './db';

/*
 * Sign-in for the live socket and matchmaking: one wallet signature buys a token that this browser keeps, so a
 * connection can only speak for an address it controls. Without it, anyone could claim to be a party leader.
 */
const TTL_MS = 30 * 86_400_000;
export const signInMessage = (addr: string, ts: number) => `Sign in to longshort.fun\n\nNo transaction, no cost.\n\n${addr.toLowerCase()}\n${ts}`;

export async function signIn(body: any) {
  const { addr, ts, sig } = body ?? {};
  if (!isAddress(String(addr)) || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300 || typeof sig !== 'string') throw new Error('Invalid or expired sign-in');
  if (!(await verifyMessage({ address: addr, message: signInMessage(addr, ts), signature: sig as `0x${string}` }).catch(() => false))) throw new Error('Invalid sign-in signature');
  const token = randomBytes(24).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - TTL_MS);
  db.prepare('INSERT INTO sessions(token, addr, created_at) VALUES (?, ?, ?)').run(token, addr.toLowerCase(), Date.now());
  return { token };
}

export function tokenOwner(token: unknown) {
  if (typeof token !== 'string') return undefined;
  const row = db.prepare('SELECT addr FROM sessions WHERE token = ? AND created_at > ?').get(token, Date.now() - TTL_MS) as { addr: string } | undefined;
  return row?.addr;
}

/** Signing out forgets the token here too, so a copy of it stops working. */
export function revoke(body: any) {
  signedIn(body);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(body.token);
  return { ok: true };
}

/** The caller's address, if the request carries this address's sign-in token. */
export function signedIn(body: any) {
  const owner = tokenOwner(body?.token);
  if (!owner || owner !== String(body?.addr).toLowerCase()) throw new Error('Sign in again to keep playing');
  return owner;
}
