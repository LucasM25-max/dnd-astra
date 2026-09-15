import type { NarratorCamera, CameraFocus } from './NarratorCamera';
import { hideNarratorBox, paintVoice, setNarratorBoxProgress, showNarratorBox } from './NarratorBox';

/**
 * One-shot narrator voice-over (interaction lines, rest lines, the horses).
 * A second audio element so the chapter timeline is never hijacked.
 *
 * Every line is read in the same boxed panel as the opening chapter
 * (NarratorBox), with the progress rail tracking the voice (or the timed
 * subtitle fallback when voice is muted, missing, or blocked).
 */
interface QueuedLine {
  clipId: string;
  text: string;
  focus: CameraFocus | null;
  duration: number;
  heading?: string;
  chapter?: string;
  dollyIn: number;
  dollyOut: number;
  resolve: () => void;
}

export interface NarrateOptions {
  /** Italic aside in the box header. */
  heading?: string;
  /** Small-caps rail label. */
  chapter?: string;
  /** Cinematic dolly-in / dolly-out durations in ms. */
  dollyIn?: number;
  dollyOut?: number;
}

export const ONE_SHOT_CLIPS = [
  'ransacked_belongings',
  'nothing_of_interest',
  'rest_while_you_can',
  'dawn_breaks',
  'something_stirs',
  'well_rested_already',
  'retreated_for_now',
  'horses_settle',
  'horses_refuse',
  'horses_tied',
] as const;
export type OneShotClipId = (typeof ONE_SHOT_CLIPS)[number];

const FALLBACK_DURATIONS: Record<string, number> = {
  ransacked_belongings: 6.129,
  nothing_of_interest: 2.425,
  rest_while_you_can: 7.085,
  dawn_breaks: 3.907,
  something_stirs: 3.262,
  well_rested_already: 4.457,
  retreated_for_now: 7.874,
  horses_settle: 4.6,
  horses_refuse: 4.8,
  horses_tied: 5.2,
};

export class NarratorSystem {
  private audio = new Audio();
  private queue: QueuedLine[] = [];
  private playing = false;
  private urls = new Map<string, string>();
  private durations = new Map<string, number>(Object.entries(FALLBACK_DURATIONS));
  private voiceEnabled = true;
  private paused = false;
  private progressRaf = 0;

  constructor(private camera: NarratorCamera | null = null) {
    this.audio.preload = 'auto';
    this.audio.volume = 0.95;
    try {
      this.voiceEnabled = localStorage.getItem('astra-narrator-voice') !== 'off';
    } catch { /* In-memory default. */ }
  }

  async initialize(): Promise<void> {
    for (const id of ONE_SHOT_CLIPS) this.urls.set(id, `/audio/narration/${id}.mp3`);
    try {
      const response = await fetch('/audio/narration/manifest.json');
      if (!response.ok) return;
      const manifest = await response.json() as { clips?: Record<string, { file?: string; duration?: number }> };
      for (const id of ONE_SHOT_CLIPS) {
        const clip = manifest.clips?.[id];
        if (typeof clip?.file === 'string' && clip.file.startsWith('/audio/narration/')) this.urls.set(id, clip.file);
        if (typeof clip?.duration === 'number' && clip.duration > 0 && clip.duration < 60) {
          this.durations.set(id, clip.duration);
        }
      }
    } catch { /* Timed subtitles remain usable. */ }
  }

  setVoiceEnabled(enabled: boolean): void {
    this.voiceEnabled = enabled;
    if (!enabled) this.audio.pause();
    else if (this.playing && this.audio.src && this.audio.currentTime > 0) void this.audio.play().catch(() => {});
    try {
      localStorage.setItem('astra-narrator-voice', enabled ? 'on' : 'off');
    } catch { /* Session-only preference. */ }
    paintVoice(enabled, false);
  }

  get isVoiceEnabled(): boolean {
    return this.voiceEnabled;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.audio.pause();
    else if (this.playing && this.voiceEnabled && this.audio.src && this.audio.currentTime > 0) {
      void this.audio.play().catch(() => {});
    }
  }

