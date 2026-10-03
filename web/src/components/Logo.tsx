'use client';
import Link from 'next/link';
import { sfx } from '@/lib/sfx';
import { FULL_VIEWBOX, LOGO_COLORS, LOGO_FUN, LOGO_MARK, LOGO_TRANSFORM, LOGO_WORD, MARK_VIEWBOX, NO_DOMAIN_VIEWBOX } from './brandPaths';

const shapes = (list: typeof LOGO_MARK) => list.map((s, i) => <path key={i} fill={LOGO_COLORS[s.tone]} d={s.d} />);

/** The mark on its own, for icon-sized spots. */
export function LogoMark({ className, title = 'longshort.fun' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} role="img" aria-label={title}>
      <g transform={LOGO_TRANSFORM}>{shapes(LOGO_MARK)}</g>
    </svg>
  );
}

/**
 * The wordmark. Its own module: the gate page shows it without loading the app around it. Two crops of the same
 * art, with and without ".fun", so a narrow bar can drop the domain without leaving a gap (see .logo-short).
 */
export function Logo() {
  return (
    <Link href="/" aria-label="longshort.fun home" className="logo flex items-center" onMouseEnter={sfx.hover}>
      <svg viewBox={FULL_VIEWBOX} className="logo-full" aria-hidden>
        <g transform={LOGO_TRANSFORM}>{shapes(LOGO_MARK)}{shapes(LOGO_WORD)}{shapes(LOGO_FUN)}</g>
      </svg>
      <svg viewBox={NO_DOMAIN_VIEWBOX} className="logo-short" aria-hidden>
        <g transform={LOGO_TRANSFORM}>{shapes(LOGO_MARK)}{shapes(LOGO_WORD)}</g>
      </svg>
    </Link>
  );
}
