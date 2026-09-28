// Game constants + math. Mirrors ArenaCore.sol exactly so the HUD shows what the contract will settle.

export const MARKETS = ['BTC', 'ETH', 'MON'] as const;
export type MarketSymbol = (typeof MARKETS)[number];
export const PERPL_IDS: Record<MarketSymbol, bigint> = { BTC: 16n, ETH: 32n, MON: 64n };

export enum Mode {
  DUEL = 0,
  SQUAD = 1,
  ROYALE = 2,
}
export enum MatchState {
  OPEN = 0,
  LIVE = 1,
  SETTLED = 2,
  CANCELLED = 3,
}

export const MARGIN = 1000; // virtual USD per player
export const MAINT = 0.1; // liquidated at 10% of starting margin
export const FEE_BPS = 1;
export const RAKE_BPS = 250;
export const COUNTDOWN = 5;

export type ClassId = 'tank' | 'scout' | 'sniper';
export const CLASSES: Record<ClassId, { name: string; leverage: 10 | 25 | 50; role: string; blurb: string }> = {
  tank: { name: 'Tank', leverage: 10, role: 'Low risk', blurb: 'Survives a ~9% move against you. Slow and steady.' },
  scout: { name: 'Scout', leverage: 25, role: 'Balanced', blurb: 'Liquidated on a ~3.6% adverse move.' },
  sniper: { name: 'Sniper', leverage: 50, role: 'High risk', blurb: 'One-shot potential. Liquidated on a ~1.8% adverse move.' },
};
export const classOf = (lev: number): ClassId => (lev >= 50 ? 'sniper' : lev >= 25 ? 'scout' : 'tank');

export const MODES: Record<
  Mode,
  { key: string; name: string; tagline: string; maxPlayers: number; duration: number; teams: boolean }
> = {
  [Mode.DUEL]: { key: 'duel', name: 'Duel', tagline: '1v1 · 60s · winner takes pot', maxPlayers: 2, duration: 60, teams: true },
  [Mode.SQUAD]: { key: 'squad', name: 'Squad', tagline: '3v3 · 120s · team PnL wins', maxPlayers: 6, duration: 120, teams: true },
  [Mode.ROYALE]: { key: 'royale', name: 'Royale', tagline: '8 FFA · 180s · lowest cut every round', maxPlayers: 8, duration: 180, teams: false },
};
export const ENTRY_TIERS = [5, 20, 50] as const;
export const STAKE_DECIMALS = 6;

export interface Pos {
  market: number;
  isLong: boolean;
  notional: number; // USD
  entryPx: number;
}

export const upnl = (p: Pos, px: number) => ((px - p.entryPx) * p.notional * (p.isLong ? 1 : -1)) / p.entryPx;

export const equityOf = (realized: number, pos: Pos | null, px?: number) =>
  Math.max(0, MARGIN + realized + (pos && px ? upnl(pos, px) : 0));

/** Price at which equity hits the maintenance floor. */
export function liqPrice(realized: number, pos: Pos) {
  const cushion = MARGIN + realized - MARGIN * MAINT; // USD lost before liquidation
  const move = (cushion / pos.notional) * pos.entryPx;
  return pos.isLong ? pos.entryPx - move : pos.entryPx + move;
}

export const notionalFor = (equity: number, leverage: number, sizeBps: number) => (equity * leverage * sizeBps) / 10_000;
export const feeFor = (notional: number) => (notional * FEE_BPS) / 10_000;

export function payouts(mode: Mode, entry: number, players: number) {
  const pot = entry * players;
  const prize = pot * (1 - RAKE_BPS / 10_000);
  if (mode === Mode.DUEL) return { pot, first: prize };
  if (mode === Mode.SQUAD) return { pot, first: prize / (players / 2) };
  return { pot, first: prize * 0.6, second: prize * 0.3, third: prize * 0.1 };
}

/** Royale: number of eliminations and round length, as in ArenaCore.eliminate. */
export function royaleRounds(maxPlayers: number, duration: number) {
  const rounds = Math.max(0, maxPlayers - 3);
  return { rounds, roundLen: Math.floor(duration / (rounds + 1)) };
}

// XP / level (ported from legacy lib/game.ts)
export const XP = { win: 50, loss: -20, floor: 1000, start: 1000, daily: 10 };
export const level = (xp: number) => Math.max(1, Math.floor((xp - XP.start) / 100) + 1);
export const levelProgress = (xp: number) => ((xp - XP.start) % 100) / 100;

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export function fmtPx(px: number) {
  if (px >= 1000) return px.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  if (px >= 1) return px.toFixed(2);
  return px.toFixed(5);
}
export const fmtUsd = (n: number, sign = false) =>
  `${sign && n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
