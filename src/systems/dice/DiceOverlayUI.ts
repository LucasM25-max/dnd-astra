import type { DiceRollResult } from './DiceResultResolver';
import { diceSfx } from './DiceSfx';
import { DICE_TIMING } from './DiceAnimationController';

/** BG3-style dice overlay: dark backdrop, 3D stage, slam badge, total, verdict banner. */
let root: HTMLElement | null = null;
let stage: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;
let naturalEl: HTMLElement | null = null;
let badgeEl: HTMLElement | null = null;
let totalEl: HTMLElement | null = null;
let bannerEl: HTMLElement | null = null;
let liveEl: HTMLElement | null = null;
let dismissResolve: (() => void) | null = null;

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
      <div class="dice-hint">Click or press any key to continue</div>
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
  root.addEventListener('click', () => dismissResolve?.());
  window.addEventListener('keydown', onKey, true);
  return root;
}

function onKey(e: KeyboardEvent): void {
  if (!root?.classList.contains('visible')) return;
  if (e.code === 'Tab') return; // allow focus to stay; overlay is transient
  e.stopPropagation();
  dismissResolve?.();
}

export function diceStage(): HTMLElement {
  ensure();
  return stage!;
}

export function showDiceOverlay(label: string, dc: number | null, sides: number): void {
  ensure();
  root!.classList.toggle('reduced', reducedMotion());
  root!.classList.remove('has-result', 'success', 'failure');
  labelEl!.textContent = label;
  const dcEl = root!.querySelector('#dice-dc')!;
  dcEl.textContent = dc === null ? '' : `DC ${dc}`;
  dcEl.classList.toggle('hidden', dc === null);
  naturalEl!.textContent = '';
  badgeEl!.textContent = '';
  totalEl!.textContent = '';
  bannerEl!.textContent = '';
  bannerEl!.className = '';
  liveEl!.textContent = `Rolling a d${sides} for ${label}.`;
  root!.classList.add('visible');
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
    if (res.success) diceSfx.success();
    else diceSfx.failure();
    root!.classList.add(res.success ? 'success' : 'failure');
    liveEl!.textContent = `${res.label}: rolled ${res.natural}${modifierText}, total ${res.total} versus DC ${res.dc}. ${res.success ? 'Success' : 'Failure'}.`;
  };
  if (reduced) {
    showBadge();
    showBanner();
  } else {
    window.setTimeout(showBadge, DICE_TIMING.badgeDelayMs);
    window.setTimeout(showBanner, DICE_TIMING.bannerDelayMs);
  }
}

export function waitForDiceDismiss(timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      dismissResolve = null;
      resolve();
    };
    dismissResolve = finish;
    const timer = window.setTimeout(finish, timeoutMs);
  });
}

export function hideDiceOverlay(): void {
  root?.classList.remove('visible');
  if (stage) stage.innerHTML = '';
}
