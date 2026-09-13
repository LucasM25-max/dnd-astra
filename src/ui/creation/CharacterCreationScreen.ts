import { gameState } from '../../game/state';
import {
  SUGGESTED_NAMES, portraitDef,
  acFor, backgroundDone, buildScores,
  classDone, draftComplete, draftToCharacter, maxHPFor, nameDone, newDraft, recommendedDraft,
  speciesDone, type CharacterDraft, type PlayerCharacter,
} from '../../game/character';
import { cryptoRandomInt } from '../../systems/dice/DiceResultResolver';
import { gearFromDraft } from '../../character/EquipmentManager';
import { CreationPreview } from './CreationPreview';
import { createCreationBackground } from './CharCreationBackground';
import { renderClassPanel, bindClassPanel, type PanelContext } from './ClassPanel';
import { renderSpeciesPanel, bindSpeciesPanel } from './SpeciesPanel';
import { renderBackgroundPanel, bindBackgroundPanel } from './BackgroundPanel';
import { renderPortraitSelector, bindPortraitSelector } from './PortraitSelector';
import { renderCharacterSummary, bindCharacterSummary } from './CharacterSummary';
import { ABILITY_NAMES, type AbilityKey } from '../../game/character';
import { esc, icon } from './creation-helpers';

export type CreationStep = 'class' | 'species' | 'background';

export interface CharacterCreationScreenOptions {
  onComplete: (c: PlayerCharacter) => void;
}

const STEP_META: { id: CreationStep; title: string; blurb: string; banner: string }[] = [
  { id: 'class', title: 'Fighter — Champion of the Battlefield', blurb: 'What are your vocations, special talents, and favoured tactics?', banner: '/images/creation/class_banner_fighter.webp' },
  { id: 'species', title: 'Human — Versatile and Determined', blurb: 'Who are your ancestors? What languages do they speak?', banner: '/images/creation/species_banner_human.webp' },
  { id: 'background', title: 'Soldier — Forged in Battle', blurb: 'How did you spend the years leading up to a life of adventure?', banner: '/images/creation/background_banner_soldier.webp' },
];

/**
 * D&D Beyond-style creation: three full-banner identity cards with a right
 * sliding drawer, and a gothic-arch live 3D render of the skeletal hero that
 * follows every portrait, armour, and weapon choice. Finishes on a parchment
 * summary sealed with a hammer strike.
 */
