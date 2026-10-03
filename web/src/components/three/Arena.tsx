'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useScene } from '@/lib/scene';
import { LOGO_COLORS, LOGO_MARK, MARK_VIEWBOX } from '../brandPaths';

/*
 * The arena: an octagonal glass stage ringed by chasing LEDs, tiered stands full of steady crowd
 * lights, four unlit light towers, and an overhead LED ring.
 * Everything that glows is unlit/additive (no extra real lights, no shadow maps), so it stays cheap;
 * the scene's `intensity` (match energy) speeds up the chase and the sweep.
 */

const VIOLET = new THREE.Color('#7c5cff');
const R = 9; // stage radius

const energy = () => 0.25 + useScene.getState().intensity * 1.5;

// ─── stage floor ────────────────────────────────────────────────────────────
function emblemTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  g.translate(512, 512);
  g.strokeStyle = 'rgba(169,184,212,0.5)';
  g.lineWidth = 3;
  // the inner ring is the wordmark ring's job now (ringTexture); spokes start outside it
  for (const r of [330, 470]) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    g.beginPath();
    g.moveTo(Math.cos(a) * 200, Math.sin(a) * 200);
    g.lineTo(Math.cos(a) * 320, Math.sin(a) * 320);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The longshort mark, drawn from the same traced paths as the site logo. */
function logoTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  const [x, y, w, h] = MARK_VIEWBOX.split(' ').map(Number);
  const s = 1024 / Math.max(w, h);
  g.translate((1024 - w * s) / 2 - x * s, (1024 - h * s) / 2 - y * s);
  g.scale(s, s);
  g.translate(0, 1100); // LOGO_TRANSFORM: potrace's flipped 0.1-unit space
  g.scale(0.1, -0.1);
  for (const shape of LOGO_MARK) {
    g.fillStyle = LOGO_COLORS[shape.tone];
    g.fill(new Path2D(shape.d));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; // seen at a grazing angle from the stands
  return t;
}

/*
 * "LONGSHORT.FUN" set round the mark like a centre-court stamp: arched over the top and under the
 * bottom, both upright for the main camera, with the mark's diamond between them at either side.
 * Drawn in the site's display face; redrawn once the webfont has loaded.
 */
const RING = 3.8; // plane size in world units
function ringTexture() {
  const S = 2048;
  const u = S / RING; // px per world unit
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')! as CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string };
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-saira').trim() || 'sans-serif';
  const font = `italic 800 ${Math.round(0.33 * u)}px ${family}`;
  const draw = () => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.lineWidth = 0.012 * u;
    g.strokeStyle = 'rgba(239, 233, 220, 0.38)';
    for (const r of [1.34, 1.82]) {
      g.beginPath();
      g.arc(0, 0, r * u, 0, Math.PI * 2);
      g.stroke();
    }
    g.font = font;
    g.fontStretch = 'condensed';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const cap = 0.24 * u; // the band the letters fill, between the two rules
    const r0 = 1.46 * u;
    const mid = r0 + cap / 2;
    const track = 0.035 * u;
    const parts: [string, string][] = [...'LONGSHORT'].map((ch) => [ch, '#efe9dc'] as [string, string]).concat([...'.FUN'].map((ch) => [ch, LOGO_COLORS.violet] as [string, string]));
    const adv = parts.map(([ch]) => g.measureText(ch).width + track);
    const span = (adv.reduce((a, b) => a + b, 0) - track) / mid;
    // top: clockwise from the left, tops outward; bottom: anticlockwise from the left, tops inward
    for (const top of [true, false]) {
      let a = (top ? -Math.PI / 2 : Math.PI / 2) + (top ? -span / 2 : span / 2);
      parts.forEach(([ch, color], i) => {
        const half = (adv[i] - track) / 2 / mid;
        a += top ? half : -half;
        const r = top ? r0 : r0 + cap;
        g.save();
        g.rotate(a);
        g.translate(r, 0);
        g.rotate(top ? Math.PI / 2 : -Math.PI / 2);
        g.fillStyle = color;
        g.fillText(ch, 0, 0);
        g.restore();
        a += (top ? 1 : -1) * (half + track / mid);
      });
    }
    // the mark's diamond, left and right, where the two arcs meet
    g.fillStyle = LOGO_COLORS.violet;
    for (const side of [-1, 1]) {
      g.save();
      g.translate(side * mid, 0);
      g.rotate(Math.PI / 4);
      const d = 0.08 * u;
      g.fillRect(-d / 2, -d / 2, d, d);
      g.restore();
    }
    t.needsUpdate = true;
  };
  draw();
  // the arena can mount before the display face has loaded; draw again with the real glyphs
  document.fonts?.load(font).then(draw, () => {});
  return t;
}

