'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { characterOf } from '@longshort/shared';
import { prefersReducedMotion, type Slot } from '@/lib/scene';
import { FOOT_H, useCast, type CastClip } from './cast';

/*
 * The characters on stage, one per player (keyed by who they are, not by seat). In the lobby and search shots
 * a newcomer rises out of the floor on their foothold, like a lift from under the stage, and a player who
 * leaves sinks back down; seats that move (someone joined) glide to their new place. Elsewhere, and with
 * reduced motion, figures simply appear and disappear.
 */

export interface Seat {
  pos: [number, number, number];
  rot: number;
  scale: number;
}
const DEPTH = 2.8; // how far under the floor a rise starts (m, before the seat's scale)

const keyOf = (s: Slot, i: number) => s.id ?? s.name ?? `seat-${i}`;
type Entry = { slot: Slot; seat: Seat; rise: boolean; leaving: boolean };

export function CastLayer({ slots, seats, animate }: { slots: Slot[]; seats: Seat[]; animate: boolean }) {
  const [cast, setCast] = useState<Map<string, Entry>>(new Map());
  const animRef = useRef(animate);
  animRef.current = animate && !prefersReducedMotion();
  useEffect(() => {
    setCast((prev) => {
      const next = new Map<string, Entry>();
      slots.forEach((slot, i) => {
        if (slot.empty || !seats[i]) return;
        const k = keyOf(slot, i);
        const was = prev.get(k);
        next.set(k, { slot, seat: seats[i], rise: was ? was.rise && !was.leaving : animRef.current, leaving: false });
      });
      // players who left sink away (if the shot shows it); otherwise they are simply gone
      if (animRef.current) for (const [k, w] of prev) if (!next.has(k)) next.set(k, { ...w, leaving: true });
      return next;
    });
  }, [slots, seats]);
  const gone = (k: string) =>
    setCast((prev) => {
      if (!prev.get(k)?.leaving) return prev;
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
  return (
    <group>
      {[...cast.entries()].map(([k, w]) => (
        <Suspense key={k} fallback={null}>
          <Figure slot={w.slot} seat={w.seat} rise={w.rise} leaving={w.leaving} onGone={() => gone(k)} />
        </Suspense>
      ))}
    </group>
  );
}

function Figure({ slot, seat, rise, leaving, onGone }: { slot: Slot; seat: Seat; rise: boolean; leaving: boolean; onGone: () => void }) {
  const id = slot.character ?? characterOf(slot.name);
  const color = slot.out ? '#44474f' : slot.color;
  const clip: CastClip = slot.out ? 'sulk' : (slot.lead ?? 0) >= 1 ? 'cheer' : 'idle';
  const scene = useCast(id, color, clip);
  const group = useRef<THREE.Group>(null);
  const at = useRef<THREE.Vector3 | null>(null);
  const lift = useRef(rise ? -DEPTH : 0);
  const done = useRef(false);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // the seat glides to its place; snap on the first frame
    const k = at.current ? 1 - Math.exp(-dt * 4) : 1;
    at.current ??= new THREE.Vector3(...seat.pos);
    at.current.lerp(new THREE.Vector3(...seat.pos), k);
    g.rotation.y += (seat.rot - g.rotation.y) * k;
    g.scale.setScalar(g.scale.x + (seat.scale - g.scale.x) * k);
    // rise from under the floor (the floor hides the part still below it), or sink when leaving
    lift.current = THREE.MathUtils.damp(lift.current, leaving ? -DEPTH : 0, leaving ? 4 : 3.2, dt);
    g.position.set(at.current.x, at.current.y + lift.current * seat.scale, at.current.z);
    if (leaving && !done.current && lift.current < -DEPTH * 0.96) {
      done.current = true;
      onGone();
    }
  });

  return (
    <group ref={group}>
      <primitive object={scene} position={[0, FOOT_H, 0]} />
    </group>
  );
}
