// Locally synthesized ambience: no remote audio, autoplay, or network dependencies.
export class ForestAudio {
  enabled = false;
  volume = .4;
  private context?: AudioContext;
  private master?: GainNode;
  private wind?: AudioBufferSourceNode;
  private noise?: AudioBuffer;
  private lastStep = 0;
  private nextBird = 0;
  private paused = false;

  private init() {
    if (this.context) return;
    this.context = new AudioContext();
    const ctx = this.context;
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) { last = (last + (Math.random() * 2 - 1) * .025) / 1.025; data[i] = last * 3.5; }
    this.wind = ctx.createBufferSource(); this.wind.buffer = this.noise; this.wind.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1400;
    const gain = ctx.createGain(); gain.gain.value = .16;
    this.wind.connect(filter).connect(gain).connect(this.master); this.wind.start();
    this.nextBird = ctx.currentTime + 1;
  }
  async toggle() { await this.setEnabled(!this.enabled); }
  async setEnabled(enabled: boolean) {
    if (enabled) { this.init(); await this.context!.resume(); }
    this.enabled = enabled; this.updateGain();
  }
  setVolume(volume: number) { this.volume = volume; this.updateGain(); }
  setPaused(paused: boolean) { this.paused = paused; this.updateGain(); }
  private updateGain() {
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume * (this.paused ? .35 : 1) : 0, this.context.currentTime, .25);
  }
  update(distance: number, moving: boolean, grounded: boolean) {
    if (!this.enabled || !this.context || !this.master || this.paused) return;
    const now = this.context.currentTime;
    if (moving && grounded && distance - this.lastStep > .66) {
      this.lastStep = distance;
      const source = this.context.createBufferSource(); source.buffer = this.noise!;
      const filter = this.context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 900 + Math.random() * 350; filter.Q.value = .65;
      const gain = this.context.createGain(); gain.gain.setValueAtTime(.48, now); gain.gain.exponentialRampToValueAtTime(.001, now + .16);
      source.connect(filter).connect(gain).connect(this.master); source.start(now, Math.random() * 2, .2);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    }
    if (now > this.nextBird) { this.bird(now); this.nextBird = now + 5 + Math.random() * 9; }
  }
  private bird(now: number) {
    const ctx = this.context!, gain = ctx.createGain(), pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - .8; gain.connect(pan).connect(this.master!);
    gain.gain.value = 0;
    for (let i = 0; i < 3; i++) {
      const t = now + i * .145, oscillator = ctx.createOscillator(); oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(2450 + i * 220, t); oscillator.frequency.exponentialRampToValueAtTime(3750 - i * 180, t + .055); oscillator.frequency.exponentialRampToValueAtTime(2600, t + .11);
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(.025, t + .015); gain.gain.linearRampToValueAtTime(0, t + .125);
      oscillator.connect(gain); oscillator.start(t); oscillator.stop(t + .13);
      oscillator.onended = () => { oscillator.disconnect(); if (i === 2) { gain.disconnect(); pan.disconnect(); } };
    }
  }
  dispose() { this.wind?.stop(); void this.context?.close(); }
}

