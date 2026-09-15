/**
 * The Narrator's boxed reading panel for every line spoken AFTER the opening
 * chapter (interactions, camp, rest, the horses). It is the same box, type
 * scale, seal, and progress rail as the opening `#narrator-panel` — one voice,
 * one layout, from the first page of the story to the last.
 *
 * While this box is up it takes the stage: the journey panel steps aside so
 * two Narrator boxes never stack.
 */

const VOICE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
const VOICE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>';

let root: HTMLElement | null = null;
let textEl: HTMLElement | null = null;
let headingEl: HTMLElement | null = null;
let chapterEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let progressEl: HTMLElement | null = null;
let voiceBtn: HTMLButtonElement | null = null;
let visible = false;
let onToggleVoice: (() => void) | null = null;

function ensure(): void {
  if (root) return;
  const host = document.querySelector('.hud') ?? document.getElementById('experience') ?? document.body;
  root = document.createElement('section');
  root.id = 'narrator-box';
  root.className = 'narrator-panel narrator-panel--oneshot';
  root.setAttribute('aria-label', 'Narrator dialogue');
  root.innerHTML =
    '<div class="narrator-top"><span class="narrator-seal">◇</span><span class="narrator-name">NARRATOR</span>'
    + '<span class="narrator-heading" id="narrator-box-heading"></span>'
    + '<span class="narrator-page" id="narrator-box-page">◇</span></div>'
    + '<p id="narrator-box-text" aria-live="polite" aria-atomic="true"></p>'
    + '<div class="narrator-bottom"><span id="narrator-box-chapter">THE TRIBOAR TRAIL</span>'
    + '<div class="narrator-controls"><span class="narrator-audio-status" id="narrator-box-status">THE STORY UNFOLDS</span>'
    + '<button id="narrator-box-voice" aria-label="Mute Narrator" title="Narrator voice">' + VOICE_ON + '</button></div></div>'
    + '<div class="narrator-progress-track" role="progressbar" aria-label="Narration progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="narrator-box-progress"></div></div>';
  host.append(root);
  textEl = root.querySelector('#narrator-box-text');
  headingEl = root.querySelector('#narrator-box-heading');
  chapterEl = root.querySelector('#narrator-box-chapter');
  statusEl = root.querySelector('#narrator-box-status');
  progressEl = root.querySelector('#narrator-box-progress');
  voiceBtn = root.querySelector('#narrator-box-voice');
  voiceBtn?.addEventListener('click', () => onToggleVoice?.());
}

export interface NarratorBoxLine {
  text: string;
  /** Italic aside next to the seal (e.g. “The ambush clearing”). */
  heading?: string;
  /** Small caps rail label at the bottom left. */
  chapter?: string;
  voiceEnabled: boolean;
  /** True when the voice clip is missing/blocked and subtitles carry the line. */
  fallback?: boolean;
  toggleVoice?: () => void;
}

export function showNarratorBox(line: NarratorBoxLine): void {
  ensure();
  onToggleVoice = line.toggleVoice ?? null;
  headingEl!.textContent = line.heading ?? '';
  headingEl!.style.display = line.heading ? '' : 'none';
  chapterEl!.textContent = line.chapter ?? 'THE TRIBOAR TRAIL';
  textEl!.textContent = line.text;
  setNarratorBoxProgress(0);
  paintVoice(line.voiceEnabled, !!line.fallback);
  visible = true;
  document.body.dataset.onenarrating = 'true';
}

export function setNarratorBoxProgress(fraction: number): void {
  if (!progressEl || !root) return;
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  progressEl.style.width = `${pct}%`;
  root.querySelector('.narrator-progress-track')?.setAttribute('aria-valuenow', String(pct));
}

export function paintVoice(voiceEnabled: boolean, fallback: boolean): void {
  if (!voiceBtn || !statusEl) return;
  voiceBtn.innerHTML = voiceEnabled ? VOICE_ON : VOICE_OFF;
  voiceBtn.setAttribute('aria-label', voiceEnabled ? 'Mute Narrator' : 'Enable Narrator');
  statusEl.textContent = fallback ? 'SUBTITLES ONLY · RETRY VOICE' : voiceEnabled ? 'THE STORY UNFOLDS' : 'VOICE MUTED';
}

export function hideNarratorBox(): void {
  visible = false;
  document.body.dataset.onenarrating = 'false';
}

export function narratorBoxVisible(): boolean {
  return visible;
}

export function disposeNarratorBox(): void {
  hideNarratorBox();
  root?.remove();
  root = textEl = headingEl = chapterEl = statusEl = progressEl = null;
  voiceBtn = null;
  onToggleVoice = null;
}
