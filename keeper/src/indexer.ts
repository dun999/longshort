import { formatUnits, parseEventLogs, type Log } from 'viem';
import { ADDR, REAL_TRADING, MARGIN, STAKE_DECIMALS, XP, arenaAbi, perplExecutionAbi } from '@longshort/shared';
import { arena, log, pub } from './chain';
import { env } from './env';
import { db, ensureProfile, getMeta, setMeta } from './db';

const e18 = (x: bigint) => Number(formatUnits(x, 18));
const usd = (x: bigint) => Number(formatUnits(x, STAKE_DECIMALS));
const lc = (a: string) => a.toLowerCase();

export type ChainEvent = { name: string; matchId: number; tx: string; block: number; ts: number; args: Record<string, unknown> };
let listeners: ((e: ChainEvent) => void)[] = [];
export const onChainEvent = (fn: (e: ChainEvent) => void) => listeners.push(fn);

const blockTs = new Map<bigint, number>();
async function tsOf(block: bigint) {
  if (!blockTs.has(block)) {
    const b = await pub.getBlock({ blockNumber: block });
    blockTs.set(block, Number(b.timestamp));
    if (blockTs.size > 500) blockTs.delete(blockTs.keys().next().value!);
  }
  return blockTs.get(block)!;
}

const insTrade = db.prepare(
  'INSERT OR IGNORE INTO trades (match_id, addr, kind, market, is_long, notional, price, pnl, fee, tx, block, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
);

