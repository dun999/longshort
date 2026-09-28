'use client';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { fmtPx, type MarketSymbol } from '@longshort/shared';
import { useSocket, type Tick } from '@/lib/socket';

const W = 1280;
const H = 560;
const UP = '#4aa37c';
const DOWN = '#d25a55';

interface C {
  o: number;
  h: number;
  l: number;
  c: number;
}

function candles(ticks: Tick[], tf: number, max: number): C[] {
  const by = new Map<number, C>();
  for (const t of ticks) {
    const b = Math.floor(t.t / 1000 / tf);
    const c = by.get(b);
    if (!c) by.set(b, { o: t.px, h: t.px, l: t.px, c: t.px });
    else (c.h = Math.max(c.h, t.px)), (c.l = Math.min(c.l, t.px)), (c.c = t.px);
  }
  const keys = [...by.keys()].sort((a, b) => a - b);
  const out: C[] = [];
  if (!keys.length) return out;
  for (let b = keys[0]; b <= keys.at(-1)!; b++) {
    const c = by.get(b);
    const p = out.at(-1);
    if (c) out.push(p ? { ...c, o: p.c, h: Math.max(c.h, p.c), l: Math.min(c.l, p.c) } : c);
    else if (p) out.push({ o: p.c, h: p.c, l: p.c, c: p.c });
  }
  return out.slice(-max);
}

// next/font registers hashed family names; resolve them from the CSS variables once
let fonts: { display: string; mono: string } | null = null;
function fontFamilies() {
  if (!fonts) {
    const cs = getComputedStyle(document.documentElement);
    fonts = { display: cs.getPropertyValue('--font-chakra').trim() || 'sans-serif', mono: cs.getPropertyValue('--font-jet').trim() || 'monospace' };
  }
  return fonts;
}

/** Paints a broadcast-style market panel: header, candles, price axis, live tag. */
function paint(ctx: CanvasRenderingContext2D, market: MarketSymbol, ticks: Tick[], big: boolean) {
  const data = candles(ticks, big ? 5 : 10, big ? 90 : 48);
  const f = fontFamilies();
  ctx.fillStyle = '#0b0d11';
  ctx.fillRect(0, 0, W, H);
  // header
  const last = data.at(-1)?.c;
  const first = data[0]?.o;
  const chg = last && first ? ((last - first) / first) * 100 : 0;
  ctx.fillStyle = '#e7e5e0';
  ctx.font = `700 54px ${f.display}`;
  ctx.fillText(`${market}-PERP`, 40, 78);
  ctx.font = `700 54px ${f.mono}`;
  ctx.textAlign = 'right';
  ctx.fillText(last ? fmtPx(last) : '…', W - 40, 78);
  ctx.font = `600 28px ${f.mono}`;
  ctx.fillStyle = chg >= 0 ? UP : DOWN;
  ctx.fillText(`${chg >= 0 ? '▲ +' : '▼ '}${chg.toFixed(3)}%`, W - 40, 118);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#626873';
  ctx.font = `600 22px ${f.display}`;
  ctx.fillText(`PERPL MARK · MONAD · ${big ? '5S' : '10S'} CANDLES`, 42, 116);
  // live tag
  ctx.fillStyle = DOWN;
  ctx.beginPath();
  ctx.arc(W - 250, 150, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e7e5e0';
  ctx.font = `700 20px ${f.display}`;
  ctx.fillText('LIVE', W - 236, 157);

  // plot
  const top = 175;
  const bottom = H - 40;
  const left = 40;
  const right = W - 150;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = top + ((bottom - top) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
  if (data.length < 2) {
    ctx.fillStyle = '#626873';
    ctx.font = `600 26px ${f.display}`;
    ctx.fillText('Waiting for price feed…', left, (top + bottom) / 2);
    return;
  }
  let lo = Math.min(...data.map((c) => c.l));
  let hi = Math.max(...data.map((c) => c.h));
  const pad = (hi - lo || hi * 0.0005) * 0.15;
  lo -= pad;
  hi += pad;
  const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const step = (right - left) / data.length;
  const bw = Math.max(3, step * 0.62);
  data.forEach((c, i) => {
    const x = left + i * step + step / 2;
    const col = c.c >= c.o ? UP : DOWN;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = Math.max(1.5, step * 0.12);
    ctx.beginPath();
    ctx.moveTo(x, y(c.h));
    ctx.lineTo(x, y(c.l));
    ctx.stroke();
    const yo = y(c.o);
    const yc = y(c.c);
    ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(2, Math.abs(yc - yo)));
  });
  // price axis + last price line
  ctx.fillStyle = '#8a909a';
  ctx.font = `500 20px ${f.mono}`;
  for (let i = 0; i <= 4; i++) {
    const v = hi - ((hi - lo) * i) / 4;
    ctx.fillText(fmtPx(v), right + 14, top + ((bottom - top) * i) / 4 + 7);
  }
  if (last) {
    const ly = y(last);
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(231,229,224,0.5)';
    ctx.beginPath();
    ctx.moveTo(left, ly);
    ctx.lineTo(right, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e7e5e0';
    ctx.fillRect(right + 6, ly - 15, 140, 30);
    ctx.fillStyle = '#0b0d11';
    ctx.font = `700 20px ${f.mono}`;
    ctx.fillText(fmtPx(last), right + 14, ly + 7);
  }
}

function Screen({ market, position, rotationY = 0, width, big }: { market: MarketSymbol; position: [number, number, number]; rotationY?: number; width: number; big: boolean }) {
  const ticks = useSocket((s) => s.prices[market]);
  const { canvas, texture } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return { canvas, texture };
  }, []);
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paint(ctx, market, ticks, big);
    texture.needsUpdate = true;
  }, [ticks, canvas, texture, market, big]);
  useEffect(() => () => texture.dispose(), [texture]);

  const height = (width * H) / W;
  const legH = position[1] - height / 2;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* bezel */}
      <mesh position={[0, 0, -0.12]}>
        <boxGeometry args={[width + 0.5, height + 0.5, 0.2]} />
        <meshStandardMaterial color="#15171c" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, -height / 2 - 0.2, 0.0]}>
        <boxGeometry args={[width * 0.35, 0.05, 0.05]} />
        <meshBasicMaterial color="#8a8578" />
      </mesh>
      {/* the picture: unlit so it reads like an emissive LED wall */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {/* support legs */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * width * 0.32, -height / 2 - legH / 2, -0.2]}>
          <boxGeometry args={[0.22, legH, 0.22]} />
          <meshStandardMaterial color="#1a1c21" metalness={0.4} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/** Stadium-style market wall behind the arena: BTC centre, ETH and MON angled on the wings. */
export function Jumbotron() {
  return (
    <group>
      <Screen market="BTC" position={[0, 5.5, -14]} width={15} big />
      <Screen market="ETH" position={[-12.2, 5.2, -7.5]} rotationY={0.62} width={7.5} big={false} />
      <Screen market="MON" position={[12.2, 5.2, -7.5]} rotationY={-0.62} width={7.5} big={false} />
    </group>
  );
}
