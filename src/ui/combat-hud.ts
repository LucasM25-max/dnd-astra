import type { CombatSnapshot } from '../engine/combat-director';
import type { WoodlandWorld } from '../engine/world';
import type { LogEntry } from '../game/encounter';
import { CONDITION_NAMES, COVER_NAMES, type Condition, type Cover } from '../game/rules';
import { SPELLS } from '../game/spells';

/**
 * The in-world combat interface.
 *
 * Nothing here opens a modal or pauses the scene. The initiative order, the
 * action bar, the attack preview and the roll log are overlays on a world that
 * keeps rendering underneath, so the fight is something the player is standing
 * in rather than something they are reading about.
 */

const escapeHtml = (text: string) => text
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export class CombatHud {
  private root: HTMLElement;
  private orderEl: HTMLElement;
  private barEl: HTMLElement;
  private previewEl: HTMLElement;
  private logEl: HTMLElement;
  private bannerEl: HTMLElement;
  private resultEl: HTMLElement;
  private vignetteEl: HTMLElement;
  private lastLogId = 0;
  private lastSignature = '';
  private lastHeroHp = -1;
  private lastActiveId: string | null = null;
  private vignetteTimer = 0;
  private visible = false;
  private selectedSpell: string | null = null;
  private abort = new AbortController();

  onFinish: () => void = () => {};

  constructor(host: HTMLElement, private world: WoodlandWorld) {
    this.root = document.createElement('div');
    this.root.className = 'combat-hud';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="combat-vignette" id="combat-vignette" aria-hidden="true"></div>
      <div class="combat-banner" id="combat-banner"></div>
      <div class="combat-order" id="combat-order" aria-label="Initiative order"></div>
      <div class="combat-preview" id="combat-preview" aria-live="polite"></div>
      <div class="combat-log" id="combat-log" aria-live="polite" aria-label="Combat log"></div>
      <div class="combat-bar" id="combat-bar" role="toolbar" aria-label="Combat actions"></div>
      <div class="combat-result" id="combat-result" hidden></div>`;
    host.append(this.root);

    this.orderEl = this.root.querySelector('#combat-order')!;
    this.barEl = this.root.querySelector('#combat-bar')!;
    this.previewEl = this.root.querySelector('#combat-preview')!;
    this.logEl = this.root.querySelector('#combat-log')!;
    this.bannerEl = this.root.querySelector('#combat-banner')!;
    this.resultEl = this.root.querySelector('#combat-result')!;
    this.vignetteEl = this.root.querySelector('#combat-vignette')!;

    this.bind();
  }

  private bind() {
    const opts = { signal: this.abort.signal };

    this.root.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      const { action, spell, target } = button.dataset;
      const adventure = this.world.adventure;

      if (spell) {
        // Selecting a spell arms it; the next click on a goblin casts it.
        this.selectedSpell = this.selectedSpell === spell ? null : spell;
        this.render(adventure.combat, true);
        return;
      }
      if (target) { this.strike(target); return; }
      switch (action) {
        case 'dodge': adventure.combatAct({ type: 'dodge' }); break;
        case 'dash': adventure.combatAct({ type: 'dash' }); break;
        case 'disengage': adventure.combatAct({ type: 'disengage' }); break;
        case 'hide': adventure.combatAct({ type: 'hide' }); break;
        case 'secondWind': adventure.combatAct({ type: 'secondWind' }); break;
        case 'endTurn': adventure.combatEndTurn(); break;
        case 'finish': this.onFinish(); break;
      }
    }, opts);

    // Clicking a goblin in the world is the primary way to attack it.
    this.world.renderer.domElement.addEventListener('pointerdown', e => {
      if (!this.visible || e.button !== 0) return;
      const adventure = this.world.adventure;
      if (!adventure.isPlayerTurn) return;
      const hovered = adventure.combatHoveredId;
      if (hovered) { e.preventDefault(); this.strike(hovered); }
    }, opts);

    document.addEventListener('keydown', e => {
      if (!this.visible || e.repeat) return;
      const adventure = this.world.adventure;
      if (!adventure.isPlayerTurn) return;
      if (e.code === 'Space') { e.preventDefault(); adventure.combatEndTurn(); }
      if (e.code === 'KeyQ') { e.preventDefault(); adventure.combatAct({ type: 'dodge' }); }
      if (e.code === 'KeyF' && adventure.combatHoveredId) { e.preventDefault(); this.strike(adventure.combatHoveredId); }
      // Number keys arm the corresponding spell.
      const index = Number(e.key) - 1;
      const snapshot = adventure.combat;
      if (Number.isInteger(index) && index >= 0 && snapshot?.spells[index]) {
        e.preventDefault();
        const spell = snapshot.spells[index];
        this.selectedSpell = this.selectedSpell === spell.id ? null : spell.id;
        this.render(snapshot, true);
      }
    }, opts);
  }

  private strike(targetId: string) {
    const adventure = this.world.adventure;
    if (this.selectedSpell) {
      const cast = adventure.combatCast(this.selectedSpell, [targetId]);
      if (cast) this.selectedSpell = null;
    } else {
      adventure.combatAttack(targetId);
    }
  }

  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.hidden = !visible;
    document.body.dataset.combat = String(visible);
    if (!visible) { this.selectedSpell = null; this.lastLogId = 0; this.lastHeroHp = -1; this.lastActiveId = null; this.logEl.innerHTML = ''; }
  }

  appendLog(entries: LogEntry[]) {
    for (const entry of entries) {
      if (entry.id > 0 && entry.id <= this.lastLogId) continue;
      if (entry.id > 0) this.lastLogId = entry.id;
      const line = document.createElement('p');
      line.className = `log-line log-${entry.kind}`;
      const roll = entry.roll
        ? `<span class="log-roll" title="${escapeHtml((entry.detail ?? entry.roll.explanation).join(' · '))}">d20 ${entry.roll.dice.join('/')} ${entry.roll.modifier >= 0 ? '+' : ''}${entry.roll.modifier} = <strong>${entry.roll.total}</strong>${entry.roll.dc !== undefined ? ` vs ${entry.roll.dc}` : ''}</span>`
        : '';
      line.innerHTML = `<span>${escapeHtml(entry.text)}</span>${roll}`;
      this.logEl.append(line);
    }
    while (this.logEl.childElementCount > 40) this.logEl.firstElementChild?.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  render(snapshot: CombatSnapshot | null, force = false) {
    if (!snapshot) { this.setVisible(false); return; }
    const active = snapshot.phase === 'active' || snapshot.phase === 'sprung';
    const done = snapshot.phase === 'resolved' || snapshot.phase === 'lost';
    this.setVisible(active || done);
    if (!active && !done) return;

    // Cheap change detection: the HUD re-renders on state change, not per frame.
    const signature = [
      snapshot.round, snapshot.activeId, snapshot.isPlayerTurn, snapshot.phase,
      snapshot.budget?.movementLeft, snapshot.budget?.action, snapshot.budget?.bonusAction,
      snapshot.preview?.targetId, snapshot.preview?.hitChance, this.selectedSpell,
      snapshot.combatants.map(c => `${c.hp}/${c.dead ? 'x' : 'o'}`).join(),
    ].join('|');
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;

    // A hit you take flashes the edges of the screen.
    const heroHp = snapshot.hero?.hp ?? -1;
    if (this.lastHeroHp >= 0 && heroHp < this.lastHeroHp) this.flashVignette();
    this.lastHeroHp = heroHp;
    // Whose turn it is gets a beat of attention.
    if (snapshot.activeId !== this.lastActiveId) {
      this.lastActiveId = snapshot.activeId;
      this.bannerEl.classList.remove('turn-swap');
      void this.bannerEl.offsetWidth;
      this.bannerEl.classList.add('turn-swap');
    }
    this.renderBanner(snapshot);
    this.renderOrder(snapshot);
    this.renderPreview(snapshot);
    this.renderBar(snapshot);
    this.renderResult(snapshot);
    this.renderSolo(snapshot);
  }

  private flashVignette() {
    this.vignetteEl.classList.remove('flash');
    void this.vignetteEl.offsetWidth;
    this.vignetteEl.classList.add('flash');
    clearTimeout(this.vignetteTimer);
    this.vignetteTimer = window.setTimeout(() => this.vignetteEl.classList.remove('flash'), 620);
  }

  private renderBanner(s: CombatSnapshot) {
    if (s.finished) { this.bannerEl.textContent = ''; return; }
    const active = s.combatants.find(c => c.id === s.activeId);
    this.bannerEl.innerHTML = s.isPlayerTurn
      ? `<span class="banner-round">ROUND ${s.round}</span><strong>Your turn.</strong> <em>Walk to move · click a goblin to attack · SPACE to end turn</em>`
      : `<span class="banner-round">ROUND ${s.round}</span><strong>${escapeHtml(active?.name ?? 'The enemy')} acts.</strong>`;
    this.bannerEl.dataset.turn = s.isPlayerTurn ? 'player' : 'enemy';
  }

  private renderOrder(s: CombatSnapshot) {
    this.orderEl.innerHTML = s.combatants.map(c => {
      const ratio = c.maxHp ? Math.max(0, c.hp / c.maxHp) : 0;
      const state = c.dead ? 'dead' : c.downed ? 'downed' : '';
      const conditions = c.conditions.length
        ? `<span class="order-conditions" title="${escapeHtml(c.conditions.map(x => CONDITION_NAMES[x as Condition] ?? x).join(', '))}">${c.conditions.length}</span>`
        : '';
      return `<div class="order-card ${c.side} ${state} ${c.id === s.activeId ? 'active' : ''}">
        <span class="order-init">${c.initiative}</span>
        <div class="order-body">
          <span class="order-name">${escapeHtml(c.name)}</span>
          <span class="order-meta">${c.dead ? 'out of the fight' : `${c.hp}/${c.maxHp} HP · AC ${c.ac}${c.side === 'enemy' ? ` · ${c.distanceFeet} ft` : ''}`}</span>
          <div class="order-hp"><i style="width:${ratio * 100}%"></i></div>
          ${c.downed ? `<span class="order-death">death saves ${c.deathSaves.successes}✓ ${c.deathSaves.failures}✗</span>` : ''}
        </div>${conditions}
      </div>`;
    }).join('');
  }

  private renderPreview(s: CombatSnapshot) {
    if (!s.isPlayerTurn || !s.preview) { this.previewEl.innerHTML = ''; this.previewEl.dataset.on = 'false'; return; }
    const p = s.preview;
    const armed = this.selectedSpell ? SPELLS[this.selectedSpell] : null;
    const reasons = [
      ...p.advantage.map(r => `<li class="good">${escapeHtml(r)}</li>`),
      ...p.disadvantage.map(r => `<li class="bad">${escapeHtml(r)}</li>`),
      p.cover !== 'none' ? `<li class="bad">${escapeHtml(COVER_NAMES[p.cover as Cover])} (+${p.cover === 'half' ? 2 : 5} AC)</li>` : '',
    ].filter(Boolean).join('');
    this.previewEl.dataset.on = 'true';
    this.previewEl.innerHTML = `
      <div class="preview-head">
        <strong>${escapeHtml(p.targetName)}</strong>
        <span>${p.gap} ft · ${escapeHtml(armed ? armed.name : p.weapon)}</span>
      </div>
      ${p.inRange
        ? `<div class="preview-odds ${p.state}"><span class="odds-number">${p.hitChance}%</span><span class="odds-label">to hit · ${escapeHtml(p.damage)} damage</span></div>`
        : '<div class="preview-odds out">Out of range</div>'}
      ${reasons ? `<ul class="preview-reasons">${reasons}</ul>` : ''}
      ${p.state !== 'normal' ? `<div class="preview-state ${p.state}">${p.state}</div>` : ''}`;
  }

  private renderBar(s: CombatSnapshot) {
    if (!s.isPlayerTurn || s.finished) { this.barEl.innerHTML = ''; return; }
    const b = s.budget;
    const spellButtons = s.spells.map((spell, i) => `
      <button class="combat-spell ${this.selectedSpell === spell.id ? 'armed' : ''}" data-spell="${spell.id}" ${spell.available && b?.action ? '' : 'disabled'}
        title="${escapeHtml(SPELLS[spell.id]?.description ?? '')}">
        <kbd>${i + 1}</kbd><span>${escapeHtml(spell.name)}</span><small>${escapeHtml(spell.slots)}</small>
      </button>`).join('');

    this.barEl.innerHTML = `
      <div class="bar-resources">
        <div class="resource ${b?.action ? 'on' : 'off'}"><span>ACTION</span></div>
        <div class="resource ${b?.bonusAction ? 'on' : 'off'}"><span>BONUS</span></div>
        <div class="resource move"><span>MOVE</span><strong>${b?.movementLeft ?? 0}<small>/${b?.movementTotal ?? 0} ft</small></strong>
          <div class="resource-track"><i style="width:${b ? (b.movementLeft / Math.max(1, b.movementTotal)) * 100 : 0}%"></i></div>
        </div>
        ${s.hero ? `<div class="resource hp"><span>HP</span><strong>${s.hero.hp}<small>/${s.hero.maxHp}</small></strong></div>` : ''}
      </div>
      <div class="bar-actions">
        ${spellButtons}
        <button data-action="dodge" ${b?.action ? '' : 'disabled'}><kbd>Q</kbd><span>Dodge</span></button>
        <button data-action="dash" ${b?.action ? '' : 'disabled'}><span>Dash</span></button>
        <button data-action="disengage" ${b?.action ? '' : 'disabled'}><span>Disengage</span></button>
        <button data-action="hide" ${b?.action ? '' : 'disabled'}><span>Hide</span></button>
        <button data-action="secondWind" ${b?.bonusAction ? '' : 'disabled'}><span>Second Wind</span></button>
        <button data-action="endTurn" class="end-turn"><kbd>SPACE</kbd><span>End turn</span></button>
      </div>`;
  }

  /**
   * The solo handicap is stated plainly rather than hidden. The player should
   * know the game is balancing a four-person module around one character.
   */
  private renderSolo(s: CombatSnapshot) {
    let el = this.root.querySelector<HTMLElement>('#combat-solo');
    if (!s.solo || !s.solo.notes.length || s.finished) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'combat-solo';
      el.className = 'combat-solo';
      this.root.append(el);
    }
    el.innerHTML = `<button class="solo-toggle" type="button" data-action="solo">Solo adventurer</button>
      <ul>${s.solo.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`;
  }

  private renderResult(s: CombatSnapshot) {
    const done = s.phase === 'resolved' || s.phase === 'lost';
    this.resultEl.hidden = !done;
    if (!done) return;
    const victory = s.phase === 'resolved';
    this.resultEl.innerHTML = `
      <div class="result-panel ${victory ? 'won' : 'lost'}">
        <span class="result-eyebrow">${victory ? 'THE ROAD IS QUIET AGAIN' : 'YOU WAKE IN THE LEAF LITTER'}</span>
        <h2>${victory ? 'The ambush is broken.' : 'They left you breathing.'}</h2>
        <p>${victory
          ? 'One goblin ran rather than die here, and it ran somewhere specific. The trail behind the northern thickets is worth following.'
          : 'The goblins took what they could carry and headed up the trail. You can go on to Phandalin, re-equip, and come back for them.'}</p>
        <button data-action="finish" class="primary-action">${victory ? 'Search the site' : 'Get up'}</button>
      </div>`;
  }

  dispose() { this.abort.abort(); clearTimeout(this.vignetteTimer); this.root.remove(); }
}
