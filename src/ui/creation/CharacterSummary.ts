import {
  ABILITY_KEYS, ABILITY_NAMES, SOLDIER, featDef, skillDef, weaponDef,
  type CharacterDraft, type PlayerCharacter,
} from '../../game/character';
import { renderVitality } from './Vitality';
import { esc, icon } from './creation-helpers';

export interface CharacterSummaryOptions {
  onForge: () => void;
  onBack: () => void;
}

/**
 * The review step: everything the wizard decided, on one drafted "charter"
 * card — gold rules and typography only, no painted parchment or seals.
 * The Forge button lives here (with the hammer-strike confirmation).
 */
export function renderCharacterSummary(d: CharacterDraft, c: PlayerCharacter): string {
  const abilityRows = ABILITY_KEYS.map(k => {
    const s = c.abilityScores[k];
    const mod = s.modifier >= 0 ? `+${s.modifier}` : `${s.modifier}`;
    const bonusBits: string[] = [];
    if (s.backgroundBonus) bonusBits.push(`+${s.backgroundBonus} Soldier`);
    return `<tr><td>${ABILITY_NAMES[k]}</td><td>${s.base}</td><td>${bonusBits.join(', ') || '—'}</td>`
      + `<td><strong>${s.total}</strong></td><td><strong class="${s.modifier >= 0 ? '' : 'neg'}">${mod}</strong></td></tr>`;
  }).join('');
  const skillLi = (id: string): string => {
    const def = skillDef(id);
    const name = def ? def.name : id;
    return `<li title="${esc(def?.pitch ?? '')}">${esc(name)}</li>`;
  };
  const styleName = { defense: 'Defense', dueling: 'Dueling', great_weapon: 'Great Weapon Fighting', two_weapon: 'Two-Weapon Fighting' }[c.fightingStyle];
  const main = weaponDef(c.equipment.mainHand);
  const off = c.equipment.offHand ? weaponDef(c.equipment.offHand) : null;
  const con = c.abilityScores.CON.modifier;
  return `<div class="cc-panel cc-summary" data-panel="review">`
    + `<div class="cc-summary-head">`
    + `<div><span class="cc-summary-eyebrow">${icon('scroll')} THE CHARTER · LEVEL 1 HUMAN FIGHTER · SOLDIER</span>`
    + `<h3 class="cc-summary-name">${esc(c.name || 'Unnamed Hero')}</h3></div>`
    + `<div class="cc-summary-seal" aria-hidden="true">${icon('star')}</div>`
    + `</div>`
    + `<div class="cc-summary-vitals">`
    + `<div class="cc-summary-vit">${renderVitality(c.hp.max, c.hp.max, [
      { label: '10', note: 'level 1 base' },
      { label: `${con >= 0 ? '+' : ''}${con}`, note: 'CON modifier', tone: con >= 0 ? 'good' : 'bad' },
    ], 'The numbers the road will test. Rest at the campfire and they return.')}</div>`
    + `<div class="cc-summary-grid">`
    + `<div><b>${c.ac}</b><span>ARMOUR CLASS</span></div>`
    + `<div><b>${c.speed} ft</b><span>SPEED</span></div>`
    + `<div><b>+${c.proficiencyBonus}</b><span>PROFICIENCY</span></div>`
    + `<div><b>${c.hitDice.max}d${c.hitDice.die}</b><span>HIT DICE</span></div>`
    + `<div><b>${c.equipment.gold} gp</b><span>PURSE</span></div>`
    + `<div><b>${off?.name === 'shield' ? 'Shield' : 'One hand'}</b><span>OFF HAND</span></div>`
    + `</div></div>`
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
    + `<li>${esc(main?.name ?? c.equipment.mainHand)}${off ? ` + ${esc(off.name)}` : ''}</li><li>Longbow + Quiver (20 arrows)</li><li>Chain Mail · Explorer's Pack</li>`
    + `</ul></div></div>`
    + `<h4>Personality</h4>`
    + `<p class="cc-summary-person"><em>Trait.</em> ${esc(c.personality.trait)} <em>Ideal.</em> ${esc(c.personality.ideal)} `
    + `<em>Bond.</em> ${esc(c.personality.bond)} <em>Flaw.</em> ${esc(c.personality.flaw)}</p>`
    + `<div class="cc-summary-actions">`
    + `<button type="button" class="cc-btn ghost" data-summary-back>${icon('back')} Keep editing</button>`
    + `<button type="button" class="cc-btn forge" data-forge>${icon('zap')} Forge hero &amp; begin</button>`
    + `</div></div>`;
}

export function bindCharacterSummary(root: HTMLElement, opts: CharacterSummaryOptions): void {
  root.querySelector('[data-summary-back]')?.addEventListener('click', opts.onBack);
  root.querySelector('[data-forge]')?.addEventListener('click', opts.onForge);
}