function Floor() {
  const emblem = useMemo(emblemTexture, []);
  const logo = useMemo(logoTexture, []);
  const ring = useMemo(ringTexture, []);
  const edge = useMemo(() => {
    const pts = Array.from({ length: 9 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      return new THREE.Vector3(Math.cos(a) * R, 0.03, Math.sin(a) * R);
    });
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 8]} position={[0, -0.01, 0]}>
        <circleGeometry args={[R, 8]} />
        <MeshReflectorMaterial resolution={512} blur={[300, 80]} mixBlur={1} mixStrength={5} roughness={0.85} depthScale={1} minDepthThreshold={0.4} maxDepthThreshold={1.4} color="#0f1016" metalness={0.4} mirror={0.2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <planeGeometry args={[11, 11]} />
        <meshBasicMaterial map={emblem} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* the longshort mark at centre stage, upright for the main camera */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.009, 0]}>
        <planeGeometry args={[2.4, 2.4]} />
        <meshBasicMaterial map={logo} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]}>
        <planeGeometry args={[RING, RING]} />
        <meshBasicMaterial map={ring} transparent opacity={0.85} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* glowing octagon rim, twice for a soft falloff */}
      <lineLoop geometry={edge}>
        <lineBasicMaterial color={VIOLET} toneMapped={false} />
      </lineLoop>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 8]} position={[0, 0.012, 0]}>
        <ringGeometry args={[R - 0.18, R, 8]} />
        <meshBasicMaterial color={VIOLET} toneMapped={false} transparent opacity={0.55} />
      </mesh>
      {/* the deck around the stage */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <ringGeometry args={[R, 24, 64]} />
        <meshStandardMaterial color="#0b0c10" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** Ring of LED segments with a chasing highlight. */
function Chase() {
  const n = 96;
  const ref = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const placed = useRef(false);
  const t = useRef(0);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    if (!placed.current) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        tmp.position.set(Math.cos(a) * (R - 0.55), 0.03, Math.sin(a) * (R - 0.55));
        tmp.rotation.set(0, -a, 0);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
      placed.current = true;
    }
    t.current += dt * energy() * 6;
    for (let i = 0; i < n; i++) {
      const k = Math.pow(0.5 + 0.5 * Math.sin(i * 0.52 - t.current), 8);
      col.copy(VIOLET).multiplyScalar(0.18 + k * 2.2);
      m.setColorAt(i, col);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]}>
      <boxGeometry args={[0.07, 0.03, 0.34]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

// ─── stands + crowd ─────────────────────────────────────────────────────────
const TIERS = Array.from({ length: 6 }, (_, k) => ({ r: 14 + k * 1.3, h: 0.6 + k * 0.85 }));

function Stands() {
  const geo = useMemo(() => {
    const pts: THREE.Vector2[] = [new THREE.Vector2(13.4, -0.05)];
    for (const t of TIERS) {
      pts.push(new THREE.Vector2(t.r - 0.6, t.h));
      pts.push(new THREE.Vector2(t.r + 0.7, t.h));
    }
    pts.push(new THREE.Vector2(TIERS.at(-1)!.r + 0.7, 0));
    return new THREE.LatheGeometry(pts, 96);
  }, []);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color="#121319" roughness={0.85} metalness={0.2} side={THREE.DoubleSide} />
    </mesh>
  );
}

