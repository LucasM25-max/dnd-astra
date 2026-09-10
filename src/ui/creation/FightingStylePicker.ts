import { FIGHTER, type CharacterDraft, type FightingStyleId } from '../../game/character';
import { esc, icon } from './creation-helpers';

export interface FightingStylePickerOptions {
  onChange: () => void;
  flourish: (kind: 'attack' | 'hit' | 'down') => void;
}

/** Fighting style cards; picking one plays the attack flourish on the live model. */
export function renderFightingStylePicker(d: CharacterDraft): string {
  const cards = FIGHTER.fightingStyles.map(s => {
    const isSel = d.fightingStyle === s.id;
    return `<button type="button" class="cc-style${isSel ? ' selected' : ''}" data-style="${s.id}" aria-pressed="${isSel}">`
      + `<span class="cc-feat-icon">${icon(s.icon, 'cc-icon-lg')}</span>`
      + `<span class="cc-feat-body"><span class="cc-feat-name">${esc(s.name)}</span>`
      + `<span class="cc-feat-tagline">${esc(s.pitch)}</span></span>`
      + `${isSel ? icon('check', 'cc-skill-check') : ''}</button>`;
  }).join('');
  return `<div class="cc-styles" role="group" aria-label="Choose your fighting style">`
    + `<div class="cc-feat-grid">${cards}</div>`
    + `<p class="cc-note">${icon('info')} Your choice also shapes the hero's stance in battle animations.</p></div>`;
}

export function bindFightingStylePicker(root: HTMLElement, d: CharacterDraft, opts: FightingStylePickerOptions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(btn => {
    btn.addEventListener('click', () => {
      d.fightingStyle = btn.dataset.style as FightingStyleId;
      opts.onChange();
      opts.flourish('attack');
    });
  });
}