// Synthesized animal sounds (hoof strikes, snorts, whinny, ox low/moan),
// panned + attenuated relative to the listener. No recordings, no network.
export class AnimalAudio {
  enabled = false;
  volume = .4;
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private paused = false;
  private listener = new Array(3).fill(0) as [number, number, number];
  private init() {
    if (this.context) return;
    this.context = new AudioContext();
    const ctx = this.context;
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  async setEnabled(enabled: boolean) {
    if (enabled) { this.init(); await this.context!.resume(); }
    this.enabled = enabled; this.updateGain();
  }
  setVolume(volume: number) { this.volume = volume; this.updateGain(); }
  setPaused(paused: boolean) { this.paused = paused; this.updateGain(); }
  setListener(x: number, y: number, z: number) { this.listener = [x, y, z]; }
  private updateGain() {
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume * (this.paused ? .3 : 1) : 0, this.context.currentTime, .25);
  }
  private gainFor(x: number, z: number) {
    const [lx, , lz] = this.listener;
    const d = Math.hypot(x - lx, z - lz);
    const [dx, dz] = [x - lx, z - lz];
    const pan = Math.max(-1, Math.min(1, (dx * (dz >= 0 ? 1 : -1)) / (d + .001)));
    return { gain: 1 / (1 + (d * d) / 26), pan };
  }
  hoof(x: number, z: number, intensity = 1, dusty = false) {
    if (!this.enabled || !this.context || !this.master || this.paused) return;
    const now = this.context.currentTime, { gain, pan } = this.gainFor(x, z);
    const g = this.context.createGain(), panNode = this.context.createStereoPanner();
    panNode.pan.value = pan * .8;
    g.gain.setValueAtTime(.16 * intensity * gain, now);
    g.gain.exponentialRampToValueAtTime(.0008, now + .09);
    g.connect(panNode).connect(this.master);
    const thump = this.context.createOscillator(); thump.type = 'sine';
    thump.frequency.setValueAtTime(58 + Math.random() * 14, now);
    thump.frequency.exponentialRampToValueAtTime(34, now + .08);
    const tGain = this.context.createGain(); tGain.gain.value = .5 * intensity;
    thump.connect(tGain).connect(g); thump.start(now); thump.stop(now + .1);
    const tap = this.context.createBufferSource(); tap.buffer = this.noise!;
    const filter = this.context.createBiquadFilter();
    filter.type = dusty ? 'bandpass' : 'lowpass';
    filter.frequency.value = dusty ? 2400 + Math.random() * 800 : 420 + Math.random() * 160;
    filter.Q.value = dusty ? 1.4 : .8;
    const fGain = this.context.createGain(); fGain.gain.value = .55 * intensity * (dusty ? 1.4 : 1);
    tap.connect(filter).connect(fGain).connect(g);
    tap.start(now, Math.random() * .5, .07);
    thump.onended = () => { thump.disconnect(); tGain.disconnect(); tap.disconnect(); filter.disconnect(); fGain.disconnect(); g.disconnect(); panNode.disconnect(); };
  }
  snort(x: number, z: number, intensity = 1) {
    if (!this.enabled || !this.context || !this.master || this.paused) return;
    const now = this.context.currentTime, { gain, pan } = this.gainFor(x, z);
    const src = this.context.createBufferSource(); src.buffer = this.noise!;
    const filter = this.context.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 2.2;
    filter.frequency.setValueAtTime(1400, now); filter.frequency.exponentialRampToValueAtTime(420, now + .14);
    const g = this.context.createGain(), panNode = this.context.createStereoPanner();
    panNode.pan.value = pan * .8;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(.30 * intensity * gain, now + .02);
    g.gain.exponentialRampToValueAtTime(.001, now + .17);
    src.connect(filter).connect(g).connect(panNode).connect(this.master!);
    src.start(now, Math.random() * 2, .2);
    src.onended = () => { src.disconnect(); filter.disconnect(); g.disconnect(); panNode.disconnect(); };
  }
  whinny(x: number, z: number) {
    if (!this.enabled || !this.context || !this.master || this.paused) return;
    const now = this.context.currentTime, { gain, pan } = this.gainFor(x, z);
    const osc = this.context.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(950, now);
    osc.frequency.exponentialRampToValueAtTime(1500, now + .09);
    osc.frequency.exponentialRampToValueAtTime(720, now + .5);
    const lfo = this.context.createOscillator(); lfo.frequency.value = 27;
    const lfoGain = this.context.createGain(); lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = this.context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1250; filter.Q.value = 1.6;
    const g = this.context.createGain(), panNode = this.context.createStereoPanner();
    panNode.pan.value = pan * .8;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(.055 * gain, now + .05);
    g.gain.exponentialRampToValueAtTime(.001, now + .55);
    osc.connect(filter).connect(g).connect(panNode).connect(this.master!);
    osc.start(now); osc.stop(now + .6); lfo.start(now); lfo.stop(now + .6);
    osc.onended = () => { osc.disconnect(); lfo.disconnect(); lfoGain.disconnect(); filter.disconnect(); g.disconnect(); panNode.disconnect(); };
  }
  low(x: number, z: number, strength = 1, moan = false) {
    if (!this.enabled || !this.context || !this.master || this.paused) return;
    const now = this.context.currentTime, { gain, pan } = this.gainFor(x, z);
    const osc = this.context.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(moan ? 150 : 118, now);
    osc.frequency.linearRampToValueAtTime(moan ? 96 : 84, now + (moan ? .7 : .5));
    const lfo = this.context.createOscillator(); lfo.frequency.value = 3.1;
    const lfoGain = this.context.createGain(); lfoGain.gain.value = 14;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 340; filter.Q.value = 1.1;
    const shape = this.context.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 128 - 1; curve[i] = Math.tanh(v * (1.6 + strength * 1.4)); }
    shape.curve = curve;
    const g = this.context.createGain(), panNode = this.context.createStereoPanner();
    panNode.pan.value = pan * .8;
    const peak = .12 * strength * gain;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + .09);
    g.gain.setValueAtTime(peak, now + (moan ? .45 : .3));
    g.gain.exponentialRampToValueAtTime(.001, now + (moan ? .85 : .6));
    osc.connect(shape).connect(filter).connect(g).connect(panNode).connect(this.master!);
    osc.start(now); osc.stop(now + .9); lfo.start(now); lfo.stop(now + .9);
    osc.onended = () => { osc.disconnect(); lfo.disconnect(); lfoGain.disconnect(); shape.disconnect(); filter.disconnect(); g.disconnect(); panNode.disconnect(); };
  }
  dispose() { void this.context?.close(); }
}

