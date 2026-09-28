'use client';
import Link from 'next/link';
import { sfx } from '@/lib/sfx';

/** The wordmark. Its own module: the gate page shows it without loading the app around it. */
export function Logo() {
  return (
    <Link href="/" className="font-display flex items-center gap-2 text-lg font-bold tracking-[0.12em] uppercase" onMouseEnter={sfx.hover}>
      <span className="relative grid h-8 w-8 place-items-center" style={{ clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)', background: 'var(--accent)' }}>
        <span className="h-3 w-3 bg-[var(--bg)]" style={{ clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)' }} />
      </span>
      <span>
        long<span className="text-violet">short</span>
        <span className="text-dim">.fun</span>
      </span>
    </Link>
  );
}