  /** Speak a line (queued; resolves when voice/subtitles finish and camera restores). */
  narrate(clipId: string, text: string, focus: CameraFocus | null = null, duration?: number, opts: NarrateOptions = {}): Promise<void> {
    const lineDuration = duration ?? this.durations.get(clipId) ?? Math.max(2.5, text.length / 16);
    return new Promise(resolve => {
      this.queue.push({
        clipId, text, focus, duration: lineDuration,
        heading: opts.heading, chapter: opts.chapter,
        dollyIn: opts.dollyIn ?? 800, dollyOut: opts.dollyOut ?? 800,
        resolve,
      });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.playing) return;
    const line = this.queue.shift();
    if (!line) return;
    this.playing = true;
    try {
      if (line.focus && this.camera) await this.camera.dollyTo(line.focus, line.dollyIn);
      await this.speak(line);
      if (line.focus && this.camera) await this.camera.restore(line.dollyOut);
    } finally {
      this.playing = false;
      line.resolve();
      void this.pump();
    }
  }

  private speak(line: QueuedLine): Promise<void> {
    let fallback = false;
    showNarratorBox({
      text: line.text,
      heading: line.heading,
      chapter: line.chapter,
      voiceEnabled: this.voiceEnabled,
      toggleVoice: () => this.setVoiceEnabled(!this.voiceEnabled),
    });
    this.trackProgress(line, () => fallback);
    const url = this.urls.get(line.clipId);
    if (!this.voiceEnabled || !url) {
      fallback = true;
      paintVoice(this.voiceEnabled, true);
      return this.timed(line.duration);
    }
    return new Promise(resolve => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        this.audio.pause();
        this.audio.onended = null;
        this.audio.onerror = null;
        window.clearTimeout(stall);
        window.clearTimeout(hard);
        this.stopProgress();
        hideNarratorBox();
        resolve();
      };
      // Stall guard + hard cap so a missing clip can never hang the game.
      const stall = window.setTimeout(() => {
        if (this.audio.readyState < 2) {
          fallback = true;
          paintVoice(this.voiceEnabled, true);
          void this.timed(line.duration).then(finish);
        }
      }, 2500);
      const hard = window.setTimeout(finish, Math.max(4000, line.duration * 1000 + 4000));
      this.audio.onended = finish;
      this.audio.onerror = () => {
        window.clearTimeout(stall);
        fallback = true;
        paintVoice(this.voiceEnabled, true);
        void this.timed(line.duration).then(() => {
          window.clearTimeout(hard);
          if (!done) {
            done = true;
            this.stopProgress();
            hideNarratorBox();
            resolve();
          }
        });
      };
      this.audio.src = url;
      this.audio.load();
      if (!this.paused) void this.audio.play().catch(() => this.audio.onerror?.(new Event('error')));
    });
  }

  /** Progress rail follows the voice clock, or the timed fallback when muted. */
  private trackProgress(line: QueuedLine, isFallback: () => boolean): void {
    this.stopProgress();
    const start = performance.now();
    const frame = (now: number): void => {
      const voiced = !isFallback() && this.audio.readyState >= 2 && !this.audio.paused && this.audio.duration > 0;
      const span = voiced ? Math.max(line.duration, this.audio.duration) : line.duration;
      const elapsed = voiced ? this.audio.currentTime : (now - start) / 1000;
      setNarratorBoxProgress(span > 0 ? elapsed / span : 1);
      this.progressRaf = requestAnimationFrame(frame);
    };
    this.progressRaf = requestAnimationFrame(frame);
  }

  private stopProgress(): void {
    if (this.progressRaf) cancelAnimationFrame(this.progressRaf);
    this.progressRaf = 0;
  }

  private timed(seconds: number): Promise<void> {
    return new Promise(resolve => {
      window.setTimeout(resolve, Math.max(800, seconds * 1000));
    });
  }
}
