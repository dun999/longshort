'use client';
/*
 * Notched bento blocks: a large block with one or more corners cut away, and a small chip seated
 * in each cut with an even gap that follows the shape (concave fillets included). The block
 * outline is one SVG path traced from the measured chip sizes, so the gap stays exact at any
 * width, and an optional gold light runs around it.
 *
 * Content can steer clear of the cuts with the CSS vars the block sets: --n-tl-w / --n-tl-h, etc.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';

type Corner = 'tl' | 'tr' | 'br' | 'bl';
type Box = { w: number; h: number };
const CORNERS: Corner[] = ['tl', 'tr', 'br', 'bl'];
const GAP = 10;
const R = 3; // near-square: matches the angular panels everywhere else

/** Orthogonal outline, clockwise, with each corner notched to fit its chip. */
function outline(w: number, h: number, n: Partial<Record<Corner, Box>>): [number, number][] {
  const pts: [number, number][] = [];
  const { tl, tr, br, bl } = n;
  if (tl) pts.push([0, tl.h], [tl.w, tl.h], [tl.w, 0]);
  else pts.push([0, 0]);
  if (tr) pts.push([w - tr.w, 0], [w - tr.w, tr.h], [w, tr.h]);
  else pts.push([w, 0]);
  if (br) pts.push([w, h - br.h], [w - br.w, h - br.h], [w - br.w, h]);
  else pts.push([w, h]);
  if (bl) pts.push([bl.w, h], [bl.w, h - bl.h], [0, h - bl.h]);
  else pts.push([0, h]);
  return pts;
}

/** Rounds every vertex: convex corners bulge out, the notch's inner corner becomes a concave fillet. */
function roundedPath(pts: [number, number][], r: number) {
  const n = pts.length;
  const seg: string[] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i + n - 1) % n];
    const [vx, vy] = pts[i];
    const [nx, ny] = pts[(i + 1) % n];
    const lp = Math.hypot(px - vx, py - vy);
    const ln = Math.hypot(nx - vx, ny - vy);
    const rr = Math.min(r, lp / 2, ln / 2);
    const a = [vx + ((px - vx) / lp) * rr, vy + ((py - vy) / lp) * rr];
    const b = [vx + ((nx - vx) / ln) * rr, vy + ((ny - vy) / ln) * rr];
    const convex = (vx - px) * (ny - vy) - (vy - py) * (nx - vx) > 0;
    seg.push(`${i ? 'L' : 'M'} ${a[0].toFixed(2)} ${a[1].toFixed(2)}`, `A ${rr} ${rr} 0 0 ${convex ? 1 : 0} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`);
  }
  return seg.join(' ') + ' Z';
}

function useBox<T extends HTMLElement>(): [React.RefObject<T | null>, Box | undefined] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<Box>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

const POS: Record<Corner, string> = { tl: 'top-0 left-0', tr: 'top-0 right-0', br: 'bottom-0 right-0', bl: 'bottom-0 left-0' };

function Seat({ corner, onBox, children }: { corner: Corner; onBox: (c: Corner, b: Box) => void; children: ReactNode }) {
  const [ref, box] = useBox<HTMLDivElement>();
  useLayoutEffect(() => {
    if (box) onBox(corner, box);
  }, [box, corner, onBox]);
  return (
    <motion.div ref={ref} className={`absolute z-20 ${POS[corner]}`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.25 }}>
      {children}
    </motion.div>
  );
}

export function NotchBlock({
  tone,
  chips = {},
  glow = true,
  delay = 0,
  className = '',
  children,
}: {
  tone: 'light' | 'dark';
  chips?: Partial<Record<Corner, ReactNode>>;
  glow?: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const [ref, size] = useBox<HTMLDivElement>();
  const [seats, setSeats] = useState<Partial<Record<Corner, Box>>>({});
  const [onBox] = useState(() => (c: Corner, b: Box) => setSeats((s) => (s[c]?.w === b.w && s[c]?.h === b.h ? s : { ...s, [c]: b })));
  const notches: Partial<Record<Corner, Box>> = {};
  for (const c of CORNERS) if (chips[c] && seats[c]) notches[c] = { w: seats[c]!.w + GAP, h: seats[c]!.h + GAP };
  const d = size ? roundedPath(outline(size.w, size.h, notches), R) : '';
  const vars = Object.fromEntries(CORNERS.flatMap((c) => [[`--n-${c}-w`, `${notches[c]?.w ?? 0}px`], [`--n-${c}-h`, `${notches[c]?.h ?? 0}px`]]));

  return (
    <motion.div
      ref={ref}
      className={`notch notch-${tone} relative ${className}`}
      style={{ ...vars, ['--run-delay' as string]: `${delay * 2}s` }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 20, delay }}
    >
      {d && (
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={size!.w} height={size!.h} aria-hidden>
          <path d={d} className="notch-fill" />
          <path d={d} className="notch-edge" />
          {glow && <path d={d} pathLength={100} className="notch-run" />}
        </svg>
      )}
      {CORNERS.map((c) =>
        chips[c] ? (
          <Seat key={c} corner={c} onBox={onBox}>
            {chips[c]}
          </Seat>
        ) : null,
      )}
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

/** The small piece that sits in a notch. Matches its block's tone, like the reference's hex tags. */
export function NotchChip({ tone, href, title, children, className = '' }: { tone: 'light' | 'dark'; href?: string; title?: string; children: ReactNode; className?: string }) {
  const cls = `notch-chip notch-chip-${tone} inline-flex items-center gap-2 px-4 py-3 text-xs ${className}`;
  return href ? (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" title={title} className={`${cls} hover:brightness-110`}>
      {children}
    </a>
  ) : (
    <div className={cls} title={title}>
      {children}
    </div>
  );
}

/** Rounded outline pill for the tag row under the blocks. */
export function Pill({ on, onClick, children }: { on?: boolean; onClick?: () => void; children: ReactNode }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag onClick={onClick} className={`notch-pill ${on ? 'on' : ''}`}>
      {children}
    </Tag>
  );
}

/** Diagonal arrow for the corner chips (↗ / ↖), drawn so it stays crisp at any size. */
export function CornerArrow({ dir = 'ne', size = 20 }: { dir?: 'ne' | 'nw'; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden style={{ transform: dir === 'nw' ? 'scaleX(-1)' : undefined }}>
      <path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
