import {
  encodeFunctionData,
  hashTypedData,
  keccak256,
  isAddress,
  parseEther,
  verifyTypedData,
  type Address,
  type Hex,
  type SignedAuthorization,
  type TransactionReceipt,
} from 'viem';
import { recoverAuthorizationAddress } from 'viem/utils';
import {
  ADDR,
  activeChain,
  delegatedTo,
  knownRelay,
  REAL_TRADING,
  relayAllowed,
  relayDelegateAbi,
  relayLive,
  relayTypes,
  RELAY_NAME,
  RELAY_VERSION,
} from '@longshort/shared';
import { log, relayer, txPub as pub } from './chain';
import { env } from './env';
import { db } from './db';

db.exec(`CREATE TABLE IF NOT EXISTS relay_requests (
  scope TEXT, addr TEXT, nonce TEXT, digest TEXT, hash TEXT, raw TEXT, status TEXT,
  PRIMARY KEY(scope,addr,nonce)
);`);
type Submitted = {scope:string;addr:string;nonce:string;digest:Hex;hash:Hex;raw:Hex|null;status:string};
const scope = `${activeChain.id}:${ADDR.relayDelegate?.toLowerCase()}`;
// Every click waits on this (on TX_RPC_URL when set, see chain.ts). viem's block watch polls every 500 ms; a Monad block lands in under half a
// second, so ask for the receipt every 100 ms instead, without waiting for the previous answer (at most
// two in flight): the receipt is seen within ~100 ms of existing whatever the RPC's round trip, at about
// ten requests a second per pending trade, which keeps a busy Royale inside the RPC's rate limit.
function receiptOf(row: Submitted): Promise<TransactionReceipt> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let resent = start;
    let inFlight = 0;
    let done = false;
    const tick = () => {
      if (done) return;
      if (Date.now() - start > 60_000) return void ((done = true), reject(new Error(`Transaction pending: ${row.hash}`)));
      if (row.raw && Date.now() - resent > 4000) {
        resent = Date.now();
        void pub.sendRawTransaction({ serializedTransaction: row.raw }).catch(() => {});
      }
      if (inFlight < 2) {
        inFlight++;
        pub.getTransactionReceipt({ hash: row.hash })
          .then((receipt) => { if (!done) (done = true), resolve(receipt); }, () => {})
          .finally(() => inFlight--);
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}
/** `fresh`: the bytes were broadcast a moment ago, so skip the lost-transaction checks and wait. */
async function confirm(row: Submitted, fresh = false): Promise<TransactionReceipt> {
  let receipt = fresh ? undefined : await pub.getTransactionReceipt({hash:row.hash}).catch(()=>undefined);
  if (!receipt) {
    if (!fresh) {
      if (!row.raw) throw new Error(`Transaction pending: ${row.hash}`);
      await pub.sendRawTransaction({serializedTransaction:row.raw}).catch(async(error)=>{
        // A rebroadcast of a transaction already in the pool is fine: Monad and geth say "already known", anvil "already imported"
        if (!/already known|already imported|nonce too low/i.test((error as Error).message) && !await pub.getTransactionReceipt({hash:row.hash}).catch(()=>undefined)) throw new Error(`Transaction pending: ${row.hash}`);
      });
    }
    receipt = await receiptOf(row);
  }
  db.prepare('UPDATE relay_requests SET status=?,raw=NULL WHERE scope=? AND addr=? AND nonce=?')
    .run(receipt.status==='success'?'confirmed':'failed',row.scope,row.addr,row.nonce);
  if (receipt.status !== 'success') throw new Error('relay reverted');
  return receipt;
}

/** What the browser needs from the receipt: the arena's events (the trade, the new match id). Perpl's own logs stay out. */
export interface Relayed {
  hash: Hex;
  receipt: { status: 'success'; blockNumber: string; logs: { address: Address; topics: Hex[]; data: Hex; logIndex: number }[] };
}
function relayed(receipt: TransactionReceipt): Relayed {
  const arena = ADDR.arena.toLowerCase();
  return {
    hash: receipt.transactionHash,
    receipt: {
      status: 'success',
      blockNumber: receipt.blockNumber.toString(),
      logs: receipt.logs
        .filter((l) => l.address.toLowerCase() === arena)
        .map((l) => ({ address: l.address, topics: l.topics as Hex[], data: l.data, logIndex: l.logIndex })),
    },
  };
}

// Fees and the sponsor's nonce were each one more serial read per click. Fees move slowly, so a
// two-second-old estimate is reused; the nonce is read alongside the checks and kept locally (below).
let feeCache: { at: number; fees: Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> } | undefined;
function sponsorFees() {
  if (!feeCache || Date.now() - feeCache.at > 2000) {
    const fees = pub.estimateFeesPerGas();
    feeCache = { at: Date.now(), fees };
    fees.catch(() => { if (feeCache?.fees === fees) feeCache = undefined; });
  }
  return feeCache.fees;
}
// The next sponsor nonce after our own last send. Only sendLock touches it, so it can run ahead of an
// RPC whose pending count lags; a nonce error drops it and the next send trusts the RPC again.
let nextSponsorNonce: number | undefined;

// A busy match is a few dozen clicks. Caps stop a loop of successful approves from draining the sponsor:
// Monad bills the gas limit of every submission, including ones that later revert.
const PER_ADDR = { n: 90, ms: 10 * 60_000 };
const PER_IP = { n: 360, ms: 10 * 60_000 };
const hits = new Map<string, number[]>();

function limited(key: string, rule: { n: number; ms: number }) {
  const now = Date.now();
  const xs = (hits.get(key) ?? []).filter((t) => t > now - rule.ms);
  if (xs.length >= rule.n) return false;
  xs.push(now);
  hits.set(key, xs);
  return true;
}

const userTail = new Map<string, Promise<unknown>>();
function userLock<T>(addr: string, fn: () => Promise<T>): Promise<T> {
  const prev = userTail.get(addr) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  userTail.set(addr, run.then(() => undefined, () => undefined));
  return run;
}

// The sponsor key has one nonce stream. Keep its sends in order; player work stays parallel up to this point.
let sendTail: Promise<unknown> = Promise.resolve();
function sendLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = sendTail.then(fn, fn);
  sendTail = run.then(() => undefined, () => undefined);
  return run;
}

