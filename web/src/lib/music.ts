'use client';
/*
 * Soundtrack: two loops composed in scripts/bgm/compose.mjs and rendered from sampled instruments.
 *   menu  : lobby.mp3 · 100 BPM swung funk: finger bass, Rhodes, guitar scratches, marimba and whistle hooks, brass
 *   match : duel.mp3 · 132 BPM action: slap bass, spiccato strings, clavinet, brass
 *           + duel-hype.mp3 (trumpet lead, toms, tambourine, timpani), whose level follows the match intensity
 * Each file carries 0.3 s of continuation on both sides of its loop, so the loop points stay seamless
 * whatever priming delay the MP3 decoder adds. Tracks crossfade; only the playing one stays decoded.
 * Nothing loads or plays before the first user gesture.
 */
import { asset } from './asset';
import { ac } from './sfx';

export type Track = 'menu' | 'match';

const TRACKS: Track[] = ['menu', 'match'];
const SONG: Record<Track, { stems: string[]; loop: [number, number] }> = {
  menu: { stems: [asset('/audio/lobby.mp3')], loop: [0.3, 77.1] },
  match: { stems: [asset('/audio/duel.mp3'), asset('/audio/duel-hype.mp3')], loop: [0.3, 58.48183333] },
};
const LEVEL = 0.8; // master gain at full volume
const FADE = 1.4;

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
let hypeTarget = 0;
let master: GainNode | undefined;
const files = new Map<string, Promise<ArrayBuffer>>();
interface Bus {
  gain: GainNode;
  hype: GainNode;
  sources: AudioBufferSourceNode[];
  buffers?: Promise<AudioBuffer[]>;
  idle?: ReturnType<typeof setTimeout>;
}
const bus: Partial<Record<Track, Bus>> = {};

/** The hype stem sits out until the fight heats up (intensity 0.25 at VS, 0.5 once live, up to 1). */
const hypeLevel = () => Math.min(1, Math.max(0, (intensity - 0.35) / 0.45));

function setup(c: AudioContext) {
  if (master) return;
  master = c.createGain();
  master.gain.value = enabled ? volume * LEVEL : 0;
  master.connect(c.destination);
  for (const t of TRACKS) {
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const hype = c.createGain();
    hype.gain.value = hypeTarget = hypeLevel();
    hype.connect(gain);
    bus[t] = { gain, hype, sources: [] };
  }
}

function fetchOnce(url: string) {
  let f = files.get(url);
  if (!f) {
    f = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.arrayBuffer();
    });
    f.catch(() => files.delete(url)); // a failed download is retried next time
    files.set(url, f);
  }
  return f;
}

/**
 * The loop start and end hold the same music but different MP3 coding noise. Blending the last samples
 * before the end into the copy just before the start makes the jump back sample-continuous.
 */
function smoothSeam(buf: AudioBuffer, [loopStart, loopEnd]: [number, number]) {
  const a = Math.round(loopStart * buf.sampleRate), b = Math.round(loopEnd * buf.sampleRate), n = 1024;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const w = (i + 1) / n;
      d[b - n + i] = d[b - n + i] * (1 - w) + d[a - n + i] * w;
    }
  }
  return buf;
}

function play(c: AudioContext, t: Track) {
  const b = bus[t]!;
  if (b.sources.length) return;
  // decodeAudioData detaches its input, so each decode gets a copy of the downloaded bytes
  const buffers = (b.buffers ??= Promise.all(SONG[t].stems.map(async (u) => smoothSeam(await c.decodeAudioData((await fetchOnce(u)).slice(0)), SONG[t].loop))));
  buffers.then(
    (bufs) => {
      if (wanted !== t || b.sources.length || b.buffers !== buffers) return;
      const at = c.currentTime + 0.05;
      const [loopStart, loopEnd] = SONG[t].loop;
      b.sources = bufs.map((buf, i) => {
        const s = c.createBufferSource();
        s.buffer = buf;
        s.loop = true;
        s.loopStart = loopStart;
        s.loopEnd = loopEnd;
        s.connect(i ? b.hype : b.gain);
        s.start(at, loopStart);
        return s;
      });
      const g = b.gain.gain;
      g.cancelScheduledValues(at);
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(1, at + FADE);
    },
    () => b.buffers === buffers && (b.buffers = undefined),
  );
}

/** Silence a faded-out track and drop its decoded audio (the download stays cached). */
function stop(t: Track) {
  const b = bus[t]!;
  for (const s of b.sources) {
    try {
      s.stop();
    } catch {}
    s.disconnect();
  }
  b.sources = [];
  b.buffers = undefined;
}

function fadeTo(track: Track) {
  const c = ac();
  if (!c || !master) return;
  const now = c.currentTime;
  for (const t of TRACKS) {
    const b = bus[t]!;
    const g = b.gain.gain;
    clearTimeout(b.idle);
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (t === track) {
      if (b.sources.length) g.linearRampToValueAtTime(1, now + FADE);
      else play(c, t);
    } else {
      g.linearRampToValueAtTime(0, now + FADE);
      b.idle = setTimeout(() => wanted !== t && stop(t), (FADE + 0.2) * 1000);
    }
  }
}

function start() {
  if (started || typeof window === 'undefined') return;
  const c = ac();
  if (!c) return;
  started = true;
  setup(c);
  fadeTo(wanted);
  // fetch the other track in the background so the switch doesn't wait on the network
  setTimeout(() => TRACKS.forEach((t) => SONG[t].stems.forEach((u) => void fetchOnce(u).catch(() => {}))), 4000);
  document.addEventListener('visibilitychange', () => {
    if (!master) return;
    master.gain.setTargetAtTime(document.hidden || !enabled ? 0 : volume * LEVEL, c.currentTime, 0.2);
  });
}

export const music = {
  /** Call once on the client: begins on the first tap/click/key (autoplay rules). */
  arm() {
    if (typeof window === 'undefined' || started) return;
    const go = () => {
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      if (enabled) start(); // switched off: nothing is downloaded until it's turned back on
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
    const h = bus.match?.hype;
    if (!started || !h || Math.abs(hypeLevel() - hypeTarget) < 0.005) return;
    hypeTarget = hypeLevel();
    h.gain.setTargetAtTime(hypeTarget, ac()!.currentTime, 0.6);
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
    if (master && c) master.gain.setTargetAtTime(on ? volume * LEVEL : 0, c.currentTime, 0.15);
  },
  setVolume(v: number) {
    volume = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem('ls.musicVol', String(volume));
    } catch {}
    const c = ac();
    if (master && c && enabled) master.gain.setTargetAtTime(volume * LEVEL, c.currentTime, 0.1);
  },
};
