import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL = 'https://indexer.example/v1/graphql';
const { envioMatch } = await import('../src/lib/envio');

test('a final report falls back while Envio lags, then uses the indexed settlement receipt', async () => {
  const originalFetch = globalThis.fetch;
  const match = { matchId: '5', mode: 0, entry: '5000000', duration: 60, state: 'LIVE', startAt: 100, endAt: 160,
    rake: '0', settleTx: null as string | null, asset: 'AUSD', tradingBudget: '100000000', players: [], accounts: [], fills: [], trades: [] };
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { Match_by_pk: match } }), { status: 200 })) as typeof fetch;
  try {
    assert.equal(await envioMatch(5, { finalized: true }), null);
    assert.equal((await envioMatch(5))?.match.state, 1);
    match.state = 'SETTLED';
    assert.equal(await envioMatch(5, { finalized: true }), null, 'a missing settlement receipt is not final evidence');
    match.settleTx = `0x${'a'.repeat(64)}`;
    const report = await envioMatch(5, { finalized: true });
    assert.equal(report?.source, 'envio');
    assert.equal(report?.match.state, 2);
    assert.equal(report?.match.settle_tx, match.settleTx);
    assert.equal(report?.match.entry, 5);
    assert.equal(report?.match.trading_budget, 100);
  } finally { globalThis.fetch = originalFetch; }
});