// Balance reads lag inflight sends. Hold the worst-case debit until the receipt lands so two
// players can't both pass the 10 MON reserve check against the same balance.
let reserved = 0n;

function explain(e: unknown): string {
  const chunks: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as { shortMessage?: string; details?: string; cause?: unknown };
    if (o.shortMessage) chunks.push(o.shortMessage);
    if (o.details && o.details !== o.shortMessage) chunks.push(o.details);
    cur = o.cause;
  }
  const text = chunks.join('\n') || (e instanceof Error ? e.message : 'relay rejected');
  return text.split('\n').find((l) => /revert|Not|Bad|Full|ERC20|Expired|Error/.test(l))?.slice(0, 200) ?? text.slice(0, 200);
}

interface AuthBody {
  address: Address;
  chainId: number;
  nonce: bigint;
  r: Hex;
  s: Hex;
  yParity: number;
}

interface Request {
  from: Address;
  target: Address;
  data: Hex;
  nonce: bigint;
  deadline: bigint;
  signature: Hex;
  authorization?: AuthBody;
}

function big(v: unknown, name: string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  throw new Error(`bad ${name}`);
}

function parse(body: any): Request {
  const from = body?.from as string;
  const target = body?.target as string;
  const data = body?.data as string;
  const signature = body?.signature as string;
  if (!isAddress(from) || !isAddress(target) || typeof data !== 'string' || !data.startsWith('0x')) throw new Error('bad request');
  if (typeof signature !== 'string' || !signature.startsWith('0x')) throw new Error('bad request');
  let authorization: AuthBody | undefined;
  const raw = body?.authorization;
  if (raw) {
    if (!isAddress(raw.address) || typeof raw.r !== 'string' || typeof raw.s !== 'string') throw new Error('bad authorization');
    const yParity = Number(raw.yParity);
    if (yParity !== 0 && yParity !== 1) throw new Error('bad authorization');
    authorization = { address: raw.address, chainId: Number(raw.chainId), nonce: big(raw.nonce, 'authorization nonce'), r: raw.r, s: raw.s, yParity };
  }
  return { from, target, data: data as Hex, nonce: big(body?.nonce, 'nonce'), deadline: big(body?.deadline, 'deadline'), signature: signature as Hex, authorization };
}

