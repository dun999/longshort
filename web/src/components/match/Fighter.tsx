'use client';
import { useEffect, useRef, useState } from 'react';
import type { CharacterId } from '@longshort/shared';
import RESULT from '@/assets/cast/result.json';
import { asset } from '@/lib/asset';

/**
 * A player's character on a result card: the victory dance, the defeat, or standing at rest, as transparent
 * animated WebPs rendered from the arena models (web/art/cast/stills.cjs --result). Every image shares one
 * scale, so the pigeon stays pigeon-sized next to the gladiator; the feet land on the stage's floor line at its
 * centre whatever the crop. The stage sets the size through --k (CSS px per image px, see .fighter).
 * Reduced motion gets a still of the same pose.
 */
export type FighterPose = 'cheer' | 'sulk' | 'idle';

export function Fighter({ id, pose, flip }: { id: CharacterId; pose: FighterPose; flip?: boolean }) {
  const r = RESULT[id];
  const src = asset(`/cast/result/${id}-${pose}.webp`);
  // fades in once decoded (a pose change swaps the image, so readiness is per source)
  const [loaded, setLoaded] = useState<string>();
  const ready = loaded === src;
  // an image that finished before hydration never fires onLoad
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth) setLoaded(src);
  }, [src]);
  return (
    <picture
      className={`fighter ${flip ? 'flip' : ''} ${ready ? 'ready' : ''}`}
      style={{ ['--w' as string]: r.w, ['--h' as string]: r.h, ['--fx' as string]: flip ? 1 - r.x : r.x, ['--fy' as string]: r.y }}
    >
      {pose !== 'idle' && <source srcSet={asset(`/cast/result/${id}-${pose}-still.webp`)} media="(prefers-reduced-motion: reduce)" />}
      <img
        key={src}
        ref={img}
        src={src}
        alt=""
        width={r.w}
        height={r.h}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(src)}
      />
    </picture>
  );
}
