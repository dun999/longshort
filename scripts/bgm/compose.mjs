// Composes and renders the soundtrack loops in web/public/audio (lobby, plus duel with its "hype" stem)
// from the note data below, using the GeneralUser GS soundfont. Each part renders 3 identical passes;
// the middle pass is the steady-state loop (tails of the previous pass included).
//
//   cd scripts/bgm && npm i --no-save --prefix . spessasynth_core
//   curl -L -o GeneralUser-GS.sf2 https://github.com/mrbumpy409/GeneralUser-GS/raw/main/GeneralUser-GS.sf2
//   node compose.mjs [lobby|duel]        (needs ffmpeg with libmp3lame)
//
// The printed loop points go into web/src/lib/music.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';

const SR = 48000;
const PAD = 0.3; // seconds of continuation kept on both sides of the loop (codec delay safety)
const OUT = new URL('../../web/public/audio/', import.meta.url).pathname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-'));
const ONLY = process.argv[2];
const sfBuf = fs.readFileSync(process.env.SF2 ?? new URL('./GeneralUser-GS.sf2', import.meta.url));
const bankAB = sfBuf.buffer.slice(sfBuf.byteOffset, sfBuf.byteOffset + sfBuf.byteLength);

// ---------- helpers
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const p = (s) => {
  if (typeof s === 'number') return s;
  const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return 12 * (Number(m[2]) + 1) + PC[m[1]];
};
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const nearest = (pc, around) => {
  let best = pc;
  for (let k = -4; k <= 4; k++) if (Math.abs(pc + 12 * k - around) < Math.abs(best - around)) best = pc + 12 * k;
  return best;
};

class Part {
  constructor(name, o) {
    Object.assign(this, { name, stem: 'base', ch: 0, bank: 0, program: 0, pan: 64, reverb: 40, chorus: 0, level: -24, human: 0.004, velHuman: 6, gate: 0.92, notes: [] }, o);
  }
  n(bar, step, len, key, vel) {
    this.notes.push({ bar, step, len, key: p(key), vel });
    return this;
  }
  seq(bar, str, vel = 90, shift = 0) {
    for (const tok of str.trim().split(/\s+/)) {
      const [s, k, l, v] = tok.split(':');
      this.n(bar, Number(s), Number(l), p(k) + shift, v ? Number(v) : vel);
    }
    return this;
  }
  chord(bar, step, len, keys, vel) {
    for (const k of keys) this.n(bar, step, len, k, vel);
    return this;
  }
}

