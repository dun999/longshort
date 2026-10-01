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
import { log, pub, relayer } from './chain';
import { env } from './env';
import { db } from './db';

db.exec(`CREATE TABLE IF NOT EXISTS relay_requests (
  scope TEXT, addr TEXT, nonce TEXT, digest TEXT, hash TEXT, raw TEXT, status TEXT,
  PRIMARY KEY(scope,addr,nonce)
);`);
type Submitted = {scope:string;addr:string;nonce:string;digest:Hex;hash:Hex;raw:Hex|null;status:string};
const scope = `${activeChain.id}:${ADDR.relayDelegate?.toLowerCase()}`;
async function confirm(row: Submitted): Promise<Hex> {
  let receipt = await pub.getTransactionReceipt({hash:row.hash}).catch(()=>undefined);
  if (!receipt) {
    if (!row.raw) throw new Error(`Transaction pending: ${row.hash}`);
    await pub.sendRawTransaction({serializedTransaction:row.raw}).catch(async(error)=>{
      if (!/already known|nonce too low/i.test((error as Error).message) && !await pub.getTransactionReceipt({hash:row.hash}).catch(()=>undefined)) throw new Error(`Transaction pending: ${row.hash}`);
    });
    receipt = await pub.waitForTransactionReceipt({hash:row.hash,timeout:60_000});
  }
  db.prepare('UPDATE relay_requests SET status=?,raw=NULL WHERE scope=? AND addr=? AND nonce=?')
    .run(receipt.status==='success'?'confirmed':'failed',row.scope,row.addr,row.nonce);
  if (receipt.status !== 'success') throw new Error('relay reverted');
  return row.hash;
}

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

export function relay(body: any, ip: string): Promise<{ hash: Hex }> {
  if (!relayLive(ADDR.relayDelegate)) throw new Error('relay off');
  if (!env.relayerKey) throw new Error('relay not configured');
  const req = parse(body);
  if (!relayAllowed(ADDR.arena, ADDR.stake, req.target, req.data)) throw new Error('BadCall');
  if (!limited(`a:${req.from.toLowerCase()}`, PER_ADDR) || !limited(`ip:${ip}`, PER_IP)) throw new Error('relay busy');
  return userLock(req.from.toLowerCase(), () => submit(req));
}

async function submit(req: Request): Promise<{ hash: Hex }> {
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
  if (prior?.digest===digest) return {hash:await sendLock(()=>confirm(prior))};
  if (prior && prior.status!=='failed') throw new Error('nonce already used by another request');
  if (req.deadline < now - 15n || req.deadline > now + 600n) throw new Error('Expired');

  const code = await pub.getCode({ address: req.from });
  const who = delegatedTo(code);
  const delegated = who !== 'empty' && who !== 'other' && who.toLowerCase() === delegate.toLowerCase();
  const migrating = who !== 'empty' && who !== 'other' && knownRelay(who);
  if (who === 'other' || (who !== 'empty' && !delegated && !migrating)) throw new Error('account has unexpected code');
  const execNonce = delegated || migrating ? await pub.readContract({ address: req.from, abi: relayDelegateAbi, functionName: 'nonce' }) : 0n;
  if (execNonce !== req.nonce) throw new Error('nonce');
  const txNonce = delegated ? 0 : await pub.getTransactionCount({ address: req.from });

  let authorization: SignedAuthorization | undefined;
  if (!delegated) {
    const auth = req.authorization;
    if (!auth) throw new Error('relay needs authorization');
    if (auth.chainId !== activeChain.id || auth.address.toLowerCase() !== delegate.toLowerCase()) throw new Error('bad authorization');
    if (auth.nonce !== BigInt(txNonce)) throw new Error('nonce');
    const signer = await recoverAuthorizationAddress({ authorization: signedAuth(auth) });
    if (signer.toLowerCase() !== req.from.toLowerCase()) throw new Error('BadSig');
    authorization = signedAuth(auth);
  }

  const calldata = encodeFunctionData({
    abi: relayDelegateAbi,
    functionName: 'execute',
    args: [req.target, req.data, req.deadline, req.signature],
  });
  const { account } = relayer();
  let gas: bigint;
  try {
    // Pass the address, not the nonce-managed account: estimation must not consume a sponsor nonce.
    gas = await pub.estimateGas({
      account: account.address,
      to: req.from,
      data: calldata,
      authorizationList: authorization ? [authorization] : undefined,
    });
  } catch (e) {
    const msg = explain(e);
    log('relay', 'simulate failed', req.from.slice(0, 10), msg.slice(0, 160));
    throw new Error(msg);
  }
  // Monad bills the limit of every submission, including ones that revert. Cap what we will actually send.
  gas = (gas * 120n) / 100n;
  if (gas > (REAL_TRADING ? 2_000_000n : 800_000n)) throw new Error('relay gas limit exceeded');

  let cost = 0n;
  let held = false;
  const hash = await sendLock(async () => {
    // Finish every durable submission before asking the RPC for a new sponsor nonce.
    const pending = db.prepare("SELECT * FROM relay_requests WHERE scope=? AND status='pending'").all(scope) as Submitted[];
    for (const row of pending) await confirm(row).catch((error)=>{if ((error as Error).message!=='relay reverted') throw error;});
    const { account: sponsor, wallet } = relayer();
    const [bal, price] = await Promise.all([pub.getBalance({ address: sponsor.address }), pub.getGasPrice()]);
    // 2x covers a fee move between this read and inclusion. The sponsor sends constantly, so it
    // cannot use Monad's emptying exception and must stay above the 10 MON reserve.
    cost = gas * price * 2n;
    if (bal < parseEther('10') + reserved + cost) throw new Error('relay dry');
    reserved += cost;
    held = true;
    try {
      const request = await wallet.prepareTransactionRequest({
        account: sponsor,
        to: req.from,
        data: calldata,
        gas,
        authorizationList: authorization ? [authorization] : undefined,
      });
      const raw = await wallet.signTransaction(request as Parameters<typeof wallet.signTransaction>[0]);
      const hash = keccak256(raw);
      db.prepare('INSERT OR REPLACE INTO relay_requests VALUES(?,?,?,?,?,?,?)').run(scope,req.from.toLowerCase(),String(req.nonce),digest,hash,raw,'pending');
      // Signed bytes and their hash exist on disk before the first broadcast.
      await pub.sendRawTransaction({serializedTransaction:raw}).catch(()=>{});
      return hash;
    } catch (e) {
      reserved -= cost;
      held = false;
      throw e;
    }
  });
  try {
    const row = db.prepare('SELECT * FROM relay_requests WHERE scope=? AND addr=? AND nonce=?').get(scope,req.from.toLowerCase(),String(req.nonce)) as Submitted;
    await confirm(row);
    log('relay', req.from.slice(0, 10), req.data.slice(0, 10), hash.slice(0, 10));
    return { hash };
  } finally {
    if (held) reserved -= cost;
  }
}
