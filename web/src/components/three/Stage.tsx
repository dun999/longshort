'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useScene, prefersReducedMotion, type Shot, type Slot } from '@/lib/scene';
import { Avatar, nameplateHost } from './Avatar';
import { Jumbotron } from './Jumbotron';
import { Arena } from './Arena';
import { Stage2D } from '../Stage2D';

// ─── Camera shots ───────────────────────────────────────────────────────────
const SHOTS: Record<Shot, { pos: [number, number, number]; target: [number, number, number]; orbit?: number; user?: boolean }> = {
  title: { pos: [-3.6, 2.4, 11], target: [-3.6, 1.9, 0] },
  lobby: { pos: [0, 2.1, 7.2], target: [0, 1.35, 0], user: true },
  queue: { pos: [0, 3.8, 9.2], target: [0, 1.4, 0], orbit: 0.05 },
  select: { pos: [0.3, 2.1, 5.2], target: [0, 1.55, 0] },
  vs: { pos: [0, 1.7, -9], target: [0, 1.6, -40] },
  arena: { pos: [0, 11, 13], target: [0, 0.5, 0], orbit: 0.03 },
  result: { pos: [0, 2.8, 8.5], target: [0, 1.7, 0], orbit: 0.025 },
  podium: { pos: [0, 2.4, 9.5], target: [0, -1.7, 0] }, // aims low so the top-3 stand in the band above the table
  backdrop: { pos: [0, 7, 15], target: [0, 1.5, 0], orbit: 0.025 },
};

function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const shot = useScene((s) => s.shot);
  const aspect = useThree((s) => s.size.width / s.size.height);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const base = SHOTS[shot];
    // tall (phone) screens: dolly back along the shot so the same cast stays in frame
    const k = aspect < 1 ? Math.min(2.1, (1 / aspect) ** 0.8) : 1;
    const s = { ...base, pos: base.pos.map((v, i) => base.target[i] + (v - base.target[i]) * k) as [number, number, number] };
    const instant = prefersReducedMotion();
    // idle orbits accumulate azimuth (possibly several full turns); without normalizing,
    // the next move "unwinds" every turn and reads as a fast spin
    c.normalizeRotations();
    c.smoothTime = shot === 'vs' ? 1.2 : 1.1;
    void c.setLookAt(...s.pos, ...s.target, !instant);
    // lobby lets the player drag/zoom around their squad; every other shot is directed
    c.enabled = !!s.user;
    c.minDistance = 4;
    c.maxDistance = 11 * k;
    c.minPolarAngle = 0.6;
    c.maxPolarAngle = 1.52;
  }, [shot, aspect]);
  useFrame((_, dt) => {
    const o = SHOTS[useScene.getState().shot].orbit;
    if (o && ref.current && !prefersReducedMotion()) ref.current.rotate(dt * o, 0, false);
  });
  return <CameraControls ref={ref} makeDefault />;
}

// ─── Lobby pedestals ────────────────────────────────────────────────────────
function layout(slots: Slot[]): { pos: [number, number, number]; rot: number }[] {
  const teams = slots.some((s) => s.team === 1);
  if (teams) {
    const idx = [0, 0];
    return slots.map((s) => {
      const t = s.team ?? 0;
      const i = idx[t]++;
      const side = t === 0 ? -1 : 1;
      return { pos: [side * (1.9 + i * 2.1), 0, -i * 0.9], rot: -side * 0.45 };
    });
  }
  const n = slots.length;
  const gap = n > 5 ? 1.9 : 2.3;
  // put "me" in the middle
  return slots.map((_, i) => {
    const off = i - (n - 1) / 2;
    return { pos: [off * gap, 0, -(Math.abs(off) ** 1.6) * 0.45], rot: -off * 0.12 };
  });
}

const HIDDEN: Slot = { empty: true, color: '#000000' };

