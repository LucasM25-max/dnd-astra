import type { PlayerCharacter } from '../../game/character';
import { diceSfx } from '../dice/DiceSfx';
import { ShortRestUI } from './ShortRestUI';

const ICONS: Record<string, string> = {
  flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4',
  backpack: 'M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10z M9 6V4a3 3 0 0 1 6 0v2 M4 14h16',
  book: 'M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z',
  pot: 'M4 11h16v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6z M2 11h20 M8 11V9a4 4 0 0 1 8 0v2 M20 6l1.5-1.5',
  tent: 'M3.5 21 12 4l8.5 17 M9 21l3-5 3 5',
};
const icon = (name: string): string =>
  `<svg class="camp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

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
    const hpLine = `HP ${c.hp.current} / ${c.hp.max} <strong>→ ${c.hp.max} / ${c.hp.max}</strong>`;
    const swLine = `Second Wind ${c.features.secondWind.usesCurrent} / ${c.features.secondWind.usesMax} <strong>→ ${c.features.secondWind.usesMax} / ${c.features.secondWind.usesMax}</strong>`;
    const inspLine = c.features.heroicInspiration.available ? 'Inspiration <strong>★ ready</strong>' : 'Inspiration <strong>→ ★ granted</strong>';
    body.innerHTML = `
      <div class="camp-card" id="camp-long">
        <div class="camp-card-title">${icon('flame')} LONG REST</div>
        <p class="camp-card-sub">Sleep through the night. Restore all HP, refresh all abilities, and let the stars keep watch.</p>
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
        <div class="camp-card-title" title="Coming soon — combine rations and foraged ingredients for temporary buffs.">${icon('pot')} COOK <span class="lock">${icon('lock')}</span></div>
        <p class="camp-card-sub">Coming soon — combine rations and foraged ingredients for temporary buffs.</p>
      </div>
      <div class="camp-links">
        <button data-camp="inventory">${icon('backpack')} MANAGE INVENTORY<span>Review and organize your gear</span></button>
        <button data-camp="sheet">${icon('book')} CHARACTER SHEET<span>Review your abilities &amp; stats</span></button>
      </div>
      <button class="camp-break" data-camp="close">${icon('tent')} BREAK CAMP</button>`;
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
        <div class="camp-head"><span class="camp-moon">${icon('moon')}</span><h2>MAKE CAMP</h2></div>
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
