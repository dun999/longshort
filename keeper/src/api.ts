import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { isAddress, parseEther, parseUnits, verifyMessage } from 'viem';
import { ADDR, erc20Abi } from '@longshort/shared';
import { MARKETS } from '@longshort/shared';
import { db, ensureProfile } from './db';
import { env } from './env';
import { gateAllows } from './gate';
import { GAS, keeper, log, pub } from './chain';
import { history, onTick } from './prices';
import { onChainEvent } from './indexer';
import { heartbeat, requestCancel } from './lobby';
import { configureLobby, lobbyOptions, releaseRematch, rematchInvites, reserveRematch, roster } from './matchmaking';
import { signedIn, signIn, tokenOwner } from './auth';
import { followersOf, matchmake, opened, pendingFor, release } from './queue';

// ─── HTTP ───────────────────────────────────────────────────────────────────
type Handler = (req: IncomingMessage, params: string[], body: any) => unknown | Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp('^' + path.replace(/:\w+/g, '([^/]+)') + '$'), h]);

const nameOf = (addr: string) => (db.prepare('SELECT name, bot FROM profiles WHERE addr = ?').get(addr) as { name: string | null; bot: number } | undefined);
function playersOf(matchId: number) {
  return (db.prepare('SELECT * FROM players WHERE match_id = ? ORDER BY rowid').all(matchId) as any[]).map((p) => {
    const n = nameOf(p.addr);
    return { ...p, name: n?.name ?? null, bot: !!n?.bot };
  });
}

route('GET', '/health', () => ({ ok: true }));
// Caddy's forward_auth asks this before serving the Envio GraphQL; handle() has already checked the gate
route('GET', '/gate', () => ({ ok: true }));

route('POST', '/lobby-options', async (_r, _p, body) => {
  const result = await configureLobby(body);
  const creator = body.addr.toLowerCase();
  if (result.created) for (const f of opened(body.id, creator, body.lease)) follow(f.addr, body.id, f.team);
  if (body.rematchOf) {
    for (const p of roster(body.rematchOf).filter((p) => !p.bot && p.addr !== creator)) {
      for (const client of clientsOf(p.addr)) send(client, { t: 'rematch-invite', sourceId: body.rematchOf, matchId: body.id, from: body.addr, team: p.team });
    }
  }
  return { ok: true };
});
route('POST', '/rematch', (_r, _p, body) => reserveRematch(body));
route('POST', '/rematch-release', (_r, _p, body) => releaseRematch(body));
route('POST', '/auth', (_r, _p, body) => signIn(body));

// Play: the keeper picks the lobby, so simultaneous players meet instead of each opening their own.
route('POST', '/matchmake', async (_r, _p, body) => {
  const addr = signedIn(body);
  let members = [addr];
  if (body.party) {
    const p = partyOf(addr);
    if (!p || p.leader !== addr) throw new Error('Only the party leader can start the match');
    p.mode = Number(body.mode);
    p.entry = Number(body.entry);
    pushParty(p);
    members = [addr, ...p.members.map((m) => m.addr).filter((a) => a !== addr)];
  }
  const lobby = body.lobby === undefined ? undefined : Number(body.lobby);
  return matchmake({ addr, mode: Number(body.mode), entry: Number(body.entry), allowBots: body.allowBots === true, party: members, lobby, avoid: Number(body.avoid) || undefined });
});
route('POST', '/matchmake/release', (_r, _p, body) => {
  release(signedIn(body), typeof body.lease === 'string' ? body.lease : undefined, Number(body.matchId) || undefined);
  return { ok: true };
});
route('GET', '/profiles', (req) => {
  const q = new URL(req.url!, 'http://x').searchParams;
  const addresses = q.get('addresses')?.split(',').filter((a) => isAddress(a)).map((a) => a.toLowerCase()).slice(0, 100);
  if (addresses) return addresses.length ? db.prepare(`SELECT addr, name, bot FROM profiles WHERE addr IN (${addresses.map(() => '?').join(',')})`).all(...addresses) : [];
  const term = (q.get('q') ?? '').trim().slice(0, 42);
  if (!term) return [];
  const prefix = term.replace(/[\\%_]/g, '\\$&') + '%';
  return db.prepare(`SELECT addr, name, bot, xp FROM profiles WHERE name LIKE ? ESCAPE '\\' OR addr LIKE ? ESCAPE '\\'
    ORDER BY name COLLATE NOCASE, addr LIMIT 30`).all(prefix, prefix);
});

