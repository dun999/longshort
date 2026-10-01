/** Explicit live testnet check. Uses fresh deterministic test wallets; never exports their keys. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createSecp256k1SigningSession } from '@category-labs/mera';
import { toViemAccount } from '@category-labs/mera/viem';
import { createPublicClient, encodeFunctionData, hexToBytes, http, maxUint256, parseEventLogs, type Address, type Hex, type LocalAccount } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import WebSocket from 'ws';
import { ADDR, activeChain, arenaAbi, delegatedTo, erc20Abi, knownRelay, relayDelegateAbi, relayTypes, RELAY_NAME, RELAY_VERSION } from '@longshort/shared';
import { env } from '../src/env';

assert.equal(activeChain.id, 10143, 'testnet only');
assert.equal(ADDR.realTrading, true);
const base = process.env.SMOKE_API ?? 'http://127.0.0.1:8790';
const pub = createPublicClient({ chain: activeChain, transport: http(env.rpcUrl) });
const arena = { address: ADDR.arena, abi: arenaAbi } as const;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const receipts: Record<string, unknown>[] = [];
async function api(path: string, body?: object) {
  const r = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(`${path}: ${data.error ?? r.status}`);
  return data;
}
function meraKey(index: number) {
  const key = mnemonicToAccount(env.botMnemonic, { addressIndex: index }).getHdKey().privateKey!;
  const session = createSecp256k1SigningSession({ privateKey: key });
  key.fill(0);
  return { session, account: toViemAccount(session) };
}
const a = meraKey(101), b = meraKey(102), sa = meraKey(201), sb = meraKey(202);
const all = [a, b, sa, sb];
const balance = (address: Address) => pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [address] });
async function login(account: LocalAccount) {
  const ts = Math.floor(Date.now() / 1000);
  const message = `Sign in to longshort.fun\n\nNo transaction, no cost.\n\n${account.address.toLowerCase()}\n${ts}`;
  return (await api('/auth', { addr: account.address, ts, sig: await account.signMessage({ message }) })).token as string;
}
async function relay(account: LocalAccount, target: Address, data: Hex, label: string) {
  const code = delegatedTo(await pub.getCode({ address: account.address }));
  const delegated = code !== 'empty' && code !== 'other' && code.toLowerCase() === ADDR.relayDelegate!.toLowerCase();
  const nonce = delegated || (code !== 'empty' && code !== 'other' && knownRelay(code)) ? await pub.readContract({ address: account.address, abi: relayDelegateAbi, functionName: 'nonce' }) : 0n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const signature = await account.signTypedData({ domain: { name: RELAY_NAME, version: RELAY_VERSION, chainId: activeChain.id, verifyingContract: account.address }, types: relayTypes, primaryType: 'Execute', message: { target, data, nonce, deadline } });
  const authorization = delegated ? undefined : await account.signAuthorization!({ contractAddress: ADDR.relayDelegate!, chainId: activeChain.id, nonce: await pub.getTransactionCount({ address: account.address }) });
  const body = JSON.parse(JSON.stringify({ from: account.address, target, data, nonce, deadline, signature, authorization }, (_k, v) => typeof v === 'bigint' ? String(v) : v));
  const result = await api('/relay', body);
  const receipt = await pub.waitForTransactionReceipt({ hash: result.hash });
  assert.equal(receipt.status, 'success', label);
  receipts.push({ action: label, hash: result.hash });
  console.log(label, result.hash);
  return receipt;
}
let socket: WebSocket | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
try {
  const health = await api('/health');
  assert.equal(health.arena.toLowerCase(), ADDR.arena.toLowerCase());
  const tokens = [await login(a.account), await login(b.account)];
  for (const [i, w] of [a, b].entries()) {
    const before = await balance(w.account.address);
    const status = await api(`/faucet/${w.account.address}`);
    assert.ok(before === 0n || (before === 200_000_000n && status.status === 'confirmed'), 'fresh wallet or a resumed claim test');
    const unauthorized = await fetch(base + '/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ addr: w.account.address }) });
    assert.equal(unauthorized.status, 500);
    const result = await api('/faucet', { addr: w.account.address, token: tokens[i] });
    assert.equal(result.status, 'confirmed');
    assert.equal(result.before, '0');
    assert.equal(result.after, '200000000');
    assert.equal(await balance(w.account.address), 200_000_000n);
    const retry = await api('/faucet', { addr: w.account.address, token: tokens[i] });
    assert.equal(retry.alreadyClaimed, true);
    assert.equal(retry.tx, result.tx);
    assert.equal(await balance(w.account.address), 200_000_000n);
    receipts.push({ action: 'claim', owner: w.account.address, before: '0', after: '200', hash: result.tx });
    console.log('claim confirmed once', w.account.address, result.tx);
    await relay(w.account, ADDR.stake, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ADDR.arena, maxUint256] }), 'approve AUSD');
  }
  const create = await relay(a.account, ADDR.arena, encodeFunctionData({ abi: arenaAbi, functionName: 'createMatch', args: [0, 5_000_000n, 60, 2, 0, 5, sa.account.address] }), 'create Duel');
  const id = parseEventLogs({ abi: arenaAbi, eventName: 'MatchCreated', logs: create.logs })[0]!.args.id;
  const ts = Math.floor(Date.now() / 1000);
  await api('/lobby-options', { id: Number(id), addr: a.account.address, ts, allowBots: false, rematchOf: 0, token: '', sig: await sa.account.signMessage({ message: `longshort.fun lobby:${id}:0:0::${ts}` }) });
  socket = new WebSocket(base.replace('http', 'ws') + '/ws');
  await new Promise((resolve,reject) => {socket!.once('open', resolve);socket!.once('error',reject);});
  socket.send(JSON.stringify({ t: 'hello', addr: a.account.address, token: tokens[0] }));
  heartbeat = setInterval(() => socket!.send(JSON.stringify({ t: 'watch', matchId: Number(id) })), 3_000);
  await relay(b.account, ADDR.arena, encodeFunctionData({ abi: arenaAbi, functionName: 'joinMatch', args: [id, 1, 5, sb.account.address] }), 'join Duel');
  assert.equal(await balance(a.account.address), 95_000_000n);
  assert.equal(await balance(b.account.address), 95_000_000n);
  const match = await pub.readContract({ ...arena, functionName: 'getMatch', args: [id] });
  while (Number((await pub.getBlock()).timestamp) < Number(match.startAt)) await wait(1_000);
  await relay(sa.account, ADDR.arena, encodeFunctionData({ abi: arenaAbi, functionName: 'open', args: [id, 0, true, 5_000] }), 'Perpl long');
  await relay(sb.account, ADDR.arena, encodeFunctionData({ abi: arenaAbi, functionName: 'open', args: [id, 0, false, 5_000] }), 'Perpl short');
  let players = await pub.readContract({ ...arena, functionName: 'getPlayers', args: [id] });
  assert.ok(players.every((p) => p.hasPos && p.pos.notional > 0n));
  await relay(sa.account, ADDR.arena, encodeFunctionData({ abi: arenaAbi, functionName: 'close', args: [id] }), 'close Perpl long');
  await relay(sb.account, ADDR.arena, encodeFunctionData({ abi: arenaAbi, functionName: 'open', args: [id, 0, true, 5_000] }), 'atomic short to long flip');
  players = await pub.readContract({ ...arena, functionName: 'getPlayers', args: [id] });
  assert.equal(players[0].hasPos, false);
  assert.equal(players[1].pos.isLong, true);
  // The remaining position is closed by the real keeper at the bell, then actual capital returns.
  const deadline = Date.now() + 180_000;
  while (Number((await pub.readContract({ ...arena, functionName: 'getMatch', args: [id] })).state) !== 2) {
    assert.ok(Date.now() < deadline, 'settlement timeout');
    await wait(2_000);
  }
  let indexed: any;
  for (let i = 0; i < 20; i++) { indexed = await api(`/match/${id}`); if (indexed.match.state === 2 && indexed.fills.length >= 6) break; await wait(1_000); }
  assert.equal(indexed.match.state, 2);
  assert.equal(indexed.accounts.length, 2);
  assert.ok(indexed.fills.length >= 6, 'real Perpl open, close and flip fills indexed');
  for (const w of [a, b]) {
    const owner = w.account.address.toLowerCase();
    const p = indexed.players.find((p: any) => p.addr === owner);
    const account = indexed.accounts.find((p: any) => p.addr === owner);
    assert.equal(account.returned, account.final_balance);
    const actual = Number(await balance(w.account.address)) / 1e6;
    assert.ok(Math.abs(actual - (95 + account.returned + p.payout)) < 0.000002, 'capital + prize exactly reconcile');
    assert.equal(await pub.getBalance({ address: w.account.address }), 0n, 'gas sponsored');
    receipts.push({ action: 'settled', owner: w.account.address, claim: 200, entry: 5, tradingBudget: 100, returned: account.returned, prize: p.payout, wallet: actual, finalEquity: p.final_equity, account: account.account });
    const recovery = await api('/recover', { id: Number(id), addr: w.account.address, token: tokens[[a, b].indexOf(w)] });
    assert.equal(recovery.pending, false, 'already returned recovery is a no-op');
  }
  assert.equal(await balance(ADDR.arena), 0n, 'no outstanding prize escrow');
  const evidence = { network: 'Monad testnet', chainId: activeChain.id, arena: ADDR.arena, token: ADDR.stake, matchId: Number(id), settlement: indexed.match.settle_tx, fills: indexed.fills, receipts };
  mkdirSync('../docs', { recursive: true });
  writeFileSync('../docs/ausd-live-validation.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log('PASS: authenticated claims, zero-MON Mera signatures, real fills, close, flip, keeper settlement, capital/prize conservation');
} finally {
  if (heartbeat) clearInterval(heartbeat);
  socket?.close();
  all.forEach((w) => w.session.end());
}
