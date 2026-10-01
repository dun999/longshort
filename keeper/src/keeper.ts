import { REAL_TRADING, MAINT, MARGIN, Mode, royaleRounds } from '@longshort/shared';
import { formatUnits } from 'viem';
import { arena, chainNow, estimateGas, keeper, log, pub, send } from './chain';
import { db } from './db';

const inflight = new Set<string>();
async function once(key: string, fn: () => Promise<unknown>) {
  if (inflight.has(key)) return;
  inflight.add(key);
  try {
    await fn();
  } finally {
    setTimeout(() => inflight.delete(key), 3000); // give the tx time to land + be indexed
  }
}

/** Simulate first so we only pay for txs that will succeed. */
async function tryWrite(scope: string, functionName: 'settle' | 'eliminate' | 'cancel' | 'liquidate', args: any[]) {
  try {
    await pub.simulateContract({ ...arena, functionName, args, account: keeper.account } as any);
  } catch {
    return false;
  }
  const gas = await estimateGas(functionName, { ...arena, functionName, args, account: keeper.account });
  const hash = await send(scope, () => keeper.writeContract({ ...arena, functionName, args, gas } as any));
  if (hash) log(scope, functionName, args.map(String).join(','), hash.slice(0, 10));
  return !!hash;
}

async function tick() {
  const now = await chainNow();
  const live = db.prepare('SELECT id, mode, max_players, duration, start_at, end_at FROM matches WHERE state IN (1,4)').all() as {
    id: number; mode: number; max_players: number; duration: number; start_at: number; end_at: number;
  }[];
  for (const m of live) {
    const id = BigInt(m.id);
    if (now < m.start_at) continue;
    // 1. settle at the bell (or early when decided — simulate tells us)
    if (now >= m.end_at) {
      if (REAL_TRADING && now >= m.end_at + 300) {
        await once(`cancel:${m.id}`, () => tryWrite('keeper', 'cancel', [id]));
        continue;
      }
      await once(`settle:${m.id}`, () => tryWrite('keeper', 'settle', [id]));
      continue;
    }
    if (REAL_TRADING) {
      const ps = await pub.readContract({ ...arena, functionName:'getPlayers', args:[id] });
      for (const p of ps) {
        const last = db.prepare('SELECT kind FROM trades WHERE match_id=? AND addr=? ORDER BY id DESC LIMIT 1').get(m.id,p.addr.toLowerCase()) as {kind:string} | undefined;
        if (!p.out && !p.hasPos && last?.kind === 'open')
          await once(`liq:${m.id}:${p.addr}`,()=>tryWrite('keeper','liquidate',[id,p.addr]));
      }
      await once(`settle:${m.id}`, () => tryWrite('keeper','settle',[id]));
      continue;
    }
    // 2. liquidations
    const [players, eqs] = await Promise.all([
      pub.readContract({ ...arena, functionName: 'getPlayers', args: [id] }),
      pub.readContract({ ...arena, functionName: 'equities', args: [id] }).catch(() => null),
    ]);
    if (eqs) {
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (p.out || !p.hasPos) continue;
        if (Number(formatUnits(eqs[i], 18)) <= MARGIN * MAINT) {
          await once(`liq:${m.id}:${p.addr}`, () => tryWrite('keeper', 'liquidate', [id, p.addr]));
        }
      }
    }
    // 3. decided early (one side wiped out)
    await once(`settle:${m.id}`, () => tryWrite('keeper', 'settle', [id]));
    // 4. royale rounds
    if (m.mode === Mode.ROYALE) {
      const { rounds, roundLen } = royaleRounds(m.max_players, m.duration);
      const due = Math.min(rounds, Math.floor((now - m.start_at) / roundLen));
      const match = await pub.readContract({ ...arena, functionName: 'getMatch', args: [id] });
      if (match.round < due) await once(`elim:${m.id}:${match.round}`, () => tryWrite('keeper', 'eliminate', [id]));
    }
  }
  // 5. expire lobbies that never filled
  const stale = db.prepare('SELECT id FROM matches WHERE state = 0 AND created_at < ?').all(now - 300) as { id: number }[];
  for (const m of stale) await once(`cancel:${m.id}`, () => tryWrite('keeper', 'cancel', [BigInt(m.id)]));
}

export function startKeeper() {
  log('keeper', 'running as', keeper.account.address);
  const loop = async () => {
    await tick().catch((e) => log('keeper', 'error', (e as Error).message.slice(0, 200)));
    setTimeout(loop, 1000);
  };
  void loop();
}