// signed "cancel my matchmaking": stops bot fill, and refunds a lobby that filled under the cancel
route('POST', '/cancel', async (_r, _p, body) => {
  const { id, addr, ts, sig } = body ?? {};
  if (!isAddress(String(addr)) || typeof sig !== 'string') return { error: 'bad request' };
  return requestCancel(Number(id), String(addr), Number(ts), sig as `0x${string}`);
});

route('GET', '/stats', () => {
  const one = (sql: string, ...a: any[]) => Object.values(db.prepare(sql).get(...a) as object)[0] as number;
  const since = Math.floor(Date.now() / 1000) - 86_400;
  return {
    matches: one('SELECT COUNT(*) FROM matches'),
    settled: one('SELECT COUNT(*) FROM matches WHERE state = 2'),
    live: one('SELECT COUNT(*) FROM matches WHERE state = 1'),
    trades: one("SELECT COUNT(*) FROM trades WHERE kind = 'open'"),
    txs: one('SELECT COUNT(*) FROM trades') + one('SELECT COUNT(*) FROM players') + one('SELECT COUNT(*) FROM matches WHERE settle_tx IS NOT NULL'),
    volume: one("SELECT COALESCE(SUM(notional), 0) FROM trades WHERE kind = 'open'"),
    humanVolume: one("SELECT COALESCE(SUM(t.notional), 0) FROM trades t JOIN profiles p ON p.addr = t.addr WHERE t.kind = 'open' AND p.bot = 0"),
    staked: one('SELECT COALESCE(SUM(m.entry), 0) FROM players pl JOIN matches m ON m.id = pl.match_id'),
    wallets: one('SELECT COUNT(*) FROM profiles WHERE bot = 0'),
    bots: one('SELECT COUNT(*) FROM profiles WHERE bot = 1'),
    trades24h: one("SELECT COUNT(*) FROM trades WHERE kind = 'open' AND ts > ?", since),
    liquidations: one("SELECT COUNT(*) FROM trades WHERE kind = 'liquidated'"),
    byMode: db.prepare('SELECT mode, COUNT(*) n FROM matches WHERE state = 2 GROUP BY mode').all(),
    daily: db.prepare(
      "SELECT strftime('%m-%d %H:00', ts, 'unixepoch') d, COUNT(*) trades, SUM(notional) volume FROM trades WHERE kind = 'open' AND ts > ? GROUP BY d ORDER BY d DESC LIMIT 24",
    ).all(since),
  };
});

route('GET', '/prices', () => Object.fromEntries(MARKETS.map((m) => [m, history[m].slice(-1200)])));

route('GET', '/leaderboard', () =>
  db.prepare('SELECT addr, name, xp, wins, losses, matches, volume, earned, bot FROM profiles WHERE matches > 0 ORDER BY xp DESC, wins DESC LIMIT 100').all(),
);

route('GET', '/profile/:addr', (_r, [addr]) => {
  if (!isAddress(addr)) return { error: 'bad address' };
  const a = addr.toLowerCase();
  ensureProfile(a);
  const profile = db.prepare('SELECT * FROM profiles WHERE addr = ?').get(a);
  const rank = (db.prepare('SELECT COUNT(*) + 1 r FROM profiles WHERE matches > 0 AND xp > (SELECT xp FROM profiles WHERE addr = ?)').get(a) as { r: number }).r;
  const matches = db.prepare(
    `SELECT m.id, m.mode, m.entry, m.state, m.start_at, m.settle_tx, p.team, p.leverage, p.result, p.payout, p.final_equity, p.xp_delta
     FROM players p JOIN matches m ON m.id = p.match_id WHERE p.addr = ? ORDER BY m.id DESC LIMIT 30`,
  ).all(a);
  return { profile, rank, matches };
});