/**
 * Synthesized combat sound: sword whooshes, meaty impacts, bow releases,
 * dice clatter, and a crit sting. Everything is generated in WebAudio —
 * no recordings, no network, and it respects the same enable/volume/pause
 * contract as the rest of the game's audio.
 */
export class CombatAudio {
  enabled = false;
  volume = .4;
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private paused = false;
  private init() {
    if (this.context) return;
    this.context = new AudioContext();
    const ctx = this.context;
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  async setEnabled(enabled: boolean) { if (enabled) { this.init(); await this.context!.resume(); } this.enabled = enabled; this.updateGain(); }
  setVolume(volume: number) { this.volume = volume; this.updateGain(); }
  setPaused(paused: boolean) { this.paused = paused; this.updateGain(); }
  private updateGain() {
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume * (this.paused ? .25 : 1) : 0, this.context.currentTime, .2);
  }
  private ready() { return this.enabled && this.context && this.master && !this.paused; }

  /** Air whoosh of a swung blade. */
  whoosh(intensity = 1) {
    if (!this.ready()) return;
    const ctx = this.context!, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise!;
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + .09);
    filter.frequency.exponentialRampToValueAtTime(700, now + .22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(.34 * intensity, now + .07);
    g.gain.exponentialRampToValueAtTime(.001, now + .26);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(now, Math.random(), .3);
    src.onended = () => { src.disconnect(); filter.disconnect(); g.disconnect(); };
  }

  /** Flesh-and-shield impact: a low thump plus a gritty snap. */
  impact(strong = 1) {
    if (!this.ready()) return;
    const ctx = this.context!, now = ctx.currentTime;
    const thump = ctx.createOscillator(); thump.type = 'sine';
    thump.frequency.setValueAtTime(160 * strong, now);
    thump.frequency.exponentialRampToValueAtTime(46, now + .12);
    const tGain = ctx.createGain();
    tGain.gain.setValueAtTime(.5, now);
    tGain.gain.exponentialRampToValueAtTime(.001, now + .18);
    thump.connect(tGain).connect(this.master!); thump.start(now); thump.stop(now + .2);
    const snap = ctx.createBufferSource(); snap.buffer = this.noise!;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(.42, now);
    g.gain.exponentialRampToValueAtTime(.001, now + .11);
    snap.connect(filter).connect(g).connect(this.master!);
    snap.start(now, Math.random(), .12);
    thump.onended = () => { thump.disconnect(); tGain.disconnect(); snap.disconnect(); filter.disconnect(); g.disconnect(); };
  }

  /** Miss: blade through empty air, no impact. */
  parry() {
    if (!this.ready()) return;
    const ctx = this.context!, now = ctx.currentTime;
    for (const [f, t0] of [[2900, 0], [2300, .06]] as const) {
      const osc = ctx.createOscillator(); osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + t0);
      osc.frequency.exponentialRampToValueAtTime(f * .6, now + t0 + .12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(.11, now + t0);
      g.gain.exponentialRampToValueAtTime(.001, now + t0 + .14);
      osc.connect(g).connect(this.master!); osc.start(now + t0); osc.stop(now + t0 + .15);
      osc.onended = () => osc.disconnect();
    }
  }

