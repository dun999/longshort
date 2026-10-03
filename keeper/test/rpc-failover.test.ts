import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { createPublicClient } from 'viem';
import { monadTestnet } from 'viem/chains';
import { rpcTransport } from '../src/rpc';

type Request = { id: number; method: string; params?: unknown[] };
type Handler = (request: Request, response: ServerResponse) => void;
function reply(response: ServerResponse, request: Request, result: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
}
async function endpoints(handlers: Handler[], check: (urls: string[]) => Promise<void>) {
  const servers = handlers.map((handler) => createServer(async (request: IncomingMessage, response) => {
    const body: Buffer[] = [];
    for await (const chunk of request) body.push(Buffer.from(chunk));
    handler(JSON.parse(Buffer.concat(body).toString()), response);
  }));
  try {
    await Promise.all(servers.map((server) => new Promise<void>((done) => server.listen(0, '127.0.0.1', done))));
    const urls = servers.map((server) => `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    await check(urls);
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); })));
  }
}

test('HTTP limits, RPC quota errors and service errors fail over once; a recovered primary stays preferred', async () => {
  let status = 429, quotaExceeded = false, primaryCalls = 0, backupCalls = 0;
  await endpoints([
    (request, response) => {
      primaryCalls++;
      if (quotaExceeded) response.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32005, message: 'RPC quota exceeded' } }));
      else reply(response, request, '0x279f', status);
    },
    (request, response) => { backupCalls++; reply(response, request, '0x279f'); },
  ], async ([primary, backup]) => {
    const client = createPublicClient({ chain: monadTestnet, transport: rpcTransport(primary, backup) });
    assert.equal(await client.getChainId(), 10143);
    assert.deepEqual([primaryCalls, backupCalls], [1, 1]);
    status = 503;
    assert.equal(await client.getChainId(), 10143);
    assert.deepEqual([primaryCalls, backupCalls], [2, 2]);
    status = 200;
    quotaExceeded = true;
    assert.equal(await client.getChainId(), 10143);
    assert.deepEqual([primaryCalls, backupCalls], [3, 3]);
    quotaExceeded = false;
    assert.equal(await client.getChainId(), 10143);
    assert.deepEqual([primaryCalls, backupCalls], [4, 3]);
  });
});

test('a primary timeout advances to the backup', async () => {
  let primaryCalls = 0, backupCalls = 0;
  await endpoints([
    () => { primaryCalls++; }, // accept the connection but never send a response
    (request, response) => { backupCalls++; reply(response, request, '0x279f'); },
  ], async ([primary, backup]) => {
    const client = createPublicClient({ chain: monadTestnet, transport: rpcTransport(primary, backup, { timeout: 150 }) });
    assert.equal(await client.getChainId(), 10143);
    assert.deepEqual([primaryCalls, backupCalls], [1, 1]);
  });
});

test('transaction failover reuses the same signed bytes rather than creating another transaction', async () => {
  const seen: Request[] = [], raw = '0x02deadbeef' as const, hash = `0x${'a'.repeat(64)}`;
  await endpoints([
    (request, response) => { seen.push(request); reply(response, request, null, 503); },
    (request, response) => { seen.push(request); reply(response, request, hash); },
  ], async ([primary, backup]) => {
    const client = createPublicClient({ chain: monadTestnet, transport: rpcTransport(primary, backup) });
    assert.equal(await client.request({ method: 'eth_sendRawTransaction', params: [raw] }), hash);
    assert.deepEqual(seen.map((request) => [request.method, request.params]), [
      ['eth_sendRawTransaction', [raw]], ['eth_sendRawTransaction', [raw]],
    ]);
  });
});

test('a contract revert is returned without trying another provider', async () => {
  let backupCalls = 0;
  await endpoints([
    (request, response) => response.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: 3, message: 'execution reverted' } })),
    (request, response) => { backupCalls++; reply(response, request, '0x'); },
  ], async ([primary, backup]) => {
    const client = createPublicClient({ chain: monadTestnet, transport: rpcTransport(primary, backup) });
    await assert.rejects(client.request({ method: 'eth_call', params: [{ to: '0x0000000000000000000000000000000000000001' }, 'latest'] }), /reverted/);
    assert.equal(backupCalls, 0);
  });
});

test('an absent or identical backup preserves a single HTTP transport', async () => {
  const primary = 'http://127.0.0.1:1';
  for (const backup of [undefined, primary]) {
    const client = createPublicClient({ chain: monadTestnet, transport: rpcTransport(primary, backup, { retryCount: 2 }) });
    assert.equal(client.transport.type, 'http');
    assert.equal(client.transport.retryCount, 2);
  }
});
