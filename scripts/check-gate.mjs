import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

function upgradeStatus(url, cookie) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'), ...(cookie ? { Cookie: cookie } : {}) },
      timeout: 5000,
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => req.destroy(new Error('WebSocket gate check timed out')));
    req.on('error', reject);
    req.end();
  });
}

/** Read-only checks plus one code login. Never logs credentials, cookies or response bodies. */
export async function checkGate(base, password, { services = true } = {}) {
  const origin = new URL(base).origin;
  const request = (path, options = {}) => fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(10_000), ...options });
  const privateResponse = (res) => assert.match(res.headers.get('cache-control') ?? '', /no-store/, 'Protected response was cacheable');
  for (const path of ['/', '/play', '/practice', '/stats', '/match/1/report', '/s/gate-check', '/s/gate-check/card', '/models/gladiator.glb?v=000000000000', '/cast/gladiator.webp']) {
    for (const headers of [{}, { rsc: '1', 'next-router-prefetch': '1' }, { cookie: 'ls_gate=%' }, { 'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware' }]) {
      const res = await request(path, { headers });
      assert.ok([307, 401].includes(res.status), `Unauthenticated ${path} returned ${res.status}`);
      if (res.status === 307) assert.equal(new URL(res.headers.get('location'), origin).pathname, '/gate');
      privateResponse(res);
      await res.body?.cancel();
    }
  }
  assert.equal((await request('/gate')).status, 200, 'Gate screen is unavailable');
  if (services) {
    for (const path of ['/api/stats', '/api/gate', '/api/health', '/v1/graphql']) {
      const res = await request(path);
      assert.equal(res.status, 401, `${path} is not gated`);
      privateResponse(res);
      await res.body?.cancel();
    }
    assert.equal(await upgradeStatus(new URL('/api/ws', origin)), 401, 'Unauthenticated keeper WebSocket opened');
  }
  const login = await request('/gate/enter', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ password, next: '/play' }) });
  assert.equal(login.status, 200, 'Access code login failed');
  const setCookie = login.headers.get('set-cookie') ?? '';
  assert.ok(/HttpOnly/i.test(setCookie), 'Session cookie must be HttpOnly');
  assert.ok(/Secure/i.test(setCookie), 'Session cookie must be Secure');
  assert.ok(/SameSite=Lax/i.test(setCookie), 'Session cookie must use SameSite=Lax');
  const cookie = setCookie.split(';')[0];
  for (const path of ['/', '/play', '/practice', ...(services ? ['/api/gate', '/api/stats'] : [])]) {
    const res = await request(path, { headers: { cookie } });
    assert.equal(res.status, 200, `Valid session rejected by ${path}`);
    privateResponse(res);
    await res.body?.cancel();
  }
  // Media: a valid session may cache only the current content-hashed URL, and only privately (web/src/lib/asset.ts).
  const media = '/cast/gladiator.webp';
  const plain = await request(media, { headers: { cookie } });
  assert.equal(plain.status, 200, `Valid session rejected by ${media}`);
  privateResponse(plain);
  const v = createHash('sha256').update(Buffer.from(await plain.arrayBuffer())).digest('hex').slice(0, 12);
  const versioned = await request(`${media}?v=${v}`, { headers: { cookie } });
  const cache = versioned.headers.get('cache-control') ?? '';
  assert.equal(versioned.status, 200, `Valid session rejected by ${media}?v=`);
  assert.ok(/\bprivate\b/.test(cache) && /max-age=\d{4,}/.test(cache) && !/public|no-store/.test(cache), 'Versioned media must be cacheable privately only');
  await versioned.body?.cancel();
  for (const [path, headers] of [[`${media}?v=000000000000`, { cookie }], [`${media}?v=${v}`, {}]]) {
    const res = await request(path, { headers });
    assert.ok(headers.cookie ? res.status === 200 : [307, 401].includes(res.status), `${path} returned ${res.status}`);
    privateResponse(res);
    await res.body?.cancel();
  }
  if (services) {
    const gql = await request('/v1/graphql', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ __typename }' }) });
    assert.equal(gql.status, 200, 'Valid session rejected by GraphQL');
    assert.equal(typeof (await gql.json()).data?.__typename, 'string', 'GraphQL did not execute the read-only check');
    assert.equal(await upgradeStatus(new URL('/api/ws', origin), cookie), 101, 'Valid session rejected by keeper WebSocket');
    assert.equal(await upgradeStatus(new URL('/v1/graphql', origin), cookie), 403, 'GraphQL subscriptions must be disabled');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const password = process.env.GATE_PASSWORD;
  if (!password) throw new Error('Set GATE_PASSWORD in the environment; never pass it as a CLI argument.');
  await checkGate(process.env.GATE_CHECK_ORIGIN || 'https://longshort.fun', password, { services: process.env.GATE_CHECK_WEB_ONLY !== '1' });
  console.log('Access gate checks passed.');
}