function signedAuth(auth: AuthBody): SignedAuthorization {
  return { address: auth.address, chainId: auth.chainId, nonce: Number(auth.nonce), r: auth.r, s: auth.s, yParity: auth.yParity as 0 | 1 };
}

export function startRelay() {
  try {
    if (!relayLive(ADDR.relayDelegate)) return;
    if (!env.relayerKey) {
      log('relay', 'RELAYER_KEY missing; player transactions cannot be sponsored');
      return;
    }
    log('relay', 'sponsoring as', relayer().account.address);
  } catch (e) {
    log('relay', 'not started', (e as Error).message);
  }
}

export function relay(body: any, ip: string): Promise<Relayed> {
  if (!relayLive(ADDR.relayDelegate)) throw new Error('relay off');
  if (!env.relayerKey) throw new Error('relay not configured');
  const req = parse(body);
  if (!relayAllowed(ADDR.arena, ADDR.stake, req.target, req.data)) throw new Error('BadCall');
  if (!limited(`a:${req.from.toLowerCase()}`, PER_ADDR) || !limited(`ip:${ip}`, PER_IP)) throw new Error('relay busy');
  return userLock(req.from.toLowerCase(), () => submit(req));
}

async function submit(req: Request): Promise<Relayed> {
  const delegate = ADDR.relayDelegate as Address;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const typed = {
    domain: { name: RELAY_NAME, version: RELAY_VERSION, chainId: activeChain.id, verifyingContract: req.from },
    types: relayTypes,
    primaryType: 'Execute' as const,
    message: { target: req.target, data: req.data, nonce: req.nonce, deadline: req.deadline },
  };
  const ok = await verifyTypedData({...typed,address:req.from,signature:req.signature});
  if (!ok) throw new Error('BadSig');
  const digest = hashTypedData(typed);
  const prior = db.prepare('SELECT * FROM relay_requests WHERE scope=? AND addr=? AND nonce=?').get(scope,req.from.toLowerCase(),String(req.nonce)) as Submitted|undefined;
  if (prior?.digest===digest) return relayed(await sendLock(()=>confirm(prior)));
  if (prior && prior.status!=='failed') throw new Error('nonce already used by another request');
  if (req.deadline < now - 15n || req.deadline > now + 600n) throw new Error('Expired');

  const calldata = encodeFunctionData({
    abi: relayDelegateAbi,
    functionName: 'execute',
    args: [req.target, req.data, req.deadline, req.signature],
  });
  const { account } = relayer();
  // Pass the address, not the nonce-managed account: estimation must not consume a sponsor nonce.
  const simulate = (authorization?: SignedAuthorization) =>
    pub.estimateGas({ account: account.address, to: req.from, data: calldata, authorizationList: authorization ? [authorization] : undefined })
      .then((gas) => ({ gas }), (error: unknown) => ({ error }));
  const claimed = req.authorization ? signedAuth(req.authorization) : undefined;
  // Every read below in one round trip instead of one after another: the account's code and nonces, a
  // simulation with the authorization the request carries, and the sponsor's balance, fees and nonce.
  // The checks then run in their original order, so a bad request still fails on the same check.
  const [code, nonceRead, txCount, simulated, balance, price, fees, sponsorNonce] = await Promise.all([
    pub.getCode({ address: req.from }),
    pub.readContract({ address: req.from, abi: relayDelegateAbi, functionName: 'nonce' }).catch((error: unknown) => ({ error })),
    claimed ? pub.getTransactionCount({ address: req.from }) : undefined,
    simulate(claimed),
    pub.getBalance({ address: account.address }),
    pub.getGasPrice(),
    sponsorFees(),
    pub.getTransactionCount({ address: account.address, blockTag: 'pending' }),
  ]);
  const who = delegatedTo(code);
  const delegated = who !== 'empty' && who !== 'other' && who.toLowerCase() === delegate.toLowerCase();
  const migrating = who !== 'empty' && who !== 'other' && knownRelay(who);
  if (who === 'other' || (who !== 'empty' && !delegated && !migrating)) throw new Error('account has unexpected code');
  if ((delegated || migrating) && typeof nonceRead !== 'bigint') throw nonceRead.error;
  const execNonce = delegated || migrating ? nonceRead as bigint : 0n;
  if (execNonce !== req.nonce) throw new Error('nonce');

  let authorization: SignedAuthorization | undefined;
  if (!delegated) {
    const auth = req.authorization;
    if (!auth || !claimed) throw new Error('relay needs authorization');
    if (auth.chainId !== activeChain.id || auth.address.toLowerCase() !== delegate.toLowerCase()) throw new Error('bad authorization');
    if (auth.nonce !== BigInt(txCount!)) throw new Error('nonce');
    const signer = await recoverAuthorizationAddress({ authorization: claimed });
    if (signer.toLowerCase() !== req.from.toLowerCase()) throw new Error('BadSig');
    authorization = claimed;
  }

  // Already delegated, yet the request carried an authorization: simulate what will actually be sent.
  const estimate = claimed && !authorization ? await simulate() : simulated;
  if ('error' in estimate) {
    const msg = explain(estimate.error);
    log('relay', 'simulate failed', req.from.slice(0, 10), msg.slice(0, 160));
    throw new Error(msg);
  }
  // Monad bills the limit of every submission, including ones that revert. Cap what we will actually send.
  const gas = (estimate.gas * 120n) / 100n;
  if (gas > (REAL_TRADING ? 2_000_000n : 800_000n)) throw new Error('relay gas limit exceeded');

  let cost = 0n;
  let held = false;
  const hash = await sendLock(async () => {
    // Finish every durable submission before taking a new sponsor nonce.
    const pending = db.prepare("SELECT * FROM relay_requests WHERE scope=? AND status='pending'").all(scope) as Submitted[];
    for (const row of pending) await confirm(row).catch((error)=>{if ((error as Error).message!=='relay reverted') throw error;});
    // A backlog just landed: its spend and nonces postdate the batch read above.
    const [bal, chainNonce] = pending.length
      ? await Promise.all([pub.getBalance({ address: account.address }), pub.getTransactionCount({ address: account.address, blockTag: 'pending' })])
      : [balance, sponsorNonce];
    // 2x covers a fee move between this read and inclusion. The sponsor sends constantly, so it
    // cannot use Monad's emptying exception and must stay above the 10 MON reserve. Sends still in
    // flight are held in `reserved` until their receipt, so a balance read before them stays safe.
    cost = gas * price * 2n;
    if (bal < parseEther('10') + reserved + cost) throw new Error('relay dry');
    reserved += cost;
    held = true;
    try {
      const nonce = Math.max(chainNonce, nextSponsorNonce ?? 0);
      const raw = await account.signTransaction({
        type: authorization ? 'eip7702' : 'eip1559',
        chainId: activeChain.id,
        nonce,
        to: req.from,
        data: calldata,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        ...(authorization ? { authorizationList: [authorization] } : {}),
      } as Parameters<typeof account.signTransaction>[0]);
      const hash = keccak256(raw);
      db.prepare('INSERT OR REPLACE INTO relay_requests VALUES(?,?,?,?,?,?,?)').run(scope,req.from.toLowerCase(),String(req.nonce),digest,hash,raw,'pending');
      nextSponsorNonce = nonce + 1;
      // Signed bytes and their hash exist on disk before the first broadcast.
      await pub.sendRawTransaction({serializedTransaction:raw}).catch((error)=>{
        if (/nonce too low|nonce too high|invalid nonce/i.test((error as Error).message)) nextSponsorNonce = undefined;
      });
      return hash;
    } catch (e) {
      reserved -= cost;
      held = false;
      throw e;
    }
  });
  try {
    const row = db.prepare('SELECT * FROM relay_requests WHERE scope=? AND addr=? AND nonce=?').get(scope,req.from.toLowerCase(),String(req.nonce)) as Submitted;
    const receipt = await confirm(row, true);
    log('relay', req.from.slice(0, 10), req.data.slice(0, 10), hash.slice(0, 10));
    return relayed(receipt);
  } finally {
    if (held) reserved -= cost;
  }
}