// ---------- loudness (BS.1770 K-weighting at 48 kHz, gated)
function kweight(x) {
  const y = new Float32Array(x.length);
  const st = [
    [[1.53512485958697, -2.69169618940638, 1.19839281085285], [-1.69065929318241, 0.73248077421585]],
    [[1, -2, 1], [-1.99004745483398, 0.99007225036621]],
  ];
  let src = x;
  for (const [[b0, b1, b2], [a1, a2]] of st) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < src.length; i++) {
      const v = b0 * src[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = src[i]; y2 = y1; y1 = v;
      y[i] = v;
    }
    src = y.slice();
  }
  return src;
}
function lufs(L, R, from = 0, to = L.length) {
  const kl = kweight(L.subarray(from, to)), kr = kweight(R.subarray(from, to));
  const blk = Math.round(0.4 * SR), hop = Math.round(0.1 * SR);
  const z = [];
  for (let i = 0; i + blk <= kl.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + blk; j++) s += kl[j] * kl[j] + kr[j] * kr[j];
    z.push(s / blk);
  }
  const ld = (v) => -0.691 + 10 * Math.log10(v);
  let g = z.filter((v) => ld(v) > -70);
  if (!g.length) return -Infinity;
  const rel = ld(g.reduce((a, b) => a + b, 0) / g.length) - 10;
  g = g.filter((v) => ld(v) > rel);
  return ld(g.reduce((a, b) => a + b, 0) / g.length);
}
const peak = (...xs) => Math.max(...xs.map((x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));

// ---------- rendering
async function renderPart(T, part, seed) {
  const stepDur = 60 / T.bpm / 4;
  const Lsec = T.bars * 16 * stepDur;
  const total = Math.ceil((3 * Lsec + 4) * SR);
  const swingOff = (T.swing - 0.5) * 2; // in 16ths
  const at = (bar, step) => {
    const sw = Number.isInteger(step) && step % 2 === 1 ? swingOff : 0;
    return (bar * 16 + step + sw) * stepDur;
  };
  const r = rng(seed);
  const base = part.notes.map((nt) => {
    const t0 = at(nt.bar, nt.step) + (r() * 2 - 1) * part.human;
    const end = at(nt.bar, nt.step) + nt.len * stepDur * part.gate;
    const vel = Math.max(1, Math.min(127, Math.round(nt.vel + (r() * 2 - 1) * part.velHuman)));
    return { t0: Math.max(0, t0), t1: Math.max(t0 + 0.02, end), key: nt.key, vel };
  });
  // three identical passes
  let notes = [];
  for (let k = 0; k < 3; k++) for (const nt of base) notes.push({ ...nt, t0: nt.t0 + k * Lsec, t1: nt.t1 + k * Lsec });
  // a key can't overlap itself on one channel: trim to just before the next strike
  const byKey = new Map();
  for (const nt of notes) (byKey.get(nt.key) ?? byKey.set(nt.key, []).get(nt.key)).push(nt);
  for (const list of byKey.values()) {
    list.sort((a, b) => a.t0 - b.t0);
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i + 1].t0 - list[i].t0 < 0.003) { list[i + 1].dead = true; continue; }
      list[i].t1 = Math.min(list[i].t1, list[i + 1].t0 - 0.002);
    }
  }
  notes = notes.filter((n) => !n.dead);
  const ev = [];
  for (const nt of notes) {
    ev.push({ s: Math.round(nt.t0 * SR), on: true, key: nt.key, vel: nt.vel });
    ev.push({ s: Math.round(nt.t1 * SR), on: false, key: nt.key });
  }
  ev.sort((a, b) => a.s - b.s || (a.on === b.on ? 0 : a.on ? 1 : -1));

  const synth = new SpessaSynthProcessor(SR, { effectsEnabled: true, eventsEnabled: false });
  synth.soundBankManager.addSoundBank(SoundBankLoader.fromArrayBuffer(bankAB.slice(0)), 'main');
  await synth.processorInitialized;
  synth.setSystemParameter?.('autoAllocateVoices', true);
  const ch = part.ch;
  synth.controllerChange(ch, 0, part.bank);
  synth.programChange(ch, part.program);
  synth.controllerChange(ch, 7, 110);
  synth.controllerChange(ch, 10, part.pan);
  synth.controllerChange(ch, 91, part.reverb);
  synth.controllerChange(ch, 93, part.chorus);
  const L = new Float32Array(total), R = new Float32Array(total);
  let pos = 0, ei = 0;
  while (pos < total) {
    while (ei < ev.length && ev[ei].s <= pos) {
      const e = ev[ei++];
      if (e.on) synth.noteOn(ch, e.key, e.vel);
      else synth.noteOff(ch, e.key);
    }
    const until = ei < ev.length ? ev[ei].s : total;
    const n = Math.max(1, Math.min(128, until - pos, total - pos));
    synth.process(L, R, pos, n);
    pos += n;
  }
  const from = Math.round(Lsec * SR), to = Math.round(2 * Lsec * SR);
  const loud = lufs(L, R, from, to);
  return { L, R, loud, Lsec };
}

