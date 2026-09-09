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
