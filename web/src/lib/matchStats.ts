import { MARGIN, REAL_TRADING, fmtUsd, shortAddr } from '@longshort/shared';

/** Per-player numbers derived from a match's trade rows. Shared by the result screen and the full report. */
export interface Row {
  kind: string;
  addr: string;
  market: number | null;
  is_long: number | null;
  notional: number | null;
  price: number | null;
  pnl: number | null;
  fee: number | null;
  ts: number;
  tx: string;
}

export interface Stats {
  addr: string;
  name: string;
  bot: boolean;
  team: number;
  leverage: number;
  result: string | null;
  payout: number;
  finalEquity: number;
  xp: number;
  opens: number;
  closes: number;
  wins: number;
  longs: number;
  shorts: number;
  volume: number;
  fees: number;
  best: number | null;
  worst: number | null;
  avgHold: number | null;
  longestHold: number;
  markets: Set<number>;
  out: 'liquidated' | 'eliminated' | null;
  curve: { time: number; value: number }[];
}

export function compute(match: any, players: any[], trades: Row[], fills: {addr:string;notional:number;fee:number}[] = []): Stats[] {
  const start = match.start_at ?? trades[0]?.ts ?? 0;
  return players.map((p: any) => {
    const mine = trades.filter((t) => t.addr === p.addr).sort((a, b) => a.ts - b.ts);
    let equity = MARGIN;
    const curve = [{ time: start, value: MARGIN }];
    let openAt: number | null = null;
    const holds: number[] = [];
    const s: Stats = {
      addr: p.addr,
      name: p.name ?? shortAddr(p.addr),
      bot: !!p.bot,
      team: p.team,
      leverage: p.leverage,
      result: p.result,
      payout: p.payout ?? 0,
      finalEquity: p.final_equity ?? MARGIN,
      xp: p.xp_delta ?? 0,
      opens: 0,
      closes: 0,
      wins: 0,
      longs: 0,
      shorts: 0,
      volume: 0,
      fees: 0,
      best: null,
      worst: null,
      avgHold: null,
      longestHold: 0,
      markets: new Set(),
      out: null,
      curve,
    };
    for (const t of mine) {
      if (t.kind === 'open') {
        // an open while holding a position implies the contract closed the old one first (flip)
        if (openAt !== null) holds.push(t.ts - openAt);
        openAt = t.ts;
        s.opens++;
        t.is_long ? s.longs++ : s.shorts++;
        s.volume += t.notional ?? 0;
        s.fees += t.fee ?? 0;
        if (t.market !== null) s.markets.add(t.market);
        equity -= t.fee ?? 0;
      } else if (t.kind === 'close') {
        const net = (t.pnl ?? 0) - (t.fee ?? 0);
        s.closes++;
        if (net > 0) s.wins++;
        s.fees += t.fee ?? 0;
        s.best = s.best === null ? net : Math.max(s.best, net);
        s.worst = s.worst === null ? net : Math.min(s.worst, net);
        equity += net;
        if (openAt !== null) holds.push(t.ts - openAt);
        openAt = null;
      } else if (t.kind === 'liquidated') {
        s.out = 'liquidated';
        equity = REAL_TRADING ? MARGIN + (t.pnl ?? -MARGIN) : 0;
      } else if (t.kind === 'eliminated') {
        s.out = 'eliminated';
      }
      curve.push({ time: t.ts, value: Math.max(0, equity) });
    }
    if (REAL_TRADING && fills.length) {
      const actual = fills.filter((f)=>f.addr===p.addr);
      s.volume = actual.reduce((sum,f)=>sum+f.notional,0);
      s.fees = actual.reduce((sum,f)=>sum+f.fee,0);
    }
    if (match.end_at) curve.push({ time: Math.max(match.end_at, curve.at(-1)!.time), value: s.finalEquity });
    if (holds.length) {
      s.avgHold = holds.reduce((a, b) => a + b, 0) / holds.length;
      s.longestHold = Math.max(...holds);
    }
    return s;
  });
}

export interface Award {
  k: string;
  d: string;
  who: Stats;
  v: string;
}

/** Match awards, most prestigious first. A player can hold several; the result screen shows their first. */
export function awards(stats: Stats[]): Award[] {
  const byBest = [...stats].filter((s) => s.best !== null && s.best > 0).sort((a, b) => (b.best ?? 0) - (a.best ?? 0))[0];
  const byOpens = [...stats].filter((s) => s.opens > 0).sort((a, b) => b.opens - a.opens)[0];
  const byHold = [...stats].sort((a, b) => b.longestHold - a.longestHold)[0];
  const byFees = [...stats].sort((a, b) => b.fees - a.fees)[0];
  return [
    byBest && { k: 'Top gun', d: 'best single trade', who: byBest, v: fmtUsd(byBest.best ?? 0, true) },
    byOpens && { k: 'Most active', d: 'most positions opened', who: byOpens, v: `${byOpens.opens} trades` },
    byHold && byHold.longestHold > 0 && { k: 'Diamond hands', d: 'longest single hold', who: byHold, v: `${Math.round(byHold.longestHold)}s` },
    byFees && byFees.fees > 0 && { k: 'Fee whale', d: 'paid the most fees', who: byFees, v: fmtUsd(byFees.fees) },
  ].filter(Boolean) as Award[];
}
