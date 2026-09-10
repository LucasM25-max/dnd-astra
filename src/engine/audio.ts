// Locally synthesized ambience: no remote audio, autoplay, or network dependencies.
export class ForestAudio {
  enabled = false;
  volume = .4;
  private context?: AudioContext;
  private master?: GainNode;
  private wind?: AudioBufferSourceNode;
  private noise?: AudioBuffer;
  private rainGain?: GainNode;
  private rumbleGain?: GainNode;
  private gustGain?: GainNode;
  private lastStep = 0;
  private nextBird = 0;
  private paused = false;
  private wet = 0; // 0 = dry, 1 = heavy rain/storm; calms birds and footfalls

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
    // Rain: white-ish noise through a bright low-pass.
    const rain = ctx.createBufferSource(); rain.buffer = this.noise; rain.loop = true; rain.playbackRate.value = 1.35;
    const rainHigh = ctx.createBiquadFilter(); rainHigh.type = 'highpass'; rainHigh.frequency.value = 500;
    const rainLow = ctx.createBiquadFilter(); rainLow.type = 'lowpass'; rainLow.frequency.value = 5200;
    const rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rain.connect(rainHigh).connect(rainLow).connect(rainGain).connect(this.master); rain.start();
    this.rainGain = rainGain;
    // Storm rumble: the same noise, very dark.
    const rumble = ctx.createBufferSource(); rumble.buffer = this.noise; rumble.loop = true;
    const rumbleFilter = ctx.createBiquadFilter(); rumbleFilter.type = 'lowpass'; rumbleFilter.frequency.value = 130;
    const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0;
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(this.master); rumble.start();
    this.rumbleGain = rumbleGain;
    // Wind gusts: a band-pass whoosh.
    const gust = ctx.createBufferSource(); gust.buffer = this.noise; gust.loop = true;
    const gustFilter = ctx.createBiquadFilter(); gustFilter.type = 'bandpass'; gustFilter.frequency.value = 620; gustFilter.Q.value = .8;
    const gustGain = ctx.createGain(); gustGain.gain.value = 0;
    gust.connect(gustFilter).connect(gustGain).connect(this.master); gust.start();
    const gustLfo = ctx.createOscillator(); gustLfo.frequency.value = .11;
    const gustLfoGain = ctx.createGain(); gustLfoGain.gain.value = .5;
    gustLfo.connect(gustLfoGain).connect(gustGain.gain); gustLfo.start();
    this.gustGain = gustGain;
    this.nextBird = ctx.currentTime + 1;
  }
  /** Set the weather bed levels (0..1 each). Called a few times a second. */
  setWeatherLevels(rain: number, storm: number, wind: number) {
    if (!this.context || !this.enabled) { this.wet = Math.max(this.wet * .9, 0); return; }
    const now = this.context.currentTime;
    const r = Math.min(1.35, rain), s = Math.min(1, storm), w = Math.min(1.4, wind);
    this.rainGain?.gain.setTargetAtTime((r * .20 + s * .12), now, 2.2);
    this.rumbleGain?.gain.setTargetAtTime(s * .22, now, 3);
    this.gustGain?.gain.setTargetAtTime(w * .10, now, 1.6);
    this.wet = Math.max(r, s);
  }
  /** A distant clap: filtered noise swelling down, panned by bearing. */
  thunder(strength: number, pan: number) {
    if (!this.context || !this.master || !this.enabled || this.paused) return;
    const ctx = this.context, t = ctx.currentTime;
    const source = ctx.createBufferSource(); source.buffer = this.noise!;
    const low = ctx.createBiquadFilter(); low.type = 'lowpass';
    low.frequency.setValueAtTime(520 * (0.6 + strength * .5), t);
    low.frequency.exponentialRampToValueAtTime(48, t + 2.6);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(.55 * strength, t + .09);
    gain.gain.exponentialRampToValueAtTime(.001, t + 2.8);
    const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(low).connect(gain).connect(panner).connect(this.master);
    source.start(t, Math.random() * 2, 3);
    source.onended = () => { source.disconnect(); low.disconnect(); gain.disconnect(); panner.disconnect(); };
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
    if (now > this.nextBird) {
      if (this.wet > .35) this.nextBird = now + 8 + Math.random() * 10; // rain hushes the birds
      else { this.bird(now); this.nextBird = now + 5 + Math.random() * 9; }
    }
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
