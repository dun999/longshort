import { maxUint256, nonceManager, parseEther, parseUnits, type PrivateKeyAccount } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { ADDR, REAL_TRADING, TRADING_BUDGET, MARKETS, MODES, Mode, erc20Abi } from '@longshort/shared';
import { GAS, arena, chainNow, estimateGas, keeper, log, pub, send, walletFor } from './chain';
import { db, ensureProfile } from './db';
import { env } from './env';
import { history } from './prices';
import { holdFill } from './lobby';
import { lobbyOptions, roster } from './matchmaking';
import { heldSeats } from './queue';

const NAMES = ['Vega', 'Nyx', 'Orca', 'Kestrel', 'Onyx', 'Rook', 'Viper', 'Echo', 'Jinx', 'Talon', 'Mako', 'Zephyr', 'Cinder', 'Pike', 'Wraith', 'Lux', 'Nova', 'Hex', 'Blitz', 'Quill', 'Rune', 'Sable', 'Tempo', 'Volt'];
const STRATS = ['momentum', 'meanrev', 'degen'] as const;
type Strat = (typeof STRATS)[number];

interface Bot {
  name: string;
  account: PrivateKeyAccount;
  wallet: ReturnType<typeof walletFor>;
  strat: Strat;
}
export const bots: Bot[] = [];
const botSet = new Set<string>();
export const isBot = (a: string) => botSet.has(a.toLowerCase());

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

async function fund(b: Bot) {
  const addr = b.account.address;
  const [mon, usd, allowance] = await Promise.all([
    pub.getBalance({ address: addr }),
    pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [addr] }),
    pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'allowance', args: [addr, ADDR.arena] }),
  ]);
  if (mon < parseEther(env.botFundMon) / 2n) {
    await send('fund', () => keeper.sendTransaction({ to: addr, value: parseEther(env.botFundMon), gas: 21_000n }));
  }
  const want = parseUnits(env.botFundStake, 6);
  if (usd < (REAL_TRADING ? parseUnits(String(TRADING_BUDGET+50),6) : want / 5n)) {
    // real tokens (AUSD) can't be minted: bots are paid from the keeper's own balance
    const have = await pub.readContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'balanceOf', args: [keeper.account.address] });
    if (have >= want) {
      const estimate=await pub.estimateContractGas({address:ADDR.stake,abi:erc20Abi,functionName:'transfer',args:[addr,want],account:keeper.account.address});
      const hash=await send('fund', () => keeper.writeContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'transfer', args: [addr, want], gas: estimate*120n/100n }));
      if(hash) await pub.waitForTransactionReceipt({hash});
    }
    else log('fund', `keeper holds too little ${ADDR.stakeSymbol ?? 'stake'} to fund ${b.name}; send some to ${keeper.account.address}`);
  }
  if (allowance < parseUnits('1000000', 6)) {
    await new Promise((r) => setTimeout(r, 1500)); // let the MON top-up land first
    await send(b.name, () =>
      b.wallet.writeContract({ address: ADDR.stake, abi: erc20Abi, functionName: 'approve', args: [ADDR.arena, maxUint256], gas: GAS.approve }),
    );
  }
}

/** Bots currently seated in an OPEN or LIVE match. */
function busyBots() {
  const rows = db.prepare('SELECT p.addr FROM players p JOIN matches m ON m.id = p.match_id WHERE m.state IN (0, 1, 4)').all() as { addr: string }[];
  return new Set(rows.map((r) => r.addr));
}
// Seats claimed by txs the indexer hasn't seen yet (expire after a few seconds).
const pendingBot = new Map<string, number>();
const pendingSeats = new Map<number, { n: number; until: number }>();
const freeBots = () => {
  const busy = busyBots();
  const t = Date.now();
  return bots.filter((b) => !busy.has(b.account.address.toLowerCase()) && (pendingBot.get(b.name) ?? 0) < t);
};
const claim = (b: Bot, matchId?: number) => {
  pendingBot.set(b.name, Date.now() + 6000);
  if (matchId === undefined) return;
  const cur = pendingSeats.get(matchId);
  const n = cur && cur.until > Date.now() ? cur.n + 1 : 1;
  pendingSeats.set(matchId, { n, until: Date.now() + 6000 });
};
const LEVS = REAL_TRADING ? [5] as const : [10, 25, 50] as const;
const RESERVE = 6; // bots kept free so a human never waits on a full fleet

