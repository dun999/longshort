import { LEVERAGES, MODES, Mode, isCharacter } from '@longshort/shared';

/**
 * A shareable result. Ranked results are looked up from the keeper by match id + address, so a link
 * can't claim a result that didn't happen: /s/1234-a1b2c3d4. Practice has no server record, so the
 * card rides in the link itself (/s/p…) and is always labelled practice.
 */
export interface CardData {
  outcome: 'win' | 'loss' | 'draw' | 'over';
  roi: number; // % on the starting margin
  equity: number;
  payout: number; // stake won (0 in practice)
  name: string;
  addr: string;
  leverage: number;
  character?: string;
  mode: Mode;
  rival?: string; // duel only
  place?: number;
  of?: number;
  award?: string;
  practice: boolean;
  id?: number;
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export const rankedCode = (id: number, addr: string) => `${id}-${addr.toLowerCase().replace(/^0x/, '').slice(0, 8)}`;

export function practiceCode(c: CardData) {
  const j = { o: c.outcome, r: +c.roi.toFixed(2), e: +c.equity.toFixed(2), n: c.name, a: c.addr, l: c.leverage, c: c.character, m: c.mode, v: c.rival, w: c.award };
  return `p${b64(JSON.stringify(j))}`;
}

export type ParsedCode = { kind: 'ranked'; id: number; prefix: string } | { kind: 'practice'; card: CardData };

const OUTCOMES = ['win', 'loss', 'draw', 'over'] as const;
const str = (v: unknown, max = 24) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, max) : undefined);
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

/** Decodes a share code. Practice fields are clamped: the link is user-controlled. */
export function parseCode(code: string): ParsedCode | null {
  const ranked = /^(\d{1,9})-([0-9a-f]{8})$/.exec(code);
  if (ranked) return { kind: 'ranked', id: Number(ranked[1]), prefix: ranked[2] };
  if (!code.startsWith('p') || code.length > 600) return null;
  try {
    const j = JSON.parse(unb64(code.slice(1)));
    const mode = [Mode.DUEL, Mode.SQUAD, Mode.ROYALE].includes(j.m) ? (j.m as Mode) : Mode.DUEL;
    return {
      kind: 'practice',
      card: {
        outcome: OUTCOMES.includes(j.o) ? j.o : 'over',
        roi: num(j.r, -100, 1000),
        equity: num(j.e, 0, 11_000),
        payout: 0,
        name: str(j.n) || 'Player',
        addr: str(j.a, 42) || '0x',
        leverage: (LEVERAGES as readonly number[]).includes(j.l) ? j.l : LEVERAGES[0],
        character: isCharacter(j.c) ? j.c : undefined,
        mode,
        rival: str(j.v),
        award: str(j.w),
        practice: true,
      },
    };
  } catch {
    return null;
  }
}

export const signedPct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;
export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const WHAT: Record<Mode, string> = { [Mode.DUEL]: '1v1 perp duel', [Mode.SQUAD]: '2v2 perp squad match', [Mode.ROYALE]: '8-player perp royale' };

/** The post text. `self` is the sharer's own result (first person); otherwise it reads as a report. */
export function shareText(c: CardData, self = true) {
  const roi = signedPct(c.roi);
  const what = WHAT[c.mode];
  const secs = MODES[c.mode].duration;
  if (c.practice) return `Practice round on longshort.fun: ${roi} vs the sparring bot in ${secs}s. Your turn.`;
  const who = self ? '' : `${c.name}: `;
  if (c.mode === Mode.ROYALE && c.place && c.of) return `${who}${ordinal(c.place)} of ${c.of} in an ${what} on longshort.fun, ${roi}.${self ? ' Come take my spot.' : ''}`;
  if (c.outcome === 'win') return self ? `Won a ${what} on longshort.fun: ${roi} in ${secs}s. Think you can beat me?` : `${c.name} won a ${what} on longshort.fun: ${roi} in ${secs}s.`;
  if (c.outcome === 'draw') return `${who}Dead heat in a ${what} on longshort.fun.${self ? ' Settle it with me?' : ''}`;
  if (c.outcome === 'loss') return self ? `${roi} in a ${what} on longshort.fun. I want a rematch.` : `${c.name}: ${roi} in a ${what} on longshort.fun.`;
  return `${who}${roi} in a ${what} on longshort.fun.`;
}

export const OUTCOME_WORD: Record<CardData['outcome'], string> = { win: 'Victory', loss: 'Defeat', draw: 'Draw', over: 'Match over' };