route('GET', '/matches', (req) => {
  const state = new URL(req.url!, 'http://x').searchParams.get('state');
  const where = state === 'open' ? 'state = 0' : state === 'live' ? 'state = 1' : 'state = 2';
  const rows = db.prepare(`SELECT * FROM matches WHERE ${where} ORDER BY id DESC LIMIT 20`).all() as any[];
  return rows.filter((m) => m.state !== 0 || !lobbyOptions(m.id)?.rematch_of).map((m) => ({ ...m, players: playersOf(m.id) }));
});

route('GET', '/match/:id', (_r, [id]) => {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(id));
  if (!m) return { error: 'not found' };
  const options = lobbyOptions(Number(id));
  return { match: { ...m, allow_bots: !!options?.allow_bots, rematch_of: options?.rematch_of }, players: playersOf(Number(id)), trades: db.prepare('SELECT * FROM trades WHERE match_id = ? ORDER BY id').all(Number(id)), roster: options?.rematch_of ? roster(options.rematch_of) : undefined };
});

route('GET', '/feed', () =>
  (db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 40').all() as any[]).map((t) => ({ ...t, name: nameOf(t.addr)?.name ?? null })),
);

route('POST', '/profile', async (_r, _p, body) => {
  const { addr, name, ts, sig } = body ?? {};
  if (typeof name !== 'string' || !/^[\w .·-]{2,20}$/.test(name) || /^bot/i.test(name)) return { error: 'bad name' };
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return { error: 'expired' };
  const ok = await verifyMessage({ address: addr, message: `longshort.fun name:${name} ts:${ts}`, signature: sig }).catch(() => false);
  if (!ok) return { error: 'bad signature' };
  ensureProfile(addr);
  db.prepare('UPDATE profiles SET name = ? WHERE addr = ?').run(name, addr.toLowerCase());
  for (const client of clientsOf(addr.toLowerCase())) client.name = name;
  const party = partyOf(addr.toLowerCase());
  const member = party?.members.find((m) => m.addr === addr.toLowerCase());
  if (member && party) { member.name = name; pushParty(party); }
  return { ok: true };
});

// Gas + stake drip so a brand-new (guest) wallet can play immediately.
const gasDrip = new Map<string, number>(); // addr → last gas refill
const stakeDrip = new Map<string, number>(); // addr → last stake drip
const ipHits = new Map<string, number[]>(); // ip → drip times in the last hour
route('POST', '/faucet', async (req, _p, body) => {
  const addr = String(body?.addr ?? '').toLowerCase() as `0x${string}`;
  if (!isAddress(addr)) return { error: 'bad address' };
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',')[0].trim();
  const now = Date.now();
  // friends often share one network: allow a dozen sign-ups per IP per hour, not one
  const hits = (ipHits.get(ip) ?? []).filter((t) => t > now - 3_600_000);
  if (hits.length >= 12) return { error: 'faucet cooldown — try again later' };
  const [mon, usd] = await Promise.all([
    pub.getBalance({ address: addr }),
    pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [addr] }),
  ]);
  const txs: string[] = [];
  // gas: refill whenever nearly dry (short cooldown), so a player is never stuck unable to join
  if (mon < parseEther(env.faucetGasLow) && (gasDrip.get(addr) ?? 0) < now - 180_000) {
    // never below the keeper's reserve: settlement and liquidations come first
    const mine = await pub.getBalance({ address: keeper.account.address });
    if (mine - parseEther(env.faucetMon) >= parseEther(env.gasReserve)) {
      gasDrip.set(addr, now);
      txs.push(await keeper.sendTransaction({ to: addr, value: parseEther(env.faucetMon), gas: 21_000n }));
    } else log('faucet', `keeper below reserve: no gas for ${addr}, top up ${keeper.account.address}`);
  }
  const drip = parseUnits(env.faucetStake, 6);
  let note: string | undefined;
  if (usd < drip / 2n && (stakeDrip.get(addr) ?? 0) < now - 3_600_000) {
    const have = await pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [keeper.account.address] });
    if (have >= drip) {
      stakeDrip.set(addr, now);
      txs.push(await keeper.writeContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'transfer', args: [addr, drip], gas: GAS.transfer }));
    } else note = `Faucet is out of ${ADDR.stakeSymbol ?? 'stake'}. Gas was sent; claim stake from the token faucet.`;
  }
  if (txs.length) ipHits.set(ip, [...hits, now]);
  await Promise.all(txs.map((hash) => pub.waitForTransactionReceipt({ hash: hash as `0x${string}` })));
  log('faucet', addr, txs.length, 'txs', note ?? '');
  return { ok: true, txs, note };
});

