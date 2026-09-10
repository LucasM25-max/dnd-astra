import type { NarratorCamera, CameraFocus } from './NarratorCamera';
import { hideCinematicSubtitle, showCinematicSubtitle } from './NarratorSubtitles';

/**
 * One-shot narrator voice-over (interaction lines, rest lines). A second audio
 * element so the chapter timeline is never hijacked; timed subtitles keep
 * every line usable when voice is muted, missing, or blocked.
 */
interface QueuedLine {
  clipId: string;
  text: string;
  focus: CameraFocus | null;
  duration: number;
  resolve: () => void;
}

export const ONE_SHOT_CLIPS = [
  'ransacked_belongings',
  'nothing_of_interest',
  'rest_while_you_can',
  'dawn_breaks',
  'something_stirs',
  'well_rested_already',
  'retreated_for_now',
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
};

export class NarratorSystem {
  private audio = new Audio();
  private queue: QueuedLine[] = [];
  private playing = false;
  private urls = new Map<string, string>();
  private durations = new Map<string, number>(Object.entries(FALLBACK_DURATIONS));
  private voiceEnabled = true;
  private paused = false;

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
    try {
      localStorage.setItem('astra-narrator-voice', enabled ? 'on' : 'off');
    } catch { /* Session-only preference. */ }
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
  narrate(clipId: string, text: string, focus: CameraFocus | null = null, duration?: number): Promise<void> {
    const lineDuration = duration ?? this.durations.get(clipId) ?? Math.max(2.5, text.length / 16);
    return new Promise(resolve => {
      this.queue.push({ clipId, text, focus, duration: lineDuration, resolve });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.playing) return;
    const line = this.queue.shift();
    if (!line) return;
    this.playing = true;
    try {
      if (line.focus && this.camera) await this.camera.dollyTo(line.focus, 800);
      await this.speak(line);
      if (line.focus && this.camera) await this.camera.restore(800);
    } finally {
      this.playing = false;
      line.resolve();
      void this.pump();
    }
  }

  private speak(line: QueuedLine): Promise<void> {
    showCinematicSubtitle(line.text);
    const url = this.urls.get(line.clipId);
    if (!this.voiceEnabled || !url) return this.timed(line.duration);
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
        hideCinematicSubtitle();
        resolve();
      };
      // Stall guard + hard cap so a missing clip can never hang the game.
      const stall = window.setTimeout(() => {
        if (this.audio.readyState < 2) void this.timed(line.duration).then(finish);
      }, 2500);
      const hard = window.setTimeout(finish, Math.max(4000, line.duration * 1000 + 4000));
      this.audio.onended = finish;
      this.audio.onerror = () => {
        window.clearTimeout(stall);
        void this.timed(line.duration).then(() => {
          window.clearTimeout(hard);
          if (!done) {
            done = true;
            hideCinematicSubtitle();
            resolve();
          }
        });
      };
      this.audio.src = url;
      this.audio.load();
      if (!this.paused) void this.audio.play().catch(() => this.audio.onerror?.(new Event('error')));
    });
  }

  private timed(seconds: number): Promise<void> {
    return new Promise(resolve => {
      window.setTimeout(resolve, Math.max(800, seconds * 1000));
    });
  }
}