const crowdVert = /* glsl */ `
  attribute float aPhase;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vA = 0.2 + fract(aPhase * 7.1) * 0.12;
    vColor = aColor;
    gl_PointSize = 1.2 * (42.0 / -mv.z); // steady pin-points, not flashing orbs
    gl_Position = projectionMatrix * mv;
  }`;
const crowdFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor * (1.0 + vA), vA * (1.0 - d * 1.6));
  }`;

function Crowd() {
  const geo = useMemo(() => {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const ph = new Float32Array(n);
    // mostly warm phone-light whites; one accent, rarely
    const palette = ['#ffe8c2', '#ffe8c2', '#ffe8c2', '#f4efe6', '#f4efe6', '#a9b8d4'].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const t = TIERS[(Math.random() * TIERS.length) | 0];
      const a = Math.random() * Math.PI * 2;
      const r = t.r + (Math.random() - 0.5) * 1.0;
      pos.set([Math.cos(a) * r, t.h + 0.35 + Math.random() * 0.25, Math.sin(a) * r], i * 3);
      const c = palette[(Math.random() * palette.length) | 0];
      col.set([c.r, c.g, c.b], i * 3);
      ph[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <shaderMaterial vertexShader={crowdVert} fragmentShader={crowdFrag} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

// ─── light towers (lamps off: no beams) ─────────────────────────────────────
function Towers() {
  const towers = useMemo(
    () =>
      [0.25, 0.75, 1.25, 1.75].map((k, i) => {
        const a = Math.PI * k;
        return { i, base: new THREE.Vector3(Math.cos(a) * 12.5, 0, Math.sin(a) * 12.5), head: new THREE.Vector3(Math.cos(a) * 12.5, 9.2, Math.sin(a) * 12.5) };
      }),
    [],
  );
  return (
    <group>
      {towers.map((t) => (
        <group key={t.i}>
          <mesh position={[t.base.x, 4.6, t.base.z]}>
            <boxGeometry args={[0.28, 9.2, 0.28]} />
            <meshStandardMaterial color="#16181e" metalness={0.5} roughness={0.6} />
          </mesh>
          <mesh position={[t.head.x, t.head.y, t.head.z]}>
            <boxGeometry args={[0.9, 0.5, 0.9]} />
            <meshStandardMaterial color="#1b1d24" metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── overhead LED ring + back portal ───────────────────────────────────────
function Overhead() {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.z += dt * 0.08 * energy();
  });
  return (
    <group position={[0, 9.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <torusGeometry args={[7.5, 0.16, 12, 128]} />
        <meshStandardMaterial color="#17191f" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh ref={ring} position={[0, 0, 0.18]}>
        <torusGeometry args={[7.5, 0.035, 8, 128, Math.PI * 1.6]} />
        <meshBasicMaterial color={VIOLET} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Portal() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.children.forEach((c, i) => (c.rotation.z += dt * (i ? -0.5 : 0.35) * energy()));
  });
  return (
    <group ref={ref} position={[0, 2.2, -17]}>
      <mesh>
        <torusGeometry args={[4, 0.07, 16, 120]} />
        <meshBasicMaterial color={VIOLET} toneMapped={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[4.6, 0.03, 8, 120, Math.PI * 1.4]} />
        <meshBasicMaterial color="#ff3d5a" toneMapped={false} transparent opacity={0.7} />
      </mesh>
      <mesh>
        <circleGeometry args={[3.9, 64]} />
        <meshBasicMaterial color="#0d0b18" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

export function Arena() {
  return (
    <group>
      <Floor />
      <Chase />
      <Stands />
      <Crowd />
      <Towers />
      <Overhead />
      <Portal />
    </group>
  );
}
