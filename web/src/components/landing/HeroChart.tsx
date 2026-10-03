'use client';
import { useEffect, useRef } from 'react';
import { CLASSES } from '@longshort/shared';

/*
 * Hero key art: a dense candlestick chart that streams left forever. Canvas 2D (no WebGL): a
 * mean-reverting random walk with trend regimes and volatility bursts, new candle every PERIOD,
 * the live candle forming at the right edge, EMA, volume, and illustrative trades pinned on candles.
 * It is decoration, so it carries no price numbers and no invented traders; the trades use the
 * game's real leverage, and the page overlays the real Perpl mark instead.
 * Pauses offscreen and in background tabs; with reduced motion it draws one still frame.
 */

const STEP = 6; // px per candle (css)
const BODY = 4;
const PERIOD = 0.42; // s per candle
const PAD_R = 96; // room right of the live candle for its glow
const UP = '#2fd08a';
const DOWN = '#ff3d5a';
const VIOLET = '#8f6bff';
const LEV = CLASSES.tank.leverage; // the leverage a player actually gets

interface Marker {
  side: 1 | -1; // long / short
  label: string;
  liq?: boolean;
}
interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  mark?: Marker;
}

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

class Market {
  p = 100;
  drift = 0;
  vol = 1;
  regimeLeft = 0;
  cascade = 0; // seconds left in a liquidation cascade
  cascadeDir = 1;
  cascadeMarked = false;
  sinceMark = 0;
  candles: Candle[] = [];