async function readBody(req: IncomingMessage) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return void res.end();
  const path = new URL(req.url!, 'http://x').pathname;
  if (path !== '/health' && !gateAllows(req)) {
    res.statusCode = 401;
    return void res.end('{"error":"private preview"}');
  }
  for (const [method, re, h] of routes) {
    const m = path.match(re);
    if (!m || method !== req.method) continue;
    try {
      const out = await h(req, m.slice(1), req.method === 'POST' ? await readBody(req) : undefined);
      res.setHeader('content-type', 'application/json');
      return void res.end(JSON.stringify(out));
    } catch (e) {
      res.statusCode = 500;
      return void res.end(JSON.stringify({ error: (e as Error).message }));
    }
  }
  res.statusCode = 404;
  res.end('{"error":"not found"}');
}

// ─── WebSocket: presence, parties, live events ─────────────────────────────
interface Client { ws: WebSocket; addr?: string; name?: string; partyId?: string }
interface Member { addr: string; name?: string; ready: boolean; leverage: number }
interface Party { id: string; leader: string; members: Member[]; mode: number; entry: number; chat: { from: string; text: string; at: number }[] }

const clients = new Set<Client>();
const parties = new Map<string, Party>();
const send = (c: Client, msg: object) => c.ws.readyState === 1 && c.ws.send(JSON.stringify(msg));
const broadcast = (msg: object) => {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === 1) c.ws.send(s);
};
const clientsOf = (addr: string) => [...clients].filter((c) => c.addr === addr);
const online = () => [...new Set([...clients].flatMap((c) => (c.addr ? [c.addr] : [])))];
/** Send a party member to the lobby their leader is seated in. */
const follow = (addr: string, matchId: number, team: number) => {
  for (const c of clientsOf(addr)) send(c, { t: 'join-match', matchId, team });
};

function pushParty(p: Party) {
  for (const m of p.members) for (const c of clientsOf(m.addr)) send(c, { t: 'party', party: p });
}

function leaveParty(addr: string) {
  for (const p of parties.values()) {
    if (!p.members.some((m) => m.addr === addr)) continue;
    p.members = p.members.filter((m) => m.addr !== addr);
    for (const c of clientsOf(addr)) send(c, { t: 'party', party: null });
    if (!p.members.length) parties.delete(p.id);
    else {
      if (p.leader === addr) p.leader = p.members[0].addr;
      pushParty(p);
    }
  }
}

function partyOf(addr: string) {
  for (const p of parties.values()) if (p.members.some((m) => m.addr === addr)) return p;
}

