'use client';
import { CLASSES, classOf } from '@longshort/shared';
import { useScene, type Shot, type Slot } from '@/lib/scene';
import { PlayerMark } from './PlayerMark';

/*
 * The arena without WebGL: the same scene state the 3D Stage renders (shot + slots), drawn as each
 * player's sigil hovering as a hologram over a glowing pedestal, over a CSS arena. Mounted by Stage
 * when a WebGL context can't be created (GPU blocklist, context loss), so every game screen still has
 * its line-up. Teams face each other; free-for-all lines up with "me" in the middle; leaders pulse,
 * eliminated players fade to grey.
 */

interface Place {
  x: number; // % from the left (centre)
  y: number; // % from the bottom (pedestal)
  s: number; // scale
  z: number;
}

function layout(slots: Slot[]): Place[] {
  const teams = slots.some((s) => s.team === 1);
  if (teams) {
    const idx = [0, 0];
    return slots.map((s) => {
      const t = s.team ?? 0;
      const i = idx[t]++;
      const side = t === 0 ? -1 : 1;
      return { x: 50 + side * (14 + i * 11), y: 13 + i * 5, s: 1 - i * 0.14, z: 10 - i };
    });
  }
  const n = slots.length;
  const gap = Math.min(17, 84 / Math.max(1, n));
  const base = n > 5 ? 0.72 : n > 3 ? 0.86 : 1;
  return slots.map((_, i) => {
    const off = i - (n - 1) / 2;
    return { x: 50 + off * gap, y: 13 + Math.abs(off) ** 1.4 * 1.6, s: base * (1 - Math.abs(off) * 0.05), z: 10 - Math.round(Math.abs(off)) };
  });
}

const NAMED: Shot[] = ['lobby', 'select'];

function Figure({ slot, place, i, named }: { slot: Slot; place: Place; i: number; named: boolean }) {
  const cls = slot.leverage ? CLASSES[classOf(slot.leverage)] : null;
  const win = (slot.lead ?? 0) >= 1;
  return (
    <div
      className={`s2-slot ${slot.me ? 'me' : ''} ${slot.out ? 'out' : ''}`}
      style={{ left: `${place.x}%`, bottom: `${place.y}%`, zIndex: place.z, ['--s' as string]: place.s, ['--c' as string]: slot.out ? '#44474f' : slot.color }}
    >
      <div className="s2-pedestal" />
      <div className="s2-beam" />
      {slot.empty ? (
        <div className="s2-empty">
          <span>+</span>
        </div>
      ) : (
        <span className={`s2-fig ${win ? 'on' : ''}`} style={{ ['--d' as string]: `${i * -0.41}s` }}>
          <PlayerMark addr={slot.name ?? `seat-${i}`} size={120} color={slot.color} className="s2-sigil" />
        </span>
      )}
      <div className="nameplate s2-name" style={{ opacity: named ? 1 : 0 }}>
        {slot.empty ? (
          <span>{slot.name ?? 'OPEN SLOT'}</span>
        ) : (
          <>
            <b>{slot.name}</b>
            {cls && (
              <i>
                {cls.name} · {slot.leverage}x
              </i>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function Stage2D() {
  const shot = useScene((s) => s.shot);
  const slots = useScene((s) => s.slots);
  const shakeAt = useScene((s) => s.shakeAt);
  const places = layout(slots);
  const named = NAMED.includes(shot);
  return (
    <div className={`stage2d shot-${shot}`}>
      <div className="s2-sky" />
      <div className="s2-sign">longshort</div>
      <div className="s2-floor" />
      <div className="s2-ring" />
      <div key={shakeAt} className={`s2-cast ${shakeAt ? 'shake' : ''}`}>
        {slots.map((s, i) => (
          <Figure key={i} slot={s} place={places[i]} i={i} named={named} />
        ))}
      </div>
    </div>
  );
}
