'use client';
/* Dev-only character turntable: the class cast on their footholds in a neutral studio. 404 in production.
 * ?c=tank,scout,sniper  ?clip=idle|win|out  ?az=deg  ?accent=%23hex  ?bg=dark  ?zoom=1 */
import { notFound, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { ClassId } from '@longshort/shared';
import { FOOT_H, useCast, type CastClip } from '@/components/three/cast';

function Figure({ cls, x, clip, color }: { cls: ClassId; x: number; clip: CastClip; color: string }) {
  const scene = useCast(cls, color, clip);
  useEffect(() => {
    scene.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }, [scene]);
  return <primitive object={scene} position={[x, FOOT_H, 0]} />;
}

function Rig({ az, n, zoom }: { az: number; n: number; zoom: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const r = (3.4 + n * 1.5) / zoom;
    const a = (az * Math.PI) / 180;
    camera.position.set(Math.sin(a) * r, 1.4 + 0.35 / zoom, Math.cos(a) * r);
    camera.lookAt(0, 1.15, 0);
    (window as unknown as { __castReady?: boolean }).__castReady = true;
  }, [camera, az, n, zoom]);
  return null;
}

function Studio() {
  const q = useSearchParams();
  const list = (q.get('c') ?? 'tank,scout,sniper').split(',') as ClassId[];
  const clip = (q.get('clip') ?? 'idle') as CastClip;
  const az = Number(q.get('az') ?? 0);
  const zoom = Number(q.get('zoom') ?? 1);
  const color = q.get('accent') ?? '#7c5cff';
  const dark = q.get('bg') === 'dark';
  const gap = 1.9;
  return (
    <div className="fixed inset-0 z-[100]" style={{ background: dark ? '#0c0d10' : '#e7e5e0' }}>
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 30, near: 0.1, far: 100 }} gl={{ antialias: true }}>
        <color attach="background" args={[dark ? '#0c0d10' : '#e7e5e0']} />
        <hemisphereLight args={[dark ? '#9fb3d9' : '#ffffff', dark ? '#1a1410' : '#b8b0a2', dark ? 0.8 : 1.6]} />
        <directionalLight
          position={[3, 6, 5]}
          intensity={dark ? 2.2 : 2.4}
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
            <Figure key={c + i} cls={c} x={(i - (list.length - 1) / 2) * gap} clip={clip} color={color} />
          ))}
        </Suspense>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <shadowMaterial opacity={dark ? 0.5 : 0.18} />
        </mesh>
        <Rig az={az} n={list.length} zoom={zoom} />
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

