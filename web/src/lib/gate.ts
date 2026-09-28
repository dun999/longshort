import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Private-preview gate. The password lives only in the server's environment (GATE_PASSWORD);
 * the browser keeps a hash of it in an httpOnly cookie. No GATE_PASSWORD = no gate (local dev).
 *
 * The whole private mode hangs off that one variable, so going public is unsetting it (see
 * scripts/private-mode.sh), no code change:
 *  - pages: middleware.ts sends visitors without the cookie to /gate
 *  - data: the keeper refuses its API and WebSocket without the cookie, and answers Caddy's
 *    forward_auth for the Envio GraphQL (keeper/src/gate.ts)
 *  - still open: /gate and /s/... (shared results, so X and co. can unfurl the card). Both sit on
 *    the bare root layout, so they never ship the game's code; /s/... also drops its pitch copy.
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

export const privateMode = () => !!gatePassword();