export async function fillLobbies(now: number) {
  const open = db.prepare('SELECT id, mode, max_players, created_at FROM matches WHERE state = 0 AND created_at <= ?').all(now - env.botFillAfter) as {
    id: number; mode: number; max_players: number; created_at: number;
  }[];
  // Human lobbies first; bot-only ambient lobbies only while a reserve stays free for humans.
  const hasHuman = (id: number) =>
    (db.prepare('SELECT COUNT(*) c FROM players WHERE match_id = ?').all(id) as { c: number }[])[0].c >
    (db.prepare('SELECT COUNT(*) c FROM players p JOIN profiles f ON f.addr = p.addr WHERE p.match_id = ? AND f.bot = 1').all(id) as { c: number }[])[0].c;
  const ranked = open.map((m) => ({ ...m, human: hasHuman(m.id) })).sort((a, b) => Number(b.human) - Number(a.human));
  for (const m of ranked) {
    if (!m.human && freeBots().length - m.max_players < RESERVE) continue;
    if (m.human && holdFill(m.id)) continue; // a cancel is pending, or a player isn't on the match screen
    const source = lobbyOptions(m.id)?.rematch_of;
    if (source) {
      const previous = roster(source);
      const present = roster(m.id);
      // Wait for every human to accept; only the original bots can take the other seats.
      if (previous.some((p) => !p.bot && !present.some((s) => s.addr === p.addr && s.team === p.team))) continue;
      for (const p of previous.filter((p) => p.bot && !present.some((s) => s.addr === p.addr))) {
        if (holdFill(m.id)) break;
        const b = freeBots().find((b) => b.account.address.toLowerCase() === p.addr);
        if (!b) continue;
        const args = [BigInt(m.id), p.team, p.leverage, '0x0000000000000000000000000000000000000000'] as const;
        if(REAL_TRADING) await fund(b);
        const ok = await pub.simulateContract({ ...arena, functionName: 'joinMatch', args, account: b.account }).then(() => true, () => false);
        if (!ok) continue;
        const gas = await estimateGas('joinMatch', { ...arena, functionName: 'joinMatch', args, account: b.account });
        claim(b, m.id);
        await send(b.name, () => b.wallet.writeContract({ ...arena, functionName: 'joinMatch', args, gas }));
      }
      continue;
    }
    const seated = db.prepare('SELECT addr, team FROM players WHERE match_id = ?').all(m.id) as { addr: string; team: number }[];
    const free = freeBots();
    const pend = pendingSeats.get(m.id);
    // seats held for players the matchmaker already sent here count as taken
    const teamCount = heldSeats(m.id, new Set(seated.map((s) => s.addr)));
    let slots = m.max_players - seated.length - teamCount[0] - teamCount[1] - (pend && pend.until > Date.now() ? pend.n : 0);
    for (const s of seated) teamCount[s.team]++;
    const teamSize = m.mode === Mode.ROYALE ? 99 : m.max_players / 2;
    while (slots-- > 0 && free.length) {
      if (m.human && holdFill(m.id)) break;
      const b = free.shift()!;
      const team = m.mode === Mode.ROYALE ? 0 : teamCount[1] < teamSize ? 1 : 0; // bots fill the away side first
      teamCount[team]++;
      claim(b, m.id);
      const args = [BigInt(m.id), team, pick(LEVS), '0x0000000000000000000000000000000000000000'] as const;
      if(REAL_TRADING) await fund(b);
      const ok = await pub.simulateContract({ ...arena, functionName: 'joinMatch', args, account: b.account }).then(() => true, () => false);
      if (!ok) continue;
      const gas = await estimateGas('joinMatch', { ...arena, functionName: 'joinMatch', args, account: b.account });
      const hash = await send(b.name, () => b.wallet.writeContract({ ...arena, functionName: 'joinMatch', args, gas }));
      if (hash) log('bots', `${b.name} → #${m.id} (team ${team})`);
    }
  }
}

