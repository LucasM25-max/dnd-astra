import { HUMAN, SOLDIER, type CharacterDraft } from '../../game/character';
import { esc, icon } from './creation-helpers';
import { renderAbilityAllocator, bindAbilityAllocator } from './AbilityScoreAllocator';
import { renderSkillPicker, bindSkillPicker } from './SkillPicker';
import { renderFeatPicker, bindFeatPicker } from './FeatPicker';
import type { PanelContext } from './ClassPanel';

/** Human panel: point buy, size/speed, languages, traits, Skillful bonus skill, origin feat. */
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
  const trait = (id: 'star' | 'scroll' | 'zap', name: string, pitch: string): string =>
    `<li>${icon(id)} <strong>${name}</strong> — ${esc(pitch)}</li>`;
  return `<div class="cc-panel" data-panel="species">`
    + `<div class="cc-identity"><h3>Human — Versatile and Determined</h3>`
    + `<p>Humans are the most adaptable and ambitious of the common species. Their short lives drive them `
    + `to achieve as much as they can — and the Sword Coast remembers those who try.</p></div>`
    + `<div class="cc-traits">`
    + trait('star', 'Resourceful', 'You start each long rest with Heroic Inspiration — a glowing star you can spend to reroll any d20 check.')
    + trait('scroll', 'Skillful', 'Proficiency in one additional skill of your choice.')
    + trait('zap', 'Versatile', 'You gain an Origin feat of your choice.')
    + `</div>`
    + `<h4>Ability scores — ${HUMAN.pointBuy.points} points</h4>${renderAbilityAllocator(d)}`
    + `<div class="cc-display-fields">`
    + `<div class="cc-display-field"><span>SIZE</span><strong>Medium</strong></div>`
    + `<div class="cc-display-field"><span>SPEED</span><strong>${HUMAN.speed} ft</strong><small>Hold <kbd>Shift</kbd> to sprint — 1.5× for 6 s, 30 s cooldown.</small></div>`
    + `</div>`
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
