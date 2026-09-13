import { FIGHTER, type CharacterDraft, type FightingStyleId } from '../../game/character';
import { esc, icon } from './creation-helpers';

export interface FightingStylePickerOptions {
  onChange: () => void;
  flourish: (kind: 'attack' | 'hit' | 'down') => void;
}

/** Fighting style cards; picking one plays the matching stance on the live model. */
export function renderFightingStylePicker(d: CharacterDraft): string {
  const cards = FIGHTER.fightingStyles.map(s => {
    const isSel = d.fightingStyle === s.id;
    const dualSuggest = s.id === 'two_weapon' && d.offHand === 'shortsword';
    return `<button type="button" class="cc-style${isSel ? ' selected' : ''}" data-style="${s.id}" aria-pressed="${isSel}">`
      + `<span class="cc-feat-icon">${icon(s.icon, 'cc-icon-lg')}</span>`
      + `<span class="cc-feat-body"><span class="cc-feat-name">${esc(s.name)}</span>`
      + `<span class="cc-feat-tagline">${esc(s.pitch)}</span>`
      + `${dualSuggest ? '<span class="cc-dual-note">Dual shortswords equipped for you.</span>' : ''}</span>`
      + `${isSel ? icon('check', 'cc-skill-check') : ''}</button>`;
  }).join('');
  return `<div class="cc-styles" role="group" aria-label="Choose your fighting style">`
    + `<div class="cc-feat-grid cc-style-grid">${cards}</div>`
    + `<p class="cc-note">${icon('info')} Picking a style shows its stance on the hero beside you — the idle and battle poses you'll fight with.</p></div>`;
}

export function bindFightingStylePicker(root: HTMLElement, d: CharacterDraft, opts: FightingStylePickerOptions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-style]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.style as FightingStyleId | undefined;
      if (!id) return;
      d.fightingStyle = id;
      // Two-Weapon Fighting: auto-suggest the matching second weapon (dual shortswords).
      if (id === 'two_weapon' && d.offHand !== 'shortsword') d.offHand = 'shortsword';
      opts.onChange();
      opts.flourish('attack');
    });
  });
}