  constructor(n: number) {
    // pre-roll so the chart opens full
    this.candles.push({ o: this.p, h: this.p, l: this.p, c: this.p, v: 0 });
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 8; k++) this.step(PERIOD / 8);
      this.roll();
    }
  }

  get live() {
    return this.candles[this.candles.length - 1];
  }

  step(dt: number) {
    this.regimeLeft -= dt;
    if (this.regimeLeft <= 0) {
      this.regimeLeft = 2 + Math.random() * 6;
      this.drift = (Math.random() - 0.5) * 0.5;
    }
    if (this.cascade <= 0 && Math.random() < dt * 0.05) {
      this.cascade = 1.2 + Math.random() * 1.2;
      this.cascadeDir = Math.random() < 0.5 ? -1 : 1;
      this.cascadeMarked = false;
    }
    this.vol += (1 - this.vol) * Math.min(1, dt * 0.8);
    let mu = this.drift + (100 - this.p) * 0.03; // weak pull home keeps it on screen for ever
    let sigma = 1.0 * this.vol;
    if (this.cascade > 0) {
      this.cascade -= dt;
      mu += this.cascadeDir * 1.6;
      sigma *= 2.2;
      this.vol = Math.max(this.vol, 1.8);
    }
    const dp = mu * dt + sigma * Math.sqrt(dt) * gauss();
    this.p += dp;
    const c = this.live;
    c.c = this.p;
    c.h = Math.max(c.h, this.p);
    c.l = Math.min(c.l, this.p);
    c.v += Math.abs(dp) * 6 + dt * (0.4 + Math.random() * 0.6);
  }

  roll() {
    const prev = this.live;
    // pin a trade on the candle that just closed, now and then
    this.sinceMark++;
    if (this.cascade > 0 && !this.cascadeMarked && this.sinceMark > 10 && Math.random() < 0.5) {
      this.cascadeMarked = true;
      prev.mark = { side: this.cascadeDir > 0 ? -1 : 1, label: `${LEV}x LIQUIDATED`, liq: true };
      this.sinceMark = 0;
    } else if (this.sinceMark > 26 && Math.random() < 0.1) {
      const side: 1 | -1 = Math.random() < 0.5 + this.drift * 0.4 ? 1 : -1;
      prev.mark = { side, label: `${side > 0 ? 'LONG' : 'SHORT'} ${LEV}x` };
      this.sinceMark = 0;
    }
    this.candles.push({ o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
    if (this.candles.length > 600) this.candles.splice(0, this.candles.length - 600);
  }
}

export function HeroChart({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const mk = new Market(260);
    let W = 0;
    let H = 0;
    let dpr = 1;
    let phase = 0; // 0..1 through the live candle's period
    let yLo = NaN;
    let yHi = NaN;
    let raf = 0;
    let last = 0;
    let visible = true;

    const resize = () => {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      draw(0);
    };

    const draw = (t: number) => {
      if (!W || !H) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const n = Math.min(mk.candles.length, Math.ceil((W - PAD_R) / STEP) + 2);
      const cs = mk.candles.slice(-n);
      const xOf = (k: number) => W - PAD_R - k * STEP - phase * STEP; // k = 0 is the live candle

      // price band (top 76%) and volume band (bottom 16%)
      const top = H * 0.1;
      const bottom = H * 0.8;
      const volTop = H * 0.84;
      let lo = Infinity;
      let hi = -Infinity;
      let vMax = 0;
      for (const c of cs) {
        lo = Math.min(lo, c.l);
        hi = Math.max(hi, c.h);
        vMax = Math.max(vMax, c.v);
      }
      const pad = (hi - lo) * 0.08 + 0.05;
      if (Number.isNaN(yLo)) {
        yLo = lo - pad;
        yHi = hi + pad;
      }
      yLo += (lo - pad - yLo) * 0.06;
      yHi += (hi + pad - yHi) * 0.06;
      const y = (p: number) => bottom - ((p - yLo) / (yHi - yLo)) * (bottom - top);

      // grid: price rows fixed, time columns ride with the candles
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(239,233,220,0.05)';
      ctx.beginPath();
      for (let i = 0; i <= 5; i++) {
        const gy = Math.round(top + ((bottom - top) * i) / 5) + 0.5;
        ctx.moveTo(0, gy);
        ctx.lineTo(W, gy);
      }
      const base = mk.candles.length;
      for (let k = 0; k < n; k++) {
        if ((base - k) % 24 === 0) {
          const gx = Math.round(xOf(k)) + 0.5;
          ctx.moveTo(gx, top - 20);
          ctx.lineTo(gx, H);
        }
      }
      ctx.stroke();

      // volume
      for (let k = 0; k < n; k++) {
        const c = cs[n - 1 - k];
        const up = c.c >= c.o;
        const h = (c.v / (vMax || 1)) * (H - volTop - 6);
        ctx.fillStyle = up ? 'rgba(47,208,138,0.22)' : 'rgba(255,61,90,0.22)';
        ctx.fillRect(Math.round(xOf(k) - BODY / 2), H - 4 - h, BODY, h);
      }

      // candles: wicks then bodies, newest brightest
      for (let k = n - 1; k >= 0; k--) {
        const c = cs[n - 1 - k];
        const up = c.c >= c.o;
        const x = Math.round(xOf(k));
        ctx.fillStyle = up ? UP : DOWN;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(x - 0.5, y(c.h), 1, Math.max(1, y(c.l) - y(c.h)));
        const yo = y(c.o);
        const yc = y(c.c);
        ctx.globalAlpha = 1;
        ctx.fillRect(x - BODY / 2, Math.min(yo, yc), BODY, Math.max(1.5, Math.abs(yc - yo)));
      }
      ctx.globalAlpha = 1;

      // EMA(55) faint, EMA(21) violet with glow
      const emaPath = (len: number) => {
        const a = 2 / (len + 1);
        let ema = cs[0].c;
        ctx.beginPath();
        for (let k = n - 1; k >= 0; k--) {
          ema += (cs[n - 1 - k].c - ema) * a;
          if (k === n - 1) ctx.moveTo(xOf(k), y(ema));
          else ctx.lineTo(xOf(k), y(ema));
        }
      };
      emaPath(55);
      ctx.strokeStyle = 'rgba(239,233,220,0.28)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      emaPath(21);
      ctx.strokeStyle = VIOLET;
      ctx.lineWidth = 1.8;
      ctx.shadowColor = VIOLET;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // live price: dashed rule + pulsing dot
      const lv = mk.live;
      const ly = y(lv.c);
      const lup = lv.c >= lv.o;
      const col = lup ? UP : DOWN;
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = lup ? 'rgba(47,208,138,0.55)' : 'rgba(255,61,90,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(ly) + 0.5);
      ctx.lineTo(W, Math.round(ly) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      const lx = xOf(0);
      const pulse = (t / 1000) % 1.4;
      ctx.fillStyle = col;
      ctx.globalAlpha = Math.max(0, 0.45 - pulse * 0.32);
      ctx.beginPath();
      ctx.arc(lx, ly, 4 + pulse * 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // crew trades pinned on candles
      ctx.font = '600 10px ui-monospace, "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      for (let k = 1; k < n; k++) {
        const c = cs[n - 1 - k];
        if (!c.mark) continue;
        const m = c.mark;
        const x = xOf(k);
        const long = m.side > 0;
        const tone = m.liq ? '#ffc857' : long ? UP : DOWN;
        const ay = long ? y(c.l) + 8 : y(c.h) - 8;
        // arrow
        ctx.fillStyle = tone;
        ctx.beginPath();
        const s = long ? 1 : -1;
        ctx.moveTo(x, ay - 3 * s);
        ctx.lineTo(x + 4.5, ay + 4 * s);
        ctx.lineTo(x - 4.5, ay + 4 * s);
        ctx.fill();
        // tag
        const tw = ctx.measureText(m.label).width + 14;
        const ty = long ? ay + 16 : ay - 16;
        const tx = Math.min(x - 7, W - PAD_R - tw);
        ctx.fillStyle = 'rgba(10,10,13,0.86)';
        ctx.strokeStyle = tone;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(tx, ty - 9, tw, 18, 3);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = tone;
        ctx.fillText(m.label, tx + 7, ty + 0.5);
      }
    };

    const tick = (dt: number, t: number) => {
      mk.step(dt);
      phase += dt / PERIOD;
      while (phase >= 1) {
        phase -= 1;
        mk.roll();
      }
      draw(t);
    };
    const frame = (t: number) => {
      tick(Math.min(0.05, (t - (last || t)) / 1000), t);
      last = t;
      raf = requestAnimationFrame(frame);
    };
    // dev-only: lets automated checks advance the chart when the tab is hidden (rAF paused)
    if (process.env.NODE_ENV !== 'production')
      (window as unknown as { __chartStep?: (n?: number) => void }).__chartStep = (n = 60) => {
        for (let i = 0; i < n; i++) tick(1 / 60, performance.now() + i * 16.7);
      };
    const start = () => {
      if (reduced || raf || !visible || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(cv);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    resize();
    start();
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
