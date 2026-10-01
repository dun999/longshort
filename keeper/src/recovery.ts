import { parseEventLogs, parseEther, type Address } from 'viem';
import { REAL_TRADING, ADDR, erc20Abi, tradingAccountAbi } from '@longshort/shared';
import { arena, keeper, pub } from './chain';
import { db } from './db';

const inflight = new Map<string, Promise<unknown>>();
const lastSend = new Map<string,number>();

/** Sponsor a recovery on the player's immutable account. Funds always go to its beneficiary. */
export function recoverCapital(id: number, addr: string) {
  if (!REAL_TRADING || !Number.isSafeInteger(id) || id < 1) throw new Error('Bad recovery request');
  const key = `${id}:${addr}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const work = recover(id, addr).finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

async function recover(id: number, addr: string) {
  const row = db.prepare('SELECT * FROM trading_accounts WHERE match_id=? AND addr=?').get(id, addr) as
    { account: Address; final_balance: number | null; returned: number } | undefined;
  if (!row) throw new Error('No trading account for this wallet');
  if (!await pub.readContract({ ...arena, functionName: 'canRecover', args: [BigInt(id)] })) throw new Error('Wait for the round to finish');
  const account = { address: row.account, abi: tradingAccountAbi } as const;
  const [beneficiary, boundArena, matchId, snapshot, held] = await Promise.all([
    pub.readContract({ ...account, functionName: 'beneficiary' }),
    pub.readContract({ ...account, functionName: 'arena' }),
    pub.readContract({ ...account, functionName: 'matchId' }),
    pub.readContract({ ...account, functionName: 'snapshot' }),
    pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [row.account] }),
  ]);
  if (beneficiary.toLowerCase() !== addr || boundArena.toLowerCase() !== ADDR.arena.toLowerCase() || matchId !== BigInt(id)) throw new Error('Account binding mismatch');
  if (snapshot[0].balanceCNS === 0n && snapshot[0].lockedBalanceCNS === 0n && snapshot[1].lotLNS === 0n && held === 0n) return { ok: true, returned: 0, pending: false };
  if (Date.now()-(lastSend.get(row.account)??0)<15_000) throw new Error('Recovery is pending. Try again shortly.');
  await pub.simulateContract({ ...account, functionName: 'recover', account: keeper.account.address });
  const estimate = await pub.estimateContractGas({ ...account, functionName: 'recover', account: keeper.account.address });
  const gas = estimate * 120n / 100n;
  if (gas > 1_500_000n) throw new Error('Recovery gas limit exceeded');
  const [available,gasPrice]=await Promise.all([pub.getBalance({address:keeper.account.address}),pub.getGasPrice()]);
  if(available<parseEther('10')+gas*gasPrice*2n) throw new Error('Recovery sponsor needs gas. Your capital remains in the trading account.');
  lastSend.set(row.account,Date.now());
  const hash = await keeper.writeContract({ ...account, functionName: 'recover', gas });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Recovery reverted; your balance remains in the trading account');
  let returned = 0;
  for (const event of parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs })) {
    if (event.address.toLowerCase() !== ADDR.stake.toLowerCase() || event.args.from.toLowerCase() !== row.account.toLowerCase() || event.args.to.toLowerCase() !== addr) continue;
    const amount = Number(event.args.value) / 1e6;
    returned += amount;
    db.prepare('INSERT OR IGNORE INTO collateral_returns VALUES(?,?,?,?,?)').run(hash, Number(event.logIndex), id, addr, amount);
  }
  db.prepare('UPDATE trading_accounts SET returned=(SELECT COALESCE(SUM(amount),0) FROM collateral_returns WHERE match_id=? AND addr=?) WHERE match_id=? AND addr=?').run(id, addr, id, addr);
  const after = await pub.readContract({ ...account, functionName: 'snapshot' });
  const pending = after[1].lotLNS !== 0n || after[0].balanceCNS !== 0n || after[0].lockedBalanceCNS !== 0n;
  // Cancelled rounds can continue losing capital before recovery. The eventual withdrawal is authoritative.
  if (!pending && row.final_balance === null) db.prepare('UPDATE trading_accounts SET final_balance=returned WHERE match_id=? AND addr=?').run(id, addr);
  return { ok: true, hash, returned, pending };
}
