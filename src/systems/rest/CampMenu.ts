import type { PlayerCharacter } from '../../game/character';
import { diceSfx } from '../dice/DiceSfx';
import { ShortRestUI } from './ShortRestUI';

export interface CampMenuHooks {
  getCharacter: () => PlayerCharacter | null;
  cooldownReason: () => string | null;
  onLongRest: () => void;
  onShortRest: () => void;
  onInventory: () => void;
  onSheet: () => void;
  onClose: () => void;
}

/** MAKE CAMP overlay: the 3D campfire stays visible behind it. */
export class CampMenu {
  private root: HTMLElement | null = null;
  private busy = false;

  constructor(private hooks: CampMenuHooks) {}

  get isOpen(): boolean {
    return this.root?.classList.contains('visible') ?? false;
  }

  show(): void {
    this.ensure();
    this.refresh();
    this.root!.classList.add('visible');
    document.body.dataset.camp = 'true';
    this.root!.querySelector<HTMLElement>('[data-camp="long"]')?.focus();
  }

  hide(): void {
    this.root?.classList.remove('visible');
    document.body.dataset.camp = 'false';
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.root?.classList.toggle('busy', busy);
  }

  refresh(): void {
    if (!this.root) return;
    const c = this.hooks.getCharacter();
    const body = this.root.querySelector('#camp-body');
    if (!body || !c) return;
    const cooldown = this.hooks.cooldownReason();
    const hpLine = `HP: ${c.hp.current}/${c.hp.max} → ${c.hp.max}/${c.hp.max}`;
    const swLine = `Second Wind: ${c.features.secondWind.usesCurrent}/${c.features.secondWind.usesMax} → ${c.features.secondWind.usesMax}/${c.features.secondWind.usesMax}`;
    const inspLine = c.features.heroicInspiration.available ? 'Inspiration: ★ ready' : 'Inspiration: ✗ → ★';
    body.innerHTML = `
      <div class="camp-card" id="camp-long">
        <div class="camp-card-title">🔥 LONG REST</div>
        <p class="camp-card-sub">Sleep through the night. Restore all HP, refresh all abilities.</p>
        <div class="camp-rows">
          <div class="camp-row"><span>${hpLine}</span></div>
          <div class="camp-row"><span>${swLine}</span></div>
          <div class="camp-row"><span>${inspLine}</span></div>
        </div>
        <button class="camp-primary" data-camp="long" ${cooldown || this.busy ? 'disabled' : ''} ${cooldown ? `title="${cooldown.replace(/"/g, '&quot;')}"` : ''}>REST UNTIL DAWN</button>
        ${cooldown ? `<div class="camp-note">${cooldown}</div>` : ''}
      </div>
      ${ShortRestUI.cardHTML(c)}
      <div class="camp-card locked">
        <div class="camp-card-title">🍳 COOK <span class="lock">🔒</span></div>
        <p class="camp-card-sub">Coming soon — combine rations and foraged ingredients for temporary buffs.</p>
      </div>
      <div class="camp-links">
        <button data-camp="inventory">📦 MANAGE INVENTORY<span>Review and organize your gear</span></button>
        <button data-camp="sheet">📋 CHARACTER SHEET<span>Review your abilities &amp; stats</span></button>
      </div>
      <button class="camp-break" data-camp="close">BREAK CAMP</button>`;
  }

  private ensure(): void {
    if (this.root) return;
    const host = document.getElementById('experience') ?? document.body;
    this.root = document.createElement('div');
    this.root.id = 'camp-menu';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Make camp');
    this.root.innerHTML = `
      <div class="camp-frame">
        <div class="camp-head"><span>🌙</span><h2>MAKE CAMP</h2></div>
        <div id="camp-body"></div>
      </div>`;
    host.append(this.root);
    this.root.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-camp]');
      if (!button || button.disabled) return;
      const action = button.dataset.camp;
      diceSfx.uiClick();
      if (action === 'long') this.hooks.onLongRest();
      else if (action === 'short-spend') this.hooks.onShortRest();
      else if (action === 'inventory') this.hooks.onInventory();
      else if (action === 'sheet') this.hooks.onSheet();
      else if (action === 'close') this.hooks.onClose();
    });
    window.addEventListener('keydown', e => {
      if (!this.isOpen || this.busy) return;
      if (e.code === 'Escape') {
        e.stopPropagation();
        this.hooks.onClose();
      }
    }, true);
  }
}
