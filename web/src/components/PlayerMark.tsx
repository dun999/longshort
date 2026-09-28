import { useMemo } from 'react';
import { sigil } from '@/lib/sigil';

/** A player's address sigil (see lib/sigil). `color` overrides the main tone (e.g. class or team colour). */
export function PlayerMark({ addr, size = 32, color, className = '' }: { addr: string; size?: number; color?: string; className?: string }) {
  const { cells, fg, alt } = useMemo(() => sigil(addr), [addr]);
  return (
    <svg viewBox="0 0 7 7" width={size} height={size} shapeRendering="crispEdges" className={`shrink-0 ${className}`} aria-hidden>
      <rect width="7" height="7" fill="#15171c" />
      {cells.map(([x, y, two]) => (
        <rect key={`${x}${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={two ? alt : (color ?? fg)} />
      ))}
    </svg>
  );
}
