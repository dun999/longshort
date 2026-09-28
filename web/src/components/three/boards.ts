'use client';
/**
 * Canvas painters for the arena's screens, in the style of an esports broadcast package: a slanted
 * bone tab, one big number, one glowing line. Everything that moves (ticker crawl, live dot, scene
 * wipes) is animated by the 3D scene instead, so a canvas is only repainted when its data changes.
 */
import { fmtPx, fmtUsd, level, STAKE, type MarketSymbol } from '@longshort/shared';
import type { Tick } from '@/lib/socket';
import { sigil } from '@/lib/sigil';

export const INK = '#07080b';
const BONE = '#e7e1d3';
const TEXT = '#d9d6cf';
const MUTED = '#8a909a';
const DIM = '#4d535e';
export const UP = '#4aa37c';
export const DOWN = '#d25a55';
const GOLD = '#c9a24a';

export interface FeedRow { kind: string; name: string | null; addr: string; market: number | null; is_long: number | null; notional: number | null; pnl: number | null; fee: number | null; ts: number }
export interface Leader { addr: string; name: string | null; xp: number; wins: number; earned: number; bot: number | boolean }
export type Pt = { x: number; y: number };

// next/font registers hashed family names; resolve them from the CSS variables once
let fam: { chakra: string; saira: string; jet: string } | null = null;
function fonts() {
  if (!fam) {
    const cs = getComputedStyle(document.documentElement);
    const v = (k: string, d: string) => cs.getPropertyValue(k).trim() || d;
    fam = { chakra: v('--font-chakra', 'sans-serif'), saira: v('--font-saira', 'sans-serif'), jet: v('--font-jet', 'monospace') };
  }
  return fam;
}
/** Canvas text only uses faces the page has already loaded: fetch the board's faces up front. */
export async function loadBoardFonts() {
  const f = fonts();
  await Promise.all([`italic 800 100px ${f.saira}`, `700 40px ${f.chakra}`, `600 20px ${f.chakra}`, `700 40px ${f.jet}`, `500 20px ${f.jet}`].map((s) => document.fonts.load(s).catch(() => [])));
}

/** Sets the largest font (≤ size) at which `text` fits in maxW. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, size: number, maxW: number) {
  let px = size;
  ctx.font = font(px);
  while (px > 12 && ctx.measureText(text).width > maxW) ctx.font = font((px -= 4));
  return px;
}
const display = (px: number) => `italic 800 ${px}px ${fonts().saira}`;
const condensed = (ctx: CanvasRenderingContext2D, on: boolean) => {
  if ('fontStretch' in ctx) (ctx as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = on ? 'extra-condensed' : 'normal';
};

function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0d0f14');
  g.addColorStop(1, INK);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // LED rows: a faint horizontal grain, like a screen seen up close
  ctx.fillStyle = 'rgba(255,255,255,0.018)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
}

/** The slanted bone tab: the site's diagonal-cut motif. Returns its right edge. */
function tab(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, label: string, px: number) {
  const f = fonts();
  ctx.font = `700 ${px}px ${f.chakra}`;
  ctx.letterSpacing = `${Math.round(px * 0.12)}px`;
  const w = ctx.measureText(label).width + px * 1.3;
  const k = h * 0.32;
  ctx.fillStyle = BONE;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w + k, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + px * 0.6, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '0px';
  return x + w + k;
}

