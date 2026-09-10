import { HUMAN, SOLDIER, type CharacterDraft } from '../../game/character';
import { esc, icon } from './creation-helpers';
import { renderAbilityAllocator, bindAbilityAllocator } from './AbilityScoreAllocator';
import { renderSkillPicker, bindSkillPicker } from './SkillPicker';
import { renderFeatPicker, bindFeatPicker } from './FeatPicker';
import type { PanelContext } from './ClassPanel';

/** Human panel: point buy, language, Skillful bonus skill, origin feat. */
export function renderSpeciesPanel(d: CharacterDraft, ctx: PanelContext): string {
  const langs = HUMAN.languages;
  const langBtns = langs.choices.map(l => {
    const isSel = d.language === l;
    const rec = l === langs.recommended;
    return `<button type="button" class="cc-lang${isSel ? ' selected' : ''}" data-lang="${esc(l)}" aria-pressed="${isSel}">`
      + `${esc(l)}${rec ? `<span class="cc-rec-badge new">Recommended — ${esc(langs.recommendReason)}</span>` : ''}`
      + `${isSel ? icon('check', 'cc-skill-check') : ''}</button>`;
  }).join('');
  const takenForSkillful = [...SOLDIER.skills, ...d.classSkills];
  return `<div class="cc-panel" data-panel="species">`
    + `<div class="cc-identity"><h3>Human — Versatile and Determined</h3>`
    + `<p>Humans are the most adaptable and ambitious of the common species. Their short lives drive them `
    + `to achieve as much as they can — and the Sword Coast remembers those who try.</p>`
    + `<ul class="cc-traits">`
    + `<li>${icon('star')} <strong>Skillful</strong> — proficiency in one extra skill of your choice</li>`
    + `<li>${icon('scroll')} <strong>Languages</strong> — Common plus one more</li>`
    + `</ul></div>`
    + `<h4>Ability scores — ${HUMAN.pointBuy.points} points</h4>${renderAbilityAllocator(d)}`
    + `<h4>Language</h4><p class="cc-note">You speak <strong>Common</strong>. Choose one more:</p>`
    + `<div class="cc-lang-grid" role="group" aria-label="Choose a second language">${langBtns}</div>`
    + `<h4>Skillful — one extra skill</h4>`
    + renderSkillPicker(d, 'skillful', {
      taken: takenForSkillful, count: 1,
      get: dd => (dd.skillful ? [dd.skillful] : []),
      set: (dd, ids) => { dd.skillful = ids[0] ?? null; }, onChange: ctx.refresh,
    })
    + `<h4>Origin feat</h4>${renderFeatPicker(d)}`
    + `</div>`;
}

export function bindSpeciesPanel(el: HTMLElement, d: CharacterDraft, ctx: PanelContext): void {
  bindAbilityAllocator(el, d, { onChange: ctx.refresh });
  el.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      d.language = btn.dataset.lang ?? null;
      ctx.refresh();
    });
  });
  bindSkillPicker(el, d, 'skillful', {
    taken: [...SOLDIER.skills, ...d.classSkills], count: 1,
      get: dd => (dd.skillful ? [dd.skillful] : []),
    set: (dd, ids) => { dd.skillful = ids[0] ?? null; }, onChange: ctx.refresh,
  });
  bindFeatPicker(el, d, { onChange: ctx.refresh });
}
