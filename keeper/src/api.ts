import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { isAddress, parseEther, parseUnits, verifyMessage } from 'viem';
import { ADDR, REAL_TRADING, erc20Abi, relayLive } from '@longshort/shared';
import { MARKETS, isCharacter } from '@longshort/shared';
import { db, ensureProfile } from './db';
import { env } from './env';
import { GATE_CACHE, gateAccess, gateAllows, gateConfig, gateOrigin, safeNext, watchGateSocket } from './gate';
import { GAS, keeper, log, pub } from './chain';
import { history, onTick } from './prices';
import { onChainEvent } from './indexer';
import { heartbeat, requestCancel } from './lobby';
import { configureLobby, lobbyOptions, releaseRematch, rematchInvites, reserveRematch, roster } from './matchmaking';
import { signedIn, signIn, tokenOwner } from './auth';
import { followersOf, matchmake, opened, pendingFor, release } from './queue';
import { relay } from './relay';
import { ausdClaims } from './faucet';
import { recoverCapital } from './recovery';
import { readMatchKey, saveMatchKey } from './passkeys';
import { JournalError, readJournal, saveJournal } from './journal';

// ─── HTTP ───────────────────────────────────────────────────────────────────
type Handler = (req: IncomingMessage, params: string[], body: any) => unknown | Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp('^' + path.replace(/:\w+/g, '([^/]+)') + '$'), h]);

// profiles.avatar holds the player's character pick (cosmetic, any character at any leverage)
const nameOf = (addr: string) => (db.prepare('SELECT name, bot, avatar FROM profiles WHERE addr = ?').get(addr) as { name: string | null; bot: number; avatar: string | null } | undefined);
function playersOf(matchId: number) {
  return (db.prepare('SELECT * FROM players WHERE match_id = ? ORDER BY rowid').all(matchId) as any[]).map((p) => {
    const n = nameOf(p.addr);
    return { ...p, name: n?.name ?? null, bot: !!n?.bot, character: n?.avatar ?? null };
  });
}

route('GET', '/health', () => ({ ok: true, chainId:ADDR.chainId, arena:ADDR.arena, asset:ADDR.stakeSymbol??'tUSD', realTrading:REAL_TRADING, accountLayer:'mera', recoveryMetadata:1, privateJournal:1,
  gate: { version: 2, required: !gateConfig().bypass, configured: gateConfig().ready } }));
route('GET', '/faucet/:addr', (_r, [addr]) => ausdClaims().status(addr));
// Caddy's forward_auth asks this before serving the Envio GraphQL; handle() has already checked the gate
route('GET', '/gate', (req) => ({ ok: true, expiresAt: gateAccess(req.headers.cookie).expiresAt }));
route('GET', '/gate/page', () => ({ ok: true }));

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
route('POST', '/passkey/match-key', (_r, _p, body) => saveMatchKey(body));
route('GET', '/passkey/match-key/:owner/:session', (_r, [owner, session]) => readMatchKey(owner, session));
route('POST', '/journal/read', (_r, _p, body) => readJournal(body));
route('POST', '/journal/save', (_r, _p, body) => saveJournal(body));
route('POST', '/recover', (_r, _p, body) => recoverCapital(Number(body?.id), signedIn(body)));
route('POST', '/relay', (req, _p, body) => {
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress).split(',')[0].trim();
  return relay(body, ip);
});

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
    live: one('SELECT COUNT(*) FROM matches WHERE state IN (1,4)'),
    trades: one("SELECT COUNT(*) FROM trades WHERE kind = 'open'"),
    txs: one('SELECT COUNT(*) FROM trades') + one('SELECT COUNT(*) FROM players') + one('SELECT COUNT(*) FROM matches WHERE settle_tx IS NOT NULL'),
    volume: one(REAL_TRADING?"SELECT COALESCE(SUM(notional),0) FROM perpl_fills":"SELECT COALESCE(SUM(notional), 0) FROM trades WHERE kind = 'open'"),
    humanVolume: one(REAL_TRADING?"SELECT COALESCE(SUM(t.notional),0) FROM perpl_fills t JOIN profiles p ON p.addr=t.addr WHERE p.bot=0":"SELECT COALESCE(SUM(t.notional), 0) FROM trades t JOIN profiles p ON p.addr = t.addr WHERE t.kind = 'open' AND p.bot = 0"),
    paidOut: one('SELECT COALESCE(SUM(payout),0) FROM players'),
    rake: one('SELECT COALESCE(SUM(rake),0) FROM matches'),
    escrow: one('SELECT COALESCE(SUM(m.entry),0) FROM players p JOIN matches m ON m.id=p.match_id WHERE m.state IN (0,1,4)'),
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
  return { match: { ...m, asset:ADDR.stakeSymbol??'tUSD', trading_budget:ADDR.tradingBudget??0, allow_bots: !!options?.allow_bots, rematch_of: options?.rematch_of }, players: playersOf(Number(id)), trades: db.prepare('SELECT * FROM trades WHERE match_id = ? ORDER BY id').all(Number(id)), accounts:db.prepare('SELECT * FROM trading_accounts WHERE match_id=?').all(Number(id)), fills:db.prepare('SELECT * FROM perpl_fills WHERE match_id=? ORDER BY block,log_index').all(Number(id)), roster: options?.rematch_of ? roster(options.rematch_of) : undefined };
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
  if (REAL_TRADING) return ausdClaims().claim(signedIn(body), ip);
  const now = Date.now();
  // friends often share one network: allow a dozen sign-ups per IP per hour, not one
  const hits = (ipHits.get(ip) ?? []).filter((t) => t > now - 3_600_000);
  if (hits.length >= 12) return { error: 'faucet cooldown — try again later' };
  const [mon, usd] = await Promise.all([
    pub.getBalance({ address: addr }),
    pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [addr] }),
  ]);
  const txs: string[] = [];
  // gas: refill whenever nearly dry (short cooldown), so a player is never stuck unable to join.
  // Off once the relay delegate is live: the sponsor pays, and a drip would just sit on the player.
  if (!relayLive(ADDR.relayDelegate) && mon < parseEther(env.faucetGasLow) && (gasDrip.get(addr) ?? 0) < now - 180_000) {
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
  let bytes = 0;
  for await (const c of req) {
    bytes += Buffer.byteLength(c);
    if (bytes > 32_768) throw new JournalError('Request is too large', 413, 'REQUEST_TOO_LARGE');
    s += c;
  }
  return s ? JSON.parse(s) : undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('cache-control', GATE_CACHE);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return void res.end();
  const path = new URL(req.url!, 'http://x').pathname;
  // Deployment probes may read health directly on loopback; a request through Caddy must authenticate.
  const localHealth = path === '/health' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];
  const access = gateAccess(req.headers.cookie);
  if (!localHealth && !access.allowed) {
    res.setHeader('x-longshort-gate', access.code);
    if (path === '/gate/page' && ['GET', 'HEAD'].includes(req.headers['x-forwarded-method'] as string ?? 'GET')) {
      const next = safeNext(req.headers['x-forwarded-uri'] as string);
      res.statusCode = 307;
      res.setHeader('location', `/gate?next=${encodeURIComponent(next)}`);
      return void res.end();
    }
    res.statusCode = access.status;
    res.setHeader('content-type', 'application/json');
    return void res.end(JSON.stringify({ error: 'Access code required', code: access.code }));
  }
  for (const [method, re, h] of routes) {
    const m = path.match(re);
    if (!m || method !== req.method) continue;
    try {
      const out = await h(req, m.slice(1), req.method === 'POST' ? await readBody(req) : undefined);
      res.setHeader('content-type', 'application/json');
      return void res.end(JSON.stringify(out));
    } catch (e) {
      res.statusCode = e instanceof JournalError ? e.status : 500;
      res.setHeader('content-type', 'application/json');
      return void res.end(JSON.stringify({ error: (e as Error).message, ...(e instanceof JournalError ? { code: e.code } : {}) }));
    }
  }
  res.statusCode = 404;
  res.end('{"error":"not found"}');
}

