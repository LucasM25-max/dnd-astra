import { gameState } from '../../game/state';
import {
  SUGGESTED_NAMES, portraitDef,
  acFor, backgroundDone, buildScores,
  classDone, draftComplete, draftToCharacter, maxHPFor, newDraft, recommendedDraft,
  speciesDone, type CharacterDraft, type PlayerCharacter, ABILITY_NAMES, type AbilityKey,
} from '../../game/character';
import { cryptoRandomInt } from '../../systems/dice/DiceResultResolver';
import { gearFromDraft } from '../../character/EquipmentManager';
import { CreationPreview } from './CreationPreview';
import { renderClassPanel, bindClassPanel } from './ClassPanel';
import { renderSpeciesPanel, bindSpeciesPanel } from './SpeciesPanel';
import { renderBackgroundPanel, bindBackgroundPanel } from './BackgroundPanel';
import { renderPortraitSelector, bindPortraitSelector } from './PortraitSelector';
import { renderCharacterSummary, bindCharacterSummary } from './CharacterSummary';
import { renderVitality } from './Vitality';
import { esc, icon } from './creation-helpers';

/**
 * Character creation: a four-step wizard (Class → Species → Background →
 * Review). Fighter, Human, and Soldier are the only options in this build,
 * so every step confirms one identity choice and hosts its mechanical
 * sub-pickers (fighting style, skills, point buy, origin feat, equipment).
 *
 * The entire flow lives on one screen — a step rail, the active panel, and
 * a live 3D preview of the same skeletal hero the game plays. Clicking a
 * choice updates it in place: the panel keeps its scroll, the focused
 * control keeps focus, and the chrome (vitality block, rail ticks, stat
 * strip) re-derives without rebuilding the page. All decoration is drawn
 * with type, rules, and gradients — no painted art in the flow.
 */

