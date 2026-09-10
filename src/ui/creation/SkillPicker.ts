import { skillDef, SKILL_IDS, type CharacterDraft } from '../../game/character';
import { esc, icon } from './creation-helpers';

export interface SkillPickerOptions {
  /** Skill ids already granted elsewhere (shown locked). */
  taken: string[];
  /** Maximum selectable. */
  count: number;
  /** Read/write the current selection. */
  get: (d: CharacterDraft) => string[];
  set: (d: CharacterDraft, ids: string[]) => void;
  onChange: () => void;
}

/** Skill cards with ability tags and plain-language pitches. `ns` namespaces the data attrs. */
export function renderSkillPicker(d: CharacterDraft, ns: string, opts: SkillPickerOptions): string {
  const selected = opts.get(d);
  const cards = SKILL_IDS.map(id => {
    const def = skillDef(id);
    if (!def) return '';
    const isTaken = opts.taken.includes(id);
    const isSel = selected.includes(id);
    const disabled = !isSel && !isTaken && selected.length >= opts.count;
    return `<button type="button" class="cc-skill${isSel ? ' selected' : ''}${isTaken ? ' taken' : ''}"`
      + ` data-skill-${ns}="${id}" ${isTaken || disabled ? 'disabled' : ''}`
      + ` aria-pressed="${isSel}" title="${esc(def.pitch)}">`
      + `<span class="cc-skill-name">${esc(def.name)}</span>`
      + `<span class="cc-ability-tag">${def.ability}</span>`
      + `<span class="cc-skill-pitch">${esc(def.pitch)}</span>`
      + `${isSel ? icon('check', 'cc-skill-check') : ''}${isTaken ? '<span class="cc-skill-lock">granted</span>' : ''}`
      + `</button>`;
  }).join('');
  return `<div class="cc-skills" role="group" aria-label="Choose ${opts.count} skills (${selected.length} chosen)">`
    + `<div class="cc-pick-count">${selected.length} of ${opts.count} chosen</div>`
    + `<div class="cc-skill-grid">${cards}</div></div>`;
}

export function bindSkillPicker(root: HTMLElement, d: CharacterDraft, ns: string, opts: SkillPickerOptions): void {
  root.querySelectorAll<HTMLButtonElement>(`[data-skill-${ns}]`).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute(`data-skill-${ns}`) ?? '';
      const selected = opts.get(d);
      if (selected.includes(id)) opts.set(d, selected.filter(s => s !== id));
      else if (selected.length < opts.count) opts.set(d, [...selected, id]);
      opts.onChange();
    });
  });
}