  /** Bowstring release. */
  bowRelease() {
    if (!this.ready()) return;
    const ctx = this.context!, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise!;
    const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(.30, now);
    g.gain.exponentialRampToValueAtTime(.001, now + .07);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(now, Math.random(), .08);
    const pluck = ctx.createOscillator(); pluck.type = 'sine';
    pluck.frequency.setValueAtTime(340, now);
    pluck.frequency.exponentialRampToValueAtTime(180, now + .06);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(.12, now);
    pg.gain.exponentialRampToValueAtTime(.001, now + .08);
    pluck.connect(pg).connect(this.master!); pluck.start(now); pluck.stop(now + .09);
    src.onended = () => { src.disconnect(); filter.disconnect(); g.disconnect(); pluck.disconnect(); pg.disconnect(); };
  }

  /** Arcane cast: rising shimmer. */
  cast() {
    if (!this.ready()) return;
    const ctx = this.context!, now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      const base = 520 + i * 260;
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(base * 2.4, now + .5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(.05, now + .18);
      g.gain.exponentialRampToValueAtTime(.001, now + .6);
      osc.connect(g).connect(this.master!); osc.start(now); osc.stop(now + .62);
      osc.onended = () => osc.disconnect();
    }
  }

  /** Dice tumbling on wood: a scatter of little knocks. */
  diceClatter(count = 1) {
    if (!this.ready()) return;
    const ctx = this.context!, now = ctx.currentTime;
    for (let i = 0; i < 5 + count * 2; i++) {
      const t = now + Math.random() * .34;
      const knock = ctx.createOscillator(); knock.type = 'triangle';
      knock.frequency.setValueAtTime(900 + Math.random() * 1500, t);
      knock.frequency.exponentialRampToValueAtTime(400, t + .03);
      const g = ctx.createGain();
      g.gain.setValueAtTime(.10 * (1 - i / (count + 7)), t);
      g.gain.exponentialRampToValueAtTime(.001, t + .05);
      knock.connect(g).connect(this.master!); knock.start(t); knock.stop(t + .06);
      knock.onended = () => knock.disconnect();
    }
  }

  /** Critical hit sting: a bright ring plus a low boom. */
  critical() {
    if (!this.ready()) return;
    const ctx = this.context!, now = ctx.currentTime;
    const ring = ctx.createOscillator(); ring.type = 'sine';
    ring.frequency.setValueAtTime(1560, now);
    ring.frequency.exponentialRampToValueAtTime(1240, now + .5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(.14, now);
    g.gain.exponentialRampToValueAtTime(.001, now + .55);
    ring.connect(g).connect(this.master!); ring.start(now); ring.stop(now + .6);
    const boom = ctx.createOscillator(); boom.type = 'sine';
    boom.frequency.setValueAtTime(120, now);
    boom.frequency.exponentialRampToValueAtTime(40, now + .3);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(.4, now);
    bg.gain.exponentialRampToValueAtTime(.001, now + .35);
    boom.connect(bg).connect(this.master!); boom.start(now); boom.stop(now + .4);
    ring.onended = () => { ring.disconnect(); g.disconnect(); boom.disconnect(); bg.disconnect(); };
  }

  /** Goblin squeal when one drops. */
  deathCry() {
    if (!this.ready()) return;
    const ctx = this.context!, now = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880 + Math.random() * 200, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + .38);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 22;
    const lg = ctx.createGain(); lg.gain.value = 120;
    lfo.connect(lg).connect(osc.frequency);
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1100; filter.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(.09, now + .04);
    g.gain.exponentialRampToValueAtTime(.001, now + .42);
    osc.connect(filter).connect(g).connect(this.master!);
    osc.start(now); osc.stop(now + .45); lfo.start(now); lfo.stop(now + .45);
    osc.onended = () => { osc.disconnect(); lfo.disconnect(); lg.disconnect(); filter.disconnect(); g.disconnect(); };
  }

  dispose() { void this.context?.close(); }
}
