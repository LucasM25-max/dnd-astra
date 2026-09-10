/**
 * Synthesize the dice/UI sound effects as small WAV files (22050 Hz mono).
 * No encoder dependency: PCM WAVs of 0.1–0.7 s are ~5–30 KB each.
 * Usage: node scripts/synth-sfx.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio', 'sfx');
mkdirSync(OUT, { recursive: true });

// Deterministic PRNG (mulberry32) so builds are reproducible.
let seed = 0xA57A;
const rand = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const buf = seconds => new Float64Array(Math.max(1, Math.floor(seconds * SR)));
const sine = (b, f0, f1, t0, dur, amp) => {
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  let phase = 0;
  for (let i = 0; i < n && s0 + i < b.length; i++) {
    const f = f0 + (f1 - f0) * (i / n);
    phase += (2 * Math.PI * f) / SR;
    const env = Math.exp(-3.2 * (i / n));
    b[s0 + i] += Math.sin(phase) * amp * env;
  }
};
const tri = (b, f0, f1, t0, dur, amp) => {
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  let phase = 0;
  for (let i = 0; i < n && s0 + i < b.length; i++) {
    const f = f0 + (f1 - f0) * (i / n);
    phase += (2 * Math.PI * f) / SR;
    const env = Math.exp(-4.5 * (i / n));
    b[s0 + i] += (2 / Math.PI) * Math.asin(Math.sin(phase)) * amp * env;
  }
};
const noise = (b, t0, dur, amp, lp = 0.2, hp = 0) => {
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  let y = 0, xPrev = 0, yHp = 0;
  for (let i = 0; i < n && s0 + i < b.length; i++) {
    const x = rand() * 2 - 1;
    y += lp * (x - y);
    let v = y;
    if (hp > 0) { yHp = hp * (yHp + y - xPrev); xPrev = y; v = yHp; }
    b[s0 + i] += v * amp * (1 - i / n);
  }
};
const sweepNoise = (b, t0, dur, amp, f0, f1) => {
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  let y = 0;
  for (let i = 0; i < n && s0 + i < b.length; i++) {
    const k = i / n;
    const lp = f0 + (f1 - f0) * k;
    y += lp * (rand() * 2 - 1 - y);
    b[s0 + i] += y * amp * Math.sin(Math.PI * k);
  }
};

const sounds = {
  dice_throw: () => { const b = buf(0.28); sweepNoise(b, 0, 0.26, 0.5, 0.03, 0.3); sine(b, 300, 700, 0, 0.2, 0.08); return b; },
  dice_bounce: () => { const b = buf(0.14); tri(b, 340, 180, 0, 0.12, 0.55); sine(b, 1250, 900, 0, 0.05, 0.2); noise(b, 0, 0.03, 0.3, 0.5); return b; },
  dice_land: () => { const b = buf(0.2); sine(b, 150, 65, 0, 0.18, 0.6); noise(b, 0, 0.08, 0.25, 0.12); return b; },
  dice_slam: () => { const b = buf(0.32); sine(b, 95, 45, 0, 0.3, 0.7); noise(b, 0, 0.14, 0.45, 0.1); sine(b, 2500, 1800, 0, 0.12, 0.1); return b; },
  dice_success: () => {
    const b = buf(0.75);
    sine(b, 523, 523, 0, 0.3, 0.4); sine(b, 659, 659, 0.1, 0.3, 0.4); sine(b, 784, 784, 0.2, 0.5, 0.42);
    sine(b, 1568, 1568, 0.2, 0.4, 0.1);
    return b;
  },
  dice_failure: () => {
    const b = buf(0.65);
    tri(b, 220, 55, 0.02, 0.55, 0.5); sine(b, 110, 48, 0.02, 0.55, 0.35); noise(b, 0, 0.3, 0.2, 0.4, 0.85);
    return b;
  },
};

function writeWav(name, samples) {
  const n = samples.length;
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data[i] = Math.round(v * 32767);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + n * 2, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(n * 2, 40);
  writeFileSync(join(OUT, `${name}.wav`), Buffer.concat([header, Buffer.from(data.buffer)]));
  console.log(`${name}.wav ${(44 + n * 2) / 1024 < 100 ? `${((44 + n * 2) / 1024).toFixed(1)} KB` : 'written'}`);
}

for (const [name, make] of Object.entries(sounds)) writeWav(name, make());
console.log(`Done → ${OUT}`);
