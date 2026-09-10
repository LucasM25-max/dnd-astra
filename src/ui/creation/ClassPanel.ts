import { FIGHTER, SOLDIER, type CharacterDraft } from '../../game/character';
import { esc, icon } from './creation-helpers';
import { renderSkillPicker, bindSkillPicker } from './SkillPicker';
import { renderFightingStylePicker, bindFightingStylePicker } from './FightingStylePicker';
import { renderEquipmentLoadout, bindEquipmentLoadout } from './EquipmentLoadout';

export interface PanelContext {
  refresh: () => void;
  flourish: (kind: 'attack' | 'hit' | 'down') => void;
}

/** Fighter panel: identity, fighting style, class skills, equipment, Second Wind. */
export function renderClassPanel(d: CharacterDraft, ctx: PanelContext): string {
  const p = FIGHTER.proficiencies;
  return `<div class="cc-panel" data-panel="class">`
    + `<div class="cc-identity"><h3>${esc(FIGHTER.title)}</h3><p>${esc(FIGHTER.flavour)}</p>`
    + `<ul class="cc-traits">`
    + `<li>${icon('heart')} Hit die <strong>d${FIGHTER.secondWind.healDie}</strong> — toughness is your trade</li>`
    + `<li>${icon('shield')} Armour: <strong>${esc(p.armour.join(', '))}</strong></li>`
    + `<li>${icon('sword')} Weapons: <strong>${esc(p.weapons.join(', '))}</strong></li>`
    + `<li>${icon('zap')} Saving throws: <strong>${esc(p.savingThrows.join(', '))}</strong></li>`
    + `</ul></div>`
    + `<h4>Fighting style</h4>${renderFightingStylePicker(d)}`
    + `<h4>Class skills — pick 2</h4>`
    + renderSkillPicker(d, 'class', {
      taken: SOLDIER.skills, count: FIGHTER.skillChoices.count,
      get: dd => dd.classSkills, set: (dd, ids) => { dd.classSkills = ids; }, onChange: ctx.refresh,
    })
    + `<h4>Starting equipment</h4>${renderEquipmentLoadout(d)}`
    + `<div class="cc-feature-card"><h4>${icon('zap')} Second Wind</h4><p>${esc(FIGHTER.secondWind.pitch)}</p></div>`
    + `</div>`;
}

export function bindClassPanel(el: HTMLElement, d: CharacterDraft, ctx: PanelContext): void {
  bindFightingStylePicker(el, d, { onChange: ctx.refresh, flourish: ctx.flourish });
  bindSkillPicker(el, d, 'class', {
    taken: SOLDIER.skills, count: FIGHTER.skillChoices.count,
    get: dd => dd.classSkills, set: (dd, ids) => { dd.classSkills = ids; }, onChange: ctx.refresh,
  });
  bindEquipmentLoadout(el, d, { onChange: ctx.refresh, flourish: ctx.flourish });
}
