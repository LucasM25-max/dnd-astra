/**
 * A dramatic generative score, synthesized entirely in Web Audio: a low drone,
 * slow evolving pads in D Dorian, sparse bell notes, a wind bed, and a deep
 * pulse when storms roll in. No samples, no network.
 */

const CHORD_SECONDS = 20;
const PROG: { label: string; notes: number[] }[] = [
  { label: 'Dm(add9)', notes: [146.83, 174.61, 220, 329.63] },
  { label: 'Bb(maj7)', notes: [233.08, 293.66, 349.23, 440] },
  { label: 'Fmaj7', notes: [174.61, 220, 261.63, 329.63] },
  { label: 'C(add9)', notes: [130.81, 196, 293.66, 329.63] },
];
const BELL_NOTES = [587.33, 659.25, 698.46, 783.99, 880, 932.33, 1046.5]; // D Dorian, upper register

export class DramaticScore {
  enabled = true;
  volume = .5;
  private context?: AudioContext;
  private master?: GainNode;
  private reverbSend?: GainNode;
  private padBus?: GainNode;
  private windGain?: GainNode;
  private noise?: AudioBuffer;
  private timer = 0;
  private nextChord = 0; private chordIndex = 0;
  private nextBell = 0;
  private nextPulse = 0;
  private paused = false;
  private storm = false;
  private windLevel = 0;

  begin() {
    if (this.context) { void this.context.resume(); return; }
    const ctx = new AudioContext();
    this.context = ctx;
    const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    this.master = master;
    this.noise = this.makeNoise(ctx, 3);
    // Reverb tail for spaciousness.
    const reverb = ctx.createConvolver(); reverb.buffer = this.makeImpulse(ctx, 2.8, 2.4);
    const reverbGain = ctx.createGain(); reverbGain.gain.value = .5;
    reverb.connect(reverbGain).connect(master);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = .7; this.reverbSend.connect(reverb);

    // Drone bed.
    const droneGain = ctx.createGain(); droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter(); droneFilter.type = 'lowpass'; droneFilter.frequency.value = 240;
    droneFilter.connect(droneGain); droneGain.connect(master); droneGain.connect(this.reverbSend!);
    const d1 = ctx.createOscillator(); d1.type = 'sine'; d1.frequency.value = 73.42;
    const d1g = ctx.createGain(); d1g.gain.value = .05; d1.connect(d1g).connect(droneFilter); d1.start();
    const d2 = ctx.createOscillator(); d2.type = 'triangle'; d2.frequency.value = 110;
    const d2g = ctx.createGain(); d2g.gain.value = .026; d2.connect(d2g).connect(droneFilter); d2.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = .05;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = .012; lfo.connect(lfoGain).connect(d1g.gain); lfo.start();
    droneGain.gain.setTargetAtTime(.9, ctx.currentTime, 4);

    // Pad bus with a slowly breathing low-pass.
    const padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 950; padFilter.Q.value = .6;
    const padBus = ctx.createGain(); padBus.gain.value = 1;
    padFilter.connect(padBus); padBus.connect(master); padBus.connect(this.reverbSend!);
    const padLfo = ctx.createOscillator(); padLfo.frequency.value = .035;
    const padLfoGain = ctx.createGain(); padLfoGain.gain.value = 260; padLfo.connect(padLfoGain).connect(padFilter.frequency); padLfo.start();
    this.padBus = padBus;

    // Wind bed.
    const wind = ctx.createBufferSource(); wind.buffer = this.noise; wind.loop = true;
    const windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 420; windFilter.Q.value = .55;
    const windGain = ctx.createGain(); windGain.gain.value = 0;
    wind.connect(windFilter).connect(windGain).connect(master); wind.start();
    const windLfo = ctx.createOscillator(); windLfo.frequency.value = .07;
    const windLfoGain = ctx.createGain(); windLfoGain.gain.value = 170; windLfo.connect(windLfoGain).connect(windFilter.frequency); windLfo.start();
    this.windGain = windGain;

    this.updateGain();
    this.nextChord = ctx.currentTime + .6;
    this.nextBell = ctx.currentTime + 6 + Math.random() * 5;
    this.nextPulse = ctx.currentTime + 4;
    this.timer = window.setInterval(() => this.schedule(), 220);
  }
  setEnabled(enabled: boolean) { this.enabled = enabled; this.updateGain(); }
  setVolume(volume: number) { this.volume = Math.max(0, Math.min(1, volume)); this.updateGain(); }
  setPaused(paused: boolean) { this.paused = paused; this.updateGain(); }
  /** 0..1: storm darkness (drives the pulse) and wind intensity. */
  setWeather(storm: boolean, wind: number) {
    this.storm = storm; this.windLevel = Math.max(0, Math.min(1.4, wind));
    if (this.windGain && this.context) this.windGain.gain.setTargetAtTime(.018 + this.windLevel * .05, this.context.currentTime, 1.2);
  }
  dispose() { window.clearInterval(this.timer); void this.context?.close(); this.context = undefined; }

