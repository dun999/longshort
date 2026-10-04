'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { MARKETS, type MarketSymbol } from '@longshort/shared';
import { useSocket, type Tick } from '@/lib/socket';
import { useApi } from '@/lib/api';
import { useScene } from '@/lib/scene';
import { BOARD, DOWN, TICKER_H, TOWER, UP, loadBoardFonts, paintPrice, paintPulse, paintTicker, paintTop, paintTower, tickerItems, type FeedRow, type Leader, type Pt } from './boards';

/*
 * The arena's broadcast wall: a centre board that rotates between the price, the arena's mood and
 * the season's best (with a wipe between scenes), a live-feed crawl under it, and a portrait price
 * tower on each wing. Canvases repaint only when their data changes; the wipe, the crawl and the
 * live dot are animated here, on the GPU side.
 */

const BONE = '#e7e1d3';
const SCREEN_TINT = '#d6d6d6'; // a touch under full brightness: the wall sets the mood, the HUD and PLAY lead
const TOWER_TINT = '#b4b4b4'; // the wings flank the pedestals: quieter still
const SCENES = [18, 8, 8]; // seconds on air: price, arena pulse, top players
const WIPE = 0.75;
const KEEP_ALL = 1e6;
const KEEP_NONE = -1e6;

function useCanvas(w: number, h: number) {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { ctx: canvas.getContext('2d')!, texture };
  }, [w, h]);
}

/** A rectangle with the site's cut corners (top right, bottom left); UVs span the full rectangle. */
function cutRect(w: number, h: number, c: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, h / 2);
  s.lineTo(w / 2 - c, h / 2);
  s.lineTo(w / 2, h / 2 - c);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(-w / 2 + c, -h / 2);
  s.lineTo(-w / 2, -h / 2 + c);
  s.closePath();
  return s;
}
function screenGeometry(w: number, h: number, c: number) {
  const g = new THREE.ShapeGeometry(cutRect(w, h, c));
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  uv.needsUpdate = true;
  return g;
}

/** A glowing bone line between two points of the board's plane (the bloom pass picks it up). */
function Strip({ a, b, t = 0.06 }: { a: [number, number]; b: [number, number]; t?: number }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return (
    <mesh position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.02]} rotation={[0, 0, Math.atan2(dy, dx)]}>
      <boxGeometry args={[Math.hypot(dx, dy) + t, t, t]} />
      <meshBasicMaterial color={BONE} toneMapped={false} />
    </mesh>
  );
}

/** Bezel, light strip along the top edge and down the cut corner, and legs down to the floor (y = 0). */
function Frame({ w, h, c, lift }: { w: number; h: number; c: number; lift: number }) {
  const m = 0.26;
  const shape = useMemo(() => cutRect(w + m * 2, h + m * 2, c + m * 0.6), [w, h, c]);
  const top = h / 2 + m * 0.55;
  const right = w / 2 + m * 0.55;
  const cut = c + m * 0.6 - m * 0.45;
  const bottom = -h / 2 - m; // local
  const legH = lift + bottom;
  return (
    <group>
      <mesh position={[0, 0, -0.24]}>
        <extrudeGeometry args={[shape, { depth: 0.2, bevelEnabled: false }]} />
        <meshStandardMaterial color="#121419" metalness={0.55} roughness={0.45} />
      </mesh>
      <Strip a={[-w / 2 - m * 0.55, top]} b={[right - cut, top]} />
      <Strip a={[right - cut, top]} b={[right, top - cut]} />
      <Strip a={[-w / 2 - m * 0.55 + cut, -h / 2 - m * 0.55]} b={[-w / 2 - m * 0.55 + cut + w * 0.22, -h / 2 - m * 0.55]} t={0.045} />
      {legH > 0 &&
        [-1, 1].map((sx) => (
          <mesh key={sx} position={[sx * w * 0.3, bottom - legH / 2, -0.25]}>
            <boxGeometry args={[0.22, legH, 0.22]} />
            <meshStandardMaterial color="#1a1c21" metalness={0.4} roughness={0.7} />
          </mesh>
        ))}
    </group>
  );
}