function live(ctx: CanvasRenderingContext2D, x: number, y: number, px: number) {
  ctx.fillStyle = DOWN;
  ctx.beginPath();
  ctx.arc(x + px * 0.35, y, px * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MUTED;
  ctx.font = `700 ${px}px ${fonts().chakra}`;
  ctx.letterSpacing = `${Math.round(px * 0.2)}px`;
  ctx.textBaseline = 'middle';
  ctx.fillText('LIVE', x + px * 1, y + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '0px';
}

/** Last price per bucket over the window, oldest first. */
function series(ticks: Tick[], windowSec: number, points: number) {
  if (!ticks.length) return [];
  const end = ticks.at(-1)!.t;
  const start = end - windowSec * 1000;
  const step = (windowSec * 1000) / points;
  const out: number[] = [];
  let i = 0;
  let last = ticks.find((t) => t.t >= start)?.px ?? ticks[0].px;
  for (let b = 1; b <= points; b++) {
    const until = start + b * step;
    while (i < ticks.length && ticks[i].t <= until) {
      if (ticks[i].t >= start) last = ticks[i].px;
      i++;
    }
    out.push(last);
  }
  return out;
}

/** Glowing price line with a fading fill beneath. Returns where the live end sits. */
function line(ctx: CanvasRenderingContext2D, vals: number[], box: { x: number; y: number; w: number; h: number }, color: string): Pt | null {
  if (vals.length < 2) return null;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo || hi * 0.0004) * 0.18;
  lo -= pad;
  hi += pad;
  const X = (i: number) => box.x + (i / (vals.length - 1)) * box.w;
  const Y = (v: number) => box.y + box.h - ((v - lo) / (hi - lo)) * box.h;
  // baseline: where the window opened
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = 'rgba(231,225,211,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.x, Y(vals[0]));
  ctx.lineTo(box.x + box.w, Y(vals[0]));
  ctx.stroke();
  ctx.setLineDash([]);
  const path = () => {
    ctx.beginPath();
    vals.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  };
  const fill = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  fill.addColorStop(0, `${color}55`);
  fill.addColorStop(1, `${color}00`);
  path();
  ctx.lineTo(X(vals.length - 1), box.y + box.h);
  ctx.lineTo(box.x, box.y + box.h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.lineWidth = 6;
  path();
  ctx.stroke();
  ctx.shadowBlur = 0;
  return { x: X(vals.length - 1), y: Y(vals.at(-1)!) };
}

const pipsW = (n: number) => n * 34 + 190; // pips plus their label, reserved at the header's right

/** Scene position markers in the header: which of the rotating scenes is on air. */
function pips(ctx: CanvasRenderingContext2D, right: number, y: number, n: number, on: number, label: string) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i === on ? BONE : 'rgba(231,225,211,0.18)';
    ctx.fillRect(right - (n - i) * 34, y - 3, 26, 6);
  }
  ctx.fillStyle = MUTED;
  ctx.font = `700 22px ${fonts().chakra}`;
  ctx.letterSpacing = '5px';
  ctx.textAlign = 'right';
  ctx.fillText(label, right - n * 34 - 14, y + 8);
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
}

export const BOARD = { w: 1600, h: 240 };
const L = 36; // left margin
const R = BOARD.w - 36;

function header(ctx: CanvasRenderingContext2D, market: MarketSymbol, scene: number, scenes: number, label: string) {
  const r = tab(ctx, L, 16, 46, market, 28);
  live(ctx, r + 18, 16 + 23, 16);
  pips(ctx, R, 16 + 23, scenes, scene, label);
}

const signed = (n: number, digits = 3) => `${n >= 0 ? '▲ +' : '▼ −'}${Math.abs(n).toFixed(digits)}%`;
const caps = (ctx: CanvasRenderingContext2D, px: number, spacing: number, color: string) => {
  ctx.font = `700 ${px}px ${fonts().chakra}`;
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillStyle = color;
};

