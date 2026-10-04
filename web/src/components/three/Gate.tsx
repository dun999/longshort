'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useScene } from '@/lib/scene';
import { Batched } from './Batched';

/*
 * The players' gate in the open back side of the tribune, after the Colosseum's entrance arches: one round
 * arch in a stone wall (dressed blocks, a ring of voussoirs with a keystone, imposts at the spring line),
 * engaged columns and an entablature with a violet inlay, a barrel-vaulted tunnel with torches that opens onto
 * warm light, braziers either side, and an iron portcullis that drops while a round is on and lifts after.
 */

const WALL_Z = -18.6; // the wall's front face
const DEPTH = 1.0;
const HALF = 7.9;
const TOP = 8.6;
// sized so the whole arch, keystone included, shows under the market board from the lobby camera
const AR = 1.8; // the opening: half-width, and the arch's inner radius
const SPRING = 1.9; // where the arch springs from its piers
const RING = 2.34; // outer radius of the voussoirs
const TUNNEL = 7;
const OPEN = 3.0; // portcullis lift when open: only its spikes and lowest bar show under the crown
const VIOLET = '#7c5cff';

function stoneTexture() {
  // dressed blocks in staggered courses: two courses per tile, a tile is 2.4 m x 1.2 m of wall
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#26221e';
  g.fillRect(0, 0, 256, 128);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 2; row++) {
    const off = row ? 64 : 0;
    for (let i = -1; i < 3; i++) {
      const x = i * 128 + off;
      const l = 0.82 + rnd() * 0.3;
      g.fillStyle = `rgb(${Math.round(92 * l)},${Math.round(84 * l)},${Math.round(74 * l)})`;
      g.fillRect(x + 3, row * 64 + 3, 122, 58);
      // a little weathering on each block
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.07})`;
        g.fillRect(x + 6 + rnd() * 100, row * 64 + 6 + rnd() * 40, 8 + rnd() * 20, 3 + rnd() * 8);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 2.4, 1 / 1.2);
  t.anisotropy = 4;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 92, 4, 64, 80, 90);
  r.addColorStop(0, '#ffe4b8');
  r.addColorStop(0.4, '#e98d45');
  r.addColorStop(1, '#2a140b');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Outline of the opening: piers up to the spring line, a half circle over the top. */
function archPath(p: THREE.Path, r: number, spring: number) {
  p.moveTo(-r, 0);
  p.lineTo(-r, spring);
  p.absarc(0, spring, r, Math.PI, 0, true);
  p.lineTo(r, 0);
}

const trim = new THREE.MeshStandardMaterial({ color: '#7a6f61', roughness: 0.92, flatShading: true });
const dark = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
const iron = new THREE.MeshStandardMaterial({ color: '#2b2d33', metalness: 0.65, roughness: 0.45, flatShading: true });
const flameHot = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd08a').multiplyScalar(2.2), toneMapped: false });
const flameOut = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2e').multiplyScalar(1.8), toneMapped: false, transparent: true, opacity: 0.85 });
const inlay = new THREE.MeshBasicMaterial({ color: VIOLET, toneMapped: false });

function Flame({ position, size = 1, phase = 0 }: { position: [number, number, number]; size?: number; phase?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime * 9 + phase;
    g.scale.set(size * (1 + Math.sin(t * 1.3) * 0.06), size * (1 + Math.sin(t) * 0.16 + Math.sin(t * 2.7) * 0.08), size * (1 + Math.cos(t * 1.1) * 0.06));
    g.rotation.y = t * 0.15;
  });
  return (
    <group ref={ref} position={position} userData={{ animated: true }}>
      <mesh material={flameOut} position={[0, 0.2, 0]}>
        <coneGeometry args={[0.2, 0.55, 5]} />
      </mesh>
      <mesh material={flameHot} position={[0, 0.14, 0]}>
        <coneGeometry args={[0.11, 0.34, 5]} />
      </mesh>
    </group>
  );
}

function Brazier({ x }: { x: number }) {
  return (
    <group position={[x, 0, WALL_Z + 1.3]}>
      <mesh material={trim} position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.42, 0.48, 0.24, 8]} />
      </mesh>
      <mesh material={trim} position={[0, 0.66, 0]}>
        <cylinderGeometry args={[0.24, 0.3, 0.9, 8]} />
      </mesh>
      <mesh material={iron} position={[0, 1.22, 0]}>
        <cylinderGeometry args={[0.46, 0.22, 0.26, 8]} />
      </mesh>
      <Flame position={[0, 1.32, 0]} size={1.3} phase={x} />
    </group>
  );
}

/** Iron grid that slides down inside the wall while a round is on. */
function Portcullis() {
  const ref = useRef<THREE.Group>(null);
  const lift = useRef(OPEN);
  const bars = useMemo(() => {
    const n = 11;
    return Array.from({ length: n }, (_, i) => -AR + 0.12 + (i * (2 * AR - 0.24)) / (n - 1));
  }, []);
  useFrame((_, dt) => {
    const shot = useScene.getState().shot;
    const want = shot === 'vs' || shot === 'arena' ? 0 : OPEN;
    lift.current = THREE.MathUtils.damp(lift.current, want, want ? 1.2 : 2.2, dt);
    if (ref.current) ref.current.position.y = lift.current;
  });
  const h = SPRING + AR + 0.4;
  return (
    <group ref={ref} position={[0, OPEN, WALL_Z - DEPTH * 0.45]}>
      <Batched>
        {bars.map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh material={iron} position={[0, h / 2 + 0.1, 0]}>
              <boxGeometry args={[0.07, h, 0.07]} />
            </mesh>
            <mesh material={iron} position={[0, 0.05, 0]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[0.06, 0.22, 4]} />
            </mesh>
          </group>
        ))}
        {[0.42, 1.24, 2.06, 2.88, 3.7].map((y) => (
          <mesh key={y} material={iron} position={[0, y, 0.05]}>
            <boxGeometry args={[2 * AR, 0.08, 0.05]} />
          </mesh>
        ))}
      </Batched>
    </group>
  );
}

/** Tunnel behind the arch: piers, a barrel vault, torches, and warm light where it opens out. */
function Tunnel() {
  const glow = useMemo(glowTexture, []);
  useEffect(() => () => glow.dispose(), [glow]);
  const end = useMemo(() => {
    const s = new THREE.Shape();
    archPath(s, AR, SPRING);
    s.closePath();
    return new THREE.ShapeGeometry(s, 16);
  }, []);
  useEffect(() => () => end.dispose(), [end]);
  // ShapeGeometry UVs are in shape units: map the arch onto the glow texture
  useMemo(() => {
    const uv = end.attributes.uv as THREE.BufferAttribute;
    const pos = end.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + AR) / (2 * AR), pos.getY(i) / (SPRING + AR));
  }, [end]);
  const z0 = WALL_Z - DEPTH;
  const zc = z0 - TUNNEL / 2;
  return (
    <group>
      <mesh material={dark} position={[0, 0.004, zc]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2 * AR, TUNNEL]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={dark} position={[s * AR, SPRING / 2, zc]} rotation={[0, -s * Math.PI / 2, 0]}>
          <planeGeometry args={[TUNNEL, SPRING]} />
        </mesh>
      ))}
      <mesh material={dark} position={[0, SPRING, zc]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[AR, AR, TUNNEL, 14, 1, true, Math.PI / 2, Math.PI]} />
      </mesh>
      {/* the far end opens onto light */}
      <mesh geometry={end} position={[0, 0, z0 - TUNNEL + 0.01]}>
        <meshBasicMaterial map={glow} toneMapped={false} />
      </mesh>
      {/* torches on brackets down both walls */}
      {[-1, 1].flatMap((s) =>
        [2.2, 4.8].map((d) => (
          <group key={`${s}${d}`} position={[s * (AR - 0.12), 1.75, z0 - d]}>
            <mesh material={iron}>
              <boxGeometry args={[0.1, 0.34, 0.1]} />
            </mesh>
            <Flame position={[0, 0.18, 0]} size={0.55} phase={s * d} />
          </group>
        )),
      )}
    </group>
  );
}

export function Gate() {
  const stone = useMemo(stoneTexture, []);
  useEffect(() => () => stone.dispose(), [stone]);
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ map: stone, color: '#ffffff', roughness: 0.93, flatShading: true }), [stone]);
  useEffect(() => () => wallMat.dispose(), [wallMat]);

  // the wall: one solid with the arched opening cut out of its bottom edge
  const wall = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-HALF, 0);
    s.lineTo(-AR, 0);
    s.lineTo(-AR, SPRING);
    s.absarc(0, SPRING, AR, Math.PI, 0, true);
    s.lineTo(AR, 0);
    s.lineTo(HALF, 0);
    s.lineTo(HALF, TOP);
    s.lineTo(-HALF, TOP);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: DEPTH, bevelEnabled: false, curveSegments: 24 });
  }, []);
  // voussoirs: wedge blocks round the arch, the keystone in the middle standing proud with a violet inlay
  const voussoirs = useMemo(() => {
    const n = 13;
    const gap = 0.012;
    return Array.from({ length: n }, (_, i) => {
      const key = i === (n - 1) / 2;
      const a0 = Math.PI - (i * Math.PI) / n - gap;
      const a1 = Math.PI - ((i + 1) * Math.PI) / n + gap;
      const outer = key ? RING + 0.32 : RING;
      const s = new THREE.Shape();
      s.moveTo(Math.cos(a0) * AR, Math.sin(a0) * AR);
      s.lineTo(Math.cos(a0) * outer, Math.sin(a0) * outer);
      s.lineTo(Math.cos(a1) * outer, Math.sin(a1) * outer);
      s.lineTo(Math.cos(a1) * AR, Math.sin(a1) * AR);
      s.closePath();
      return { geo: new THREE.ExtrudeGeometry(s, { depth: key ? 0.34 : 0.2, bevelEnabled: false }), key };
    });
  }, []);
  useEffect(() => () => [wall, ...voussoirs.map((v) => v.geo)].forEach((g) => g.dispose()), [wall, voussoirs]);

  const colX = AR + 1.45;
  return (
    <group>
      <Batched>
        <mesh geometry={wall} material={wallMat} position={[0, 0, WALL_Z - DEPTH]} />
        {voussoirs.map(({ geo }, i) => (
          <mesh key={i} geometry={geo} material={trim} position={[0, SPRING, WALL_Z]} />
        ))}
        {/* the keystone's inlay */}
        <mesh material={inlay} position={[0, SPRING + RING + 0.04, WALL_Z + 0.345]} rotation={[0, 0, Math.PI / 4]}>
          <planeGeometry args={[0.2, 0.2]} />
        </mesh>
        {/* piers framing the opening, and the imposts the arch springs from */}
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh material={trim} position={[s * (AR + 0.3), SPRING / 2, WALL_Z + 0.08]}>
              <boxGeometry args={[0.6, SPRING, 0.16]} />
            </mesh>
            <mesh material={trim} position={[s * (AR + 0.32), SPRING - 0.06, WALL_Z + 0.16]}>
              <boxGeometry args={[0.78, 0.2, 0.32]} />
            </mesh>
            {/* engaged column: plinth, faceted shaft, capital */}
            <mesh material={trim} position={[s * colX, 0.22, WALL_Z + 0.18]}>
              <boxGeometry args={[0.92, 0.44, 0.5]} />
            </mesh>
            <mesh material={trim} position={[s * colX, 2.52, WALL_Z + 0.06]}>
              <cylinderGeometry args={[0.3, 0.34, 4.16, 10]} />
            </mesh>
            <mesh material={trim} position={[s * colX, 4.72, WALL_Z + 0.18]}>
              <boxGeometry args={[0.92, 0.32, 0.5]} />
            </mesh>
          </group>
        ))}
        {/* entablature with a violet inlay line, and a cornice */}
        <mesh material={trim} position={[0, 5.21, WALL_Z + 0.2]}>
          <boxGeometry args={[HALF * 2, 0.66, 0.4]} />
        </mesh>
        <mesh material={inlay} position={[0, 5.21, WALL_Z + 0.405]}>
          <planeGeometry args={[HALF * 2, 0.05]} />
        </mesh>
        <mesh material={trim} position={[0, 5.63, WALL_Z + 0.3]}>
          <boxGeometry args={[HALF * 2, 0.18, 0.6]} />
        </mesh>
        <Tunnel />
        <Brazier x={-(colX + 1.25)} />
        <Brazier x={colX + 1.25} />
      </Batched>
      <Portcullis />
      {/* the braziers' warm light on the stone */}
      <pointLight position={[0, 2.6, WALL_Z + 2.6]} color="#ffb070" intensity={14} distance={12} decay={2} />
    </group>
  );
}
