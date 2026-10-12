'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useScene } from '@/lib/scene';
import { PERPL_PATH } from '../landing/SponsorLogos';

/*
 * The tribune: an octagonal grandstand that follows the stage's eight sides. Seven straight blocks of
 * stepped concrete with empty seats (one instanced mesh), radial aisles with step lights, a ribbon board
 * (our wordmark alternating with "TRADES ON perpl", where every order fills) on
 * the front wall, a back wall on pillars and a cantilevered roof with a lit edge. The back side is left open:
 * that's the players' gate (Gate.tsx). Seats in each block carry a chevron, up (long) and down
 * (short) in turn. Flat-shaded and unlit-cheap: no extra lights, no shadows.
 */

const SEG = 8;
const HALF = Math.PI / SEG;
const T = Math.tan(HALF);
const D0 = 17; // front wall, measured perpendicular to each side
const ROWS = 8;
const TREAD = 0.85;
const RISER = 0.5;
const Y0 = 1.05; // first tread (the front wall's height)
const GATE = 6; // the back side (-Z): left open for the players' gate
const BACK = D0 + ROWS * TREAD;
const TOP = Y0 + (ROWS - 1) * RISER;
const AISLE = 0.6; // half-width of every aisle
const VIOLET = new THREE.Color('#7c5cff');

const rowY = (j: number) => Y0 + j * RISER;
const rowD = (j: number) => D0 + j * TREAD;

/** Point at perpendicular distance d from the centre and lateral offset s along side k. */
function at(k: number, d: number, s: number, y: number): [number, number, number] {
  const a = k * 2 * HALF;
  const ux = Math.cos(a), uz = Math.sin(a);
  return [ux * d - uz * s, y, uz * d + ux * s];
}