async function handle(l: Log & { eventName: string; args: any }) {
  const a = l.args;
  const id = Number(a.id);
  const tx = l.transactionHash!;
  const block = Number(l.blockNumber);
  const ts = await tsOf(l.blockNumber!);
  switch (l.eventName) {
    case 'MatchCreated':
      db.prepare(
        'INSERT OR REPLACE INTO matches (id, mode, entry, max_players, duration, state, creator, created_at, create_tx) VALUES (?,?,?,?,?,0,?,?,?)',
      ).run(id, Number(a.mode), usd(a.entry), Number(a.maxPlayers), Number(a.duration), lc(a.creator), ts, tx);
      break;
    case 'PlayerJoined':
      ensureProfile(a.player);
      db.prepare('INSERT OR REPLACE INTO players (match_id, addr, team, leverage, session) VALUES (?,?,?,?,?)').run(
        id, lc(a.player), Number(a.team), Number(a.leverage), lc(a.session),
      );
      break;
    case 'PlayerLeft':
      db.prepare('DELETE FROM players WHERE match_id = ? AND addr = ?').run(id, lc(a.player));
      break;
    case 'ClassChanged':
      db.prepare('UPDATE players SET leverage = ? WHERE match_id = ? AND addr = ?').run(Number(a.leverage), id, lc(a.player));
      break;
    case 'MatchStarted':
      db.prepare('UPDATE matches SET state = 1, start_at = ?, end_at = ? WHERE id = ?').run(Number(a.startAt), Number(a.endAt), id);
      break;
    case 'Opened': {
      const r = insTrade.run(id, lc(a.player), 'open', Number(a.market), a.isLong ? 1 : 0, e18(a.notional), e18(a.price), 0, e18(a.fee), tx, block, ts);
      if (r.changes && !REAL_TRADING) db.prepare('UPDATE profiles SET volume = volume + ? WHERE addr = ?').run(e18(a.notional), lc(a.player));
      break;
    }
    case 'Closed':
      insTrade.run(id, lc(a.player), 'close', Number(a.market), null, null, e18(a.price), e18(a.pnl), e18(a.fee), tx, block, ts);
      break;
    case 'Liquidated':
      {
        const ps = REAL_TRADING ? await pub.readContract({...arena,functionName:'getPlayers',args:[BigInt(id)],blockNumber:l.blockNumber!}) : [];
        const balance = ps.find((p)=>lc(p.addr)===lc(a.player))?.frozenEquity;
        insTrade.run(id, lc(a.player), 'liquidated', null, null, null, e18(a.price), balance === undefined ? -MARGIN : e18(balance)-MARGIN, 0, tx, block, ts);
      }
      break;
    case 'Eliminated':
      insTrade.run(id, lc(a.player), 'eliminated', null, null, null, null, e18(a.equity) - MARGIN, 0, tx, block, ts);
      break;
    case 'Cancelled':
      db.prepare('UPDATE matches SET state = 3 WHERE id = ?').run(id);
      db.prepare('UPDATE trading_accounts SET final_balance=returned WHERE match_id=? AND final_balance IS NULL AND returned>0').run(id);
      break;
    case 'Closing':
      db.prepare('UPDATE matches SET state=4 WHERE id=?').run(id); break;
    case 'TradingAccountCreated':
      db.prepare('INSERT OR REPLACE INTO trading_accounts(match_id,addr,account,account_id,budget) VALUES(?,?,?,?,?)')
        .run(id,lc(a.player),lc(a.account),String(a.accountId),usd(a.budget)); break;
    case 'FinalBalance':
      db.prepare('UPDATE trading_accounts SET final_balance=? WHERE match_id=? AND addr=?').run(usd(a.balance),id,lc(a.player)); break;
    case 'CollateralReturned':
      db.prepare('INSERT OR IGNORE INTO collateral_returns VALUES(?,?,?,?,?)').run(tx,Number(l.logIndex),id,lc(a.player),usd(a.amount));
      db.prepare('UPDATE trading_accounts SET returned=(SELECT COALESCE(SUM(amount),0) FROM collateral_returns WHERE match_id=? AND addr=?) WHERE match_id=? AND addr=?')
        .run(id,lc(a.player),id,lc(a.player)); break;
    case 'Settled':
      await onSettled(id, a.winners as string[], a.payouts as bigint[], a.rake as bigint, tx, l.blockNumber!);
      break;
  }
  if (REAL_TRADING && ['Opened','Closed','Closing','CloseDeferred','CollateralReturned'].includes(l.eventName)) await recordFills(tx,block,ts);
  const args = JSON.parse(JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  for (const fn of listeners) {
    try {
      fn({ name: l.eventName, matchId: id, tx, block, ts, args });
    } catch (e) {
      log('indexer', 'listener error', (e as Error).message);
    }
  }
}

const scanned = new Set<string>();
async function recordFills(tx: string, block: number, ts: number) {
  if (scanned.has(tx)) { reconcileFees(tx); return; }
  const receipt = await pub.getTransactionReceipt({hash:tx as `0x${string}`});
  const logs = parseEventLogs({abi:perplExecutionAbi,logs:receipt.logs.filter((l)=>lc(l.address)===lc(ADDR.perplExchange))});
  let request: {accountId:bigint;perpId:bigint;orderType:number} | undefined;
  for (const l of logs) {
    const a = l.args as any;
    if (l.eventName==='OrderRequest' || l.eventName==='OrderRequestV2') {request=a;continue;}
    if (!request || !l.eventName.startsWith('TakerOrderFilled')) continue;
    const who = db.prepare('SELECT match_id,addr FROM trading_accounts WHERE account_id=?').get(String(request.accountId)) as {match_id:number;addr:string}|undefined;
    if (!who) continue;
    const notional = Number(a.entryPricePNS * a.lotLNS) / 1e6;
    const fee = Number(a.feeCNS + (a.builderFeeCNS ?? 0n))/1e6;
    const inserted = db.prepare('INSERT OR IGNORE INTO perpl_fills VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(tx,Number(l.logIndex),who.match_id,who.addr,String(request.accountId),Number(request.perpId),Number(request.orderType),Number(a.entryPricePNS)/10,String(a.lotLNS),notional,fee,block,ts);
    if (inserted.changes) db.prepare('UPDATE profiles SET volume=volume+? WHERE addr=?').run(notional,who.addr);
  }
  // Coordinator closes report net PnL. Reconstruct gross for the existing report model using actual Perpl fees.
  reconcileFees(tx);
  scanned.add(tx); if(scanned.size>2000) scanned.delete(scanned.values().next().value!);
}
function reconcileFees(tx:string) {
  const totals = db.prepare('SELECT addr,SUM(fee) fee FROM perpl_fills WHERE tx=? AND order_type IN (2,3) GROUP BY addr').all(tx) as {addr:string;fee:number}[];
  for(const t of totals) db.prepare("UPDATE trades SET pnl=pnl+?,fee=? WHERE tx=? AND addr=? AND kind='close' AND fee=0").run(t.fee,t.fee,tx,t.addr);
}

async function onSettled(id: number, winners: string[], payouts: bigint[], rake: bigint, tx: string, block: bigint) {
  const done = db.prepare('SELECT state FROM matches WHERE id = ?').get(id) as { state: number } | undefined;
  if (done?.state === 2) return; // already applied (retry after a partial batch)
  const players = await pub.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(id)], blockNumber: block });
  const refund = rake === 0n && winners.length === players.length;
  const paid = new Map(winners.map((w, i) => [lc(w), usd(payouts[i])]));
  const entry = (db.prepare('SELECT entry FROM matches WHERE id = ?').get(id) as { entry: number } | undefined)?.entry ?? 0;
  const upd = db.prepare('UPDATE players SET result = ?, payout = ?, final_equity = ?, xp_delta = ? WHERE match_id = ? AND addr = ?');
  for (const p of players) {
    const addr = lc(p.addr);
    const eq = REAL_TRADING || p.out ? e18(BigInt(p.frozenEquity)) : Math.max(0, MARGIN + e18(BigInt(p.realized)));
    const won = !refund && paid.has(addr);
    const result = refund ? 'draw' : won ? 'win' : 'loss';
    const prof = db.prepare('SELECT xp FROM profiles WHERE addr = ?').get(addr) as { xp: number } | undefined;
    const xp = prof?.xp ?? XP.start;
    const delta = refund ? 0 : won ? XP.win : Math.max(XP.floor, xp + XP.loss) - xp;
    upd.run(result, paid.get(addr) ?? 0, eq, delta, id, addr);
    db.prepare(
      `UPDATE profiles SET xp = xp + ?, matches = matches + 1, wins = wins + ?, losses = losses + ?, earned = earned + ? WHERE addr = ?`,
    ).run(delta, won ? 1 : 0, result === 'loss' ? 1 : 0, (paid.get(addr) ?? 0) - entry, addr);
  }
  db.prepare('UPDATE matches SET state = 2, settle_tx = ?, rake = ? WHERE id = ?').run(tx, usd(rake), id);
}

