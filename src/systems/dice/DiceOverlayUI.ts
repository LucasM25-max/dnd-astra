import type { DiceRollResult } from './DiceResultResolver';
import { diceSfx } from './DiceSfx';
import { DICE_TIMING, diceTiming } from './DiceAnimationController';

/** BG3-style dice overlay: dark backdrop, 3D stage, slam badge, total, verdict banner. */
let root: HTMLElement | null = null;
let stage: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;
let naturalEl: HTMLElement | null = null;
let badgeEl: HTMLElement | null = null;
let totalEl: HTMLElement | null = null;
let bannerEl: HTMLElement | null = null;
let liveEl: HTMLElement | null = null;
let hintEl: HTMLElement | null = null;
let rollBtn: HTMLButtonElement | null = null;
let continueBtn: HTMLButtonElement | null = null;
/**
 * The overlay never advances itself: the player asks for the throw, then asks
 * to leave. `armed` waits for the Roll button, `result` for Continue.
 */
export type DicePhase = 'armed' | 'rolling' | 'result';
let phase: DicePhase = 'armed';
let rollResolve: (() => void) | null = null;
let confirmResolve: (() => void) | null = null;
let continueTimer = 0;

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ensure(): HTMLElement {
  if (root) return root;
  const host = document.getElementById('experience') ?? document.body;
  root = document.createElement('div');
  root.id = 'dice-overlay';
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-label', 'Dice roll');
  root.innerHTML = `
    <div class="dice-backdrop"></div>
    <div class="dice-panel">
      <div class="dice-eyebrow">◇ FATE DECIDES</div>
      <div class="dice-check"><span id="dice-label"></span><span id="dice-dc"></span></div>
      <div class="dice-stage" id="dice-stage"></div>
      <div class="dice-readout">
        <span id="dice-natural" aria-hidden="true"></span>
        <span id="dice-badge" aria-hidden="true"></span>
      </div>
      <div id="dice-total" aria-hidden="true"></div>
      <div id="dice-banner" aria-hidden="true"></div>
      <div class="dice-actions">
        <button id="dice-roll" class="dice-action primary" type="button">Roll the die</button>
        <button id="dice-continue" class="dice-action" type="button" hidden>Continue</button>
      </div>
      <div class="dice-hint" id="dice-hint"></div>
    </div>
    <div id="dice-live" class="sr-only" aria-live="polite"></div>`;
  host.append(root);
  stage = root.querySelector('#dice-stage');
  labelEl = root.querySelector('#dice-label');
  naturalEl = root.querySelector('#dice-natural');
  badgeEl = root.querySelector('#dice-badge');
  totalEl = root.querySelector('#dice-total');
  bannerEl = root.querySelector('#dice-banner');
  liveEl = root.querySelector('#dice-live');
  hintEl = root.querySelector('#dice-hint');
  rollBtn = root.querySelector('#dice-roll');
  continueBtn = root.querySelector('#dice-continue');
  rollBtn!.addEventListener('click', () => { if (phase === 'armed') confirmRoll(); });
  continueBtn!.addEventListener('click', () => { if (phase === 'result') confirmContinue(); });
  // The roll is modal: the world's own key and pointer bindings must not react
  // while it is up (Escape used to open the camp menu over the result). Input
  // aimed at the overlay's own buttons is left alone, so the gate still works
  // with a keyboard — and a stray key no longer dismisses anything.
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', swallowOutside, true);
  window.addEventListener('click', swallowOutside, true);
  return root;
}

/** Ignore world-level input while the overlay is visible, unless it targets the overlay. */
function swallowOutside(e: Event): void {
  if (!root?.classList.contains('visible')) return;
  if (e.target instanceof Element && root.contains(e.target)) return;
  e.stopPropagation();
}

function onKey(e: KeyboardEvent): void {
  if (!root?.classList.contains('visible')) return;
  // Focus traversal stays available inside the panel; nothing else reaches the game.
  if (e.code === 'Tab') { e.stopPropagation(); return; }
  if (e.target instanceof Element && root.contains(e.target)) return;
  e.stopPropagation();
  if (phase === 'result' && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape')) {
    e.preventDefault();
    confirmContinue();
  }
}

function confirmRoll(): void {
  const resolve = rollResolve;
  rollResolve = null;
  phase = 'rolling';
  if (rollBtn) { rollBtn.disabled = true; rollBtn.setAttribute('aria-disabled', 'true'); }
  setHint('The die is in motion…');
  resolve?.();
}

function confirmContinue(): void {
  const resolve = confirmResolve;
  confirmResolve = null;
  phase = 'result';
  window.clearTimeout(continueTimer);
  resolve?.();
}

function setHint(text: string): void {
  if (hintEl) hintEl.textContent = text;
  // Exposed for styling and for the smoke harness: which gate is open.
  if (root) root.dataset.phase = phase;
}

