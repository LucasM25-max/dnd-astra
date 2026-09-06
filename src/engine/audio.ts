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
