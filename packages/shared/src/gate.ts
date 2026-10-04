// Server-only entry point. Do not re-export from index.ts (which is used by the browser).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GATE_COOKIE = 'ls_gate';
export const GATE_TTL = 24 * 60 * 60;
export const GATE_CACHE = 'private, no-store, max-age=0';
export const GATE_REQUIRED = 'GATE_REQUIRED';
export const GATE_UNAVAILABLE = 'GATE_UNAVAILABLE';

export function gateConfig(env: NodeJS.ProcessEnv = process.env) {
  const password = env.GATE_PASSWORD ?? '';
  const secret = env.GATE_SESSION_SECRET ?? '';
  return {
    password,
    secret,
    bypass: env.NODE_ENV !== 'production' && env.GATE_DEV_BYPASS === '1',
    ready: password.trim().length > 0 && password.length <= 256 && secret.length >= 32,
  };
}
export type GateConfig = ReturnType<typeof gateConfig>;

export function sameSecret(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

// Bind sessions to both secrets: changing the access code also invalidates every old session.
function signature(payload: string, config: GateConfig) {
  const key = createHmac('sha256', config.secret).update(`longshort.fun/gate/v2:${config.password}`).digest();
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function createGateSession(config = gateConfig(), now = Date.now()) {
  if (!config.ready) throw new Error('Access gate is not configured');
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 2, iat, exp: iat + GATE_TTL, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  return `${payload}.${signature(payload, config)}`;
}

export function verifyGateSession(token: string, config = gateConfig(), now = Date.now()): { expiresAt: number } | null {
  if (!config.ready || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [payload, sig] = parts;
  if (!sameSecret(sig, signature(payload, config))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    if (session.v !== 2 || !Number.isSafeInteger(session.iat) || !Number.isSafeInteger(session.exp)
      || session.iat > seconds + 30 || session.exp <= seconds || session.exp <= session.iat
      || session.exp - session.iat > GATE_TTL || !/^[a-f0-9]{32}$/.test(session.nonce)) return null;
    return { expiresAt: session.exp * 1000 };
  } catch { return null; }
}

/** Malformed and duplicate cookies fail closed instead of throwing or selecting an arbitrary token. */
export function gateCookie(header: string | null | undefined): string {
  if (!header || header.length > 16_384) return '';
  const values = header.split(';').map((part) => part.trim()).filter((part) => part.split('=', 1)[0] === GATE_COOKIE);
  if (values.length !== 1) return '';
  try { return decodeURIComponent(values[0].slice(GATE_COOKIE.length + 1)); } catch { return ''; }
}

export function gateAccess(header: string | null | undefined, config = gateConfig(), now = Date.now()) {
  if (config.bypass) return { allowed: true, expiresAt: null, status: 200, code: null } as const;
  if (!config.ready) return { allowed: false, expiresAt: null, status: 503, code: GATE_UNAVAILABLE } as const;
  const session = verifyGateSession(gateCookie(header), config, now);
  return session
    ? { allowed: true, expiresAt: session.expiresAt, status: 200, code: null } as const
    : { allowed: false, expiresAt: null, status: 401, code: GATE_REQUIRED } as const;
}

/** An explicit public allowlist. File extensions and /s/ are never access exemptions. */
export function gatePublicPath(path: string) {
  return path === '/gate' || path === '/gate/enter' || path.startsWith('/_next/static/')
    || ['/favicon.ico', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'].includes(path);
}

export function gateOrigin(requestUrl: string, env: NodeJS.ProcessEnv = process.env) {
  return new URL(env.GATE_ORIGIN || (env.NODE_ENV === 'production' ? 'https://longshort.fun' : requestUrl)).origin;
}

export function safeNext(next: string | null | undefined) {
  if (!next || next.length > 2048 || !next.startsWith('/') || next.startsWith('//')) return '/';
  try {
    const decoded = decodeURIComponent(next);
    if (decoded.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(decoded)) return '/';
    const url = new URL(next, 'https://longshort.fun');
    if (url.origin !== 'https://longshort.fun' || url.pathname.startsWith('//') || /^\/gate(?:\/|$)/.test(url.pathname)) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}
