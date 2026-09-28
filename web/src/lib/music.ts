'use client';
/*
 * Procedural soundtrack (no audio files): two looping tracks in A minor, generated with WebAudio.
 *   menu  : 84 BPM · soft pads, sub bass, echoing arpeggio, quiet hats (lobby, pages, results)
 *   match : 124 BPM · kick, snare, pulsing bass, 16th hats and arp (VS countdown + the fight)
 * A lookahead scheduler queues notes ~120 ms ahead on the audio clock, so timing stays tight
 * even when the page is busy. Tracks crossfade; the whole thing starts on the first user gesture.
 */
import { ac } from './sfx';

export type Track = 'menu' | 'match';

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);
const LOOKAHEAD = 0.12;

interface Chord {
  bass: number;
  tones: number[];
}
const AM = { bass: 33, tones: [57, 60, 64] };
const F = { bass: 29, tones: [53, 57, 60] };
const C = { bass: 36, tones: [55, 60, 64] };
const G = { bass: 31, tones: [55, 59, 62] };
const E = { bass: 28, tones: [52, 56, 59] };
const SONG: Record<Track, { bpm: number; chords: Chord[] }> = {
  menu: { bpm: 84, chords: [AM, F, C, G] },
  match: { bpm: 124, chords: [AM, AM, F, E] },
};

let enabled = true;
let volume = 0.55;
try {
  enabled = localStorage.getItem('ls.music') !== '0';
  const v = Number(localStorage.getItem('ls.musicVol'));
  if (v > 0 && v <= 1) volume = v;
} catch {}

let started = false;
let wanted: Track = 'menu';
let intensity = 0.3;
let master: GainNode | undefined;
let noiseBuf: AudioBuffer | undefined;
const bus: Partial<Record<Track, { gain: GainNode; echo: DelayNode; step: number; next: number; live: boolean }>> = {};
let timer: ReturnType<typeof setInterval> | undefined;

function setup(c: AudioContext) {
  if (master) return;
  master = c.createGain();
  master.gain.value = enabled ? volume * 0.5 : 0;
  master.connect(c.destination);
  noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  for (const t of ['menu', 'match'] as Track[]) {
    const gain = c.createGain();
    gain.gain.value = 0;
    // a shared echo per track gives the arp and pads some space
    const echo = c.createDelay(1);
    echo.delayTime.value = (60 / SONG[t].bpm) * 0.75;
    const fb = c.createGain();
    fb.gain.value = 0.28;
    const wet = c.createGain();
    wet.gain.value = 0.35;
    echo.connect(fb).connect(echo);
    echo.connect(wet).connect(gain);
    gain.connect(master);
    bus[t] = { gain, echo, step: 0, next: 0, live: false };
  }
}

