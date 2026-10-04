import { MARGIN, MatchState, Mode, shortAddr } from '@longshort/shared';
import { awards, compute } from '@/lib/matchStats';
import { parseCode, type CardData } from '@/lib/shareLink';
import { GATE_COOKIE, gatePassword, gateToken } from '@/lib/gate';

const KEEPER = process.env.KEEPER_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

/** The card behind a share code: ranked results come from the keeper's record, never from the link. */
export async function resolveCard(code: string): Promise<CardData | null> {
  const parsed = parseCode(code);
  if (!parsed) return null;
  if (parsed.kind === 'practice') return parsed.card;
  // no-store: a lookup made a moment before the keeper records the settlement must not stick
  // in private mode the keeper wants the same cookie a signed-in teammate's browser sends
  const pw = gatePassword();
  const headers = pw ? { cookie: `${GATE_COOKIE}=${gateToken(pw)}` } : undefined;
  const res = await fetch(`${KEEPER}/match/${parsed.id}`, { cache: 'no-store', headers }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  if (!data?.match || data.match.state !== MatchState.SETTLED) return null;
  const players: any[] = data.players ?? [];
  const p = players.find((x) => x.addr.toLowerCase().startsWith(`0x${parsed.prefix}`));
  if (!p) return null;
  const mode = data.match.mode as Mode;
  const equity = p.final_equity ?? MARGIN;
  const standings = [...players].sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0) || (b.final_equity ?? 0) - (a.final_equity ?? 0));
  const award = awards(compute(data.match, players, data.trades ?? [])).find((a) => a.who.addr === p.addr)?.k;
  const rival = mode === Mode.DUEL ? players.find((x) => x.addr !== p.addr) : undefined;
  return {
    outcome: p.result === 'win' || p.result === 'loss' || p.result === 'draw' ? p.result : 'over',
    roi: ((equity - MARGIN) / MARGIN) * 100,
    equity,
    payout: p.payout ?? 0,
    name: p.name ?? shortAddr(p.addr),
    addr: p.addr,
    leverage: p.leverage,
    character: p.character ?? undefined,
    mode,
    rival: rival ? (rival.name ?? shortAddr(rival.addr)) : undefined,
    place: standings.indexOf(p) + 1,
    of: players.length,
    award,
    practice: false,
    id: parsed.id,
  };
}
