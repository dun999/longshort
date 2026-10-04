import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { middleware, config as matcher } from '../src/middleware';
import { POST } from '../src/app/gate/enter/route';
import { GateAttempts, gateClient } from '../src/lib/gate-attempts';
import { handleGateResponse } from '../src/lib/gate-client';
import { GATE_COOKIE, GATE_TTL, createGateSession, gateConfig, verifyGateSession } from '@longshort/shared/gate';

Object.assign(process.env, { NODE_ENV: 'production' });
process.env.GATE_DEV_BYPASS = '1'; // Deliberately set: production must ignore this.
process.env.GATE_PASSWORD = 'gate-test-access-code';
process.env.GATE_SESSION_SECRET = 'test-signing-secret-'.repeat(4);
process.env.GATE_ORIGIN = 'https://longshort.fun';
process.env.GATE_TRUST_PROXY = '1';
process.env.NEXT_PUBLIC_ASSET_HASHES = JSON.stringify({ '/models/sniper.glb': 'a1b2c3d4e5f6' }); // set by next.config.ts in builds

const protectedPaths = ['/', '/play', '/play?party=abc', '/practice', '/leaderboard', '/stats', '/profile/0x123', '/match/12', '/match/12/report', '/dev/cast', '/s/test', '/s/test/card', '/gatekeeper', '/gate/private', '/report.png', '/models/sniper.glb', '/cast/sniper.webp'];
const cookie = `${GATE_COOKIE}=${createGateSession(gateConfig())}`;

test('only access-gate failures redirect; wallet authorization can renew its own token', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const redirected: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { pathname: '/play', search: '?party=abc', replace: (url: string) => redirected.push(url) } } });
  try {
    assert.equal(handleGateResponse(new Response('{}', { status: 401 })), false);
    assert.equal(redirected.length, 0);
    assert.equal(handleGateResponse(new Response('{}', { status: 401, headers: { 'x-longshort-gate': 'GATE_REQUIRED' } })), true);
    assert.deepEqual(redirected, ['/gate?next=%2Fplay%3Fparty%3Dabc']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('all pages, including shares, apparent asset suffixes and gate-like paths, require a session', () => {
  for (const path of protectedPaths) {
    const url = `https://longshort.fun${path}`;
    assert.equal(unstable_doesMiddlewareMatch({ config: matcher, nextConfig: {}, url }), true, path);
    for (const headers of [{}, { rsc: '1', 'next-router-prefetch': '1' }, { 'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware' }] as Record<string, string>[]) {
      const denied = middleware(new NextRequest(url, { headers }));
      assert.equal(denied.status, 307, path);
      assert.equal(new URL(denied.headers.get('location')!).pathname, '/gate');
      assert.match(denied.headers.get('cache-control')!, /no-store/);
    }
    assert.equal(middleware(new NextRequest(url, { headers: { cookie } })).headers.get('x-middleware-next'), '1', path);
  }
});

test('only a valid session asking for current content-hashed media may cache it, and only privately', () => {
  const cache = (path: string, headers: Record<string, string> = { cookie }) => middleware(new NextRequest(`https://longshort.fun${path}`, { headers })).headers.get('cache-control')!;
  assert.equal(cache('/models/sniper.glb?v=a1b2c3d4e5f6'), 'private, max-age=31536000, immutable');
  for (const path of ['/models/sniper.glb', '/models/sniper.glb?v=000000000000', '/models/sniper.glb?v=', '/cast/sniper.webp?v=a1b2c3d4e5f6', '/play?v=a1b2c3d4e5f6']) {
    assert.match(cache(path), /no-store/, path);
  }
  const denied = middleware(new NextRequest('https://longshort.fun/models/sniper.glb?v=a1b2c3d4e5f6'));
  assert.equal(denied.status, 307);
  assert.match(denied.headers.get('cache-control')!, /no-store/);
});

test('only the gate and explicit framework/branding files are public; data requests get errors', () => {
  for (const path of ['/gate', '/gate/enter', '/_next/static/chunks/runtime.js', '/icon-192.png', '/manifest.webmanifest']) {
    assert.equal(middleware(new NextRequest(`https://longshort.fun${path}`)).headers.get('x-middleware-next'), '1');
  }
  for (const path of ['/api/stats', '/api/gate', '/v1/graphql', '/_next/image?url=%2Fs%2Ftest%2Fcard']) {
    assert.equal(middleware(new NextRequest(`https://longshort.fun${path}`)).status, 401);
  }
  const previous = process.env.GATE_SESSION_SECRET;
  delete process.env.GATE_SESSION_SECRET;
  try {
    assert.equal(middleware(new NextRequest('https://longshort.fun/play')).status, 307);
    assert.equal(middleware(new NextRequest('https://longshort.fun/api/stats')).status, 503);
  } finally { process.env.GATE_SESSION_SECRET = previous; }
});

test('per-client and global attempt limits recover after their window and ignore untrusted IP headers', () => {
  const attempts = new GateAttempts();
  for (let i = 0; i < 10; i++) assert.equal(attempts.take('alice', 1000), 0);
  assert.equal(attempts.take('alice', 1001), 900);
  assert.equal(attempts.take('bob', 1001), 0);
  assert.equal(attempts.take('alice', 901_000), 0);
  const global = new GateAttempts();
  for (let i = 0; i < 100; i++) assert.equal(global.take(`client-${i}`, 1000), 0);
  assert.equal(global.take('new-ip', 1000), 900);
  process.env.GATE_TRUST_PROXY = '0';
  assert.equal(gateClient(new Headers({ 'x-gate-client-ip': '1.2.3.4', 'x-forwarded-for': '9.8.7.6' })), 'untrusted');
  process.env.GATE_TRUST_PROXY = '1';
  assert.equal(gateClient(new Headers({ 'x-forwarded-for': '9.8.7.6' })), 'untrusted');
});

let client = 1;
const enter = (password: string, next = '/play', headers: Record<string, string> = {}) => POST(new Request('https://longshort.fun/gate/enter', {
  method: 'POST', headers: { origin: 'https://longshort.fun', 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'x-gate-client-ip': `192.0.2.${client++}`, ...headers },
  body: new URLSearchParams({ password, next }),
}));

test('code submission issues a secure expiring cookie, preserves the destination, and rejects wrong codes/origins', async () => {
  const success = await enter(process.env.GATE_PASSWORD!, '/play?mode=squad');
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { next: '/play?mode=squad' });
  const header = success.headers.get('set-cookie')!;
  assert.match(header, /HttpOnly/i);
  assert.match(header, /Secure/i);
  assert.match(header, /SameSite=lax/i);
  assert.match(header, new RegExp(`Max-Age=${GATE_TTL}`));
  const token = header.split(';')[0].slice(GATE_COOKIE.length + 1);
  assert.ok(verifyGateSession(decodeURIComponent(token)));
  assert.equal((await enter('wrong')).status, 401);
  assert.equal((await enter(process.env.GATE_PASSWORD!, '/', { origin: 'https://evil.example' })).status, 403);
  assert.deepEqual(await (await enter(process.env.GATE_PASSWORD!, '//evil.example')).json(), { next: '/' });
  assert.equal((await enter('x'.repeat(5000))).status, 413);
});

test('repeated code guesses are refused with Retry-After and no session', async () => {
  const headers = { 'x-gate-client-ip': '198.51.100.1' };
  for (let i = 0; i < 10; i++) assert.equal((await enter('wrong', '/', headers)).status, 401);
  const limited = await enter(process.env.GATE_PASSWORD!, '/', headers);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(limited.headers.get('set-cookie'), null);
});