export function diceStage(): HTMLElement {
  ensure();
  return stage!;
}

export function showDiceOverlay(label: string, dc: number | null, sides: number): void {
  ensure();
  window.clearTimeout(continueTimer);
  root!.classList.toggle('reduced', reducedMotion());
  root!.classList.remove('has-result', 'success', 'failure');
  phase = 'armed';
  if (rollBtn) { rollBtn.hidden = false; rollBtn.disabled = false; rollBtn.removeAttribute('aria-disabled'); }
  if (continueBtn) { continueBtn.hidden = true; continueBtn.disabled = false; }
  setHint('Nothing happens on its own — press Roll to throw the die.');
  labelEl!.textContent = label;
  const dcEl = root!.querySelector('#dice-dc')!;
  dcEl.textContent = dc === null ? '' : `DC ${dc}`;
  dcEl.classList.toggle('hidden', dc === null);
  naturalEl!.textContent = '';
  badgeEl!.textContent = '';
  totalEl!.textContent = '';
  bannerEl!.textContent = '';
  bannerEl!.className = '';
  liveEl!.textContent = `Roll a d${sides} for ${label}. Press the Roll button when you are ready.`;
  root!.classList.add('visible');
  // The button gets focus only after the panel is on screen and inert-safe.
  window.requestAnimationFrame(() => rollBtn?.focus({ preventScroll: true }));
}

/** Resolves when the player presses the Roll button. Never on a timer. */
export function waitForRoll(): Promise<void> {
  ensure();
  return new Promise(resolve => { rollResolve = resolve; });
}

export function showDiceResult(res: DiceRollResult): void {
  if (!root) return;
  const reduced = reducedMotion();
  naturalEl!.textContent = String(res.natural);
  naturalEl!.classList.remove('zoom');
  void naturalEl!.offsetWidth;
  naturalEl!.classList.add('zoom');
  const modifierText = res.modifier === 0 ? '' : `${res.modifier > 0 ? '+' : ''}${res.modifier}`;
  const showBadge = (): void => {
    if (modifierText) {
      badgeEl!.textContent = modifierText;
      badgeEl!.classList.remove('slam');
      void badgeEl!.offsetWidth;
      badgeEl!.classList.add('slam');
      diceSfx.slam();
    }
    totalEl!.textContent = String(res.total);
    totalEl!.classList.remove('pulse');
    void totalEl!.offsetWidth;
    totalEl!.classList.add('pulse');
    root!.classList.add('has-result');
  };
  const showBanner = (): void => {
    if (res.success === null) {
      liveEl!.textContent = `${res.label}: rolled ${res.natural}${modifierText}, total ${res.total}.`;
      return;
    }
    bannerEl!.textContent = res.success ? 'SUCCESS' : 'FAILURE';
    bannerEl!.className = res.success ? 'banner success' : 'banner failure';
    root!.classList.add('has-verdict');
    if (res.success) diceSfx.success();
    else diceSfx.failure();
    root!.classList.add(res.success ? 'success' : 'failure');
    liveEl!.textContent = `${res.label}: rolled ${res.natural}${modifierText}, total ${res.total} versus DC ${res.dc}. ${res.success ? 'Success' : 'Failure'}.`;
  };
  if (reduced) {
    showBadge();
    showBanner();
    armContinue(0);
  } else {
    window.setTimeout(showBadge, DICE_TIMING.badgeDelayMs);
    window.setTimeout(showBanner, DICE_TIMING.bannerDelayMs);
    // Continue only becomes available once the readout has finished landing, so
    // the player always sees the result before the way out appears.
    armContinue(DICE_TIMING.bannerDelayMs + diceTiming(reduced).continueDelayMs);
  }
}

function armContinue(delayMs: number): void {
  const reveal = (): void => {
    phase = 'result';
    if (rollBtn) rollBtn.hidden = true;
    if (continueBtn) {
      continueBtn.hidden = false;
      continueBtn.disabled = false;
      window.requestAnimationFrame(() => continueBtn?.focus({ preventScroll: true }));
    }
    setHint('Read the result, then press Continue.');
  };
  if (delayMs <= 0) reveal();
  else { window.clearTimeout(continueTimer); continueTimer = window.setTimeout(reveal, delayMs); }
}

export function waitForDiceContinue(): Promise<void> {
  ensure();
  return new Promise(resolve => { confirmResolve = resolve; });
}

/** @deprecated the overlay no longer closes itself; kept for older callers. */
export const waitForDiceDismiss = (): Promise<void> => waitForDiceContinue();

export function hideDiceOverlay(): void {
  window.clearTimeout(continueTimer);
  rollResolve?.();
  rollResolve = null;
  confirmResolve?.();
  confirmResolve = null;
  phase = 'armed';
  root?.classList.remove('visible', 'has-verdict');
  if (stage) stage.innerHTML = '';
}
