import { FIGHTER, SOLDIER, buildScores, abilityModifier, type CharacterDraft } from '../../game/character';
import { hpGlobeSVG } from '../hpGlobe';
import { esc, icon } from './creation-helpers';
import { renderSkillPicker, bindSkillPicker } from './SkillPicker';
import { renderFightingStylePicker, bindFightingStylePicker } from './FightingStylePicker';
import { renderEquipmentLoadout, bindEquipmentLoadout } from './EquipmentLoadout';

export interface PanelContext {
  refresh: () => void;
  flourish: (kind: 'attack' | 'hit' | 'down') => void;
}

/** Fighter panel: HP globe, lit proficiencies, style stance previews, skills, equipment, Second Wind. */
export function renderClassPanel(d: CharacterDraft, ctx: PanelContext): string {
  const p = FIGHTER.proficiencies;
  const scores = buildScores(d.bases, d.plusTwo, d.plusOne);
  const conMod = abilityModifier(scores.CON.total);
  const conSign = conMod >= 0 ? '+' : '';
  const hpNow = 10 + conMod;
  const sw = FIGHTER.secondWind;
  const chip = (id: string, label: string, note: string): string =>
    `<span class="cc-prof-chip" title="${esc(note)}">${icon(id)} ${esc(label)}</span>`;
  return `<div class="cc-panel" data-panel="class">`
    + `<div class="cc-identity"><h3>${esc(FIGHTER.title)}</h3><p>${esc(FIGHTER.flavour)}</p></div>`
    + `<div class="cc-hp-globe-card" title="Your hit points: your starting maximum.">`
    + `<div class="cc-hp-globe">${hpGlobeSVG(hpNow, hpNow, 74)}</div>`
    + `<div class="cc-hp-copy"><strong>Hit die ${sw.healDie} — toughness is your trade</strong>`
    + `<p>${hpNow} HP at level 1: <em>10 + your Constitution modifier (${conSign}${conMod})</em>.</p>`
    + `<p class="cc-hp-rest">${icon('flame')} You recover lost hit points when you rest at a campfire — short rests spend Hit Dice, long rests refill everything.</p></div></div>`
    + `<h4>Proficiencies — everything is yours</h4>`
    + `<div class="cc-prof-groups">`
    + `<div class="cc-prof-row"><span class="cc-prof-label">Armour</span><div class="cc-prof-chips">`
    + p.armour.map(a => chip('shield', a, `Proficient in ${a.toLowerCase()} armour.`)).join('') + `</div></div>`
    + `<div class="cc-prof-row"><span class="cc-prof-label">Weapons</span><div class="cc-prof-chips">`
    + p.weapons.map(w => chip('sword', w, `Proficient with ${w.toLowerCase()} weapons.`)).join('') + `</div></div>`
    + `<div class="cc-prof-row"><span class="cc-prof-label">Saving throws</span><div class="cc-prof-chips">`
    + p.savingThrows.map(s => chip('zap', s, `You add your proficiency bonus to ${s} saving throws.`)).join('') + `</div></div>`
    + `</div>`
    + `<h4>Fighting style</h4>${renderFightingStylePicker(d)}`
    + `<h4>Class skills — pick 2</h4>`
    + renderSkillPicker(d, 'class', {
      taken: SOLDIER.skills, count: FIGHTER.skillChoices.count,
      get: dd => dd.classSkills, set: (dd, ids) => { dd.classSkills = ids; }, onChange: ctx.refresh,
    })
    + `<h4>Starting equipment</h4>${renderEquipmentLoadout(d)}`
    + `<div class="cc-feature-card cc-second-wind">`
    + `<div class="cc-cooldown-ring" role="img" aria-label="Second Wind: one charge, recharged at a long rest">`
    + `<span class="cc-cooldown-core">${icon('zap')}<b>${sw.healDie}+${sw.healBonus}</b></span></div>`
    + `<div><h4>${esc(sw.pitch.split('.')[0])}</h4>`
    + `<p>${esc(sw.pitch)}</p>`
    + `<p class="cc-hp-rest">${icon('flame')} Recharges when you finish a long rest at the campfire.</p></div></div>`
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
