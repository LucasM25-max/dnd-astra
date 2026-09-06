import script from './narration-script.json';

export const NARRATION = script.lines;
export const INTRO_COUNT = NARRATION.filter(line => line.stage === 'introduction').length;
export type StoryPhase = 'title' | 'journey' | 'arrival' | 'exploration';
export interface NarratorState {
  phase: StoryPhase; active: boolean; index: number; text: string; heading: string;
  progress: number; journeyProgress: number; paused: boolean; voiceEnabled: boolean; fallback: boolean;
}
export function introductionProgress(index: number, seconds: number, durations: number[]) {
  if (index >= INTRO_COUNT) return 1;
  if (index < 0) return 0;
  const total = durations.slice(0, INTRO_COUNT).reduce((a, b) => a + b, 0);
  const before = durations.slice(0, index).reduce((a, b) => a + b, 0);
  return Math.max(0, Math.min(1, (before + Math.min(seconds, durations[index])) / total));
}

/** One audio element owns the timeline. Animation follows the audio clock, not frame count. */
export class Narrator {
  private audio = new Audio();
  private phase: StoryPhase = 'title';
  private index = -1;
  private active = false;
  private generation = 0;
  private pauseReasons = new Set<string>();
  private urls = NARRATION.map(line => `/audio/narration/${line.id}.mp3`);
  private durations = NARRATION.map(line => Math.max(8, line.text.length / 15));
  private voiceEnabled = true;
  private fallback = false;
  private fallbackTime = 0;
  private loadingSeconds = 0;
  private handedOff = false;
  onHandoff = () => {};
  onComplete = () => {};
  onChange = () => {};

  constructor() {
    this.audio.preload = 'auto'; this.audio.volume = .9;
    try { this.voiceEnabled = localStorage.getItem('astra-narrator-voice') !== 'off'; } catch { /* Optional persistence. */ }
    this.audio.muted = !this.voiceEnabled;
  }
  async initialize() {
    try {
      const response = await fetch('/audio/narration/manifest.json');
      if (!response.ok) throw new Error('Missing narration manifest');
      const manifest = await response.json();
      NARRATION.forEach((line, i) => {
        const clip = manifest?.clips?.[line.id];
        if (typeof clip?.file === 'string' && /^\/audio\/narration\/[a-z0-9-]+\.(mp3|wav|ogg)$/.test(clip.file)) this.urls[i] = clip.file;
        if (Number.isFinite(clip?.duration) && clip.duration > 0 && clip.duration < 300) this.durations[i] = clip.duration;
      });
    } catch { /* Local default MP3s and readable, timed subtitles remain usable. */ }
    this.audio.src = this.urls[0]; this.audio.load();
  }
  start(alreadyArrived = false) {
    if (this.phase !== 'title') return;
    if (alreadyArrived) { this.phase = 'exploration'; this.handedOff = true; this.onChange(); return; }
    this.phase = 'journey'; this.playLine(0);
  }
  private playLine(index: number) {
    const token = ++this.generation;
    this.audio.pause(); this.index = index; this.active = true; this.fallback = false; this.fallbackTime = 0; this.loadingSeconds = 0;
    this.audio.src = this.urls[index];
    this.audio.onloadedmetadata = () => {
      if (token === this.generation && Number.isFinite(this.audio.duration) && this.audio.duration > 0) this.durations[index] = this.audio.duration;
    };
    this.audio.onended = () => { if (token === this.generation && this.active && this.audio.currentTime > this.durations[index] - .5) this.next(); };
    this.audio.onerror = () => { if (token === this.generation && this.active) this.useTextFallback(); };
    this.audio.load();
    if (!this.pauseReasons.size) void this.tryPlay(token);
    this.onChange();
  }
  private async tryPlay(token = this.generation) {
    try { await this.audio.play(); }
    catch (error) {
      if (token !== this.generation || this.pauseReasons.size || !this.active || (error instanceof DOMException && error.name === 'AbortError')) return;
      this.useTextFallback();
    }
  }
  private useTextFallback() {
    if (this.fallback) return;
    this.fallbackTime = this.audio.currentTime || 0; this.audio.pause(); this.fallback = true; this.onChange();
  }
  next() {
    if (!this.active) return;
    if (this.index === INTRO_COUNT - 1) { this.enterArrival(); return; }
    if (this.index < NARRATION.length - 1) { this.playLine(this.index + 1); return; }
    this.active = false; this.audio.pause(); this.phase = 'exploration'; this.onComplete(); this.onChange();
  }
  skipJourney() { if (this.phase === 'journey') this.enterArrival(); }
  private enterArrival() {
    this.phase = 'arrival'; this.pauseReasons.delete('reader');
    if (!this.handedOff) { this.handedOff = true; this.onHandoff(); }
    this.playLine(INTRO_COUNT);
  }
  togglePause() { this.setPaused(!this.pauseReasons.has('reader'), 'reader'); }
  setPaused(paused: boolean, reason = 'menu') {
    if (paused) this.pauseReasons.add(reason); else this.pauseReasons.delete(reason);
    if (this.pauseReasons.size) this.audio.pause();
    else if (this.active && !this.fallback) void this.tryPlay();
    this.onChange();
  }
  restartLine() {
    if (this.index < 0) return;
    if (!this.active) { this.phase = 'arrival'; this.playLine(INTRO_COUNT); return; }
    this.pauseReasons.delete('reader'); this.playLine(this.index);
  }
  setVoiceEnabled(enabled: boolean) {
    this.voiceEnabled = enabled; this.audio.muted = !enabled;
    try { localStorage.setItem('astra-narrator-voice', enabled ? 'on' : 'off'); } catch { /* In-memory control still works. */ }
    if (enabled && this.fallback && this.active) {
      this.audio.currentTime = this.fallbackTime; this.fallback = false;
      if (!this.pauseReasons.size) void this.tryPlay();
    }
    this.onChange();
  }
  update(realDelta: number) {
    if (!this.active || this.pauseReasons.size) return;
    if (this.fallback) { this.fallbackTime += Math.max(0, realDelta); if (this.fallbackTime >= this.durations[this.index]) this.next(); }
    else if (this.audio.readyState < 2 || (this.audio.paused && !this.audio.ended)) {
      this.loadingSeconds += realDelta; if (this.loadingSeconds > 8) this.useTextFallback();
    } else this.loadingSeconds = 0;
  }
  get state(): NarratorState {
    const time = this.fallback ? this.fallbackTime : this.audio.currentTime;
    const line = NARRATION[this.index];
    return { phase: this.phase, active: this.active, index: this.index, text: line?.text ?? '', heading: line?.heading ?? '',
      progress: this.index < 0 ? 0 : Math.max(0, Math.min(1, time / this.durations[this.index])),
      journeyProgress: this.phase === 'title' ? 0 : introductionProgress(this.index, time, this.durations),
      paused: this.pauseReasons.size > 0, voiceEnabled: this.voiceEnabled, fallback: this.fallback };
  }
  dispose() { this.generation++; this.audio.pause(); this.audio.onended = null; this.audio.onerror = null; this.audio.onloadedmetadata = null; this.audio.removeAttribute('src'); this.audio.load(); }
}
