import { parseUnits } from 'viem';
import { ADDR, MARKETS, mockOracleAbi, readPerplPrices, type MarketSymbol } from '@longshort/shared';
import { GAS, keeper, log, perplPub, send } from './chain';
import { db } from './db';

// ticks persist so charts open with real history even right after a restart
db.exec('CREATE TABLE IF NOT EXISTS ticks (market TEXT, t INTEGER, px REAL)');
db.exec('CREATE INDEX IF NOT EXISTS ticks_mt ON ticks(market, t)');
const insTick = db.prepare('INSERT INTO ticks (market, t, px) VALUES (?, ?, ?)');

export interface Tick {
  t: number; // ms
  px: number;
}
const HISTORY = 1800; // ~30 min at 1s
export const history: Record<MarketSymbol, Tick[]> = { BTC: [], ETH: [], MON: [] };
export const latest = (m: MarketSymbol) => history[m].at(-1)?.px;

const lastPushed: Partial<Record<MarketSymbol, number>> = {};
let listeners: ((m: MarketSymbol, tick: Tick) => void)[] = [];
export const onTick = (fn: (m: MarketSymbol, tick: Tick) => void) => listeners.push(fn);

async function pollOnce() {
  const prices = await readPerplPrices(perplPub).catch(() => []);
  const now = Date.now();
  for (const p of prices) {
    const tick = { t: now, px: p.price, src: p.timestamp };
    const h = history[p.symbol];
    h.push(tick);
    insTick.run(p.symbol, tick.t, tick.px);
    if (h.length > HISTORY) h.shift();
    for (const fn of listeners) fn(p.symbol, tick);

    // Local dev: mirror Perpl into MockOracle so the arena always sees live prices.
    if (ADDR.mockOracleActive && lastPushed[p.symbol] !== p.price) {
      lastPushed[p.symbol] = p.price;
      const market = MARKETS.indexOf(p.symbol);
      await send('oracle', () =>
        keeper.writeContract({
          address: ADDR.mockOracle,
          abi: mockOracleAbi,
          functionName: 'set',
          args: [market, parseUnits(p.price.toString(), 18)],
          gas: GAS.oracleSet,
        }),
      );
    }
  }
}

export async function startPrices() {
  const since = Date.now() - 30 * 60_000;
  for (const m of MARKETS) {
    const rows = db.prepare('SELECT t, px FROM ticks WHERE market = ? AND t > ? ORDER BY t').all(m, since) as unknown as Tick[];
    history[m].push(...rows.slice(-HISTORY));
  }
  db.prepare('DELETE FROM ticks WHERE t < ?').run(Date.now() - 86_400_000);
  await pollOnce();
  log('prices', 'live', MARKETS.map((m) => `${m}=${latest(m)}`).join(' '), ADDR.mockOracleActive ? '(mirroring → MockOracle)' : '');
  setInterval(() => void pollOnce(), 1000);
}
