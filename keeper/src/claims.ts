import type { DatabaseSync } from 'node:sqlite';
import { isAddress, type Address, type Hash, type Hex } from 'viem';

export interface ClaimChain {
  chainId: () => Promise<number>;
  balance: (address: Address) => Promise<bigint>;
  prepare: (address: Address, amount: bigint) => Promise<{ hash: Hash; raw: Hex }>;
  broadcast: (raw: Hex) => Promise<unknown>;
  receipt: (hash: Hash) => Promise<{ status: 'success' | 'reverted' } | undefined>;
  wait: (hash: Hash) => Promise<{ status: 'success' | 'reverted' }>;
}
type Row = { addr: Address; amount: string; before_balance: string; after_balance: string | null; status: string; tx: Hash | null; raw: Hex | null };
/**
 * New wallets cost nothing, so one claim per wallet does not protect the funding wallet on its own. Claims are capped
 * per IP (friends often share one network), and across everyone per hour and per day, so a flood of fresh wallets
 * waits for the window to roll over instead of emptying the faucet.
 */
export const CLAIM_LIMITS = { perIp: 12, perHour: 40, perDay: 150 };

/** One transfer per wallet. Signed bytes are durable BEFORE broadcasting, so a restart cannot duplicate a drip. */
export class AUSDClaims {
  private tail: Promise<unknown> = Promise.resolve();
  private scope: string;
  constructor(private db: DatabaseSync, private chain: ClaimChain, token: Address, private amount = 200_000_000n, private limits = CLAIM_LIMITS) {
    this.scope = `10143:${token.toLowerCase()}`;
    db.exec(`CREATE TABLE IF NOT EXISTS ausd_claims (
      scope TEXT, addr TEXT, amount TEXT NOT NULL, before_balance TEXT NOT NULL, after_balance TEXT,
      status TEXT NOT NULL, tx TEXT, raw TEXT, ip TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY(scope, addr)
    ); CREATE INDEX IF NOT EXISTS ausd_claim_ip ON ausd_claims(scope, ip, created_at);`);
  }
  private row(addr: string) { return this.db.prepare('SELECT * FROM ausd_claims WHERE scope=? AND addr=?').get(this.scope,addr.toLowerCase()) as Row | undefined; }
  async status(addr: string) {
    if (!isAddress(addr)) throw new Error('Invalid wallet');
    const row = this.row(addr);
    return { eligible: !row || row.status === 'failed', amount: row?.amount ?? this.amount.toString(), status: row?.status ?? 'available',
      tx: row?.tx ?? undefined, before: row?.before_balance, after: row?.after_balance ?? undefined,
      balance: (await this.chain.balance(addr as Address)).toString() };
  }
  claim(addr: string, ip: string) {
    // Serialize the dedicated funding key's nonce and the durable claim state.
    const run = this.tail.then(() => this.transfer(addr, ip));
    this.tail = run.catch(() => {});
    return run;
  }
  private async transfer(addr: string, ip: string) {
    if (!isAddress(addr)) throw new Error('Invalid wallet');
    if (await this.chain.chainId() !== 10143) throw new Error('AUSD claims are Monad testnet only');
    const address = addr.toLowerCase() as Address;
    // A signed transfer from a previous request may not have reached the mempool yet. Resolve it before preparing another nonce.
    const outstanding = this.db.prepare("SELECT * FROM ausd_claims WHERE scope=? AND status='pending' AND raw IS NOT NULL AND addr!=?")
      .all(this.scope,address) as Row[];
    for (const prior of outstanding) await this.confirm(prior);
    let row = this.row(address);
    if (row?.status === 'confirmed') return { ok: true, alreadyClaimed: true, ...await this.status(address) };
    if (!row || row.status === 'failed') {
      const now = Date.now();
      const count = this.db.prepare("SELECT COUNT(*) n FROM ausd_claims WHERE scope=? AND ip=? AND created_at>? AND status!='failed'")
        .get(this.scope,ip,now-3_600_000) as { n: number };
      if (count.n >= this.limits.perIp) throw new Error('Claim limit reached. Try again later.');
      for (const [window, cap] of [[3_600_000, this.limits.perHour], [86_400_000, this.limits.perDay]]) {
        const all = this.db.prepare("SELECT COUNT(*) n, MIN(created_at) first FROM ausd_claims WHERE scope=? AND created_at>? AND status!='failed'")
          .get(this.scope,now-window) as { n: number; first: number | null };
        const wait = Math.max(1, Math.ceil((all.first! + window - now) / 60_000));
        if (all.n >= cap) throw new Error(`The faucet is busy. Try again in ${wait > 90 ? `${Math.ceil(wait / 60)} hours` : `${wait} minutes`}.`);
      }
      const before = await this.chain.balance(address);
      this.db.prepare('INSERT OR REPLACE INTO ausd_claims(scope,addr,amount,before_balance,status,ip,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(this.scope,address,this.amount.toString(),before.toString(),'pending',ip,Date.now());
      row = this.row(address)!;
    }
    if (!row.tx || !row.raw) {
      const signed = await this.chain.prepare(address,BigInt(row.amount));
      this.db.prepare('UPDATE ausd_claims SET tx=?,raw=? WHERE scope=? AND addr=?').run(signed.hash,signed.raw,this.scope,address);
      row = this.row(address)!;
    }
    await this.confirm(row);
    return { ok: true, alreadyClaimed: false, ...await this.status(address) };
  }
  private async confirm(row: Row) {
    const address = row.addr;
    let receipt = await this.chain.receipt(row.tx!);
    if (!receipt) {
      // Rebroadcast the SAME signed transaction after transport failures or a process restart.
      await this.chain.broadcast(row.raw!).catch(async (error) => {
        if (!await this.chain.receipt(row!.tx!)) {
          const message = (error as Error).message;
          if (!/already known|nonce too low/i.test(message)) throw new Error('Claim transfer is pending. Retry to check the same transaction.');
        }
      });
      receipt = await this.chain.wait(row.tx!);
    }
    if (receipt.status !== 'success') {
      this.db.prepare("UPDATE ausd_claims SET status='failed',raw=NULL WHERE scope=? AND addr=?").run(this.scope,address);
      throw new Error('AUSD transfer reverted. You can retry the claim.');
    }
    const after = await this.chain.balance(address);
    this.db.prepare("UPDATE ausd_claims SET status='confirmed',after_balance=?,raw=NULL WHERE scope=? AND addr=?")
      .run(after.toString(),this.scope,address);
  }
}