export async function startIndexer() {
  let from = BigInt(getMeta('cursor') ?? ADDR.deployBlock);
  if (getMeta('arena') !== lc(ADDR.arena)) {
    // A new arena starts a new season. Its match tables are copied aside under the old arena's address first, so
    // nothing is lost; AUSD claims, callsigns, passkey recovery hints and private journals are left untouched.
    const old = getMeta('arena');
    const tables = ['matches', 'players', 'trades', 'trading_accounts', 'perpl_fills', 'collateral_returns'];
    if (old && /^0x[0-9a-f]{40}$/.test(old)) for (const t of tables) db.exec(`CREATE TABLE IF NOT EXISTS archive_${old.slice(2, 10)}_${t} AS SELECT * FROM ${t}`);
    for (const t of tables) db.exec(`DELETE FROM ${t}`);
    db.exec('UPDATE profiles SET xp = 1000, wins = 0, losses = 0, matches = 0, volume = 0, earned = 0');
    from = BigInt(ADDR.deployBlock);
    setMeta('arena', lc(ADDR.arena));
  }
  log('indexer', 'from block', from);
  const tick = async () => {
    try {
      const head = await pub.getBlockNumber();
      if (head < from) return;
      const span = BigInt(env.logRange - 1); // Monad's public RPC hangs past ~100 blocks; QuickNode allows 1000
      const to = head - from > span ? from + span : head;
      const raw = await pub.getLogs({ address: ADDR.arena, fromBlock: from, toBlock: to });
      const logs = parseEventLogs({ abi: arenaAbi, logs: raw });
      for (const l of logs) await handle(l as any);
      from = to + 1n;
      setMeta('cursor', from.toString());
    } catch (e) {
      log('indexer', 'error', (e as Error).message.slice(0, 200));
    }
  };
  await tick();
  const loop = async () => {
    await tick();
    setTimeout(loop, 700);
  };
  void loop();
}
