'use client';
/* Dev-only character turntable: the class cast on their footholds in a neutral studio. 404 in production.
 * ?c=tank,scout,sniper  ?clip=idle|win|out  ?az=deg  ?accent=%23hex  ?bg=dark|none  ?zoom=1
 * ?portrait=1 frames one figure for a 3:4 still; ?at=seconds holds that frame of the clip (used by the card renders). */
import { notFound, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { ClassId } from '@longshort/shared';
import { FOOT_H, useCast, type CastClip } from '@/components/three/cast';

function Figure({ cls, x, clip, color, at }: { cls: ClassId; x: number; clip: CastClip; color: string; at?: number }) {
  const scene = useCast(cls, color, clip, 1, at);
  useEffect(() => {
    scene.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }, [scene]);
  return <primitive object={scene} position={[x, FOOT_H, 0]} />;
}

function Rig({ az, n, zoom, portrait }: { az: number; n: number; zoom: number; portrait: boolean }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const r = portrait ? 7.4 / zoom : (3.4 + n * 1.5) / zoom;
    const a = (az * Math.PI) / 180;
    camera.position.set(Math.sin(a) * r, portrait ? 1.55 : 1.4 + 0.35 / zoom, Math.cos(a) * r);
    camera.lookAt(0, portrait ? 1.2 : 1.15, 0);
    (window as unknown as { __castReady?: boolean }).__castReady = true;
  }, [camera, az, n, zoom, portrait]);
  return null;
}

function Studio() {
  const q = useSearchParams();
  const list = (q.get('c') ?? 'tank,scout,sniper').split(',') as ClassId[];
  const clip = (q.get('clip') ?? 'idle') as CastClip;
  const az = Number(q.get('az') ?? 0);
  const zoom = Number(q.get('zoom') ?? 1);
  const color = q.get('accent') ?? '#7c5cff';
  const none = q.get('bg') === 'none';
  const dark = q.get('bg') === 'dark' || none;
  const portrait = q.get('portrait') === '1';
  const at = q.get('at') === null ? undefined : Number(q.get('at'));
  const gap = 1.9;
  return (
    <div className="fixed inset-0 z-[100]" style={{ background: none ? 'transparent' : dark ? '#0c0d10' : '#e7e5e0' }}>
      <Canvas shadows dpr={[1, 2]} camera={{ fov: portrait ? 24 : 30, near: 0.1, far: 100 }} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
        {!none && <color attach="background" args={[dark ? '#0c0d10' : '#e7e5e0']} />}
        {/* cool rim from behind so a figure separates from a dark card */}
        {dark && <directionalLight position={[-4, 4, -5]} intensity={none ? 2.4 : 1.6} color="#a9b8ff" />}
        {/* stills (bg=none) sit on dark cards: brighter fill so dark greens and bronzes still read */}
        <hemisphereLight args={[none ? '#ffffff' : dark ? '#9fb3d9' : '#ffffff', none ? '#4a4038' : dark ? '#1a1410' : '#b8b0a2', none ? 1.7 : dark ? 0.8 : 1.6]} />
        <directionalLight
          position={[3, 6, 5]}
          intensity={none ? 2.8 : dark ? 2.2 : 2.4}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-5}
          shadow-camera-right={5}
          shadow-camera-top={4}
          shadow-camera-bottom={-2}
          shadow-bias={-0.0004}
        />
        <Suspense fallback={null}>
          {list.map((c, i) => (
            <Figure key={c + i} cls={c} x={(i - (list.length - 1) / 2) * gap} clip={clip} color={color} at={at} />
          ))}
        </Suspense>
        {!none && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
            <planeGeometry args={[40, 40]} />
            <shadowMaterial opacity={dark ? 0.5 : 0.18} />
          </mesh>
        )}
        <Rig az={az} n={list.length} zoom={zoom} portrait={portrait} />
      </Canvas>
    </div>
  );
}

export default function CastPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense>
      <Studio />
    </Suspense>
  );
}

