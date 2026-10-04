import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { GATE_COOKIE, GATE_TTL, createGateSession, gateConfig } from '../src/gate';

Object.assign(process.env, {
  ENV_FILE: '.env.test-does-not-exist', FAUCET_ENV_FILE: '.env.test-does-not-exist', DB_PATH: ':memory:',
  RPC_URL: 'http://127.0.0.1:1', KEEPER_KEY: `0x${'1'.repeat(64)}`,
  BOT_MNEMONIC: 'test test test test test test test test test test test junk', PORT: '0', HOST: '127.0.0.1',
  GATE_DEV_BYPASS: '0', GATE_PASSWORD: 'api-test-access-code', GATE_SESSION_SECRET: 's'.repeat(64),
});
const { startApi } = await import('../src/api');
const { db } = await import('../src/db');
const server = startApi();
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.GATE_ORIGIN = base;
const sockets: WebSocket[] = [];
after(() => { for (const ws of sockets) ws.terminate(); server.close(); db.close(); });
const token = (now = Date.now()) => `${GATE_COOKIE}=${createGateSession(gateConfig(), now)}`;

test('HTTP and the GraphQL forward-auth endpoint reject unauthenticated requests', async () => {
  for (const path of ['/stats', '/prices', '/gate', '/profiles', '/match/1']) {
    const denied = await fetch(base + path);
    assert.equal(denied.status, 401, path);
    assert.equal((await denied.json()).code, 'GATE_REQUIRED');
    assert.match(denied.headers.get('cache-control')!, /no-store/);
  }
  assert.equal((await fetch(base + '/auth', { method: 'POST', body: '{}' })).status, 401);
  const page = await fetch(base + '/gate/page', { redirect: 'manual', headers: { 'x-forwarded-uri': '/play?party=abc', 'x-forwarded-method': 'GET' } });
  assert.equal(page.status, 307);
  assert.equal(page.headers.get('location'), '/gate?next=%2Fplay%3Fparty%3Dabc');
  assert.equal((await fetch(base + '/gate/page', { headers: { 'x-forwarded-method': 'POST' } })).status, 401);
  assert.equal((await fetch(base + '/gate', { headers: { cookie: token() } })).status, 200);
  assert.equal((await fetch(base + '/gate', { headers: { cookie: 'ls_gate=%' } })).status, 401);
  assert.equal((await fetch(base + '/health')).status, 200, 'direct loopback health probe');
  assert.equal((await fetch(base + '/health', { headers: { 'x-forwarded-for': '192.0.2.1' } })).status, 401, 'public proxy health is gated');
  const secret = process.env.GATE_SESSION_SECRET;
  delete process.env.GATE_SESSION_SECRET;
  try { assert.equal((await fetch(base + '/gate')).status, 503); }
  finally { process.env.GATE_SESSION_SECRET = secret; }
});

function rejectedSocket(headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers });
    sockets.push(ws);
    ws.on('error', () => {});
    ws.on('open', () => { ws.close(); reject(new Error('Unauthorized WebSocket opened')); });
    ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode!); res.resume(); ws.terminate(); });
  });
}

test('WebSocket upgrades reject missing, forged, expired and cross-origin credentials', async () => {
  assert.equal(await rejectedSocket({}), 401);
  assert.equal(await rejectedSocket({ cookie: 'ls_gate=forged' }), 401);
  assert.equal(await rejectedSocket({ cookie: token(Date.now() - GATE_TTL * 1000) }), 401);
  assert.equal(await rejectedSocket({ cookie: token(), origin: 'https://evil.example' }), 403);
});

test('an already-connected WebSocket closes at session expiry', { timeout: 5000 }, async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie: token(Date.now() - GATE_TTL * 1000 + 2000), origin: base } });
  sockets.push(ws);
  const closing = once(ws, 'close');
  await once(ws, 'open');
  assert.equal((await closing)[0], 4001);
});

test('a rotated code prevents messages on an existing connection', { timeout: 5000 }, async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie: token() } });
  sockets.push(ws);
  await once(ws, 'open');
  const password = process.env.GATE_PASSWORD;
  process.env.GATE_PASSWORD = 'rotated-code';
  try {
    const closing = once(ws, 'close');
    ws.send(JSON.stringify({ t: 'hello' }));
    assert.equal((await closing)[0], 4001);
  } finally { process.env.GATE_PASSWORD = password; }
});
