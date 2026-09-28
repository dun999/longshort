'use client';
// Procedural WebAudio sound effects: no assets, instant, and mutable.
let ctx: AudioContext | undefined;
let muted = false;
try {
  muted = localStorage.getItem('ls.muted') === '1';
} catch {}

/** The one AudioContext for effects and music (created lazily; browsers need a user gesture first). */
export const ac = () => {
  if (typeof window === 'undefined') return;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

function tone(freq: number, dur: number, { type = 'sine' as OscillatorType, gain = 0.12, slide = 0, delay = 0 } = {}) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.2, delay = 0) {
  const c = ac();
  if (!c || muted) return;
  const t = c.currentTime + delay;
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1800, t);
  f.frequency.exponentialRampToValueAtTime(80, t + dur);
  const g = c.createGain();
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

export const sfx = {
  hover: () => tone(1400, 0.04, { type: 'triangle', gain: 0.025 }),
  click: () => tone(700, 0.07, { type: 'square', gain: 0.04, slide: 300 }),
  select: () => (tone(520, 0.08, { type: 'triangle', gain: 0.08 }), tone(780, 0.12, { type: 'triangle', gain: 0.08, delay: 0.06 })),
  queue: () => tone(300, 0.5, { gain: 0.05, slide: 60 }),
  found: () => [0, 0.12, 0.24].forEach((d, i) => tone([523, 659, 988][i], 0.35, { type: 'triangle', gain: 0.12, delay: d })),
  lockIn: () => (noise(0.25, 0.15), tone(180, 0.35, { type: 'sawtooth', gain: 0.08, slide: -90 }), tone(880, 0.2, { type: 'triangle', gain: 0.08, delay: 0.05 })),
  beep: (hi = false) => tone(hi ? 1320 : 660, hi ? 0.35 : 0.12, { type: 'square', gain: 0.05 }),
  long: () => tone(380, 0.18, { type: 'sawtooth', gain: 0.06, slide: 500 }),
  short: () => tone(760, 0.18, { type: 'sawtooth', gain: 0.06, slide: -450 }),
  close: () => tone(520, 0.1, { type: 'triangle', gain: 0.07 }),
  confirm: () => tone(1760, 0.06, { type: 'sine', gain: 0.04 }),
  error: () => tone(160, 0.25, { type: 'square', gain: 0.06, slide: -60 }),
  boom: () => (noise(0.9, 0.35), tone(90, 0.8, { type: 'sine', gain: 0.25, slide: -60 })),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.45, { type: 'triangle', gain: 0.1, delay: i * 0.11 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.5, { type: 'sine', gain: 0.1, delay: i * 0.16 })),
  isMuted: () => muted,
  toggle: () => {
    muted = !muted;
    try {
      localStorage.setItem('ls.muted', muted ? '1' : '0');
    } catch {}
    return muted;
  },
};