/** Centre board, scene 1: the price. One big number left, the last five minutes as one line right. */
export function paintPrice(ctx: CanvasRenderingContext2D, market: MarketSymbol, ticks: Tick[], scene: number, scenes: number): Pt | null {
  const { w, h } = BOARD;
  backdrop(ctx, w, h);
  header(ctx, market, scene, scenes, 'LIVE PRICE');
  const vals = series(ticks, 300, 150);
  const last = vals.at(-1);
  if (!last) {
    caps(ctx, 30, 6, DIM);
    ctx.fillText('WAITING FOR THE FEED…', L, 170);
    ctx.letterSpacing = '0px';
    return null;
  }
  const chg = ((last - vals[0]) / vals[0]) * 100;
  const color = chg >= 0 ? UP : DOWN;
  condensed(ctx, true);
  fit(ctx, fmtPx(last), display, 142, 520);
  ctx.fillStyle = BONE;
  const pw = ctx.measureText(fmtPx(last)).width;
  ctx.fillText(fmtPx(last), L - 4, 216);
  condensed(ctx, false);
  const cx = L + pw + 30;
  ctx.fillStyle = color;
  ctx.font = `700 32px ${fonts().jet}`;
  ctx.fillText(signed(chg), cx, 160);
  caps(ctx, 18, 5, DIM);
  ctx.fillText('LAST 5 MIN', cx + 2, 204);
  ctx.letterSpacing = '0px';
  const chart = { x: Math.max(cx + 280, 860), y: 88, w: 0, h: 128 };
  chart.w = R - chart.x;
  ctx.font = `500 18px ${fonts().jet}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  ctx.fillText(`H ${fmtPx(Math.max(...vals))}   L ${fmtPx(Math.min(...vals))}`, R - pipsW(scenes) - 30, 46);
  ctx.textAlign = 'left';
  return line(ctx, vals, chart, color);
}

/** Longs vs shorts among recent opens (by size), optionally on one market. */
export function flow(feed: FeedRow[], market?: number) {
  const opens = feed.filter((r) => r.kind === 'open' && (market === undefined || r.market === market));
  const long = opens.filter((r) => r.is_long).reduce((s, r) => s + (r.notional ?? 0), 0);
  const all = opens.reduce((s, r) => s + (r.notional ?? 0), 0);
  return { n: opens.length, volume: all, longShare: all ? long / all : 0.5 };
}

/** Centre board, scene 2: the arena's mood, as a tug of war. */
export function paintPulse(ctx: CanvasRenderingContext2D, market: MarketSymbol, feed: FeedRow[], online: number, scene: number, scenes: number) {
  const { w, h } = BOARD;
  backdrop(ctx, w, h);
  header(ctx, market, scene, scenes, 'ARENA PULSE');
  const f = flow(feed);
  const pct = Math.round(f.longShare * 100);
  condensed(ctx, true);
  ctx.font = display(130);
  ctx.fillStyle = UP;
  ctx.fillText(`${pct}%`, L - 4, 216);
  const lw = ctx.measureText(`${pct}%`).width;
  ctx.textAlign = 'right';
  ctx.fillStyle = DOWN;
  ctx.fillText(`${100 - pct}%`, R, 216);
  const rw = ctx.measureText(`${100 - pct}%`).width;
  ctx.textAlign = 'left';
  condensed(ctx, false);
  // the tug bar between the two numbers, the same picture as the in-match scorebar
  const bx = L + lw + 50;
  const bw = R - rw - 50 - bx;
  const split = bx + bw * f.longShare;
  caps(ctx, 20, 7, UP);
  ctx.fillText('LONGS', bx, 112);
  ctx.textAlign = 'right';
  ctx.fillStyle = DOWN;
  ctx.fillText('SHORTS', bx + bw, 112);
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
  ctx.fillStyle = UP;
  ctx.fillRect(bx, 128, split - bx - 3, 28);
  ctx.fillStyle = DOWN;
  ctx.fillRect(split + 3, 128, bx + bw - split - 3, 28);
  ctx.fillStyle = BONE;
  ctx.fillRect(bx + bw / 2 - 1, 120, 2, 44);
  const vol = f.volume >= 1e6 ? `$${(f.volume / 1e6).toFixed(2)}M` : `$${Math.round(f.volume / 1000)}K`;
  ctx.font = `600 22px ${fonts().jet}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.fillText([`${f.n} RECENT TRADES`, `${vol} VOLUME`, ...(online ? [`${online} ONLINE`] : [])].join('  ·  '), bx + bw / 2, 204);
  ctx.textAlign = 'left';
}