function writeWav(path, chans) {
  const n = chans[0].length, nc = chans.length;
  const buf = Buffer.alloc(44 + n * nc * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * nc * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * nc * 4, 28); buf.writeUInt16LE(nc * 4, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * nc * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++, o += 4) buf.writeFloatLE(chans[c][i], o);
  fs.writeFileSync(path, buf);
}
function readWav(path) {
  const b = fs.readFileSync(path);
  let o = 12, nc = 2, data;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') nc = b.readUInt16LE(o + 10);
    if (id === 'data') { data = [o + 8, sz]; break; }
    o += 8 + sz + (sz & 1);
  }
  const n = data[1] / 4 / nc;
  const ch = Array.from({ length: nc }, () => new Float32Array(n));
  for (let i = 0, q = data[0]; i < n; i++) for (let c = 0; c < nc; c++, q += 4) ch[c][i] = b.readFloatLE(q);
  return ch;
}

async function build(T, parts, target, eq) {
  console.log(`\n== ${T.name}: ${T.bars} bars @ ${T.bpm} BPM`);
  const rendered = [];
  let seed = 7;
  for (const part of parts) {
    if (!part.notes.length) continue;
    const t = Date.now();
    const r = await renderPart(T, part, seed++);
    const gain = Number.isFinite(r.loud) ? 10 ** ((part.level - r.loud) / 20) : 0;
    console.log(`  ${part.name.padEnd(12)} ${part.stem.padEnd(5)} notes=${String(part.notes.length).padStart(4)} raw=${r.loud.toFixed(1)} LUFS → ${part.level} (x${gain.toFixed(2)})  ${Date.now() - t}ms`);
    rendered.push({ part, ...r, gain });
  }
  const Lsec = rendered[0].Lsec, n = rendered[0].L.length;
  const stems = {};
  for (const r of rendered) {
    const s = (stems[r.part.stem] ??= [new Float32Array(n), new Float32Array(n)]);
    for (let i = 0; i < n; i++) { s[0][i] += r.L[i] * r.gain; s[1][i] += r.R[i] * r.gain; }
  }
  // normalise the full mix (all stems) to the target loudness
  const all = [new Float32Array(n), new Float32Array(n)];
  for (const s of Object.values(stems)) for (let i = 0; i < n; i++) { all[0][i] += s[0][i]; all[1][i] += s[1][i]; }
  const from = Math.round(Lsec * SR), to = Math.round(2 * Lsec * SR);
  const g = 10 ** ((target - lufs(all[0], all[1], from, to)) / 20);
  for (const [name, s] of Object.entries(stems)) {
    for (const c of s) for (let i = 0; i < n; i++) c[i] *= g;
    const stem = `${T.name}${name === 'base' ? '' : '-' + name}`, file = `${TMP}/${stem}`;
    writeWav(`${file}.full.wav`, s);
    // brickwall at -1 dBFS; latency compensated so the timeline is unchanged
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${file}.full.wav`, '-af', `${eq},alimiter=limit=0.891:attack=4:release=80:level=disabled:latency=1`, '-c:a', 'pcm_f32le', `${file}.lim.wav`]);
    const [l, r] = readWav(`${file}.lim.wav`);
    // loop body = the middle pass, its head crossfaded from the continuation past its end (the synth's
    // chorus/LFOs drift a little between passes); the pads are copies of the body, so the file is periodic
    const off = Math.round(PAD * SR), len = to - from, X = Math.round(0.12 * SR);
    const loop = [l, r].map((c) => {
      const body = c.slice(from, to);
      for (let i = 0; i < X; i++) body[i] = c[from + i] * (i / X) + c[to + i] * (1 - i / X);
      const out = new Float32Array(len + 2 * off);
      out.set(body.subarray(len - off), 0);
      out.set(body, off);
      out.set(body.subarray(0, off), off + len);
      return out;
    });
    // seam check: the jump across the loop point vs the largest step anywhere in the body
    let seam = 0, step = 0;
    for (const c of loop) {
      seam = Math.max(seam, Math.abs(c[off] - c[off + len - 1]));
      for (let i = off + 1; i < off + len; i++) step = Math.max(step, Math.abs(c[i] - c[i - 1]));
    }
    seam = seam / step;
    writeWav(`${file}.wav`, loop);
    const kbps = name === 'base' ? '128k' : '96k';
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${file}.wav`, '-c:a', 'libmp3lame', '-b:a', kbps, `${OUT}${stem}.mp3`]);
    const size = fs.statSync(`${OUT}${stem}.mp3`).size;
    console.log(`  stem ${name}: ${lufs(loop[0], loop[1], off, off + len).toFixed(1)} LUFS, peak ${(20 * Math.log10(peak(...loop))).toFixed(1)} dBFS, seam jump ${(seam * 100).toFixed(0)}% of max step, ${(size / 1024).toFixed(0)} KB`);
    for (const ext of ['full.wav', 'lim.wav', 'wav']) fs.rmSync(`${file}.${ext}`);
  }
  console.log(`  mix ${target} LUFS · loop: [${PAD}, ${+(PAD + (to - from) / SR).toFixed(8)}]`);
}

