import { NextResponse } from 'next/server';
import { GATE_CACHE, GATE_COOKIE, GATE_TTL, createGateSession, gateConfig, gateOrigin, safeNext, sameSecret } from '../../../lib/gate';
import { gateAttempts, gateClient } from '../../../lib/gate-attempts';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const config = gateConfig();
  const json = req.headers.get('accept')?.includes('application/json');
  const fail = (status: number, error: string, retryAfter?: number) => NextResponse.json({ error }, {
    status, headers: { 'Cache-Control': GATE_CACHE, ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) },
  });
  if (!config.ready) return fail(503, 'Access is temporarily unavailable. Please try again later.');
  if (req.headers.get('origin') !== gateOrigin(req.url)) return fail(403, 'Invalid request origin.');
  const retryAfter = gateAttempts.take(gateClient(req.headers));
  if (retryAfter) return fail(429, `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.`, retryAfter);
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return fail(415, 'Invalid form.');
  const reader = req.body?.getReader();
  if (!reader) return fail(400, 'Enter an access code.');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return fail(413, 'Form is too large.'); }
      chunks.push(value);
    }
  } catch { return fail(400, 'Invalid form.'); }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const next = safeNext(form.get('next'));
  const given = form.get('password') ?? '';
  if (given.length > 256 || !sameSecret(given, config.password)) {
    if (json) return fail(401, 'That code is not right. Try again.');
    return new NextResponse(null, { status: 303, headers: { Location: `/gate?e=1&next=${encodeURIComponent(next)}`, 'Cache-Control': GATE_CACHE } });
  }
  const res = json ? NextResponse.json({ next }, { headers: { 'Cache-Control': GATE_CACHE } })
    : new NextResponse(null, { status: 303, headers: { Location: next, 'Cache-Control': GATE_CACHE } });
  res.cookies.set(GATE_COOKIE, createGateSession(config), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' || gateOrigin(req.url).startsWith('https:'),
    path: '/',
    maxAge: GATE_TTL,
  });
  return res;
}