/** Flat-shaded, vertex-coloured geometry from quads. */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.Color) {
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(color.r, color.g, color.b);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

const sides = Array.from({ length: SEG }, (_, k) => k).filter((k) => k !== GATE);

function structure() {
  const b = new Builder();
  const c = (h: string) => new THREE.Color(h);
  const tread = [c('#25272e'), c('#292b33')];
  const riser = c('#1b1d23');
  const wall = c('#17191e');
  const roof = c('#121318');
  for (const k of sides) {
    const hw = (d: number) => d * T;
    // front wall from the deck to the first tread
    b.quad(at(k, D0, -hw(D0), -0.03), at(k, D0, hw(D0), -0.03), at(k, D0, hw(D0), Y0), at(k, D0, -hw(D0), Y0), riser);
    for (let j = 0; j < ROWS; j++) {
      const d0 = rowD(j), d1 = rowD(j + 1), y = rowY(j);
      b.quad(at(k, d0, -hw(d0), y), at(k, d1, -hw(d1), y), at(k, d1, hw(d1), y), at(k, d0, hw(d0), y), tread[j % 2]);
      if (j < ROWS - 1) b.quad(at(k, d1, -hw(d1), y), at(k, d1, hw(d1), y), at(k, d1, hw(d1), y + RISER), at(k, d1, -hw(d1), y + RISER), riser);
    }
    // back wall up to the roof line
    b.quad(at(k, BACK, -hw(BACK), TOP), at(k, BACK, hw(BACK), TOP), at(k, BACK, hw(BACK), 8.6), at(k, BACK, -hw(BACK), 8.6), wall);
    // roof: a canopy sloping down toward the stage, with its underside
    const r0 = BACK + 0.4, r1 = D0 + 1.6;
    b.quad(at(k, r0, -hw(r0), 9.7), at(k, r1, -hw(r1), 9.15), at(k, r1, hw(r1), 9.15), at(k, r0, hw(r0), 9.7), roof);
    b.quad(at(k, r1, -hw(r1), 9.15), at(k, r1, hw(r1), 9.15), at(k, r1, hw(r1), 8.9), at(k, r1, -hw(r1), 8.9), wall);
  }
  // stepped end walls where the stands meet the gate
  for (const [k, sgn] of [
    [GATE - 1, 1],
    [GATE + 1, -1],
  ] as const) {
    for (let j = 0; j < ROWS; j++) {
      const d0 = rowD(j), d1 = rowD(j + 1), y = rowY(j);
      b.quad(at(k, d0, sgn * d0 * T, -0.03), at(k, d1, sgn * d1 * T, -0.03), at(k, d1, sgn * d1 * T, y + 0.25), at(k, d0, sgn * d0 * T, y + 0.25), wall);
    }
    b.quad(at(k, BACK, sgn * BACK * T, -0.03), at(k, BACK + 0.01, sgn * BACK * T, 8.6), at(k, D0, sgn * D0 * T, Y0 + 0.25), at(k, D0, sgn * D0 * T, -0.03), wall);
  }
  return b.geometry();
}

function seatGeometry() {
  const pan = new THREE.BoxGeometry(0.46, 0.07, 0.4).translate(0, 0.42, -0.02);
  const back = new THREE.BoxGeometry(0.46, 0.44, 0.06).rotateX(-0.16).translate(0, 0.66, 0.2);
  const post = new THREE.BoxGeometry(0.12, 0.38, 0.12).translate(0, 0.19, 0.05);
  const g = mergeGeometries([pan.toNonIndexed(), back.toNonIndexed(), post.toNonIndexed()])!;
  g.computeVertexNormals();
  return g;
}

/** Seat placements: every row of every block, minus the aisles; colour by the block's chevron. */
function seatPlan() {
  const out: { p: [number, number, number]; rot: number; color: THREE.Color }[] = [];
  const base = [new THREE.Color('#2b2e38'), new THREE.Color('#30333e')];
  const mark = new THREE.Color('#4a3ba6');
  const gap = 0.56;
  sides.forEach((k, n) => {
    const up = n % 2 === 0;
    for (let j = 0; j < ROWS; j++) {
      const d = rowD(j) + 0.42;
      const hw = d * T - AISLE / Math.cos(HALF) - 0.25;
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; ; i++) {
          const s = side * (AISLE + 0.3 + i * gap);
          if (Math.abs(s) > hw) break;
          const row = up ? ROWS - 1 - j : j; // apex at the top (long) or the bottom (short)
          const lit = Math.abs(i - row) < 0.5 || Math.abs(i - row - 1) < 0.5;
          out.push({ p: at(k, d, s, rowY(j)), rot: Math.PI / 2 - k * 2 * HALF, color: lit ? mark : base[(j + i) % 2] });
        }
      }
    }
  });
  return out;
}

/** Aisle steps: a half-height block on the back half of every tread, at each block's centre and each corner. */
function stepPlan() {
  const out: { p: [number, number, number]; rot: number; depth: number }[] = [];
  for (const k of sides) {
    for (let j = 0; j < ROWS - 1; j++) {
      const d = rowD(j) + TREAD * 0.75;
      out.push({ p: at(k, d, 0, rowY(j) + RISER / 4), rot: -k * 2 * HALF, depth: TREAD / 2 });
    }
  }
  // corner aisles run along the diagonals between two blocks
  for (let k = 0; k < SEG; k++) {
    if (k === GATE || (k + 1) % SEG === GATE) continue; // no corner aisle into the open gate side
    const a = k * 2 * HALF + HALF;
    for (let j = 0; j < ROWS - 1; j++) {
      const r = (rowD(j) + TREAD * 0.75) / Math.cos(HALF);
      out.push({ p: [Math.cos(a) * r, rowY(j) + RISER / 4, Math.sin(a) * r], rot: -a, depth: TREAD / 2 / Math.cos(HALF) });
    }
  }
  return out;
}

function ribbonTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 64;
  const g = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-saira').trim() || 'sans-serif';
  const font = `italic 800 44px ${family}`;
  const label = `italic 700 32px ${family}`;
  const mark = new Path2D(PERPL_PATH);
  const markH = 40;
  const markW = (markH * 2879) / 788;
  const draw = () => {
    g.fillStyle = '#0b0b10';
    g.fillRect(0, 0, 2048, 64);
    g.textBaseline = 'middle';
    // two boards' worth: the wordmark, then where every trade fills (Perpl), spaced evenly so the wrap is seamless
    g.font = font;
    const name = g.measureText('LONGSHORT.FUN').width;
    g.font = label;
    const venue = g.measureText('TRADES ON').width + 20 + markW;
    const units = [name, venue, name, venue];
    const gap = (2048 - units.reduce((a, b) => a + b, 0)) / units.length;
    const diamond = (x: number) => {
      g.fillStyle = '#8f75ff';
      g.save();
      g.translate(x, 32);
      g.rotate(Math.PI / 4);
      g.fillRect(-6, -6, 12, 12);
      g.restore();
    };
    let x = 0;
    units.forEach((w, i) => {
      diamond(x);
      const at = x + gap / 2;
      if (i % 2 === 0) {
        g.font = font;
        g.fillStyle = '#d9d3c6';
        g.fillText('LONGSHORT', at, 34);
        g.fillStyle = '#8f75ff';
        g.fillText('.FUN', at + g.measureText('LONGSHORT').width, 34);
      } else {
        g.font = label;
        g.fillStyle = '#8d889a';
        g.fillText('TRADES ON', at, 34);
        g.save();
        g.translate(at + w - markW, 32 - markH / 2);
        g.scale(markH / 788, markH / 788);
        g.translate(0, 788);
        g.scale(0.1, -0.1);
        g.fillStyle = '#d9d3c6';
        g.fill(mark);
        g.restore();
      }
      x += w + gap;
    });
    diamond(2048); // the other half of the first diamond, across the wrap
    t.needsUpdate = true;
  };
  draw();
  document.fonts?.load(font).then(draw, () => {});
  return t;
}