function Pedestals() {
  const slots = useScene((s) => s.slots);
  const shot = useScene((s) => s.shot);
  const places = useMemo(() => layout(slots), [slots]);
  const show = ['lobby', 'select'].includes(shot); // searching and results list the names in their own UI
  // Fixed pool of 8, never unmounted: drei <Html> nameplates race React 19's root unmount otherwise.
  return (
    <group>
      {Array.from({ length: 8 }, (_, i) => (
        <group key={i} visible={i < slots.length}>
          <Avatar slot={slots[i] ?? HIDDEN} position={places[i]?.pos ?? [0, -50, 0]} rotationY={places[i]?.rot ?? 0} showName={show && i < slots.length} />
        </group>
      ))}
    </group>
  );
}

// ─── Shake + FX ─────────────────────────────────────────────────────────────
function World({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    const age = performance.now() - useScene.getState().shakeAt;
    const k = age < 600 && !prefersReducedMotion() ? (1 - age / 600) * 0.25 : 0;
    g.current.position.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, 0);
  });
  return <group ref={g}>{children}</group>;
}

function Effects() {
  const samples = useThree((s) => Math.min(4, s.gl.capabilities.maxSamples));
  return (
    <EffectComposer multisampling={samples}>
      <Bloom mipmapBlur intensity={0.25} luminanceThreshold={0.85} luminanceSmoothing={0.1} />
      <Vignette eskil={false} offset={0.25} darkness={0.7} />
    </EffectComposer>
  );
}

function Dimmer() {
  // fades the scene when the HUD needs focus
  const { scene } = useThree();
  useFrame(() => {
    const shot = useScene.getState().shot;
    const fog = scene.fog as THREE.Fog | null;
    if (!fog) return;
    const target = shot === 'arena' ? 26 : 60;
    fog.far = THREE.MathUtils.lerp(fog.far, target, 0.05);
  });
  return null;
}

/** Dev-only: lets automated checks step frames when the tab is hidden (rAF paused). */
function DevFrameHook() {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as { __lsStep?: (n?: number) => void; __scene?: typeof useScene };
    w.__lsStep = (n = 60) => {
      for (let i = 0; i < n; i++) advance(performance.now() / 1000 + i / 60);
    };
    w.__scene = useScene; // lets automated checks stage a scene (e.g. every character on the pedestals)
  }, [advance]);
  return null;
}

/** Probe once before mounting the Canvas: with WebGL blocked (GPU blocklist, repeated context loss)
 * three.js would throw on context creation; the 2D arena keeps every page's cast on screen instead. */
const hasWebGL = () => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
};

export default function Stage() {
  const [gl] = useState(hasWebGL);
  // hidden behind the fight HUD and the result screen: stop rendering, keep the context
  const off = useScene((s) => s.shot === 'arena' || s.shot === 'result');
  if (!gl)
    return (
      <div className="stage" aria-hidden>
        <Stage2D />
      </div>
    );
  return (
    <div className="stage" aria-hidden>
      <div ref={(el) => void (el && (nameplateHost.current = el))} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />
      <Canvas
        dpr={[1, 1.6]}
        frameloop={off ? 'never' : 'always'}
        camera={{ fov: 40, position: [0, 4, 25], near: 0.1, far: 200 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        fallback={<div className="stage-fallback" />}
      >
        <color attach="background" args={['#0c0d10']} />
        <fog attach="fog" args={['#0c0d10', 16, 60]} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[5, 10, 6]} intensity={1.4} color="#f1ece2" />
        <pointLight position={[-6, 3, 4]} intensity={18} color="#9fb3d9" distance={20} />
        <pointLight position={[6, 3, 4]} intensity={14} color="#d9b98a" distance={20} />
        <spotLight position={[0, 12, 2]} angle={0.5} penumbra={0.8} intensity={90} color="#f4efe6" />
        <World>
          <Arena />
          <Jumbotron />
          <Pedestals />
          {/* no drei <Sparkles>: its 0.05 / distanceToCenter is infinite when a pixel hits a sprite's
              centre, and the NaN it blends in blacks out the frame through Bloom */}
        </World>
        <CameraRig />
        <Dimmer />
        <Effects />
        <DevFrameHook />
      </Canvas>
    </div>
  );
}