function onMessage(c: Client, msg: any) {
  const me = c.addr;
  switch (msg.t) {
    case 'hello': {
      if (!isAddress(String(msg.addr))) return;
      const addr = String(msg.addr).toLowerCase();
      // only a signed-in connection speaks for an address: parties, invites and match assignments follow it
      const ok = tokenOwner(msg.token) === addr;
      c.addr = ok ? addr : undefined;
      c.name = ok ? (nameOf(addr)?.name ?? undefined) : undefined;
      send(c, { t: 'auth', ok });
      broadcast({ t: 'presence', online: online() });
      if (!ok) return;
      ensureProfile(addr);
      const p = partyOf(addr);
      if (p) send(c, { t: 'party', party: p });
      for (const invite of rematchInvites(addr) as any[]) send(c, { t: 'rematch-invite', ...invite, from: invite.creator });
      for (const f of pendingFor(addr)) send(c, { t: 'join-match', ...f });
      return;
    }
    case 'bye': {
      // signed out: this connection stops speaking for the address, and a last tab leaves the party
      if (!me) return;
      if (!clientsOf(me).some((x) => x !== c)) leaveParty(me);
      c.addr = c.name = undefined;
      broadcast({ t: 'presence', online: online() });
      return;
    }
    case 'party:create': {
      if (!me) return;
      leaveParty(me);
      const p: Party = { id: randomUUID().slice(0, 8), leader: me, members: [{ addr: me, name: c.name, ready: false, leverage: 25 }], mode: 1, entry: 5, chat: [] };
      parties.set(p.id, p);
      pushParty(p);
      return;
    }
    case 'party:invite': {
      const p = me ? partyOf(me) : undefined;
      if (!p) return;
      for (const t of clientsOf(String(msg.to).toLowerCase())) send(t, { t: 'invite', partyId: p.id, from: me, fromName: c.name });
      return;
    }
    case 'party:join': {
      const p = parties.get(msg.partyId);
      if (me && p?.members.some((m) => m.addr === me)) return pushParty(p);
      if (!me || !p || p.members.length >= 3) return send(c, { t: 'toast', text: 'Party is full or gone' });
      leaveParty(me);
      p.members.push({ addr: me, name: c.name, ready: false, leverage: 25 });
      p.chat.push({ from: 'system', text: `${c.name ?? me.slice(0, 6)} joined the party`, at: Date.now() });
      pushParty(p);
      return;
    }
    case 'watch':
      // the player is on their match screen (lobby guard: bot fill + abandonment)
      if (me && Number.isInteger(msg.matchId)) heartbeat(Number(msg.matchId), me);
      return;
    case 'party:leave':
      if (me) leaveParty(me);
      return;
    case 'party:kick': {
      // leader only; the kicked player is told why instead of silently losing the party
      const p = me ? partyOf(me) : undefined;
      const who = String(msg.addr ?? '').toLowerCase();
      if (!p || p.leader !== me || who === me) return;
      const m = p.members.find((x) => x.addr === who);
      if (!m) return;
      leaveParty(who);
      for (const t of clientsOf(who)) send(t, { t: 'toast', text: 'The party leader removed you from the party' });
      p.chat.push({ from: 'system', text: `${m.name ?? who.slice(0, 6)} was removed from the party`, at: Date.now() });
      pushParty(p);
      return;
    }
    case 'party:set': {
      const p = me ? partyOf(me) : undefined;
      if (!p || p.leader !== me) return;
      if (msg.mode !== undefined) p.mode = Number(msg.mode);
      if (msg.entry !== undefined) p.entry = Number(msg.entry);
      pushParty(p);
      return;
    }
    case 'party:ready': {
      const p = me ? partyOf(me) : undefined;
      const m = p?.members.find((x) => x.addr === me);
      if (!p || !m) return;
      m.ready = !!msg.ready;
      if (msg.leverage) m.leverage = Number(msg.leverage);
      pushParty(p);
      return;
    }
    case 'party:chat': {
      const p = me ? partyOf(me) : undefined;
      if (!p) return;
      p.chat.push({ from: c.name ?? me!.slice(0, 6), text: String(msg.text).slice(0, 200), at: Date.now() });
      p.chat = p.chat.slice(-50);
      pushParty(p);
      return;
    }
  }
}

export function startApi() {
  const server = createServer((req, res) => void handle(req, res));
  const wss = new WebSocketServer({ server, path: '/ws', verifyClient: ({ req }: { req: IncomingMessage }) => gateAllows(req) });
  wss.on('connection', (ws) => {
    const c: Client = { ws };
    clients.add(c);
    send(c, { t: 'presence', online: online() });
    ws.on('message', (raw) => {
      try {
        onMessage(c, JSON.parse(String(raw)));
      } catch {}
    });
    ws.on('close', () => {
      clients.delete(c);
      broadcast({ t: 'presence', online: online() });
    });
  });
  onChainEvent((e) => {
    broadcast({ t: 'chain', e });
    // a party leader took their seat: the members follow
    if (e.name === 'PlayerJoined') for (const f of followersOf(e.matchId, String(e.args.player).toLowerCase())) follow(f.addr, e.matchId, f.team);
  });
  onTick((market, tick) => broadcast({ t: 'tick', market, tick }));
  server.listen(env.port, env.host ?? '::', () => log('api', `http://${env.host ?? 'localhost'}:${env.port}  ws://${env.host ?? 'localhost'}:${env.port}/ws`));
  return server;
}
