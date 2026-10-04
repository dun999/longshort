'use client';
import { Suspense, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { CLASSES, classOf, type ClassId } from '@longshort/shared';
import type { Slot } from '@/lib/scene';
import { FOOT_H, useCast, type CastClip } from './cast';

/** Stable DOM host for nameplates (set by Stage). drei otherwise re-targets on event-system changes and remounts every root. */
export const nameplateHost: { current: HTMLElement } = { current: null as unknown as HTMLElement };

const metal = new THREE.MeshStandardMaterial({ color: '#1d1f26', metalness: 0.6, roughness: 0.45 });

// ─── hologram shader: stable fresnel rim and soft scanlines ─────────────────
const holoVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vY = wp.y;
    vec4 mv = viewMatrix * wp;
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const holoFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPower;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    // clamped: rounding can push |dot| past 1 head-on, and pow() of a negative is NaN, which Bloom
    // spreads over the whole frame (a black flash while the camera moves)
    float fres = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2);
    // Hard, moving stripes and rapid opacity modulation shimmer at lobby distance.
    float scan = 0.9 + 0.1 * cos(vY * 24.0);
    float a = (0.1 + fres * 0.95) * scan * uPower;
    gl_FragColor = vec4(uColor * (0.55 + fres * 1.7), a);
  }`;
const holoCache = new Map<string, THREE.ShaderMaterial>();
function holo(color: string, power = 1) {
  const k = `${color}|${power}`;
  if (!holoCache.has(k))
    holoCache.set(
      k,
      new THREE.ShaderMaterial({
        vertexShader: holoVert,
        fragmentShader: holoFrag,
        uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: power } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  return holoCache.get(k)!;
}

/** The class character on its foothold, playing the clip that fits the slot. */
function Figure({ cls, color, clip }: { cls: ClassId; color: string; clip: CastClip }) {
  const scene = useCast(cls, color, clip);
  return <primitive object={scene} position={[0, FOOT_H, 0]} />;
}

/** A player in the lobby: their class character on its foothold, ringed in their colour. Open seats stay holograms. */
export function Avatar({ slot, position, rotationY = 0, showName, scale = 1 }: { slot: Slot; position: [number, number, number]; rotationY?: number; showName: boolean; scale?: number }) {
  const ring = useRef<THREE.Mesh>(null);
  const ghost = useRef<THREE.Group>(null);
  const color = slot.out ? '#44474f' : slot.color;
  const trim = useTrim(color);
  const cls = slot.leverage ? classOf(slot.leverage) : 'scout';
  const clip: CastClip = slot.out ? 'out' : (slot.lead ?? 0) >= 1 ? 'win' : 'idle';

  useFrame(({ clock }, dt) => {
    if (ring.current) ring.current.rotation.z += dt * (slot.me ? 1.4 : 0.6);
    if (ghost.current) ghost.current.position.y = 1.3 + Math.sin(clock.elapsedTime * 1.6) * 0.05;
  });

  return (
    <group position={position}>
      {slot.empty ? (
        <>
          {/* open seat: the old projector pedestal and a waiting hologram */}
          <mesh material={metal} position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.85, 0.95, 0.24, 48]} />
          </mesh>
          <mesh material={trim} position={[0, 0.245, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.74, 0.79, 64]} />
          </mesh>
          <mesh material={holo(color, 0.18)} position={[0, 1.35, 0]}>
            <cylinderGeometry args={[0.45, 0.78, 2.2, 32, 1, true]} />
          </mesh>
          <group ref={ghost} position={[0, 1.3, 0]}>
            <mesh material={holo('#626873', 0.6)}>
              <capsuleGeometry args={[0.32, 0.9, 8, 16]} />
            </mesh>
            <mesh material={trim}>
              <boxGeometry args={[0.5, 0.05, 0.05]} />
            </mesh>
            <mesh material={trim}>
              <boxGeometry args={[0.05, 0.5, 0.05]} />
            </mesh>
          </group>
        </>
      ) : (
        <group rotation={[0, rotationY, 0]} scale={scale}>
          <Suspense fallback={null}>
            <Figure key={cls} cls={cls} color={color} clip={clip} />
          </Suspense>
        </group>
      )}
      {/* floor ring in the player's colour; your own seat gets the turning arc */}
      <mesh material={trim} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9 * scale, 0.93 * scale, 64]} />
      </mesh>
      {slot.me && (
        <mesh ref={ring} material={trim} position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.97 * scale, 1.0 * scale, 64, 1, 0, Math.PI * 1.2]} />
        </mesh>
      )}

      {/* always mounted (toggling <Html> mid-render races React's root unmount); hidden via style */}
      <Html portal={nameplateHost} position={[0, 2.75 * (slot.empty ? 0.93 : scale), 0]} center distanceFactor={9} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', opacity: showName ? 1 : 0, transition: 'opacity .2s' }}>
        <div className={`nameplate ${slot.me ? 'is-me' : ''} ${slot.empty ? 'is-empty' : ''}`} style={{ ['--c' as string]: color }}>
          {slot.empty ? (
            <span>{slot.name ?? 'OPEN SLOT'}</span>
          ) : (
            <>
              <b>{slot.name}</b>
              {slot.leverage ? (
                <i>
                  {CLASSES[cls].name} · {slot.leverage}x
                </i>
              ) : null}
            </>
          )}
        </div>
      </Html>
    </group>
  );
}

const trims = new Map<string, THREE.MeshBasicMaterial>();
function useTrim(color: string) {
  if (!trims.has(color)) trims.set(color, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  return trims.get(color)!;
}
