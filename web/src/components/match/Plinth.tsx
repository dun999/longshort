/**
 * A low-poly stone plinth for the result stage, drawn like the cast: twelve facets, one flat colour per face,
 * shaded by which way the face points (light from the upper left). The winner's has a gold rim and a gold
 * ring on top; the podium's first place stands taller. In a 240-wide box the feet go at (120, TOP).
 */
export const TOP = 28;
const N = 12;
const RX = 100;
const RY = 24;
const BASE = 1.15; // the lower step, wider than the top

type Kind = 'gold' | 'tall' | 'stone';
const SIDE: Record<Kind, number> = { gold: 24, tall: 46, stone: 14 };
const STEP = 15;

/** Total height of a plinth in the 240-wide box. */
export const plinthHeight = (kind: Kind) => TOP + SIDE[kind] + RY * BASE + STEP + 2;

const ring = (cy: number, s: number) =>
  Array.from({ length: N }, (_, i) => {
    const a = ((15 + (360 / N) * i) * Math.PI) / 180;
    return [120 + RX * s * Math.cos(a), cy + RY * s * Math.sin(a)] as const;
  });
const pts = (p: readonly (readonly [number, number])[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
/** 0..1: how much a side facing angle `mid` catches a light from the upper left and front */
const lit = (mid: number) => Math.max(0, -0.55 * Math.cos(mid) + 0.83 * Math.sin(mid));
const stone = (b: number, dark: boolean) => `hsl(248 7% ${(dark ? 10 : 16) + b * (dark ? 12 : 22)}%)`;
const gold = (b: number) => `hsl(41 62% ${24 + b * 36}%)`;

/** Visible side faces between two rings (the front half), split into a gold rim and stone when asked. */
function sides(top: ReturnType<typeof ring>, h: number, rim: number, dark: boolean) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < N; i++) {
    const mid = ((30 + (360 / N) * i) * Math.PI) / 180;
    if (Math.sin(mid) < 0.05) continue;
    const a = top[i];
    const b = top[(i + 1) % N];
    const at = (p: readonly [number, number], dy: number) => [p[0], p[1] + dy] as const;
    const l = lit(mid);
    if (rim) out.push(<polygon key={`r${i}`} points={pts([a, b, at(b, rim), at(a, rim)])} fill={gold(l)} />);
    out.push(<polygon key={`s${i}`} points={pts([at(a, rim), at(b, rim), at(b, h), at(a, h)])} fill={stone(l, dark)} />);
  }
  return out;
}

export function Plinth({ kind, className }: { kind: Kind; className?: string }) {
  const h = SIDE[kind];
  const rich = kind !== 'stone';
  const top = ring(TOP, 1);
  const inner = ring(TOP, rich ? 0.74 : 0.82);
  const stepTop = ring(TOP + h, BASE);
  const H = plinthHeight(kind);
  return (
    <svg viewBox={`0 0 240 ${H.toFixed(1)}`} className={className} aria-hidden>
      {/* lower step: its ledge shows around the top block */}
      <polygon points={pts(stepTop)} fill={stone(0.35, true)} />
      {sides(stepTop, STEP, 0, true)}
      {/* the block */}
      {sides(top, h, rich ? Math.round(h * 0.34) : 0, !rich)}
      <polygon points={pts(top)} fill={rich ? gold(0.95) : stone(0.5, true)} />
      {/* the top as a fan of facets, each a touch lighter or darker */}
      {inner.map((p, i) => (
        <polygon key={i} points={pts([[120, TOP], p, inner[(i + 1) % N]])} fill={rich ? `hsl(248 6% ${34 + ((i * 7) % 5) * 1.6}%)` : `hsl(248 6% ${20 + ((i * 7) % 5) * 1.2}%)`} />
      ))}
    </svg>
  );
}