type Voice = { type?: OscillatorType; gain?: number; attack?: number; release?: number; cutoff?: number; q?: number; detune?: number; echo?: boolean };
function tone(c: AudioContext, t: Track, at: number, freq: number, dur: number, v: Voice = {}) {
  const b = bus[t]!;
  const { type = 'sine', gain = 0.05, attack = 0.005, release = 0.1, cutoff = 12000, q = 0.7, detune = 0 } = v;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.setValueAtTime(gain, at + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  f.connect(g).connect(b.gain);
  if (v.echo) g.connect(b.echo);
  for (const cents of detune ? [-detune, detune] : [0]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = cents;
    o.connect(f);
    o.start(at);
    o.stop(at + dur + 0.05);
  }
}

function hit(c: AudioContext, t: Track, at: number, kind: 'hat' | 'snare', gain: number) {
  const src = c.createBufferSource();
  src.buffer = noiseBuf!;
  const f = c.createBiquadFilter();
  f.type = kind === 'hat' ? 'highpass' : 'bandpass';
  f.frequency.value = kind === 'hat' ? 7500 : 1800;
  const g = c.createGain();
  const dur = kind === 'hat' ? 0.045 : 0.18;
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(bus[t]!.gain);
  src.start(at, Math.random() * 0.5, dur + 0.02);
}

function kick(c: AudioContext, t: Track, at: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(150, at);
  o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
  g.gain.setValueAtTime(0.55, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
  o.connect(g).connect(bus[t]!.gain);
  o.start(at);
  o.stop(at + 0.36);
}

/** One 16th-note step of a track at time `at`. */
function play(c: AudioContext, t: Track, step: number, at: number) {
  const { bpm, chords } = SONG[t];
  const s16 = 60 / bpm / 4;
  const bar = Math.floor(step / 16) % chords.length;
  const i = step % 16;
  const ch = chords[bar];
  if (t === 'menu') {
    if (i === 0) {
      for (const n of ch.tones) tone(c, t, at, midi(n), s16 * 16, { type: 'sawtooth', gain: 0.022, attack: 0.9, release: 1.1, cutoff: 900, detune: 7, echo: true });
      tone(c, t, at, midi(ch.bass + 12), s16 * 7, { type: 'sine', gain: 0.11, attack: 0.02, release: 0.5 });
    }
    if (i === 8) tone(c, t, at, midi(ch.bass + 12), s16 * 7, { type: 'sine', gain: 0.08, attack: 0.02, release: 0.5 });
    if (i % 2 === 0) {
      const arp = [0, 1, 2, 1, 2, 0, 1, 2][(i / 2) % 8];
      const lift = Math.floor(step / 64) % 2 ? 24 : 12; // every other loop an octave up
      tone(c, t, at, midi(ch.tones[arp] + lift), s16 * 1.6, { type: 'triangle', gain: 0.03, release: 0.18, echo: true });
    }
    if (i % 4 === 2) hit(c, t, at, 'hat', 0.018);
    return;
  }
  // match
  if (i % 4 === 0) kick(c, t, at);
  if (i === 4 || i === 12) hit(c, t, at, 'snare', 0.11);
  hit(c, t, at, 'hat', i % 2 ? 0.035 : 0.018);
  const bassNote = ch.bass + (i % 8 === 6 ? 24 : 12);
  tone(c, t, at, midi(bassNote), s16 * 0.9, { type: 'sawtooth', gain: 0.07, release: 0.08, cutoff: 260 + intensity * 1100, q: 6 });
  if (i % 2 === 0 || intensity > 0.6) {
    const arp = [0, 2, 1, 2][i % 4];
    tone(c, t, at, midi(ch.tones[arp] + 24), s16 * 0.8, { type: 'square', gain: 0.012 + intensity * 0.01, release: 0.06, cutoff: 3200, echo: true });
  }
  if (i === 0) for (const n of ch.tones) tone(c, t, at, midi(n + 12), s16 * 16, { type: 'sawtooth', gain: 0.012, attack: 0.3, release: 0.6, cutoff: 1400, detune: 9 });
}

function schedule() {
  const c = ac();
  if (!c) return;
  for (const t of ['menu', 'match'] as Track[]) {
    const b = bus[t]!;
    if (!b.live) continue;
    const s16 = 60 / SONG[t].bpm / 4;
    if (b.next < c.currentTime) b.next = c.currentTime + 0.05;
    while (b.next < c.currentTime + LOOKAHEAD) {
      play(c, t, b.step++, b.next);
      b.next += s16;
    }
  }
}

function fadeTo(track: Track) {
  const c = ac();
  if (!c) return;
  const now = c.currentTime;
  for (const t of ['menu', 'match'] as Track[]) {
    const b = bus[t]!;
    const on = t === track;
    b.gain.gain.cancelScheduledValues(now);
    b.gain.gain.setValueAtTime(b.gain.gain.value, now);
    b.gain.gain.linearRampToValueAtTime(on ? 1 : 0, now + 1.4);
    if (on && !b.live) {
      b.live = true;
      b.step = 0;
      b.next = now + 0.05;
    }
    // stop generating a faded-out track once it is silent
    if (!on) setTimeout(() => wanted !== t && (b.live = false), 1600);
  }
}

function start() {
  if (started || typeof window === 'undefined') return;
  const c = ac();
  if (!c) return;
  started = true;
  setup(c);
  fadeTo(wanted);
  timer = setInterval(schedule, 25);
  document.addEventListener('visibilitychange', () => {
    if (!master) return;
    master.gain.setTargetAtTime(document.hidden || !enabled ? 0 : volume * 0.5, c.currentTime, 0.2);
  });
}

export const music = {
  /** Call once on the client: begins on the first tap/click/key (autoplay rules). */
  arm() {
    if (typeof window === 'undefined' || started) return;
    const go = () => {
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      if (enabled) start(); // switched off: nothing is generated until it's turned back on
    };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  },
  setTrack(t: Track) {
    if (t === wanted) return;
    wanted = t;
    if (started) fadeTo(t);
  },
  setIntensity(x: number) {
    intensity = Math.max(0, Math.min(1, x));
  },
  isOn: () => enabled,
  volume: () => volume,
  setOn(on: boolean) {
    enabled = on;
    try {
      localStorage.setItem('ls.music', on ? '1' : '0');
    } catch {}
    const c = ac();
    if (on && !started) start();
    if (master && c) master.gain.setTargetAtTime(on ? volume * 0.5 : 0, c.currentTime, 0.15);
  },
  setVolume(v: number) {
    volume = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem('ls.musicVol', String(volume));
    } catch {}
    const c = ac();
    if (master && c && enabled) master.gain.setTargetAtTime(volume * 0.5, c.currentTime, 0.1);
  },
  stopTimer: () => timer && clearInterval(timer),
};