export class CharacterCreationScreen {
  private root: HTMLElement | null = null;
  private preview: CreationPreview | null = null;
  private draft: CharacterDraft = newDraft();
  private step: CreationStep | null = null;
  private lookTimer: ReturnType<typeof setTimeout> | null = null;
  private appliedKey = '';
  private summaryChar: PlayerCharacter | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private forging = false;

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
      + `<div class="creation-main">`
      + `<div class="creation-left">`
      + `<div class="creation-cards" data-region="cards" role="tablist" aria-label="Identity sections"></div>`
      + `<aside class="creation-drawer" data-region="drawer" aria-live="polite" aria-label="Section options">`
      + `<button type="button" class="cc-drawer-close" data-drawer-close aria-label="Back to your cards">${icon('back')} Your cards</button>`
      + `<div class="cc-drawer-body" data-region="drawer-body"></div>`
      + `</aside></div>`
      + `<section class="creation-right" aria-label="Hero preview">`
      + `<div class="creation-arch">`
      + `<img class="creation-arch-frame" src="/images/creation/arch_frame.webp" alt="" onerror="this.style.display='none'"/>`
      + `<canvas data-region="preview-canvas" aria-label="Live model of your hero"></canvas>`
      + `<span class="creation-arch-tag">YOUR HERO · LIVE</span>`
      + `</div>`
      + `<div class="creation-flourish" role="group" aria-label="Preview actions">`
      + `<button type="button" data-flourish="attack">${icon('sword')} Attack</button>`
      + `<button type="button" data-flourish="hit">${icon('shield')} Take a hit</button>`
      + `<button type="button" data-flourish="down">${icon('heart')} Fall</button>`
      + `</div>`
      + `<div class="creation-statstrip" data-region="statstrip"></div>`
      + `<div data-region="portraits"></div>`
      + `<div class="creation-name">`
      + `<label>HERO NAME<input type="text" data-region="name" maxlength="24" placeholder="Name your hero" autocomplete="off" spellcheck="false"/></label>`
      + `<button type="button" data-random-name title="Random name" aria-label="Random name">${icon('dice')}</button>`
      + `</div>`
      + `<div class="creation-pills" role="group" aria-label="Suggested names">`
      + SUGGESTED_NAMES.map(n => `<button type="button" data-pill="${esc(n)}">${esc(n)}</button>`).join('')
      + `</div>`
      + `<div class="creation-forge-wrap">`
      + `<p class="cc-missing" data-region="missing"></p>`
      + `<button type="button" class="cc-btn forge" data-forge-legend data-review>Forge your legend ${icon('zap')}</button>`
      + `</div></section></div>`
      + `<footer class="creation-foot"><button type="button" class="cc-btn ghost" data-recommended>${icon('sparkles')} Use recommended hero</button>`
      + `<small class="cc-foot-note">The Triboar Trail is already waiting for you beyond this door.</small></footer>`
      + `<div class="creation-summary-veil" data-region="summary-veil" hidden><div class="cc-flash" aria-hidden="true"></div><div class="creation-summary" data-region="summary"></div></div>`;
    root.appendChild(shell);
    document.body.appendChild(root);
    this.root = root;
    document.body.dataset.creating = 'true';
    const canvas = root.querySelector<HTMLCanvasElement>('[data-region="preview-canvas"]')!;
    const gear = gearFromDraft(this.draft);
    this.preview = new CreationPreview(canvas, { preset: portraitDef(gear.preset), mainHand: gear.mainHand, offHand: gear.offHand });
    void this.preview.start();
    this.appliedKey = this.gearKey();
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
    this.forging = false;
    if (!document.querySelector('#experience[data-ready="true"]')) document.body.dataset.creating = 'false';
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
      return `<button type="button" class="creation-card${active ? ' active' : ''}${done ? ' done' : ''}" data-step="${s.id}" role="tab" aria-selected="${active}">`
        + `<img class="creation-card-banner" src="${esc(s.banner)}" alt="" loading="lazy" onerror="this.style.display='none'"/>`
        + `<span class="creation-card-scrim" aria-hidden="true"></span>`
        + `<span class="creation-card-body">`
        + `<span class="creation-card-eyebrow">${done ? 'CHOSEN' : 'CHOOSE'}</span>`
        + `<span class="creation-card-title">${esc(s.title)}</span>`
        + `<span class="creation-card-blurb">${esc(s.blurb)}</span>`
        + `<span class="creation-card-see">${icon('chevron')} SEE OPTIONS</span></span>`
        + `<span class="creation-card-status" aria-label="${done ? 'complete' : 'incomplete'}">${done ? icon('check') : icon('chevron')}</span>`
        + `</button>`;
    }).join('');
    region.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(btn => {
      btn.addEventListener('click', () => this.openDrawer(btn.dataset.step as CreationStep));
    });
  }

  private openDrawer(step: CreationStep): void {
    this.step = step;
    this.renderCards();
    this.renderDrawer();
    this.root!.querySelector<HTMLElement>('[data-region="drawer"]')!.classList.add('open');
    window.setTimeout(() => this.root?.querySelector<HTMLButtonElement>('[data-drawer-close]')?.focus(), 480);
  }

  private closeDrawer(): void {
    this.step = null;
    this.renderCards();
    this.root!.querySelector<HTMLElement>('[data-region="drawer"]')!.classList.remove('open');
  }

  private renderDrawer(): void {
    const drawer = this.root!.querySelector<HTMLElement>('[data-region="drawer"]')!;
    const body = drawer.querySelector<HTMLElement>('[data-region="drawer-body"]')!;
    if (!this.step) { body.innerHTML = ''; return; }
    const ctx = this.ctx();
    body.innerHTML = this.step === 'class' ? renderClassPanel(this.draft, ctx)
      : this.step === 'species' ? renderSpeciesPanel(this.draft, ctx)
        : renderBackgroundPanel(this.draft);
    if (this.step === 'class') bindClassPanel(body, this.draft, ctx);
    else if (this.step === 'species') bindSpeciesPanel(body, this.draft, ctx);
    else bindBackgroundPanel(body, this.draft, ctx);
    body.scrollTop = 0;
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
    const top = (Object.keys(scores) as AbilityKey[]).sort((a, b) => scores[b].total - scores[a].total)[0];
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
    const btn = this.root!.querySelector<HTMLButtonElement>('[data-forge-legend]')!;
    const ready = draftComplete(this.draft) && !this.forging;
    btn.disabled = !ready;
    btn.classList.toggle('ready', ready);
    btn.title = missing.length ? `Still needed: ${missing.join(', ')}` : 'Forge your hero and begin the journey';
    this.root!.querySelector('[data-region="missing"]')!.textContent =
      missing.length ? `Still needed: ${missing.join(' · ')}` : 'Every section is set. When you are ready, forge your legend.';
  }

  private syncName(): void {
    const input = this.root!.querySelector<HTMLInputElement>('[data-region="name"]')!;
    if (document.activeElement !== input && input.value !== this.draft.name) input.value = this.draft.name;
  }

  // --- Live 3D preview sync ---

  private gearKey(): string {
    const g = gearFromDraft(this.draft);
    return `${g.preset}|${g.mainHand}|${g.offHand ?? '-'}`;
  }

  private scheduleLook(): void {
    if (this.lookTimer) clearTimeout(this.lookTimer);
    this.lookTimer = setTimeout(() => {
      this.lookTimer = null;
      this.syncLook();
    }, 180);
  }

  /** Push portrait + weapon changes into the live model (instant re-dress). */
  private syncLook(): void {
    const preview = this.preview;
    if (!preview) return;
    const key = this.gearKey();
    if (key === this.appliedKey) return;
    const prevKey = this.appliedKey;
    this.appliedKey = key;
    const gear = gearFromDraft(this.draft);
    if (prevKey && prevKey.split('|')[0] !== gear.preset) preview.setPortrait(portraitDef(gear.preset));
    preview.setEquipment(gear.mainHand, gear.offHand);
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
    root.querySelectorAll<HTMLButtonElement>('[data-pill]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.draft.name = btn.dataset.pill ?? this.draft.name;
        this.syncName();
        this.renderFoot();
      });
    });
    root.querySelector('[data-recommended]')?.addEventListener('click', () => {
      const name = this.draft.name.trim() || 'Aldric';
      this.draft = recommendedDraft(name);
      this.refresh();
    });
    root.querySelector('[data-drawer-close]')?.addEventListener('click', () => this.closeDrawer());
    root.querySelector('[data-forge-legend]')?.addEventListener('click', () => this.openSummary());
    // Focus trap + Escape handling.
    this.keyHandler = (e: KeyboardEvent): void => {
      if (!this.root) return;
      if (e.key === 'Escape') {
        if (this.summaryChar) this.closeSummary();
        else if (this.step) this.closeDrawer();
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

  // --- Summary + forge ---

  private openSummary(): void {
    if (!draftComplete(this.draft) || !this.root || this.forging) return;
    const char = draftToCharacter(this.draft);
    this.summaryChar = char;
    const veil = this.root.querySelector<HTMLElement>('[data-region="summary-veil"]')!;
    const region = this.root.querySelector<HTMLElement>('[data-region="summary"]')!;
    region.innerHTML = renderCharacterSummary(this.draft, char);
    bindCharacterSummary(region, {
      onBack: () => this.closeSummary(),
      onForge: () => this.forge(),
    });
    veil.hidden = false;
    // The model keeps turning behind the parchment, working a weapon flourish.
    void this.preview?.flourish('attack');
    window.setTimeout(() => { region.querySelector<HTMLButtonElement>('[data-forge]')?.focus(); }, 60);
  }

  private closeSummary(): void {
    this.summaryChar = null;
    const veil = this.root?.querySelector<HTMLElement>('[data-region="summary-veil"]');
    if (veil) veil.hidden = true;
    this.root?.querySelector<HTMLButtonElement>('[data-forge-legend]')?.focus();
  }

  /** Hammer strike, wax seal, then off into the woodland. */
  private forge(): void {
    if (this.forging) return;
    const forged = this.summaryChar;
    if (!forged || !this.root) return;
    this.forging = true;
    const veil = this.root.querySelector<HTMLElement>('[data-region="summary-veil"]')!;
    veil.classList.add('sealing');
    this.playForgeStrike();
    window.setTimeout(() => {
      this.close();
      this.opts.onComplete(forged);
    }, 780);
  }

  /** One hammer blow: low thump + bright ring + a whisper of metal dust. */
  private playForgeStrike(): void {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const t = ctx.currentTime;
      const dest = ctx.destination;
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(130, t);
      thump.frequency.exponentialRampToValueAtTime(36, t + 0.16);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.55, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      thump.connect(tg).connect(dest);
      thump.start(t); thump.stop(t + 0.26);
      const ring = ctx.createOscillator();
      ring.type = 'triangle';
      ring.frequency.setValueAtTime(720, t + 0.028);
      ring.frequency.exponentialRampToValueAtTime(540, t + 0.9);
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.11, t + 0.028);
      rg.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
      ring.connect(rg).connect(dest);
      ring.start(t + 0.028); ring.stop(t + 1);
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.3, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      noise.connect(bp).connect(ng).connect(dest);
      noise.start(t);
      window.setTimeout(() => { void ctx.close().catch(() => { /* Already closed. */ }); }, 1100);
    } catch { /* The seal still lands. */ }
  }
}