const STEPS = [
  { id: 'class', n: 'I', title: 'Fighter', sub: 'Champion of the Battlefield' },
  { id: 'species', n: 'II', title: 'Human', sub: 'Versatile and Determined' },
  { id: 'background', n: 'III', title: 'Soldier', sub: 'Forged in Battle' },
  { id: 'review', n: 'IV', title: 'Review', sub: 'Your legend, before the forge' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

export interface CharacterCreationScreenOptions {
  onComplete: (c: PlayerCharacter) => void;
}

/** Controls that must survive a refresh with focus intact. */
const FOCUSABLE_SELECTOR = [
  '[data-style]', '[data-feat]', '[data-lang]', '[data-asi-target]', '[data-asi-clear]',
  '[data-recommended-build]', '[data-reroll-personality]', '[data-portrait]', '[data-abase]',
  '[data-skill-class]', '[data-skill-skillful]', '[data-weapon-primary]', '[data-weapon-offhand]',
  '[data-person]', '[data-name]',
].join(',');

function focusSignature(el: Element | null): string {
  if (!(el instanceof HTMLElement) || !el.dataset) return '';
  return `${el.tagName}&${Object.entries(el.dataset).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join('&')}`;
}

export class CharacterCreationScreen {
  private root: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private preview: CreationPreview | null = null;
  private draft: CharacterDraft = newDraft();
  private step = 0;
  private lookTimer: ReturnType<typeof setTimeout> | null = null;
  private appliedKey = '';
  private forging = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private opts: CharacterCreationScreenOptions) {}

  get isOpen(): boolean { return this.root !== null; }

  open(): void {
    if (this.root) return;
    gameState.setBase('CHARACTER_CREATION');
    const root = document.createElement('section');
    root.id = 'char-creation';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Create your hero');
    root.innerHTML = `
      <div class="cc-bg" aria-hidden="true"><i class="cc-bg-glow a"></i><i class="cc-bg-glow b"></i><i class="cc-bg-vignette"></i></div>
      <div class="cc-shell">
        <header class="cc-head">
          <div class="cc-head-lead">${icon('helm')}<div><h2>Create your hero</h2><p>Chapter I · The Triboar Trail — every choice explained in plain words</p></div></div>
          <button type="button" class="cc-btn ghost" data-recommended>${icon('sparkles')} Use recommended hero</button>
        </header>
        <div class="cc-grid">
          <nav class="cc-rail" aria-label="Creation steps">${STEPS.map((st, i) => `
            <button type="button" class="cc-rail-item" data-step-btn="${i}" aria-current="${i === this.step ? 'step' : 'false'}">
              <span class="cc-rail-n">${st.n}</span>
              <span class="cc-rail-copy"><strong>${st.title}</strong><small>${st.sub}</small></span>
              <span class="cc-rail-tick" aria-hidden="true">${icon('check')}</span>
            </button>`).join('')}
          </nav>
          <main class="cc-panel-wrap" aria-label="Hero choices">
            <div class="cc-panel-scroll" id="cc-panel-body" tabindex="-1"></div>
            <footer class="cc-foot">
              <p class="cc-missing" data-region="missing"></p>
              <div class="cc-foot-actions">
                <button type="button" class="cc-btn ghost" data-back hidden>${icon('back')} Keep editing</button>
                <button type="button" class="cc-btn primary" data-next hidden>Next ${icon('chevron')}</button>
                <button type="button" class="cc-btn forge" data-forge-legend data-review>See your summary ${icon('chevron')}</button>
              </div>
            </footer>
          </main>
          <aside class="cc-side" aria-label="Live preview of your hero">
            <figure class="cc-dais">
              <canvas data-region="preview-canvas" aria-label="Live model of your hero"></canvas>
              <span class="cc-dais-rule" aria-hidden="true"></span>
              <figcaption class="cc-dais-cap"><span>THE MODEL YOU'LL PLAY</span><em>drag to turn</em></figcaption>
            </figure>
            <div class="cc-flourish" role="group" aria-label="Preview actions">
              <button type="button" data-flourish="attack">${icon('sword')} Attack</button>
              <button type="button" data-flourish="hit">${icon('shield')} Take a hit</button>
              <button type="button" data-flourish="down">${icon('heart')} Fall</button>
              <button type="button" data-flourish="salute">${icon('star')} Salute</button>
            </div>
            <div class="cc-vitality" data-region="vitality"></div>
            <section class="cc-portraits-card">
              <h4 class="cc-side-h">Identity</h4>
              <div class="cc-name-row">
                <label>HERO NAME<input type="text" data-region="name" maxlength="24" placeholder="Name your hero" autocomplete="off" spellcheck="false"/></label>
                <button type="button" data-random-name title="Roll a suggested name" aria-label="Roll a suggested name">${icon('dice')}</button>
              </div>
              <div class="cc-name-pills" role="group" aria-label="Suggested names">
                ${SUGGESTED_NAMES.map(n => `<button type="button" data-pill="${esc(n)}">${esc(n)}</button>`).join('')}
              </div>
              <h4 class="cc-side-h">Face</h4>
              <div data-region="portraits"></div>
              <p class="cc-side-note">${icon('info')} The six faces are the ones the game paints on the model itself.</p>
            </section>
            <div class="creation-statstrip" data-region="statstrip"></div>
          </aside>
        </div>
      </div>
      <div class="cc-forge-flash" data-region="flash" aria-hidden="true"></div>`;
    document.body.appendChild(root);
    this.root = root;
    document.body.dataset.creating = 'true';
    this.body = root.querySelector<HTMLElement>('#cc-panel-body')!;

    const canvas = root.querySelector<HTMLCanvasElement>('[data-region="preview-canvas"]')!;
    const gear = gearFromDraft(this.draft);
    this.preview = new CreationPreview(canvas, { preset: portraitDef(gear.preset), mainHand: gear.mainHand, offHand: gear.offHand });
    void this.preview.start();
    this.appliedKey = this.gearKey();

    this.wireStatic();
    this.renderStep(true);
    this.renderPortraits();
    this.syncSide();
    window.setTimeout(() => root.querySelector<HTMLElement>('[data-region="name"]')?.focus({ preventScroll: true }), 80);
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
    this.body = null;
    this.forging = false;
    if (!document.querySelector('#experience[data-ready="true"]')) document.body.dataset.creating = 'false';
  }

  /** Test/smoke hook: fill the recommended hero instantly. */
  fillRecommended(name = 'Aldric'): void {
    this.draft = recommendedDraft(name);
    this.refresh();
  }

  // --- Rendering ---------------------------------------------------------

  /**
   * A panel context handed to every step: `refresh` re-derives everything
   * while preserving scroll + focus, `flourish` poses the live model.
   */
  private ctx() {
    return { refresh: () => this.refresh(), flourish: (k: 'attack' | 'hit' | 'down' | 'salute' | 'bow') => this.preview?.flourish(k) };
  }

  /**
   * The only update path a choice takes: swap the panel body's markup, then
   * restore its scroll and the clicked control's focus. Nothing else on the
   * screen is touched — no drawer open/close, no window scroll, no
   * "back to top".
   */
  private refresh(): void {
    if (!this.root || !this.body) return;
    const scroll = this.body.scrollTop;
    const active = document.activeElement as HTMLElement | null;
    const sig = active && this.body.contains(active) ? focusSignature(active) : '';
    this.renderStep();
    this.renderPortraits();
    if (sig) {
      const restore = [...this.body.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .find(el => focusSignature(el) === sig);
      restore?.focus({ preventScroll: true });
    }
    this.body.scrollTop = scroll;
    this.syncSide();
  }

  /** The face picker lives outside the step panel; re-render + redraw on refresh. */
  private renderPortraits(): void {
    if (!this.root) return;
    const region = this.root.querySelector<HTMLElement>('[data-region="portraits"]');
    if (!region) return;
    region.innerHTML = renderPortraitSelector(this.draft);
    bindPortraitSelector(region, this.draft, {
      onChange: () => {
        this.scheduleLook();
        this.refresh();
      },
    });
  }

  private stepDone(id: StepId): boolean {
    return id === 'class' ? classDone(this.draft)
      : id === 'species' ? speciesDone(this.draft)
        : id === 'background' ? backgroundDone(this.draft)
          : draftComplete(this.draft);
  }

  private renderStep(animateIn = false): void {
    if (!this.body || !this.root) return;
    const d = this.draft;
    const c = this.ctx();
    switch (STEPS[this.step].id as StepId) {
      case 'class': this.body.innerHTML = renderClassPanel(d, c); bindClassPanel(this.body, d, c); break;
      case 'species': this.body.innerHTML = renderSpeciesPanel(d, c); bindSpeciesPanel(this.body, d, c); break;
      case 'background': this.body.innerHTML = renderBackgroundPanel(d); bindBackgroundPanel(this.body, d, c); break;
      case 'review':
        this.body.innerHTML = renderCharacterSummary(d, draftToCharacter(d));
        bindCharacterSummary(this.body, {
          onForge: () => this.forge(),
          onBack: () => this.go(STEPS.length - 2),
        });
        break;
    }
    if (animateIn) this.body.firstElementChild?.classList.add('cc-enter');
    // Rail + footer state.
    this.root.querySelectorAll<HTMLElement>('.cc-rail-item').forEach((n, i) => {
      n.classList.toggle('active', i === this.step);
      n.classList.toggle('done', this.stepDone(STEPS[i].id));
      n.setAttribute('aria-current', i === this.step ? 'step' : 'false');
    });
    const atReview = this.step === STEPS.length - 1;
    const back = this.root.querySelector<HTMLButtonElement>('[data-back]')!;
    const next = this.root.querySelector<HTMLButtonElement>('[data-next]')!;
    const review = this.root.querySelector<HTMLButtonElement>('[data-forge-legend]')!;
    back.hidden = this.step === 0;
    // The primary button doubles as "to review" before the review step and
    // "forge" on it; a separate Next only sits between plain steps.
    next.hidden = atReview || this.step === STEPS.length - 2;
    review.innerHTML = atReview
      ? `${icon('zap')} Forge hero &amp; begin`
      : `See your summary ${icon('chevron')}`;
  }

  /** Derived side-column chrome (always cheap to recompute, never scrolled). */
  private syncSide(): void {
    if (!this.root) return;
    const d = this.draft;
    const scores = buildScores(d.bases, d.plusTwo, d.plusOne);
    const con = scores.CON.modifier;
    const hp = Math.max(1, maxHPFor(scores, d.originFeat ?? 'tough'));
    const ac = acFor(d.offHand, d.fightingStyle ?? 'defense');
    const top = (Object.keys(scores) as AbilityKey[]).sort((a, b) => scores[b].total - scores[a].total)[0];
    const vitality = this.root.querySelector<HTMLElement>('[data-region="vitality"]');
    if (vitality) {
      const terms = [
        { label: '10', note: 'Fighter hit die × 1', tone: undefined as 'good' | 'bad' | undefined },
        { label: `${con >= 0 ? '+' : ''}${con}`, note: 'Constitution modifier', tone: (con >= 0 ? 'good' : 'bad') as 'good' | 'bad' },
      ];
      if (d.originFeat === 'tough') terms.push({ label: '+2', note: 'Tough (origin feat)', tone: 'good' });
      vitality.innerHTML = renderVitality(hp, hp, terms,
        'Recover hit points at the campfire — short rests spend Hit Dice, a long rest refills everything.');
    }
    const strip = this.root.querySelector<HTMLElement>('[data-region="statstrip"]');
    if (strip) {
      strip.innerHTML = `
        <span title="Hit points">${icon('heart')} <strong>${hp}</strong> HP</span>
        <span title="Armour class">${icon('shield')} <strong>${ac}</strong> AC</span>
        <span title="Highest ability: ${ABILITY_NAMES[top]}">${icon('star')} <strong>${top} ${scores[top].total}</strong></span>
        <span title="Proficiency bonus">${icon('zap')} <strong>+2</strong></span>`;
    }
    const missing = this.missingList();
    const note = this.root.querySelector<HTMLElement>('[data-region="missing"]');
    if (note) note.innerHTML = missing.length
      ? `${icon('info')} <span>Still needed: ${missing.join(' · ')}</span>`
      : `${icon('check')} <span>Every section is set. When you are ready, forge your legend.</span>`;
    const btn = this.root.querySelector<HTMLButtonElement>('[data-forge-legend]');
    if (btn) {
      const ready = draftComplete(d) && !this.forging;
      const atReview = this.step === STEPS.length - 1;
      btn.disabled = atReview && !ready;
      btn.classList.toggle('ready', ready && atReview);
      btn.title = atReview
        ? (ready ? 'Forge your hero and begin the journey' : `Still needed: ${missing.join(', ')}`)
        : (missing.length ? `Review any time — still needed: ${missing.join(', ')}` : 'Review your hero, then forge');
    }
    const nameInput = this.root.querySelector<HTMLInputElement>('[data-region="name"]')!;
    if (document.activeElement !== nameInput && nameInput.value !== d.name) nameInput.value = d.name;
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
    if (d.name.trim().length < 2) missing.push('hero name (2+ letters)');
    return missing;
  }

  private go(step: number): void {
    this.step = Math.max(0, Math.min(STEPS.length - 1, step));
    this.renderStep(true);
    this.body?.scrollTo({ top: 0 });
    this.syncSide();
  }

  // --- Live 3D preview sync ----------------------------------------------

  private gearKey(): string {
    const g = gearFromDraft(this.draft);
    return `${g.preset}|${g.mainHand}|${g.offHand ?? '-'}`;
  }

  private scheduleLook(): void {
    if (this.lookTimer) clearTimeout(this.lookTimer);
    this.lookTimer = setTimeout(() => { this.lookTimer = null; this.syncLook(); }, 140);
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

  // --- Wiring ---------------------------------------------------------------

  private wireStatic(): void {
    const root = this.root!;
    root.querySelectorAll<HTMLButtonElement>('[data-step-btn]').forEach(btn =>
      btn.addEventListener('click', () => this.go(Number(btn.dataset.stepBtn))));
    root.querySelector('[data-back]')!.addEventListener('click', () => this.go(this.step - 1));
    root.querySelector('[data-next]')!.addEventListener('click', () => this.go(this.step + 1));
    root.querySelector('[data-forge-legend]')!.addEventListener('click', () => {
      if (this.step === STEPS.length - 1) this.forge();
      else this.go(STEPS.length - 1);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-flourish]').forEach(btn =>
      btn.addEventListener('click', () => this.preview?.flourish(btn.dataset.flourish as 'attack' | 'hit' | 'down' | 'salute')));
    root.querySelector<HTMLInputElement>('[data-region="name"]')!.addEventListener('input', e => {
      this.draft.name = (e.target as HTMLInputElement).value;
      this.syncSide();
    });
    root.querySelector('[data-random-name]')!.addEventListener('click', () => {
      this.draft.name = SUGGESTED_NAMES[cryptoRandomInt(0, SUGGESTED_NAMES.length - 1)];
      this.refresh();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-pill]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.draft.name = btn.dataset.pill ?? this.draft.name;
        this.refresh();
      });
    });
    root.querySelector('[data-recommended]')!.addEventListener('click', () => {
      const name = this.draft.name.trim() || 'Aldric';
      this.draft = recommendedDraft(name);
      this.refresh();
      this.scheduleLook();
    });
    // The model follows equipment choices live (debounced re-dress).
    const observer = new MutationObserver(() => this.scheduleLook());
    observer.observe(root.querySelector('#cc-panel-body')!, { childList: true, subtree: true });
    // Drag-to-turn the dais.
    const canvas = root.querySelector<HTMLCanvasElement>('[data-region="preview-canvas"]')!;
    let dragging = false, lastX = 0;
    canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      this.preview?.addTurn((e.clientX - lastX) * 0.012);
      lastX = e.clientX;
    });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
    // Focus trap + Escape (Escape walks back through the wizard, never out).
    this.keyHandler = (e: KeyboardEvent): void => {
      if (!this.root) return;
      if (e.key === 'Escape') {
        if (this.step > 0) { e.preventDefault(); e.stopPropagation(); this.go(this.step - 1); }
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = [...this.root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), canvas, #cc-panel-body',
      )].filter(el => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  // --- Forge ----------------------------------------------------------------

  /** Hammer strike + a bloom of light, then off into the woodland. */
  private forge(): void {
    if (this.forging || !draftComplete(this.draft) || !this.root) return;
    this.forging = true;
    this.syncSide();
    this.root.querySelector<HTMLElement>('.cc-shell')!.classList.add('sealing');
    this.root.querySelector<HTMLElement>('[data-region="flash"]')?.classList.add('on');
    this.playForgeStrike();
    window.setTimeout(() => {
      const forged = draftToCharacter(this.draft);
      this.close();
      this.opts.onComplete(forged);
    }, 640);
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

  dispose(): void {
    this.close();
  }
}