function Ribbon() {
  const tex = useMemo(ribbonTexture, []);
  const geo = useMemo(() => {
    const b: number[] = [];
    const uv: number[] = [];
    for (const k of sides) {
      const hw = D0 * T;
      const y0 = 0.38, y1 = 0.88, d = D0 - 0.02;
      const p = [at(k, d, -hw, y0), at(k, d, hw, y0), at(k, d, hw, y1), at(k, d, -hw, y1)];
      const reps = (2 * hw) / 7; // one strip (two wordmarks, two Perpl boards) per ~7 m
      for (const [i, q] of [0, 1, 2, 0, 2, 3].entries()) {
        void i;
        b.push(...p[q]);
        uv.push(q === 1 || q === 2 ? reps : 0, q >= 2 ? 1 : 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial map={tex} toneMapped={false} side={THREE.DoubleSide} color="#bdb6aa" />
    </mesh>
  );
}

function Seats() {
  const plan = useMemo(seatPlan, []);
  const geo = useMemo(seatGeometry, []);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    plan.forEach((s, i) => {
      o.position.set(...s.p);
      o.rotation.set(0, s.rot, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, s.color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [plan]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, plan.length]}>
      <meshStandardMaterial flatShading roughness={0.7} metalness={0.1} />
    </instancedMesh>
  );
}

/** Aisle steps and the step lights on their noses (lights brighten a touch with the arena's energy). */
function Aisles() {
  const plan = useMemo(stepPlan, []);
  const steps = useRef<THREE.InstancedMesh>(null);
  const lights = useRef<THREE.InstancedMesh>(null);
  const lightMat = useMemo(() => new THREE.MeshBasicMaterial({ color: VIOLET.clone().multiplyScalar(0.9), toneMapped: false }), []);
  useEffect(() => {
    const o = new THREE.Object3D();
    plan.forEach((s, i) => {
      o.position.set(...s.p);
      o.rotation.set(0, s.rot, 0);
      o.scale.set(s.depth, RISER / 2, AISLE * 2 - 0.1);
      o.updateMatrix();
      steps.current?.setMatrixAt(i, o.matrix);
      // light strip on the step nose (stage side)
      o.scale.set(1, 1, 1);
      o.translateX(-s.depth / 2 - 0.005);
      o.translateY(RISER / 4 - 0.03);
      o.updateMatrix();
      lights.current?.setMatrixAt(i, o.matrix);
    });
    if (steps.current) steps.current.instanceMatrix.needsUpdate = true;
    if (lights.current) lights.current.instanceMatrix.needsUpdate = true;
  }, [plan]);
  useFrame(() => {
    const e = 0.55 + useScene.getState().intensity * 0.6;
    lightMat.color.copy(VIOLET).multiplyScalar(e);
  });
  return (
    <group>
      <instancedMesh ref={steps} args={[undefined, undefined, plan.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#34363f" flatShading roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={lights} args={[undefined, undefined, plan.length]} material={lightMat}>
        <boxGeometry args={[0.02, 0.025, AISLE * 1.4]} />
      </instancedMesh>
    </group>
  );
}

/** Pillars on the back wall at every corner and mid-block, carrying the roof; a lit strip on the roof edge. */
function Frame() {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const k of sides) {
      for (const s of [-1, 0, 1]) {
        const d = BACK + 0.25;
        const p = at(k, d, s * d * T, 0);
        const g = new THREE.BoxGeometry(0.5, 9.7, 0.5).toNonIndexed();
        g.rotateY(-k * 2 * HALF).translate(p[0], 4.85, p[2]);
        parts.push(g);
        // roof truss reaching out over the stands
        const r1 = D0 + 1.7;
        const a = at(k, d, s * d * T, 9.55), b2 = at(k, r1, s * r1 * T, 9.05);
        const len = Math.hypot(b2[0] - a[0], b2[2] - a[2]);
        const beam = new THREE.BoxGeometry(len, 0.35, 0.22).toNonIndexed();
        beam.rotateZ(Math.atan2(9.05 - 9.55, len));
        beam.rotateY(-Math.atan2(b2[2] - a[2], b2[0] - a[0]));
        beam.translate((a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2 - 0.15, (a[2] + b2[2]) / 2);
        parts.push(beam);
      }
      // a rail along the top of the front wall
      const hw = D0 * T;
      const rail = new THREE.BoxGeometry(2 * hw, 0.06, 0.06).toNonIndexed();
      const c = at(k, D0 - 0.05, 0, Y0 + 0.55);
      rail.rotateY(Math.PI / 2 - k * 2 * HALF).translate(c[0], c[1], c[2]);
      parts.push(rail);
      for (const s of [-0.9, -0.45, 0, 0.45, 0.9]) {
        const p = at(k, D0 - 0.05, s * hw, Y0 + 0.28);
        parts.push(new THREE.BoxGeometry(0.05, 0.55, 0.05).toNonIndexed().translate(p[0], p[1], p[2]));
      }
    }
    const g = mergeGeometries(parts)!;
    g.computeVertexNormals();
    return g;
  }, []);
  const edge = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (const k of sides) {
      const r1 = D0 + 1.6;
      pts.push(new THREE.Vector3(...at(k, r1 - 0.02, -r1 * T, 8.92)), new THREE.Vector3(...at(k, r1 - 0.02, r1 * T, 8.92)));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, []);
  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial color="#1c1e24" flatShading roughness={0.6} metalness={0.4} />
      </mesh>
      <lineSegments geometry={edge}>
        <lineBasicMaterial color={VIOLET} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

export function Tribune() {
  const geo = useMemo(structure, []);
  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial vertexColors flatShading roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <Seats />
      <Aisles />
      <Ribbon />
      <Frame />
    </group>
  );
}
