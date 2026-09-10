/**
 * Game sound effects: synthesised WAV samples (see scripts/synth-sfx.mjs) with
 * a procedural WebAudio fallback, plus the camp-night ambience bed and dawn
 * chorus. Audio is decorative and must never break the game.
 */
let context: AudioContext | null = null;
let master: GainNode | null = null;
const samples = new Map<string, AudioBuffer>();
let samplesLoading: Promise<void> | null = null;

const SAMPLE_FILES: Record<string, string> = {
  throwDie: '/audio/sfx/dice_throw.wav',
  bounce: '/audio/sfx/dice_bounce.wav',
  land: '/audio/sfx/dice_land.wav',
  slam: '/audio/sfx/dice_slam.wav',
  success: '/audio/sfx/dice_success.wav',
  failure: '/audio/sfx/dice_failure.wav',
};

function ensure(): AudioContext | null {
  try {
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
    }
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** Crypto-backed noise (keeps every randomised path on getRandomValues). */
function fillNoise(data: Float32Array): void {
  const ints = new Uint32Array(data.length);
  crypto.getRandomValues(ints);
  for (let i = 0; i < data.length; i++) data[i] = (ints[i] / 4294967296) * 2 - 1;
}

function playSample(name: string, gain = 1): boolean {
  const ctx = ensure();
  const buffer = ctx && master ? samples.get(name) : undefined;
  if (!ctx || !master || !buffer) return false;
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = gain;
    source.connect(g).connect(master);
    source.start();
    return true;
  } catch {
    return false;
  }
}

function preloadSamples(): void {
  if (samplesLoading) return;
  samplesLoading = (async () => {
    const ctx = ensure();
    if (!ctx) return;
    await Promise.all(Object.entries(SAMPLE_FILES).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const raw = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(raw);
        samples.set(name, decoded);
      } catch { /* Fall back to the procedural synth below. */ }
    }));
  })();
}

function tone(frequency: number, endFrequency: number, duration: number, gain: number, delay = 0, type: OscillatorType = 'sine'): void {
  const ctx = ensure();
  if (!ctx || !master) return;
  try {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  } catch { /* Audio is decorative; never break the game. */ }
}

function noiseBurst(duration: number, gain: number, filterFrequency: number, delay = 0, type: BiquadFilterType = 'lowpass'): void {
  const ctx = ensure();
  if (!ctx || !master) return;
  try {
    const t = ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    fillNoise(data);
    for (let i = 0; i < length; i++) data[i] *= 1 - i / length;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFrequency;
    const g = ctx.createGain();
    g.gain.value = gain;
    source.connect(filter).connect(g).connect(master);
    source.start(t);
  } catch { /* Decorative only. */ }
}

// --- Night ambience: soft noise bed + cricket chirps, faded in/out. ---

let nightNodes: { source: AudioBufferSourceNode; gain: GainNode; chirpTimer: ReturnType<typeof setInterval> } | null = null;

function startNightBed(): void {
  const ctx = ensure();
  if (!ctx || !master || nightNodes) return;
  try {
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    fillNoise(data);
    // Brown-ish: integrate and soften.
    let last = 0;
    for (let i = 0; i < length; i++) { last = (last + 0.02 * data[i]) / 1.02; data[i] = last * 3.2; }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 3);
    source.connect(filter).connect(g).connect(master);
    source.start();
    const chirpTimer = setInterval(() => {
      if (!nightNodes) return;
      const chirps = 2 + Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * 3);
      const base = 3800 + (crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * 900;
      for (let i = 0; i < chirps; i++) tone(base, base * 0.92, 0.07, 0.028, i * 0.09);
    }, 2400);
    nightNodes = { source, gain: g, chirpTimer };
  } catch { /* Decorative only. */ }
}

function stopNightBed(): void {
  if (!nightNodes || !context) return;
  const { source, gain, chirpTimer } = nightNodes;
  nightNodes = null;
  clearInterval(chirpTimer);
  try {
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
    gain.gain.linearRampToValueAtTime(0, context.currentTime + 1.2);
    window.setTimeout(() => { try { source.stop(); } catch { /* already stopped */ } }, 1400);
  } catch {
    try { source.stop(); } catch { /* already stopped */ }
  }
}

export const diceSfx = {
  unlock() { ensure(); preloadSamples(); },
  throwDie() { if (!playSample('throwDie')) noiseBurst(0.22, 0.16, 2400, 0, 'bandpass'); },
  bounce(strength: number) {
    const s = Math.max(0.1, Math.min(1, strength));
    if (playSample('bounce', 0.4 + s * 0.6)) return;
    tone(300 + s * 420, 140, 0.09, 0.12 + s * 0.2, 0, 'triangle');
    noiseBurst(0.05, 0.08 * s, 3200);
  },
  land() { if (!playSample('land')) { tone(180, 70, 0.16, 0.28, 0, 'triangle'); noiseBurst(0.08, 0.12, 900); } },
  slam() { if (!playSample('slam')) { tone(140, 55, 0.22, 0.4, 0, 'square'); noiseBurst(0.12, 0.22, 700); } },
  success() {
    if (playSample('success')) return;
    tone(523, 523, 0.22, 0.16, 0); tone(659, 659, 0.22, 0.16, 0.1); tone(784, 784, 0.4, 0.18, 0.2);
  },
  failure() {
    if (playSample('failure')) return;
    noiseBurst(0.3, 0.3, 4200, 0, 'highpass'); tone(220, 60, 0.4, 0.25, 0.02, 'sawtooth');
  },
  uiClick() { tone(660, 520, 0.06, 0.08, 0, 'triangle'); },
  cardSelect() { tone(440, 660, 0.12, 0.12, 0, 'triangle'); tone(660, 880, 0.14, 0.1, 0.08, 'triangle'); },
  sealStrike() {
    tone(90, 40, 0.5, 0.5, 0, 'square');
    noiseBurst(0.2, 0.3, 500);
    tone(1567, 1567, 0.5, 0.1, 0.15);
    tone(2093, 2093, 0.7, 0.08, 0.3);
  },
  restChime() { tone(392, 392, 0.4, 0.12, 0); tone(523, 523, 0.6, 0.12, 0.25); },
  heal() { tone(587, 1175, 0.35, 0.1, 0); },
  startNightAmbience() { startNightBed(); },
  stopNightAmbience() { stopNightBed(); },
  /** A few bright descending phrases as the sky pales. */
  dawnChorus() {
    const phrases = 4 + Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * 3);
    for (let p = 0; p < phrases; p++) {
      const base = 2400 + (crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * 1400;
      const at = p * 0.55 + (crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * 0.2;
      for (let i = 0; i < 3; i++) tone(base - i * 260, base - i * 260 - 120, 0.12, 0.06, at + i * 0.14);
    }
  },
};