// =====================================================================================
// LOBBY · 100 BPM swung funk in D dorian: finger bass, Rhodes, chicken-scratch guitar,
// marimba hook → whistle hook, brass melody. Form A1 B1 A2 B2 (8 bars each).
// =====================================================================================
function lobby() {
  const T = { name: 'lobby', bpm: 100, swing: 0.57, bars: 32 };
  const C = {
    Dm7: { root: 'D2', iv: [3, 7, 10], ep: ['F3', 'A3', 'C4', 'E4'], gt: ['F4', 'A4', 'C5'] },
    G7: { root: 'G1', iv: [4, 7, 10], ep: ['F3', 'A3', 'B3', 'E4'], gt: ['F4', 'B4', 'D5'] },
    Bbmaj7: { root: 'Bb1', iv: [4, 7, 11], maj: true, ep: ['F3', 'A3', 'C4', 'D4'], gt: ['F4', 'A4', 'D5'] },
    A7: { root: 'A1', iv: [4, 7, 10], ep: ['G3', 'A3', 'C#4', 'E4'], gt: ['G4', 'C#5', 'E5'] },
    C7: { root: 'C2', iv: [4, 7, 10], ep: ['E3', 'G3', 'Bb3', 'D4'], gt: ['E4', 'Bb4', 'D5'] },
    Am7: { root: 'A1', iv: [3, 7, 10], ep: ['G3', 'A3', 'C4', 'E4'], gt: ['G4', 'C5', 'E5'] },
    Gm7: { root: 'G1', iv: [3, 7, 10], ep: ['F3', 'A3', 'Bb3', 'D4'], gt: ['F4', 'Bb4', 'D5'] },
  };
  const A = ['Dm7', 'G7', 'Dm7', 'G7', 'Dm7', 'G7', 'Bbmaj7', 'A7'];
  const B = ['Bbmaj7', 'C7', 'Am7', 'Dm7', 'Bbmaj7', 'C7', 'Gm7', 'A7'];
  const form = [...A, ...B, ...A, ...B];
  const h1 = '2:A4:1 3:C5:1 4:D5:2 6:C5:1 7:D5:2 10:F5:2 12:E5:1 13:D5:1 14:C5:2';
  const h2 = '0:D5:3 3:B4:1 4:G4:2 7:A4:1 8:B4:2 10:D5:4';
  const h4 = '0:D5:2 2:E5:2 4:F5:2 6:E5:1 7:D5:2 10:B4:2 12:A4:4';
  const h7 = '0:D5:2 2:F5:2 4:A5:3 8:G5:1 9:F5:1 10:D5:2 12:C5:2 14:A4:2';
  const h8 = '0:C#5:2 2:E5:2 4:G5:2 6:E5:1 7:C#5:2 10:A4:4';
  const HOOK = [h1, h2, h1, h4, h1, h2, h7, h8];
  const b1 = '0:F5:3 3:D5:1 4:F5:2 6:G5:2 8:A5:4 12:G5:2 14:F5:2';
  const b2 = '0:E5:3 3:C5:1 4:E5:2 6:G5:2 8:Bb5:4 12:A5:2 14:G5:2';
  const b3 = '0:A5:6 6:G5:2 8:E5:4 12:C5:2 14:D5:2';
  const b4 = '0:F5:4 4:E5:2 6:D5:2 8:C5:2 10:D5:6';
  const b7 = '0:Bb5:4 4:A5:2 6:G5:2 8:F5:4 12:D5:2 14:E5:2';
  const b8 = '0:E5:4 4:C#5:2 6:E5:2 8:G5:4 12:A5:4';
  const MEL = [b1, b2, b3, b4, b1, b2, b7, b8];

  const drums = new Part('drums', { ch: 9, program: 0, reverb: 28, level: -20, human: 0.003, velHuman: 5 });
  const bass = new Part('bass', { ch: 0, program: 33, reverb: 6, level: -22, gate: 0.85 });
  const keys = new Part('rhodes', { ch: 1, program: 4, reverb: 50, chorus: 30, level: -30, pan: 50, gate: 0.8 });
  const gtr = new Part('guitar', { ch: 2, bank: 8, program: 28, reverb: 30, level: -33, pan: 86, gate: 0.7 });
  const mar = new Part('marimba', { ch: 3, program: 12, reverb: 50, level: -24, pan: 58 });
  const brass = new Part('brass', { ch: 4, program: 61, reverb: 55, level: -25, pan: 72, gate: 0.88 });
  const whistle = new Part('whistle', { ch: 5, bank: 11, program: 78, reverb: 62, level: -24, pan: 64, gate: 0.9 });
  const pizz = new Part('pizz', { ch: 6, program: 45, reverb: 45, level: -31, pan: 38 });
  const pad = new Part('strings', { ch: 7, program: 49, reverb: 70, level: -34, pan: 64, gate: 1 });

  for (let bar = 0; bar < T.bars; bar++) {
    const c = C[form[bar]], nx = C[form[(bar + 1) % T.bars]];
    const sec = ['A1', 'B1', 'A2', 'B2'][bar >> 3], inA = sec[0] === 'A', b8i = bar % 8, odd = bar % 2 === 1;
    const fill = bar === 31;
    // --- drums
    for (const [st, v] of odd ? [[0, 108], [10, 100], [13, 82]] : [[0, 110], [7, 86], [10, 100]]) drums.n(bar, st, 1, 36, v);
    drums.n(bar, 4, 1, 38, 102);
    if (!fill) drums.n(bar, 12, 1, 38, 106);
    if (!inA) {
      drums.n(bar, 4, 1, 39, 66);
      if (!fill) drums.n(bar, 12, 1, 39, 74);
    }
    if (odd) drums.n(bar, 9, 1, 38, 32);
    else drums.n(bar, 15, 1, 38, 36);
    for (let st = 0; st < 16; st += 2) {
      if (odd && st === 14) { drums.n(bar, 14, 2, 46, 60); continue; }
      drums.n(bar, st, 1, 42, st % 4 === 0 ? 76 : 56);
    }
    drums.n(bar, 3, 1, 42, 32).n(bar, 11, 1, 42, 32);
    if (b8i === 0) drums.n(bar, 0, 16, 49, 86);
    if (!inA) for (const st of [4, 12]) drums.n(bar, st, 1, 54, 64);
    if (sec === 'B2') {
      for (const st of [2, 6, 10, 14]) drums.n(bar, st, 1, 54, 42);
      for (let st = 0; st < 16; st++) drums.n(bar, st, 1, 70, st % 2 ? 26 : 40);
    }
    if (bar === 7 || bar === 23) drums.n(bar, 13, 1, 38, 46).n(bar, 14, 1, 38, 56).n(bar, 15, 1, 38, 68);
    if (bar === 15) drums.n(bar, 12, 2, 58, 84);
    if (fill) drums.n(bar, 12, 1, 38, 88).n(bar, 13, 1, 38, 74).n(bar, 14, 1, 47, 96).n(bar, 15, 1, 43, 104);

    // --- bass
    const r = p(c.root), [t3, t5, t7] = c.iv;
    const appr = nearest(p(nx.root) - 1, r + 5);
    bass.n(bar, 0, 3, r, 112).n(bar, 3, 1, r + 12, 78).n(bar, 6, 1, r + t7, 76).n(bar, 7, 2, r + t5, 96);
    bass.n(bar, 10, 2, r + t3, 100).n(bar, 12, 1, r + (c.maj ? 7 : 5), 78).n(bar, 14, 2, appr, 92);
    if (odd && !(sec === 'A1')) bass.n(bar, 9, 0.5, r + 12, 52);

    // --- rhodes comping
    if (!odd) keys.chord(bar, 0, 2, c.ep, 70).chord(bar, 6, 1, c.ep, 58).chord(bar, 10, 3, c.ep, 72);
    else keys.chord(bar, 3, 1, c.ep, 58).chord(bar, 6, 2, c.ep, 68).chord(bar, 11, 2, c.ep, 66).chord(bar, 14, 1, c.ep, 56);

    // --- guitar scratches (enter at bar 4)
    if (bar >= 4) {
      for (const st of [2, 6, 10, 14]) gtr.chord(bar, st, 0.6, c.gt, 84);
      gtr.n(bar, 7, 0.4, c.gt[0], 42).n(bar, 15, 0.4, c.gt[0], 42);
    }

    // --- melodies
    if (sec === 'A1') mar.seq(bar, HOOK[b8i], 96);
    if (sec === 'B1') mar.seq(bar, MEL[b8i], 90);
    if (sec === 'A2') whistle.seq(bar, HOOK[b8i], 94), mar.seq(bar, HOOK[b8i], 60);
    if (sec === 'B2') brass.seq(bar, MEL[b8i], 100, -12), mar.seq(bar, MEL[b8i], 82);

    // --- brass stabs answer the marimba in B1
    if (sec === 'B1' && odd) brass.chord(bar, 0, 1, c.gt, 102).chord(bar, 3, 1, c.gt, 94);
    if (bar === 15) brass.chord(bar, 12, 4, c.gt, 106);

    // --- pizzicato tresillo + string pad
    if (sec === 'A2' || sec === 'B2') {
      const rm = r + 12 < 48 ? r + 24 : r + 12;
      const e = c.ep.map(p);
      pizz.n(bar, 0, 1, rm, 80).n(bar, 3, 1, e[0], 60).n(bar, 6, 1, e[1], 64).n(bar, 8, 1, rm, 74).n(bar, 11, 1, e[1], 60).n(bar, 14, 1, e[2], 66);
    }
    if (!inA) pad.chord(bar, 0, 16, c.ep, sec === 'B1' ? 54 : 68);
  }
  return [T, [drums, bass, keys, gtr, mar, brass, whistle, pizz, pad]];
}

