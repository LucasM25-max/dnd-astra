import {
  ABILITY_KEYS, ABILITY_NAMES, SOLDIER, featDef, skillDef, weaponDef,
  type CharacterDraft, type PlayerCharacter,
} from '../../game/character';
import { hpGlobeSVG } from '../hpGlobe';
import { esc, icon } from './creation-helpers';

export interface CharacterSummaryOptions {
  onForge: () => void;
  onBack: () => void;
}

/** Parchment review sheet with wax seal, HP globe, and the forge button. */
export function renderCharacterSummary(d: CharacterDraft, c: PlayerCharacter): string {
  const abilityRows = ABILITY_KEYS.map(k => {
    const s = c.abilityScores[k];
    const mod = s.modifier >= 0 ? `+${s.modifier}` : `${s.modifier}`;
    const bonusBits: string[] = [];
    if (s.backgroundBonus) bonusBits.push(`+${s.backgroundBonus} background`);
    return `<tr><td>${ABILITY_NAMES[k]}</td><td>${s.base}</td><td>${bonusBits.join(', ') || '—'}</td>`
      + `<td><strong>${s.total}</strong></td><td><strong>${mod}</strong></td></tr>`;
  }).join('');
  const skillLi = (id: string): string => {
    const def = skillDef(id);
    const name = def ? def.name : id;
    return `<li title="${esc(def?.pitch ?? '')}">${esc(name)}</li>`;
  };
  const styleName = { defense: 'Defense', dueling: 'Dueling', great_weapon: 'Great Weapon Fighting', two_weapon: 'Two-Weapon Fighting' }[c.fightingStyle];
  const main = weaponDef(c.equipment.mainHand);
  const off = c.equipment.offHand ? weaponDef(c.equipment.offHand) : null;
  return `<div class="cc-summary-parchment" role="document" aria-label="Hero summary">`
    + `<img class="cc-seal" src="/images/creation/wax_seal_dragon.webp" alt="Dragon wax seal" onerror="this.style.display='none'"/>`
    + `<h3>${esc(c.name || 'Unnamed Hero')}</h3>`
    + `<p class="cc-summary-sub">Level 1 Human Fighter · Soldier</p>`
    + `<div class="cc-summary-hero"><div class="cc-summary-globe">${hpGlobeSVG(c.hp.max, c.hp.max, 84)}</div>`
    + `<ul class="cc-summary-vitals">`
    + `<li>${icon('shield')} <strong>${c.ac}</strong> Armour Class</li>`
    + `<li>${icon('zap')} <strong>${c.speed} ft</strong> Speed</li>`
    + `<li>${icon('star')} <strong>+${c.proficiencyBonus}</strong> Proficiency</li>`
    + `<li>${icon('coin')} <strong>${c.equipment.gold}</strong> Gold</li>`
    + `</ul></div>`
    + `<h4>Ability scores</h4>`
    + `<table class="cc-summary-table"><thead><tr><th>Ability</th><th>Base</th><th>Bonus</th><th>Total</th><th>Mod</th></tr></thead>`
    + `<tbody>${abilityRows}</tbody></table>`
    + `<div class="cc-summary-cols"><div><h4>Skills</h4><ul class="cc-summary-list">`
    + `<li class="cc-summary-group">Soldier</li>${SOLDIER.skills.map(skillLi).join('')}`
    + `<li class="cc-summary-group">Fighter</li>${d.classSkills.map(skillLi).join('')}`
    + `${d.skillful ? `<li class="cc-summary-group">Skillful</li>${skillLi(d.skillful)}` : ''}`
    + `</ul></div><div><h4>Features</h4><ul class="cc-summary-list">`
    + `<li><strong>${esc(styleName)}</strong> — fighting style</li>`
    + `<li><strong>${esc(featDef(c.originFeat)?.name ?? c.originFeat)}</strong> — origin feat</li>`
    + `<li><strong>Savage Attacker</strong> — Soldier feat</li>`
    + `<li><strong>Second Wind</strong> — heal 1d10 + 1, once per rest</li>`
    + `</ul><h4>Equipment</h4><ul class="cc-summary-list">`
    + `<li>${esc(main?.name ?? c.equipment.mainHand)}${off ? ` + ${esc(off.name)}` : ''}</li>`
    + `<li>Longbow + Quiver (20 arrows)</li><li>Chain Mail · Explorer's Pack</li>`
    + `</ul></div></div>`
    + `<h4>Personality</h4>`
    + `<p class="cc-summary-person"><em>Trait.</em> ${esc(c.personality.trait)} <em>Ideal.</em> ${esc(c.personality.ideal)} `
    + `<em>Bond.</em> ${esc(c.personality.bond)} <em>Flaw.</em> ${esc(c.personality.flaw)}</p>`
    + `<div class="cc-summary-actions">`
    + `<button type="button" class="cc-btn ghost" data-summary-back>Keep editing</button>`
    + `<button type="button" class="cc-btn forge" data-forge>${icon('zap')} Forge hero &amp; begin</button>`
    + `</div></div>`;
}

export function bindCharacterSummary(root: HTMLElement, opts: CharacterSummaryOptions): void {
  root.querySelector('[data-summary-back]')?.addEventListener('click', opts.onBack);
  root.querySelector('[data-forge]')?.addEventListener('click', opts.onForge);
}
