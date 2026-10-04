import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GATE_COOKIE, GATE_TTL, createGateSession, gateAccess, gateConfig, gateCookie, safeNext } from '../src/gate';
import { verifyGateSession as webVerify } from '@longshort/shared/gate';

const config = gateConfig({ NODE_ENV: 'production', GATE_PASSWORD: 'test-access-code', GATE_SESSION_SECRET: 's'.repeat(64) });
const now = Date.now();
const cookie = (token: string) => `${GATE_COOKIE}=${token}`;

test('missing configuration fails closed, and production ignores the local opt-out', () => {
  for (const env of [{}, { GATE_PASSWORD: config.password }, { GATE_SESSION_SECRET: config.secret }, { GATE_PASSWORD: config.password, GATE_SESSION_SECRET: 'short' }]) {
    const cfg = gateConfig({ ...env, NODE_ENV: 'production', GATE_DEV_BYPASS: '1' });
    assert.equal(gateAccess(null, cfg).status, 503);
    assert.throws(() => createGateSession(cfg), /not configured/);
  }
  assert.equal(gateAccess(null, gateConfig({ NODE_ENV: 'development' })).allowed, false);
  assert.equal(gateAccess(null, gateConfig({ NODE_ENV: 'development', GATE_DEV_BYPASS: '1' })).allowed, true);
});

test('only signed, unexpired sessions pass; web and keeper use the same verifier', () => {
  const token = createGateSession(config, now);
  assert.notEqual(token, createGateSession(config, now), 'sessions include a random nonce');
  assert.equal(gateAccess(cookie(token), config, now).allowed, true);
  assert.equal(webVerify(token, config, now)?.expiresAt, Math.floor(now / 1000) * 1000 + GATE_TTL * 1000);
  assert.equal(gateAccess(null, config, now).status, 401);
  assert.equal(gateAccess(cookie(token), config, now + GATE_TTL * 1000).allowed, false);
  assert.equal(gateAccess(cookie(token + 'x'), config, now).allowed, false);
  const [body, sig] = token.split('.');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  data.exp += 3600;
  assert.equal(webVerify(`${Buffer.from(JSON.stringify(data)).toString('base64url')}.${sig}`, config, now), null);
  const legacy = createHash('sha256').update(`longshort.fun/gate/v1:${config.password}`).digest('hex');
  assert.equal(gateAccess(cookie(legacy), config, now).allowed, false);
});

test('rotating either secret invalidates all existing sessions', () => {
  const token = createGateSession(config, now);
  for (const changed of [{ ...config, password: 'new-code' }, { ...config, secret: 'r'.repeat(64) }]) {
    assert.equal(gateAccess(cookie(token), changed, now).allowed, false);
  }
});

test('malformed, oversized and duplicate cookies cannot crash or authorize the request', () => {
  const token = createGateSession(config, now);
  for (const header of ['ls_gate=%', 'ls_gate=%E0%A4%A', 'ls_gate', 'ls_gate=nope', `xls_gate=${token}`, `${cookie(token)}; ${cookie('other')}`, cookie('a'.repeat(20_000))]) {
    assert.equal(gateAccess(header, config, now).allowed, false, header.slice(0, 40));
  }
  assert.equal(gateCookie(`theme=dark; ${cookie(encodeURIComponent(token))}; x=1`), token);
});

test('return URLs cannot change origin or loop through the gate', () => {
  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', '/%5cevil.example', '/%2fevil.example', '/x/..//evil.example', '/%0d%0aLocation:test', '/gate', '/gate/enter', '/%zz']) {
    assert.equal(safeNext(next), '/', next);
  }
  assert.equal(safeNext('/play?mode=squad&party=abc'), '/play?mode=squad&party=abc');
  assert.equal(safeNext('/s/test'), '/s/test');
});