  private updateGain() {
    if (!this.context || !this.master) return;
    const target = this.enabled ? this.volume * (this.paused ? .22 : 1) : 0;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, .5);
  }
  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0); let last = 0;
    for (let i = 0; i < data.length; i++) { last = (last + (Math.random() * 2 - 1) * .2) / 1.2; data[i] = last * 2.6; }
    return buffer;
  }
  private makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * .5;
    }
    return buffer;
  }
  private schedule() {
    const ctx = this.context; if (!ctx || !this.enabled) return;
    const now = ctx.currentTime;
    while (this.nextChord < now + 1.6) { this.scheduleChord(this.nextChord, PROG[this.chordIndex % PROG.length].notes); this.chordIndex++; this.nextChord += CHORD_SECONDS; }
    if (this.nextBell < now + 1.4) { this.scheduleBell(this.nextBell); this.nextBell = now + 4.5 + Math.random() * 7.5; }
    if (this.storm && this.nextPulse < now + 1.4) { this.schedulePulse(this.nextPulse); this.nextPulse += 2; }
    if (!this.storm && this.nextPulse < now) this.nextPulse = now + 3;
  }
  private scheduleChord(t: number, notes: number[]) {
    const ctx = this.context!;
    for (const f of notes) {
      for (const detune of [-6, 5]) {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f; osc.detune.value = detune * (0.6 + Math.random() * .4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(.0165, t + 3.2);
        g.gain.setValueAtTime(.0165, t + CHORD_SECONDS - 4.2);
        g.gain.linearRampToValueAtTime(0, t + CHORD_SECONDS + 2.6);
        osc.connect(g).connect(this.padBus!);
        osc.start(t); osc.stop(t + CHORD_SECONDS + 3);
        osc.onended = () => { osc.disconnect(); g.disconnect(); };
      }
    }
  }
  private scheduleBell(t: number) {
    const ctx = this.context!;
    const f = BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)];
    const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 2.98;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(5.5 * f, t);
    modGain.gain.exponentialRampToValueAtTime(.4 * f, t + 1.1);
    mod.connect(modGain).connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.05, t + .012);
    g.gain.exponentialRampToValueAtTime(.0004, t + 2.9);
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.4 - .7;
    carrier.connect(g).connect(pan);
    pan.connect(this.master!); pan.connect(this.reverbSend!);
    carrier.start(t); mod.start(t); carrier.stop(t + 3); mod.stop(t + 3);
    carrier.onended = () => { mod.disconnect(); modGain.disconnect(); g.disconnect(); pan.disconnect(); };
  }
  private schedulePulse(t: number) {
    const ctx = this.context!;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(96, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + .3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.13, t + .02);
    g.gain.exponentialRampToValueAtTime(.0004, t + .42);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 130;
    osc.connect(g).connect(filter).connect(this.master!);
    osc.start(t); osc.stop(t + .5);
    osc.onended = () => { g.disconnect(); filter.disconnect(); };
  }
}
