import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Private-preview gate for the data plane: the API, the live WebSocket and (through Caddy's
 * forward_auth → GET /gate) the Envio GraphQL. A request passes with the same httpOnly cookie the
 * web gate sets after the access code (web/src/lib/gate.ts). No GATE_PASSWORD = public: going live
 * is removing that one variable, no code change. Read per request, after env.ts has loaded the .env file.
 */
export const GATE_COOKIE = 'ls_gate';
export const gateToken = (pw: string) => createHash('sha256').update(`longshort.fun/gate/v1:${pw}`).digest('hex');

export function gateAllows(req: Pick<IncomingMessage, 'headers'>, password = process.env.GATE_PASSWORD ?? '') {
  if (!password) return true;
  const want = Buffer.from(gateToken(password));
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== GATE_COOKIE) continue;
    const have = Buffer.from(decodeURIComponent(v.join('=')));
    if (have.length === want.length && timingSafeEqual(have, want)) return true;
  }
  return false;
}