// ─── WebSocket: presence, parties, live events ─────────────────────────────
interface Client { ws: WebSocket; request: IncomingMessage; addr?: string; name?: string; partyId?: string }
interface Member { addr: string; name?: string; ready: boolean; leverage: number; character?: string }
interface Party { id: string; leader: string; members: Member[]; mode: number; entry: number; chat: { from: string; text: string; at: number }[] }

const clients = new Set<Client>();
const parties = new Map<string, Party>();
const send = (c: Client, msg: object) => {
  if (!gateAllows(c.request)) return c.ws.close(4001, 'Access code required');
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
};
const broadcast = (msg: object) => {
  const s = JSON.stringify(msg);
  for (const c of clients) {
    if (!gateAllows(c.request)) c.ws.close(4001, 'Access code required');
    else if (c.ws.readyState === 1) c.ws.send(s);
  }
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
      const p: Party = { id: randomUUID().slice(0, 8), leader: me, members: [{ addr: me, name: c.name, ready: false, leverage: 25, character: nameOf(me)?.avatar ?? undefined }], mode: 1, entry: 5, chat: [] };
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
      if (!me || !p || p.members.length >= (REAL_TRADING ? 2 : 3)) return send(c, { t: 'toast', text: 'Party is full or gone' });
      leaveParty(me);
      p.members.push({ addr: me, name: c.name, ready: false, leverage: 25, character: nameOf(me)?.avatar ?? undefined });
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
    case 'character': {
      // cosmetic pick, saved on the profile so every view of this player (lobby, arena, share card) shows it
      if (!me || !isCharacter(msg.id)) return;
      ensureProfile(me);
      db.prepare('UPDATE profiles SET avatar = ? WHERE addr = ?').run(msg.id, me);
      const p = partyOf(me);
      const m = p?.members.find((x) => x.addr === me);
      if (p && m) {
        m.character = msg.id;
        pushParty(p);
      }
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
  const wss = new WebSocketServer({ noServer: true, verifyClient: ({ req }, done) => {
    const access = gateAccess(req.headers.cookie);
    const originAllowed = !req.headers.origin || gateConfig().bypass || req.headers.origin === gateOrigin('http://localhost');
    done(access.allowed && originAllowed, access.allowed ? 403 : access.status, 'Access code required');
  } });
  // Only /ws upgrades. Anything else is refused with 403: Caddy's forward_auth copies a client's Upgrade header onto
  // its /gate check, so a GraphQL subscription attempt lands here (ws on its own would answer 400).
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') return void socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, request) => {
    const c: Client = { ws, request };
    watchGateSocket(ws, request);
    clients.add(c);
    send(c, { t: 'presence', online: online() });
    ws.on('message', (raw) => {
      if (!gateAllows(request)) return ws.close(4001, 'Access code required');
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
  const host = env.host ?? '127.0.0.1';
  if (process.env.NODE_ENV === 'production' && !['127.0.0.1', '::1'].includes(host)) throw new Error('Production keeper must listen on loopback behind Caddy');
  server.listen(env.port, host, () => log('api', `http://${host}:${env.port}  ws://${host}:${env.port}/ws`));
  return server;
}