// =====================================================================================
// DUEL · 132 BPM straight action in D minor: slap bass, spiccato strings, clavinet, brass.
// The "hype" stem (toms, tambourine, timpani, trumpet + xylophone lead) rides the match
// intensity at runtime. Form A B A' B' (8 bars each).
// =====================================================================================
function duel() {
  const T = { name: 'duel', bpm: 132, swing: 0.5, bars: 32 };
  const C = {
    Dm: { root: 'D2', iv: [3, 7, 10], tri: ['D4', 'F4', 'A4'], os: ['D4', 'A4'] },
    Bb: { root: 'Bb1', iv: [4, 7, 9], tri: ['D4', 'F4', 'Bb4'], os: ['Bb3', 'F4'] },
    C: { root: 'C2', iv: [4, 7, 10], tri: ['E4', 'G4', 'C5'], os: ['C4', 'G4'] },
    A7: { root: 'A1', iv: [4, 7, 10], tri: ['C#4', 'E4', 'G4'], os: ['A3', 'E4'] },
    Gm: { root: 'G1', iv: [3, 7, 10], tri: ['D4', 'G4', 'Bb4'], os: ['G3', 'D4'] },
  };
  const A = ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A7'];
  const B = ['Gm', 'A7', 'Dm', 'Dm', 'Gm', 'A7', 'Bb', 'A7'];
  const form = [...A, ...B, ...A, ...B];
  const k0 = '0:D5:3 3:A4:3 6:D5:2 8:E5:2 10:F5:4 14:E5:2';
  const k1 = '0:D5:6 6:C5:2 8:A4:8';
  const k2 = '0:Bb4:3 3:D5:3 6:F5:2 8:G5:2 10:F5:4 14:D5:2';
  const k3 = '0:E5:3 3:G5:3 6:E5:2 8:C5:4 12:D5:2 14:E5:2';
  const k6 = '0:F5:3 3:D5:3 6:Bb4:2 8:D5:2 10:F5:4 14:G5:2';
  const k7 = '0:E5:4 4:C#5:4 8:A4:4 12:C#5:2 14:E5:2';
  const HOOK = [k0, k1, k2, k3, k0, k1, k6, k7];
  const c0 = '0:G4:4 4:Bb4:4 8:D5:6 14:C5:2';
  const c1 = '0:C#5:4 4:E5:4 8:A4:8';
  const c2 = '0:D5:4 4:F5:4 8:A5:6 14:G5:2';
  const c3 = '0:F5:6 6:E5:2 8:D5:8';
  const c6 = '0:D5:4 4:F5:4 8:Bb5:4 12:A5:4';
  const c7 = '0:G5:4 4:E5:4 8:C#5:4 12:A4:2 14:C#5:2';
  const COUNTER = [c0, c1, c2, c3, c0, c1, c6, c7];

  const drums = new Part('drums', { ch: 9, program: 16, reverb: 26, level: -20, human: 0.002, velHuman: 4 });
  const bass = new Part('slap', { ch: 0, program: 36, reverb: 6, level: -22, gate: 0.8, human: 0.003 });
  const str = new Part('strings', { ch: 1, program: 48, reverb: 40, level: -29, pan: 44, gate: 0.55, human: 0.002 });
  const clav = new Part('clav', { ch: 2, program: 7, reverb: 28, level: -30, pan: 84, gate: 0.6 });
  const brass = new Part('brass', { ch: 3, program: 61, reverb: 50, level: -24, pan: 70, gate: 0.9 });
  const hdrums = new Part('perc', { stem: 'hype', ch: 9, program: 16, reverb: 30, level: -25, human: 0.002, velHuman: 4 });
  const timp = new Part('timpani', { stem: 'hype', ch: 4, program: 47, reverb: 60, level: -27, gate: 1 });
  const tpt = new Part('trumpet', { stem: 'hype', ch: 5, program: 56, reverb: 55, level: -24, pan: 58, gate: 0.9 });
  const xyl = new Part('xylophone', { stem: 'hype', ch: 6, program: 13, reverb: 45, level: -31, pan: 40 });

  for (let bar = 0; bar < T.bars; bar++) {
    const c = C[form[bar]];
    const sec = ['A', 'B', "A'", "B'"][bar >> 3], b8i = bar % 8, odd = bar % 2 === 1, end8 = b8i === 7;
    // --- core drums
    for (const st of [0, 3, 8, 10]) drums.n(bar, st, 1, 36, st === 0 || st === 8 ? 112 : 96);
    drums.n(bar, 4, 1, 38, 108);
    if (!end8) drums.n(bar, 12, 1, 38, 110);
    for (let st = 0; st < 16; st += 2) drums.n(bar, st, 1, 42, st % 4 === 0 ? 82 : 62);
    if (b8i === 0) drums.n(bar, 0, 16, 49, 96);
    if (end8) drums.n(bar, 12, 1, 38, 86).n(bar, 13, 1, 38, 92).n(bar, 14, 1, 38, 100).n(bar, 15, 1, 38, 110);
    // --- hype percussion
    for (let st = 1; st < 16; st += 2) hdrums.n(bar, st, 1, 42, 42);
    for (const st of [2, 6, 10, 14]) hdrums.n(bar, st, 1, 54, 58);
    if (bar % 4 === 0) hdrums.n(bar, 0, 16, 57, 92);
    if (odd && !end8) hdrums.n(bar, 14, 1, 36, 92);
    if (end8) for (const [st, k, v] of [[8, 50, 92], [9, 50, 80], [10, 48, 96], [11, 48, 84], [12, 47, 100], [13, 45, 96], [14, 43, 108], [15, 41, 112]]) hdrums.n(bar, st, 1, k, v);
    if (bar % 4 === 0) timp.n(bar, 0, 8, p(c.root) + 12, 104);
    if (bar === 31) for (let st = 8; st < 16; st++) timp.n(bar, st, 1, 'A2', 60 + (st - 8) * 7);

    // --- slap bass
    const r = p(c.root), [t3, t5, t7] = c.iv;
    for (const [st, iv, len, v] of [[0, 0, 2, 112], [2, 0, 1, 82], [3, 12, 1, 100], [5, 0, 1, 80], [6, t5, 1, 92], [8, 0, 2, 108], [10, 0, 1, 82], [11, 12, 1, 98], [13, t7, 1, 86], [14, t5, 1, 90], [15, t3, 1, 84]])
      bass.n(bar, st, len, r + iv, v);

    // --- spiccato strings: 3-3-2 accents
    const [lo, hi] = c.os;
    for (let st = 0; st < 16; st++) {
      const acc = [0, 3, 6, 8, 11, 14].includes(st);
      str.n(bar, st, 1, [3, 6, 11, 14].includes(st) ? hi : lo, acc ? 96 : 50);
    }

    // --- clavinet
    if (sec[0] === 'A') for (const [st, len, v] of [[0, 1, 100], [3, 1, 80], [6, 2, 94], [10, 1, 84], [12, 1, 70], [14, 1, 90]]) clav.chord(bar, st, len, c.tri, v);
    else for (const st of [2, 6, 10, 14]) clav.chord(bar, st, 1, c.tri, 82);

    // --- brass
    const stab = [...c.tri, p(c.tri[0]) - 12];
    if (sec === 'A') {
      if (b8i === 2 || b8i === 6) brass.chord(bar, 0, 2, stab, 104).chord(bar, 3, 2, stab, 96).chord(bar, 6, 8, stab, 100);
      if (b8i === 3 || b8i === 7) brass.chord(bar, 0, 2, stab, 104).chord(bar, 3, 2, stab, 96).chord(bar, 6, 2, stab, 98).chord(bar, 8, b8i === 7 ? 8 : 6, stab, 106);
    }
    if (sec === "A'") brass.seq(bar, HOOK[b8i], 104, -12);
    if (sec[0] === 'B') brass.seq(bar, COUNTER[b8i], sec === 'B' ? 96 : 106, -12);

    // --- hype leads
    if (sec[0] === 'A') tpt.seq(bar, HOOK[b8i], 104);
    else tpt.seq(bar, COUNTER[b8i], 100);
    if (sec === "A'" || sec === "B'") xyl.seq(bar, sec === "A'" ? HOOK[b8i] : COUNTER[b8i], 84, 12);
  }
  return [T, [drums, bass, str, clav, brass, hdrums, timp, tpt, xyl]];
}

if (!ONLY || ONLY === 'lobby') { const [T, parts] = lobby(); await build(T, parts, -16.5, 'highpass=f=32,equalizer=f=250:t=q:w=1.2:g=-2.5,highshelf=f=2500:g=4'); }
if (!ONLY || ONLY === 'duel') { const [T, parts] = duel(); await build(T, parts, -15.5, 'highpass=f=32,equalizer=f=300:t=q:w=1:g=-1.5,highshelf=f=5000:g=2'); }