/** The pulsing dot at the live end of a price line. */
function LiveDot({ at, color, clip, size = 1, on }: { at: React.RefObject<THREE.Vector3 | null>; color: string; clip?: THREE.Plane[]; size?: number; on?: () => boolean }) {
  const g = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    g.current.visible = !!at.current && (on?.() ?? true);
    if (at.current) g.current.position.copy(at.current);
    const k = (clock.elapsedTime % 1.4) / 1.4;
    ring.current?.scale.setScalar(size * (1 + k * 1.6));
    if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
  });
  return (
    <group ref={g}>
      <mesh scale={size}>
        <circleGeometry args={[0.09, 20]} />
        <meshBasicMaterial color={color} toneMapped={false} clippingPlanes={clip} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.1, 0.14, 28]} />
        <meshBasicMaterial color={color} transparent toneMapped={false} depthWrite={false} clippingPlanes={clip} />
      </mesh>
    </group>
  );
}

const toLocal = (p: Pt | null, w: number, h: number, cw: number, ch: number) => (p ? new THREE.Vector3((p.x / cw - 0.5) * w, (0.5 - p.y / ch) * h, 0.012) : null);

type BoardData = ReturnType<typeof useBoardData>;
function useBoardData() {
  const off = useScene((s) => s.shot === 'arena' || s.shot === 'result'); // hidden behind the HUD: don't poll
  const { data: feed } = useApi<FeedRow[]>(off ? null : '/feed', 15_000);
  const { data: leaders } = useApi<Leader[]>(off ? null : '/leaderboard', 60_000);
  const online = useSocket((s) => s.online.length);
  const [fontsReady, setReady] = useState(false);
  useEffect(() => void loadBoardFonts().then(() => setReady(true)), []);
  return { feed: Array.isArray(feed) ? feed : [], top: Array.isArray(leaders) ? leaders.filter((r) => !r.bot) : [], online, fontsReady, off };
}

/** A market's ticks, held while the stage is hidden behind the HUD: a fight must not repaint boards nobody sees. */
function useBoardTicks(market: MarketSymbol, off: boolean): Tick[] {
  const held = useRef<Tick[]>([]);
  const ticks = useSocket((s) => (off ? held.current : s.prices[market]));
  held.current = ticks;
  return ticks;
}