let lastAmbient = 0;
async function ambient(now: number) {
  if (REAL_TRADING) return;
  if (!env.ambientEvery || now - lastAmbient < env.ambientEvery) return; // 0 = bots only fill human lobbies
  const openCount = (db.prepare('SELECT COUNT(*) c FROM matches WHERE state = 0').get() as { c: number }).c;
  const liveCount = (db.prepare('SELECT COUNT(*) c FROM matches WHERE state = 1').get() as { c: number }).c;
  if (openCount > 0 || liveCount >= 3) return;
  const free = freeBots();
  if (free.length < 8 + RESERVE) return;
  lastAmbient = now;
  const roll = Math.random();
  const mode = roll < 0.55 ? Mode.DUEL : roll < 0.8 ? Mode.ROYALE : Mode.SQUAD;
  const cfg = MODES[mode];
  const b = free[0];
  claim(b);
  await send(b.name, () =>
    b.wallet.writeContract({
      ...arena,
      functionName: 'createMatch',
      args: [mode, parseUnits('5', 6), cfg.duration, cfg.maxPlayers, 0, pick(LEVS), '0x0000000000000000000000000000000000000000'],
      gas: GAS.createMatch,
    }),
  );
  log('bots', `${b.name} opened an ambient ${cfg.name} lobby`);
}

// ─── trading brains ─────────────────────────────────────────────────────────
interface Brain { nextAt: number; market: number; holdUntil: number }
const brains = new Map<string, Brain>();

function direction(strat: Strat, market: number) {
  const h = history[MARKETS[market]];
  if (h.length < 6 || strat === 'degen') return Math.random() < 0.5;
  const now = h.at(-1)!.px;
  const past = h.at(-6)!.px;
  if (now === past) return Math.random() < 0.5;
  const up = now > past;
  return strat === 'momentum' ? up : !up;
}

async function trade(now: number) {
  const live = db.prepare('SELECT id, start_at, end_at FROM matches WHERE state = 1 AND start_at <= ? AND end_at > ?').all(now, now + 2) as {
    id: number; start_at: number; end_at: number;
  }[];
  for (const m of live) {
    const players = await pub.readContract({ ...arena, functionName: 'getPlayers', args: [BigInt(m.id)] });
    for (const p of players) {
      if (!isBot(p.addr) || p.out) continue;
      const b = bots.find((x) => x.account.address.toLowerCase() === p.addr.toLowerCase())!;
      const key = `${m.id}:${p.addr}`;
      let brain = brains.get(key);
      if (!brain) {
        brain = { nextAt: m.start_at + rand(1, 6), market: REAL_TRADING ? 0 : Math.floor(Math.random() * 3), holdUntil: 0 };
        brains.set(key, brain);
      }
      if (now < brain.nextAt) continue;
      brain.nextAt = now + rand(3, 9);
      if (p.hasPos && now < brain.holdUntil) continue;
      if (p.hasPos && Math.random() < 0.45) {
        const gas = await estimateGas('close', { ...arena, functionName: 'close', args: [BigInt(m.id)], account: b.account }, !REAL_TRADING);
        await send(b.name, () => b.wallet.writeContract({ ...arena, functionName: 'close', args: [BigInt(m.id)], gas }));
        continue;
      }
      if (!REAL_TRADING && Math.random() < 0.25) brain.market = Math.floor(Math.random() * 3);
      const size = b.strat === 'degen' ? 10_000 : pick([2_500, 5_000, 7_500]);
      brain.holdUntil = now + rand(5, 18);
      const args = [BigInt(m.id), brain!.market, direction(b.strat, brain!.market), size] as const;
      const gas = (await estimateGas('open', { ...arena, functionName: 'open', args, account: b.account }, !REAL_TRADING)) + 40_000n;
      await send(b.name, () => b.wallet.writeContract({ ...arena, functionName: 'open', args, gas }));
    }
  }
  if (brains.size > 2000) brains.clear();
}

export async function startBots() {
  for (let i = 0; i < env.botCount; i++) {
    const account = mnemonicToAccount(env.botMnemonic, { addressIndex: i + 1, nonceManager }) as unknown as PrivateKeyAccount;
    const name = `bot·${NAMES[i % NAMES.length]}`;
    const b = { name, account, wallet: walletFor(account), strat: STRATS[i % STRATS.length] };
    bots.push(b);
    botSet.add(account.address.toLowerCase());
    ensureProfile(account.address, true, name);
    db.prepare('UPDATE profiles SET name = ?, bot = 1 WHERE addr = ?').run(name, account.address.toLowerCase());
  }
  for (const b of bots) await fund(b);
  log('bots', `${bots.length} bots funded & approved`);
  const loop = async () => {
    try {
      const now = await chainNow();
      await fillLobbies(now);
      await trade(now);
      await ambient(now);
    } catch (e) {
      log('bots', 'error', (e as Error).message.slice(0, 200));
    }
    setTimeout(loop, 1000);
  };
  void loop();
}