function drawSigil(ctx: CanvasRenderingContext2D, addr: string, x: number, y: number, size: number) {
  const { cells, fg, alt } = sigil(addr);
  const u = size / 7;
  ctx.fillStyle = '#15171c';
  ctx.fillRect(x, y, size, size);
  for (const [cx, cy, two] of cells) {
    ctx.fillStyle = two ? alt : fg;
    ctx.fillRect(x + (cx + 1) * u, y + (cy + 1) * u, Math.ceil(u), Math.ceil(u));
  }
}
const nameOf = (n: string | null, addr: string) => (n ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`).replace(/^bot·/, '');

/** Centre board, scene 3: the season's best (humans only), three across. */
export function paintTop(ctx: CanvasRenderingContext2D, market: MarketSymbol, top: Leader[], scene: number, scenes: number) {
  const { w, h } = BOARD;
  backdrop(ctx, w, h);
  header(ctx, market, scene, scenes, 'TOP PLAYERS');
  const col = (R - L) / 3;
  top.slice(0, 3).forEach((p, i) => {
    const x = L + i * col;
    condensed(ctx, true);
    ctx.font = display(130);
    ctx.fillStyle = i === 0 ? GOLD : 'rgba(231,225,211,0.22)';
    ctx.fillText(String(i + 1), x - 4, 216);
    condensed(ctx, false);
    drawSigil(ctx, p.addr, x + 80, 84, 132);
    const tx = x + 234;
    ctx.fillStyle = TEXT;
    fit(ctx, nameOf(p.name, p.addr), (px) => `700 ${px}px ${fonts().chakra}`, 36, col - 250);
    ctx.fillText(nameOf(p.name, p.addr), tx, 124);
    caps(ctx, 18, 4, MUTED);
    ctx.fillText(`LVL ${level(p.xp)} · ${p.wins} WIN${p.wins === 1 ? '' : 'S'}`, tx, 162);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = p.earned > 0 ? GOLD : DIM;
    ctx.font = `700 28px ${fonts().jet}`;
    ctx.fillText(`${p.earned > 0 ? '+' : ''}${p.earned.toFixed(2)} ${STAKE}`, tx, 210);
  });
}

export const TOWER = { w: 540, h: 960 };

/** Side tower: one market, portrait. Returns where the live end sits. */
export function paintTower(ctx: CanvasRenderingContext2D, market: MarketSymbol, ticks: Tick[], feed: FeedRow[], mIdx: number): Pt | null {
  const { w, h } = TOWER;
  backdrop(ctx, w, h);
  const r = tab(ctx, 30, 34, 58, market, 34);
  live(ctx, r + 18, 34 + 29, 18);
  const vals = series(ticks, 600, 90);
  const last = vals.at(-1);
  if (!last) return null;
  const chg = ((last - vals[0]) / vals[0]) * 100;
  const color = chg >= 0 ? UP : DOWN;
  condensed(ctx, true);
  fit(ctx, fmtPx(last), display, 124, w - 60);
  ctx.fillStyle = BONE;
  ctx.fillText(fmtPx(last), 28, 218);
  condensed(ctx, false);
  ctx.fillStyle = color;
  ctx.font = `700 34px ${fonts().jet}`;
  ctx.fillText(signed(chg), 30, 272);
  ctx.fillStyle = DIM;
  ctx.font = `600 20px ${fonts().chakra}`;
  ctx.letterSpacing = '4px';
  ctx.fillText('10 MIN', w - 30 - ctx.measureText('10 MIN').width, 270);
  ctx.letterSpacing = '0px';
  const head = line(ctx, vals, { x: 30, y: 320, w: w - 60, h: 420 }, color);
  // this market's order flow
  const f = flow(feed, mIdx);
  const L = Math.round(f.longShare * 100);
  ctx.font = `700 22px ${fonts().chakra}`;
  ctx.letterSpacing = '4px';
  ctx.fillStyle = MUTED;
  ctx.fillText(f.n ? 'LONGS VS SHORTS' : 'NO RECENT TRADES', 30, 812);
  ctx.letterSpacing = '0px';
  const split = 30 + (w - 60) * f.longShare;
  ctx.fillStyle = f.n ? UP : 'rgba(231,225,211,0.12)';
  ctx.fillRect(30, 832, split - 33, 22);
  ctx.fillStyle = f.n ? DOWN : 'rgba(231,225,211,0.12)';
  ctx.fillRect(split + 3, 832, w - 30 - split - 3, 22);
  if (f.n) {
    ctx.font = `700 30px ${fonts().jet}`;
    ctx.fillStyle = UP;
    ctx.fillText(`${L}%`, 30, 900);
    ctx.fillStyle = DOWN;
    ctx.textAlign = 'right';
    ctx.fillText(`${100 - L}%`, w - 30, 900);
    ctx.textAlign = 'left';
  }
  return head;
}

/** Ticker items, newest first, from the arena's recent trades. */
export function tickerItems(feed: FeedRow[], markets: readonly string[]) {
  return feed.slice(0, 24).map((r) => {
    const who = nameOf(r.name, r.addr).toUpperCase();
    const mk = r.market !== null ? markets[r.market] : '';
    if (r.kind === 'open') return { who, text: `${r.is_long ? '▲ LONG' : '▼ SHORT'} ${mk} ${r.notional ? `$${(r.notional / 1000).toFixed(1)}K` : ''}`, color: r.is_long ? UP : DOWN };
    if (r.kind === 'close') {
      const net = (r.pnl ?? 0) - (r.fee ?? 0);
      return { who, text: `CLOSED ${fmtUsd(net, true)}`, color: net >= 0 ? UP : DOWN };
    }
    if (r.kind === 'liquidated') return { who, text: 'LIQUIDATED', color: GOLD };
    return { who, text: 'ELIMINATED', color: GOLD };
  });
}

export const TICKER_H = 96;

export const TICKER_MAX_W = 4096; // many phone GPUs cap textures at 4096 px: the loop must fit

/** One seamless loop of the crawl: the newest items that fit in TICKER_MAX_W, repeated up to ≥ minW. */
export function paintTicker(items: { who: string; text: string; color: string }[], minW: number): HTMLCanvasElement {
  const f = fonts();
  const probe = document.createElement('canvas').getContext('2d')!;
  const gap = 90;
  const measure = (it: { who: string; text: string }) => {
    probe.font = `700 40px ${f.chakra}`;
    probe.letterSpacing = '3px';
    const a = probe.measureText(it.who).width;
    probe.font = `700 36px ${f.jet}`;
    probe.letterSpacing = '0px';
    return a + 22 + probe.measureText(it.text).width + gap;
  };
  const all = items.length ? items : [{ who: 'ARENA', text: 'QUIET · BE THE FIRST TRADE', color: MUTED }];
  const list: typeof all = [];
  let used = 0;
  for (const it of all) {
    const w = measure(it);
    if (list.length && used + w > TICKER_MAX_W) break;
    list.push(it);
    used += w;
  }
  let loop = [...list];
  while (loop.reduce((s, it) => s + measure(it), 0) < minW && loop.length + list.length <= 64) loop = [...loop, ...list];
  const width = Math.ceil(loop.reduce((s, it) => s + measure(it), 0));
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = TICKER_H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, TICKER_H);
  ctx.textBaseline = 'middle';
  let x = 0;
  for (const it of loop) {
    ctx.font = `700 40px ${f.chakra}`;
    ctx.letterSpacing = '3px';
    ctx.fillStyle = TEXT;
    ctx.fillText(it.who, x, TICKER_H / 2 + 2);
    x += ctx.measureText(it.who).width + 22;
    ctx.letterSpacing = '0px';
    ctx.font = `700 36px ${f.jet}`;
    ctx.fillStyle = it.color;
    ctx.fillText(it.text, x, TICKER_H / 2 + 2);
    x += ctx.measureText(it.text).width + gap / 2;
    // separator: the site's diamond
    ctx.fillStyle = 'rgba(231,225,211,0.35)';
    ctx.save();
    ctx.translate(x - 6, TICKER_H / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-6, -6, 12, 12);
    ctx.restore();
    x += gap / 2;
  }
  return cv;
}
