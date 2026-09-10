import { gameState } from '../../game/state';
import {
  ABILITY_NAMES, FIGHTER, SOLDIER, SUGGESTED_NAMES, acFor, backgroundDone, buildScores,
  classDone, draftComplete, draftToCharacter, maxHPFor, nameDone, newDraft, recommendedDraft,
  speciesDone, type CharacterDraft, type PlayerCharacter,
} from '../../game/character';
import { cryptoRandomInt } from '../../systems/dice/DiceResultResolver';
import { CreationPreview } from './CreationPreview';
import { createCreationBackground } from './CharCreationBackground';
import { renderClassPanel, bindClassPanel, type PanelContext } from './ClassPanel';
import { renderSpeciesPanel, bindSpeciesPanel } from './SpeciesPanel';
import { renderBackgroundPanel, bindBackgroundPanel } from './BackgroundPanel';
import { renderPortraitSelector, bindPortraitSelector } from './PortraitSelector';
import { renderCharacterSummary, bindCharacterSummary } from './CharacterSummary';
import { draftLook, esc, icon } from './creation-helpers';

export type CreationStep = 'class' | 'species' | 'background';

export interface CharacterCreationScreenOptions {
  onComplete: (c: PlayerCharacter) => void;
}

const STEP_META: { id: CreationStep; title: string; blurb: string; banner: string }[] = [
  { id: 'class', title: FIGHTER.title, blurb: 'What are your vocations, special talents, and favoured tactics?', banner: '/images/creation/class_banner_fighter.png' },
  { id: 'species', title: 'HUMAN — Versatile and Determined', blurb: 'Who are your ancestors? What languages do they speak?', banner: '/images/creation/species_banner_human.png' },
  { id: 'background', title: SOLDIER.title, blurb: (SOLDIER as { cardBlurb?: string }).cardBlurb ?? 'How did you spend the years leading up to a life of adventure?', banner: '/images/creation/background_banner_soldier.png' },
];

/**
 * D&D Beyond-style creation: three identity cards, a live 3D hero model, and a
 * detail drawer — finishing on a parchment summary sealed with the forge button.
 */