// ─── centre board ─────────────────────────────────────────────────────────
function CentreBoard({ market, position, width, data }: { market: MarketSymbol; position: [number, number, number]; width: number; data: BoardData }) {
  const height = (width * BOARD.h) / BOARD.w;
  const cut = 0.45;
  const tickerH = 0.44;
  const gap = 0.08;
  const { feed, top, online, fontsReady } = data;
  const ticks = useBoardTicks(market, data.off);
  const gl = useThree((s) => s.gl);
  useEffect(() => void (gl.localClippingEnabled = true), [gl]);

  // which scenes have something to show: the price always does
  const hasPulse = feed.some((r) => r.kind === 'open');
  const hasTop = top.length > 0;
  const onAir = useMemo(() => [0, ...(hasPulse ? [1] : []), ...(hasTop ? [2] : [])], [hasPulse, hasTop]);

  const price = useCanvas(BOARD.w, BOARD.h);
  const pulse = useCanvas(BOARD.w, BOARD.h);
  const best = useCanvas(BOARD.w, BOARD.h);
  const canvases = [price, pulse, best];
  const head = useRef<THREE.Vector3 | null>(null);
  const [headColor, setHeadColor] = useState(UP);

  useEffect(() => {
    const p = paintPrice(price.ctx, market, ticks, onAir.indexOf(0), onAir.length);
    head.current = toLocal(p, width, height, BOARD.w, BOARD.h);
    const vals = ticks.slice(-300);
    setHeadColor(vals.length > 1 && vals.at(-1)!.px < vals[0].px ? DOWN : UP);
    price.texture.needsUpdate = true;
  }, [ticks, market, onAir, fontsReady, price, width, height]);
  useEffect(() => {
    paintPulse(pulse.ctx, market, feed, online, onAir.indexOf(1), onAir.length);
    pulse.texture.needsUpdate = true;
  }, [feed, online, market, onAir, fontsReady, pulse]);
  useEffect(() => {
    paintTop(best.ctx, market, top, onAir.indexOf(2), onAir.length);
    best.texture.needsUpdate = true;
  }, [top, market, onAir, fontsReady, best]);
  useEffect(() => () => canvases.forEach((c) => c.texture.dispose()), []); // eslint-disable-line react-hooks/exhaustive-deps

  // one clipping plane per scene: "keep everything" on air, a moving edge during a wipe
  const clips = useMemo(() => [0, 1, 2].map(() => new THREE.Plane(new THREE.Vector3(1, 0, 0), KEEP_ALL)), []);
  const edges = useMemo(() => [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)], []);
  const geo = useMemo(() => screenGeometry(width, height, cut), [width, height]);
  const bandGeo = useMemo(() => {
    const k = height * 0.2;
    const s = new THREE.Shape();
    s.moveTo(-0.5 - k, -height / 2);
    s.lineTo(0.5 - k, -height / 2);
    s.lineTo(0.5 + k, height / 2);
    s.lineTo(-0.5 + k, height / 2);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }, [height]);

  const group = useRef<THREE.Group>(null);
  const on = useRef([true, false, false]);
  const warmup = useRef(3);
  const planes = useRef<(THREE.Mesh | null)[]>([]);
  const band = useRef<THREE.Mesh>(null);
  const sched = useRef({ scene: 0, since: 0, wipe: null as null | { from: number; to: number; at: number } });

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const s = sched.current;
    const g = group.current;
    if (!g) return;
    if (!onAir.includes(s.scene)) s.scene = 0;
    if (!s.wipe && t - s.since > SCENES[s.scene] && onAir.length > 1) {
      s.wipe = { from: s.scene, to: onAir[(onAir.indexOf(s.scene) + 1) % onAir.length], at: t };
    }
    const toWorld = (p: THREE.Plane, nx: number, x: number) => (p.normal.set(nx, 0, 0), (p.constant = -nx * x), p.applyMatrix4(g.matrixWorld));
    let bandX: number | null = null;
    if (s.wipe) {
      const k = Math.min(1, (t - s.wipe.at) / WIPE);
      const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      bandX = -width / 2 - 1.6 + e * (width + 3.2);
      if (k >= 1) {
        s.scene = s.wipe.to;
        s.since = t;
        s.wipe = null;
        bandX = null;
      }
    }
    // Warm-up: for the first frames every scene and the band are drawn (clipped to nothing), so their
    // shaders compile and textures upload at mount. After that, off-air scenes are simply not drawn.
    const warm = warmup.current > 0;
    if (warm) warmup.current--;
    [0, 1, 2].forEach((i) => {
      const w = s.wipe;
      on.current[i] = w ? i === w.from || i === w.to : i === s.scene;
      const m = planes.current[i];
      if (m) m.visible = on.current[i] || warm;
      // incoming keeps what the band has passed (x < band), outgoing keeps the rest
      if (w && bandX !== null && i === w.to) toWorld(clips[i], -1, bandX);
      else if (w && bandX !== null && i === w.from) toWorld(clips[i], 1, bandX);
      else {
        clips[i].normal.set(1, 0, 0);
        clips[i].constant = on.current[i] ? KEEP_ALL : KEEP_NONE;
      }
    });
    if (band.current) {
      band.current.visible = bandX !== null || warm;
      band.current.position.x = bandX ?? -width;
    }
    toWorld(edges[0], 1, -width / 2);
    toWorld(edges[1], -1, width / 2);
  });

  // the crawl: one seamless loop, scrolled by texture offset. A new texture per loop: a GPU texture
  // keeps the size it was first uploaded at. Repainted only when the items actually change.
  const labelW = (tickerH * 360) / TICKER_H;
  const crawlW = width - labelW;
  const items = useMemo(() => tickerItems(feed, MARKETS), [feed]);
  const itemsKey = JSON.stringify(items);
  const crawl = useRef<THREE.CanvasTexture | null>(null);
  const [crawlMap, setCrawlMap] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    const visiblePx = (crawlW / tickerH) * TICKER_H;
    const cv = paintTicker(items, visiblePx + 200);
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.wrapS = THREE.RepeatWrapping;
    tx.anisotropy = 4;
    tx.repeat.x = visiblePx / cv.width;
    crawl.current?.dispose();
    crawl.current = tx;
    setCrawlMap(tx);
  }, [itemsKey, fontsReady, crawlW]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => crawl.current?.dispose(), []);
  useFrame((_, dt) => {
    const tx = crawl.current;
    const cv = tx?.image as HTMLCanvasElement | undefined;
    if (tx && cv?.width) tx.offset.x = (tx.offset.x + (dt * 150) / cv.width) % 1;
  });
  const label = useCanvas(360, TICKER_H);
  useEffect(() => {
    const c = label.ctx;
    c.fillStyle = BONE;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(360, 0);
    c.lineTo(330, TICKER_H);
    c.lineTo(0, TICKER_H);
    c.closePath();
    c.fill();
    c.fillStyle = '#07080b';
    c.font = `700 36px ${getComputedStyle(document.documentElement).getPropertyValue('--font-chakra').trim() || 'sans-serif'}`;
    c.letterSpacing = '6px';
    c.textBaseline = 'middle';
    c.fillText('LIVE FEED', 34, TICKER_H / 2 + 2);
    label.texture.needsUpdate = true;
  }, [label, fontsReady]);

  const tickerY = -height / 2 - gap - tickerH / 2;
  return (
    <group ref={group} position={position}>
      <Frame w={width} h={height + gap + tickerH} c={cut} lift={position[1]} />
      <group position={[0, (gap + tickerH) / 2, 0]}>
        {canvases.map((c, i) => (
          <mesh key={i} ref={(m) => void (planes.current[i] = m)} geometry={geo} renderOrder={i}>
            <meshBasicMaterial map={c.texture} color={SCREEN_TINT} toneMapped={false} clippingPlanes={[clips[i]]} />
          </mesh>
        ))}
        <LiveDot at={head} color={headColor} clip={[clips[0]]} size={0.8} on={() => on.current[0]} />
        <mesh ref={band} geometry={bandGeo} position={[-width, 0, 0.02]}>
          <meshBasicMaterial color={BONE} toneMapped={false} clippingPlanes={edges} />
        </mesh>
        <group position={[0, tickerY, 0]}>
          <mesh position={[labelW / 2 - width / 2, 0, 0.004]}>
            <planeGeometry args={[labelW, tickerH]} />
            <meshBasicMaterial map={label.texture} color={SCREEN_TINT} toneMapped={false} />
          </mesh>
          {crawlMap && (
            <mesh position={[labelW / 2, 0, 0]}>
              <planeGeometry args={[crawlW, tickerH]} />
              <meshBasicMaterial map={crawlMap} color={SCREEN_TINT} toneMapped={false} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}

// ─── wing towers ──────────────────────────────────────────────────────────
function Tower({ market, position, rotationY, width, data }: { market: MarketSymbol; position: [number, number, number]; rotationY: number; width: number; data: BoardData }) {
  const height = (width * TOWER.h) / TOWER.w;
  const { feed, fontsReady } = data;
  const ticks = useBoardTicks(market, data.off);
  const c = useCanvas(TOWER.w, TOWER.h);
  const head = useRef<THREE.Vector3 | null>(null);
  const [color, setColor] = useState(UP);
  useEffect(() => {
    head.current = toLocal(paintTower(c.ctx, market, ticks, feed, MARKETS.indexOf(market)), width, height, TOWER.w, TOWER.h);
    const vals = ticks.slice(-600);
    setColor(vals.length > 1 && vals.at(-1)!.px < vals[0].px ? DOWN : UP);
    c.texture.needsUpdate = true;
  }, [ticks, feed, market, fontsReady, c, width, height]);
  useEffect(() => () => c.texture.dispose(), [c]);
  const geo = useMemo(() => screenGeometry(width, height, 0.36), [width, height]);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Frame w={width} h={height} c={0.36} lift={position[1]} />
      <mesh geometry={geo}>
        <meshBasicMaterial map={c.texture} color={TOWER_TINT} toneMapped={false} />
      </mesh>
      <LiveDot at={head} color={color} size={0.55} />
    </group>
  );
}

/** Stadium-style market wall behind the arena: BTC centre, ETH and MON towers on the wings. */
export function Jumbotron() {
  const data = useBoardData();
  return (
    <group>
      {/* A triptych sized to the lobby shot: all three tops level just under the top bar, the ribbon
          ends above the pedestal nameplates, the wings sit between the side panels and the ribbon. */}
      <CentreBoard market="BTC" position={[0, 5.37, -14]} width={14} data={data} />
      <Tower market="ETH" position={[-8.9, 4.37, -14]} rotationY={0.3} width={2.6} data={data} />
      <Tower market="MON" position={[8.9, 4.37, -14]} rotationY={-0.3} width={2.6} data={data} />
    </group>
  );
}
