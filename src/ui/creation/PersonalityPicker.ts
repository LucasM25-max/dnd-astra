import { SOLDIER, randomPersonality, type CharacterDraft } from '../../game/character';
import { esc, icon } from './creation-helpers';

export interface PersonalityPickerOptions {
  onChange: () => void;
}

function selectRow(label: string, key: 'trait' | 'ideal' | 'bond' | 'flaw', options: string[], value: string): string {
  const opts = options.map(o => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('');
  return `<label class="cc-person-row"><span class="cc-person-label">${label}</span>`
    + `<select data-person="${key}" aria-label="Choose your ${label.toLowerCase()}">${opts}</select></label>`;
}

/** Soldier personality: four dropdowns plus a crypto-random roller. */
export function renderPersonalityPicker(d: CharacterDraft): string {
  const p = SOLDIER.personality;
  return `<div class="cc-personality">`
    + selectRow('Trait', 'trait', p.traits, d.trait)
    + selectRow('Ideal', 'ideal', p.ideals, d.ideal)
    + selectRow('Bond', 'bond', p.bonds, d.bond)
    + selectRow('Flaw', 'flaw', p.flaws, d.flaw)
    + `<button type="button" class="cc-recommended" data-reroll-personality>${icon('dice')} Roll randomly</button>`
    + `</div>`;
}

export function bindPersonalityPicker(root: HTMLElement, d: CharacterDraft, opts: PersonalityPickerOptions): void {
  root.querySelectorAll<HTMLSelectElement>('[data-person]').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.person as 'trait' | 'ideal' | 'bond' | 'flaw';
      d[key] = sel.value;
      opts.onChange();
    });
  });
  root.querySelector('[data-reroll-personality]')?.addEventListener('click', () => {
    randomPersonality(d);
    opts.onChange();
  });
}