export class CharacterCreationScreen {
  private root: HTMLElement | null = null;
  private preview: CreationPreview | null = null;
  private draft: CharacterDraft = newDraft();
  private step: CreationStep = 'class';
  private lookTimer: ReturnType<typeof setTimeout> | null = null;
  private summaryChar: PlayerCharacter | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private opts: CharacterCreationScreenOptions) {}

  get isOpen(): boolean { return this.root !== null; }

  open(): void {
    if (this.root) return;
    gameState.setBase('CHARACTER_CREATION');
    const root = document.createElement('div');
    root.id = 'char-creation';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Create your hero');
    root.appendChild(createCreationBackground());
    const shell = document.createElement('div');
    shell.className = 'creation-shell';
    shell.innerHTML =
      `<header class="creation-head"><h2>Create your hero</h2>`
      + `<p>Choose a card to begin — the hero on the pedestal is already you.</p></header>`
      + `<div class="creation-main"><div class="creation-cards" data-region="cards"></div>`
      + `<section class="creation-preview" aria-label="Hero preview"><div class="creation-arch">`
      + `<img class="creation-arch-frame" src="/images/creation/arch_frame.png" alt="" onerror="this.style.display='none'"/>`
      + `<canvas data-region="preview-canvas" aria-label="Live model of your hero"></canvas>`
      + `</div><div class="creation-flourish" role="group" aria-label="Preview actions">`
      + `<button type="button" data-flourish="attack">${icon('sword')} Attack</button>`
      + `<button type="button" data-flourish="hit">${icon('shield')} Take a hit</button>`
      + `<button type="button" data-flourish="down">${icon('heart')} Fall</button>`
      + `</div><div class="creation-name">`
      + `<label>Hero name<input type="text" data-region="name" maxlength="24" placeholder="Name your hero" autocomplete="off"/></label>`
      + `<button type="button" data-random-name title="Random name">${icon('dice')}</button>`
      + `</div><div class="creation-statstrip" data-region="statstrip"></div>`
      + `<div data-region="portraits"></div></section>`
      + `<aside class="creation-drawer" data-region="drawer" aria-live="polite"></aside></div>`
      + `<footer class="creation-foot"><button type="button" class="cc-btn ghost" data-recommended>${icon('sparkles')} Use recommended hero</button>`
      + `<div class="cc-review-wrap"><button type="button" class="cc-btn review" data-review>Review &amp; forge ${icon('chevron')}</button>`
      + `<p class="cc-missing" data-region="missing"></p></div></footer>`
      + `<div class="creation-summary-veil" data-region="summary-veil" hidden><div class="creation-summary" data-region="summary"></div></div>`;
    root.appendChild(shell);
    document.body.appendChild(root);
    this.root = root;
    const canvas = root.querySelector<HTMLCanvasElement>('[data-region="preview-canvas"]')!;
    this.preview = new CreationPreview(canvas, draftLook(this.draft));
    this.preview.start();
    this.wireStatic();
    this.refresh();
    root.querySelector<HTMLInputElement>('[data-region="name"]')?.focus();
  }

  close(): void {
    if (this.lookTimer) clearTimeout(this.lookTimer);
    this.lookTimer = null;
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    this.preview?.dispose();
    this.preview = null;
    this.root?.remove();
    this.root = null;
    this.summaryChar = null;
  }

  /** Test/smoke hook: fill the recommended hero instantly. */
  fillRecommended(name = 'Aldric'): void {
    this.draft = recommendedDraft(name);
    this.refresh();
  }

  // --- Rendering ---

  private ctx(): PanelContext {
    return { refresh: () => this.refresh(), flourish: k => this.preview?.flourish(k) };
  }

  private refresh(): void {
    if (!this.root) return;
    this.renderCards();
    this.renderDrawer();
    this.renderPortraits();
    this.renderStatStrip();
    this.renderFoot();
    this.syncName();
    this.scheduleLook();
  }

  private stepDone(id: CreationStep): boolean {
    return id === 'class' ? classDone(this.draft) : id === 'species' ? speciesDone(this.draft) : backgroundDone(this.draft);
  }

  private renderCards(): void {
    const region = this.root!.querySelector('[data-region="cards"]')!;
    region.innerHTML = STEP_META.map(s => {
      const done = this.stepDone(s.id);
      const active = this.step === s.id;
      return `<button type="button" class="creation-card${active ? ' active' : ''}${done ? ' done' : ''}" data-step="${s.id}" aria-pressed="${active}">`
        + `<img class="creation-card-banner" src="${esc(s.banner)}" alt="" loading="lazy" onerror="this.style.display='none'"/>`
        + `<span class="creation-card-body"><span class="creation-card-title">${esc(s.title)}</span>`
        + `<span class="creation-card-blurb">${esc(s.blurb)}</span></span>`
        + `<span class="creation-card-status" aria-label="${done ? 'complete' : 'incomplete'}">${done ? icon('check') : icon('chevron')}</span>`
        + `</button>`;
    }).join('');
    region.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.step = btn.dataset.step as CreationStep;
        this.refresh();
      });
    });
  }

  private renderDrawer(): void {
    const drawer = this.root!.querySelector<HTMLElement>('[data-region="drawer"]')!;
    const ctx = this.ctx();
    drawer.innerHTML = this.step === 'class' ? renderClassPanel(this.draft, ctx)
      : this.step === 'species' ? renderSpeciesPanel(this.draft, ctx)
        : renderBackgroundPanel(this.draft);
    if (this.step === 'class') bindClassPanel(drawer, this.draft, ctx);
    else if (this.step === 'species') bindSpeciesPanel(drawer, this.draft, ctx);
    else bindBackgroundPanel(drawer, this.draft, ctx);
    drawer.scrollTop = 0;
  }

  private renderPortraits(): void {
    const region = this.root!.querySelector('[data-region="portraits"]')!;
    region.innerHTML = `<h4 class="cc-preview-h">Portrait</h4>${renderPortraitSelector(this.draft)}`;
    bindPortraitSelector(region as HTMLElement, this.draft, { onChange: () => this.refresh() });
  }

  private renderStatStrip(): void {
    const region = this.root!.querySelector('[data-region="statstrip"]')!;
    const scores = buildScores(this.draft.bases, this.draft.plusTwo, this.draft.plusOne);
    const hp = Math.max(1, maxHPFor(scores, this.draft.originFeat ?? 'tough'));
    const ac = acFor(this.draft.offHand, this.draft.fightingStyle ?? 'defense');
    const top = (Object.keys(scores) as (keyof typeof scores)[]).sort((a, b) => scores[b].total - scores[a].total)[0];
    region.innerHTML = `<span title="Hit points">${icon('heart')} <strong>${hp}</strong> HP</span>`
      + `<span title="Armour class">${icon('shield')} <strong>${ac}</strong> AC</span>`
      + `<span title="Highest ability: ${ABILITY_NAMES[top]}">${icon('star')} <strong>${top} ${scores[top].total}</strong></span>`;
  }

  private missingList(): string[] {
    const d = this.draft;
    const missing: string[] = [];
    if (d.classSkills.length !== 2) missing.push('2 class skills');
    if (!d.fightingStyle) missing.push('fighting style');
    if (!d.mainHand || !d.offHand) missing.push('equipment');
    if (!d.language) missing.push('language');
    if (!d.skillful) missing.push('Skillful skill');
    if (!d.originFeat) missing.push('origin feat');
    if (!(d.plusTwo && d.plusOne && d.plusTwo !== d.plusOne)) missing.push('background +2/+1');
    if (!nameDone(d)) missing.push('hero name (2+ letters)');
    return missing;
  }

  private renderFoot(): void {
    const missing = this.missingList();
    const btn = this.root!.querySelector<HTMLButtonElement>('[data-review]')!;
    btn.disabled = !draftComplete(this.draft);
    btn.title = missing.length ? `Still needed: ${missing.join(', ')}` : 'Review your hero';
    this.root!.querySelector('[data-region="missing"]')!.textContent =
      missing.length ? `Still needed: ${missing.join(' · ')}` : 'Ready to forge.';
  }

  private syncName(): void {
    const input = this.root!.querySelector<HTMLInputElement>('[data-region="name"]')!;
    if (document.activeElement !== input && input.value !== this.draft.name) input.value = this.draft.name;
  }

  private scheduleLook(): void {
    if (this.lookTimer) clearTimeout(this.lookTimer);
    this.lookTimer = setTimeout(() => {
      this.preview?.setLook(draftLook(this.draft));
    }, 250);
  }

  // --- Wiring ---

  private wireStatic(): void {
    const root = this.root!;
    root.querySelectorAll<HTMLButtonElement>('[data-flourish]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.preview?.flourish(btn.dataset.flourish as 'attack' | 'hit' | 'down');
      });
    });
    root.querySelector<HTMLInputElement>('[data-region="name"]')?.addEventListener('input', e => {
      this.draft.name = (e.target as HTMLInputElement).value;
      this.renderFoot();
    });
    root.querySelector('[data-random-name]')?.addEventListener('click', () => {
      this.draft.name = SUGGESTED_NAMES[cryptoRandomInt(0, SUGGESTED_NAMES.length - 1)];
      this.refresh();
    });
    root.querySelector('[data-recommended]')?.addEventListener('click', () => {
      const name = this.draft.name.trim() || 'Aldric';
      this.draft = recommendedDraft(name);
      this.refresh();
    });
    root.querySelector('[data-review]')?.addEventListener('click', () => this.openSummary());
    // Focus trap + Escape handling.
    this.keyHandler = (e: KeyboardEvent): void => {
      if (!this.root) return;
      if (e.key === 'Escape') {
        if (this.summaryChar) this.closeSummary();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = [...this.root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, select, [tabindex="0"]',
      )].filter(el => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private openSummary(): void {
    if (!draftComplete(this.draft) || !this.root) return;
    const char = draftToCharacter(this.draft);
    this.summaryChar = char;
    const veil = this.root.querySelector<HTMLElement>('[data-region="summary-veil"]')!;
    const region = this.root.querySelector<HTMLElement>('[data-region="summary"]')!;
    region.innerHTML = renderCharacterSummary(this.draft, char);
    bindCharacterSummary(region, {
      onBack: () => this.closeSummary(),
      onForge: () => {
        const forged = this.summaryChar;
        this.close();
        if (forged) this.opts.onComplete(forged);
      },
    });
    veil.hidden = false;
    region.querySelector<HTMLButtonElement>('[data-forge]')?.focus();
  }

  private closeSummary(): void {
    this.summaryChar = null;
    const veil = this.root?.querySelector<HTMLElement>('[data-region="summary-veil"]');
    if (veil) veil.hidden = true;
    this.root?.querySelector<HTMLButtonElement>('[data-review]')?.focus();
  }
}
