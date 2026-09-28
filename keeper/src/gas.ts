import { formatEther, parseEther, zeroAddress, type Address } from 'viem';
import { keeper, log, pub, send } from './chain';
import { db } from './db';
import { env } from './env';
import { isBot } from './bots';
import { onChainEvent } from './indexer';

/*
 * Gas station: the arena pays players' network fees, so nobody needs MON to play.
 * Each human's trading address (their per-match session key, or their own address when they have
 * none, e.g. guests) is topped up to TARGET when they join and whenever it drops under LOW while
 * their match is open or live. Every (match, address) is capped, and the keeper keeps RESERVE
 * for itself so settlement and liquidations are never starved.
 */
const TARGET = parseEther(env.gasTarget);
const LOW = parseEther(env.gasLow);
const CAP = parseEther(env.gasCapPerMatch);
const RESERVE = parseEther(env.gasReserve);

const given = new Map<string, bigint>();
const pending = new Set<string>();
let warned = 0;

const tradingAddr = (player: string, session: string) => (session && session !== zeroAddress ? session : player) as Address;

async function topUp(matchId: number, addr: Address, why: 'join' | 'low') {
  const key = `${matchId}:${addr.toLowerCase()}`;
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const bal = await pub.getBalance({ address: addr });
    if (bal >= (why === 'join' ? TARGET : LOW)) return;
    const sent = given.get(key) ?? 0n;
    let amt = TARGET - bal;
    if (sent + amt > CAP) amt = CAP - sent;
    if (amt <= 0n) return;
    const mine = await pub.getBalance({ address: keeper.account.address });
    if (mine - amt < RESERVE) {
      if (Date.now() - warned > 60_000) log('gas', `keeper below reserve (${formatEther(mine)} MON): subsidy paused, top up ${keeper.account.address}`);
      warned = Date.now();
      return;
    }
    const hash = await send('gas', () => keeper.sendTransaction({ to: addr, value: amt, gas: 21_000n }));
    if (hash) {
      given.set(key, sent + amt);
      log('gas', `${why} #${matchId} ${addr.slice(0, 10)} +${formatEther(amt)} MON`);
    }
  } catch (e) {
    log('gas', 'top-up failed', (e as Error).message.slice(0, 120));
  } finally {
    pending.delete(key);
  }
}

export function startGasStation() {
  onChainEvent((e) => {
    if (e.name !== 'PlayerJoined') return;
    const player = String(e.args.player);
    if (isBot(player)) return;
    void topUp(e.matchId, tradingAddr(player, String(e.args.session ?? '')), 'join');
  });
  const humans = db.prepare(
    `SELECT p.match_id AS id, p.addr, p.session FROM players p JOIN matches m ON m.id = p.match_id
     WHERE m.state IN (0, 1) AND p.addr NOT IN (SELECT addr FROM profiles WHERE bot = 1)`,
  );
  const loop = async () => {
    try {
      for (const h of humans.all() as { id: number; addr: string; session: string }[]) {
        if (!isBot(h.addr)) await topUp(h.id, tradingAddr(h.addr, h.session), 'low');
      }
    } catch (e) {
      log('gas', 'loop error', (e as Error).message.slice(0, 120));
    }
    setTimeout(loop, 4000);
  };
  void loop();
  log('gas', `station on: target ${env.gasTarget}, low ${env.gasLow}, cap ${env.gasCapPerMatch}/match, reserve ${env.gasReserve} MON`);
}
