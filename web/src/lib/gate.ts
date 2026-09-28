import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Private-preview gate. The password lives only in the server's environment (GATE_PASSWORD);
 * the browser keeps a hash of it in an httpOnly cookie. No GATE_PASSWORD = no gate (local dev).
 */
export const GATE_COOKIE = 'ls_gate';
export const gatePassword = () => process.env.GATE_PASSWORD || '';
export const gateToken = (pw: string) => createHash('sha256').update(`longshort.fun/gate/v1:${pw}`).digest('hex');

export function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Only same-site paths: never bounce to another origin after sign-in. */
export const safeNext = (next: string | null | undefined) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
