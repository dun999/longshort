/** Arena v2 live check: a real Duel at 15x through the web Settings/Play path, against a keeper bot.
 * The human credential is an in-memory WebAuthn fixture; the deployed keeper
 * supplies and trades its own bot. This does not test a physical passkey.
 */
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { parseAbiItem, type Address } from 'viem';
import { ADDR, Mode, activeChain, erc20Abi } from '@longshort/shared';

assert.equal(activeChain.id, 10143, 'Monad testnet only');
assert.equal(ADDR.realTrading, true);
process.env.NEXT_PUBLIC_API_URL = 'https://longshort.fun/api';
process.env.NEXT_PUBLIC_RPC_URL = 'https://testnet-rpc.monad.xyz';
const storage = new Map<string, string>(), deviceSecret = randomBytes(32), credentialId = randomBytes(16);
let ceremonies = 0;
const credential = async (options: any) => {
  ceremonies++;
  const output = new Uint8Array(createHmac('sha256', deviceSecret).update(new Uint8Array(options.publicKey.extensions.prf.eval.first)).digest());
  return { type: 'public-key', rawId: credentialId.buffer.slice(credentialId.byteOffset, credentialId.byteOffset + credentialId.byteLength),
    response: { getTransports: () => ['internal'] },
    getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: output.buffer } } }) };
};
const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
Object.defineProperties(globalThis, {
  localStorage: { value: localStorage, configurable: true },
  window: { value: { isSecureContext: true, PublicKeyCredential: class {}, localStorage, addEventListener: () => {} }, configurable: true },
  location: { value: { hostname: 'longshort.fun' }, configurable: true },
  navigator: { value: { credentials: { create: credential, get: credential } }, configurable: true },
});
const { useWallet } = await import('../../web/src/lib/wallet');
const { useSettings } = await import('../../web/src/lib/settings');
const actions = await import('../../web/src/lib/actions');
const mera = await import('../../web/src/lib/mera');
const { api } = await import('../../web/src/lib/api');
const { arena, publicClient: pub } = await import('../../web/src/lib/clients');
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const balance = (address: Address) => pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [address] });
const allowance = (address: Address) => pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'allowance', args: [address, ADDR.arena] });
let socket: WebSocket | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, id: number | undefined;
try {
  const profiles = await api<any[]>('/profiles?q=bot');
  const bots = profiles.filter((p) => p.bot);
  assert.ok(bots.length > 0, 'the keeper must expose actual bot profiles');
  const before = await Promise.all(bots.map(async (b) => ({ addr: b.addr, balance: (await balance(b.addr)).toString(), allowance: (await allowance(b.addr)).toString() })));
  // a new arena starts with no bot allowance: the keeper approves it when it seats a bot
  await useWallet.getState().connectPasskey({ create: true, username: 'Bot matchmaking integration fixture' });
  if (useWallet.getState().error) throw new Error(useWallet.getState().error);
  const owner = useWallet.getState().address!;
  await useWallet.getState().faucet();
  assert.equal(await balance(owner), 200_000_000n);
  // This is the same store and preference used by the original Settings toggle.
  useSettings.getState().setAllowBots(true);
  const queuedAt = Date.now();
  id = await actions.quickPlay(Mode.DUEL, 5, 15);
  socket = new WebSocket('wss://longshort.fun/api/ws');
  await new Promise<void>((done, reject) => { socket!.once('open', () => done()); socket!.once('error', reject); });
  const ts = Math.floor(Date.now() / 1000);
  const { token } = await api<{ token: string }>('/auth', { addr: owner, ts, sig: await mera.ownerAccount()!.signMessage({ message: `Sign in to longshort.fun\n\nNo transaction, no cost.\n\n${owner.toLowerCase()}\n${ts}` }) });
  socket.send(JSON.stringify({ t: 'hello', addr: owner, token }));
  heartbeat = setInterval(() => socket!.send(JSON.stringify({ t: 'watch', matchId: id })), 3000);
  // The keeper's event projection can trail the confirmed create receipt briefly.
  let info: any;
  const indexDeadline = Date.now() + 15_000;
  while (!info) {
    try { info = await api<any>(`/match/${id}`); }
    catch (error) { if (!/not found/.test((error as Error).message) || Date.now() > indexDeadline) throw error; await wait(1000); }
  }
  assert.equal(info.match.allow_bots, true, 'Settings must reach the durable lobby option');
  const entryReceipt = await pub.getTransactionReceipt({ hash: info.match.create_tx });
  assert.equal(entryReceipt.status, 'success');
  const joinDeadline = Date.now() + 90_000;
  let players = await pub.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(id)] });
  while (players.length < 2) {
    assert.ok(Date.now() < joinDeadline, 'real bot join timeout');
    await wait(1000); players = await pub.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(id)] });
  }
  const bot = players.find((p) => p.addr.toLowerCase() !== owner.toLowerCase())!;
  const me = players.find((p) => p.addr.toLowerCase() === owner.toLowerCase())!;
  assert.equal(me.leverage, 15, 'the 15x class is accepted on-chain');
  assert.ok([5, 10, 15].includes(bot.leverage), 'bots pick a live class');
  assert.ok(bots.some((b) => b.addr === bot.addr.toLowerCase()), 'the opponent must be the deployed bot, not another fixture');
  const matchedAfterMs = Date.now() - queuedAt;
  const joins = await pub.getLogs({ address: ADDR.arena,
    event: parseAbiItem('event PlayerJoined(uint256 indexed id, address indexed player, uint8 team, uint8 leverage, address session)'),
    args: { id: BigInt(id), player: bot.addr }, fromBlock: entryReceipt.blockNumber, toBlock: 'latest' });
  assert.equal(joins.length, 1);
  const botJoin = await pub.getTransactionReceipt({ hash: joins[0].transactionHash! });
  assert.equal(botJoin.status, 'success');
  const round = await pub.readContract({ ...arena, functionName: 'getMatch', args: [BigInt(id)] });
  while (Number((await pub.getBlock()).timestamp) < Number(round.startAt)) await wait(1000);
  const long = await actions.tradeOpen(id, 0, true, 5000);
  assert.equal(ceremonies, 1, 'fixture onboarding and play must remain prompt-free afterward');
  const settleDeadline = Date.now() + 180_000;
  do {
    assert.ok(Date.now() < settleDeadline, 'real bot round settlement timeout');
    await wait(2000); info = await api<any>(`/match/${id}`);
  } while (info.match.state !== 2);
  const botFills = info.fills.filter((f: any) => f.addr === bot.addr.toLowerCase());
  assert.ok(botFills.length >= 2, 'the bot must execute and close real Perpl orders');
  assert.ok(info.players.find((p: any) => p.addr === bot.addr.toLowerCase())?.bot);
  for (const addr of [owner, bot.addr]) {
    const player = info.players.find((p: any) => p.addr === addr.toLowerCase());
    const capital = info.accounts.find((a: any) => a.addr === addr.toLowerCase());
    assert.equal(capital.returned, capital.final_balance);
    const initial = addr === owner ? 200 : Number(before.find((b) => b.addr === addr.toLowerCase())!.balance) / 1e6;
    assert.ok(Math.abs(Number(await balance(addr)) / 1e6 - (initial - 105 + capital.returned + player.payout)) < 0.000002);
  }
  assert.equal(await pub.getBalance({ address: owner }), 0n, 'human gas remains sponsored');
  const evidence = { executedAt: new Date().toISOString(), evidenceType: 'real-keeper-bot-with-WebAuthn-fixture',
    limitations: ['No physical passkey or browser timing is tested'], chainId: ADDR.chainId, arena: ADDR.arena,
    matchId: id, owner, bot: bot.addr, settingsAllowBots: true, botFundingBefore: before, matchedAfterMs,
    fixtureCeremonies: ceremonies, entry: entryReceipt.transactionHash, botJoin: botJoin.transactionHash,
    humanTrade: long.hash, settlement: info.match.settle_tx, fills: info.fills, ledger: info.accounts, players: info.players };
  mkdirSync('../docs/evidence', { recursive: true });
  writeFileSync('../docs/evidence/arena-v2-live-duel-15x.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log('PASS', JSON.stringify({ matchId: id, bot: bot.addr, matchedAfterMs, botFills: botFills.length, settlement: info.match.settle_tx }));
} catch (error) {
  console.error('Bot integration failed; submitted testnet transactions remain real.', id ? `Match #${id}` : ''); throw error;
} finally {
  clearInterval(heartbeat); socket?.close(); mera.lock(); deviceSecret.fill(0); storage.clear();
}
