'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { CLASSES, classOf } from '@longshort/shared';
import type { Slot } from '@/lib/scene';

/** Stable DOM host for nameplates (set by Stage). drei otherwise re-targets on event-system changes and remounts every root. */
export const nameplateHost: { current: HTMLElement } = { current: null as unknown as HTMLElement };

const metal = new THREE.MeshStandardMaterial({ color: '#1d1f26', metalness: 0.6, roughness: 0.45 });

// ─── hologram shader: fresnel rim, rolling scanlines, a little flicker ───────
const holoTime = { value: 0 };
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
  uniform float uTime;
  uniform float uPower;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float scan = 0.55 + 0.45 * step(0.5, fract(vY * 16.0 - uTime * 1.4));
    float flick = 0.93 + 0.07 * sin(uTime * 37.0) * sin(uTime * 11.0);
    float a = (0.1 + fres * 0.95) * scan * flick * uPower;
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
        uniforms: { uColor: { value: new THREE.Color(color) }, uTime: holoTime, uPower: { value: power } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  return holoCache.get(k)!;
}

/** A player on a pedestal: a holographic trader projected in their colour. Build varies by class (leverage). */
export function Avatar({ slot, position, rotationY = 0, showName }: { slot: Slot; position: [number, number, number]; rotationY?: number; showName: boolean }) {
  const body = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  const color = slot.out ? '#44474f' : slot.color;
  const lead = slot.lead ?? 0;
  const skin = holo(color, slot.out ? 0.45 : lead >= 1 ? 1.35 : 1);
  const trim = useMemo(() => new THREE.MeshBasicMaterial({ color, toneMapped: false }), [color]);
  const beam = holo(color, 0.18);
  const cls = slot.leverage ? classOf(slot.leverage) : 'scout';
  const shoulder = cls === 'tank' ? 0.26 : cls === 'sniper' ? 0.15 : 0.2;
  const torsoW = cls === 'tank' ? 0.86 : cls === 'sniper' ? 0.58 : 0.7;

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + seed;
    holoTime.value = clock.elapsedTime;
    if (body.current) {
      body.current.position.y = 0.42 + Math.sin(t * 1.6) * 0.05 + (slot.empty ? 0 : lead * 0.12);
      body.current.rotation.y = rotationY + Math.sin(t * 0.5) * 0.12;
      body.current.rotation.z = THREE.MathUtils.lerp(body.current.rotation.z, slot.out ? 0.5 : 0, dt * 3);
    }
    if (ring.current) ring.current.rotation.z += dt * (slot.me ? 1.4 : 0.6);
  });

  return (
    <group position={position}>
      {/* pedestal + projector */}
      <mesh material={metal} position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.85, 0.95, 0.24, 48]} />
      </mesh>
      <mesh material={trim} position={[0, 0.245, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.74, 0.79, 64]} />
      </mesh>
      <mesh ref={ring} material={trim} position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 0.93, 64, 1, 0, Math.PI * 1.2]} />
      </mesh>
      <mesh material={beam} position={[0, 1.35, 0]}>
        <cylinderGeometry args={[0.45, 0.78, 2.2, 32, 1, true]} />
      </mesh>

      {slot.empty ? (
        <group position={[0, 1.3, 0]}>
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
      ) : (
        <group ref={body}>
          {/* legs */}
          {[-0.17, 0.17].map((x) => (
            <mesh key={x} material={skin} position={[x, 0.42, 0]}>
              <capsuleGeometry args={[0.11, 0.55, 6, 16]} />
            </mesh>
          ))}
          {/* torso */}
          <RoundedBox args={[torsoW, 0.82, 0.42]} radius={0.12} smoothness={4} position={[0, 1.18, 0]} material={skin} />
          <mesh material={trim} position={[0, 1.22, 0.215]}>
            <boxGeometry args={[torsoW * 0.62, 0.04, 0.01]} />
          </mesh>
          <mesh material={trim} position={[0, 1.07, 0.215]}>
            <boxGeometry args={[torsoW * 0.3, 0.025, 0.01]} />
          </mesh>
          {/* shoulders */}
          {[-1, 1].map((s) => (
            <mesh key={s} material={skin} position={[s * (torsoW / 2 + shoulder * 0.55), 1.46, 0]}>
              <sphereGeometry args={[shoulder, 24, 16]} />
            </mesh>
          ))}
          {/* arms */}
          {[-1, 1].map((s) => (
            <mesh key={s} material={skin} position={[s * (torsoW / 2 + 0.12), 1.08, 0]} rotation={[0, 0, s * 0.08]}>
              <capsuleGeometry args={[0.08, 0.5, 6, 16]} />
            </mesh>
          ))}
          {/* head + visor */}
          <RoundedBox args={[0.42, 0.38, 0.4]} radius={0.14} smoothness={4} position={[0, 1.84, 0]} material={skin} />
          <mesh material={trim} position={[0, 1.86, 0.2]}>
            <boxGeometry args={[0.3, cls === 'sniper' ? 0.035 : 0.07, 0.02]} />
          </mesh>
          {cls === 'sniper' && (
            <group position={[0.15, 2.07, -0.05]}>
              <mesh material={skin}>
                <cylinderGeometry args={[0.014, 0.014, 0.34]} />
              </mesh>
              <mesh material={trim} position={[0, 0.19, 0]}>
                <sphereGeometry args={[0.035]} />
              </mesh>
            </group>
          )}
          {cls === 'tank' && (
            <mesh material={skin} position={[0, 1.18, -0.26]}>
              <boxGeometry args={[0.55, 0.55, 0.07]} />
            </mesh>
          )}
        </group>
      )}

      {/* always mounted (toggling <Html> mid-render races React's root unmount); hidden via style */}
      <Html portal={nameplateHost} position={[0, 2.55, 0]} center distanceFactor={9} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', opacity: showName ? 1 : 0, transition: 'opacity .2s' }}>
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
