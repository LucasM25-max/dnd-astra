import { ORIGIN_FEATS, featDef, type CharacterDraft, type OriginFeatId } from '../../game/character';
import { esc, icon } from './creation-helpers';

export interface FeatPickerOptions {
  onChange: () => void;
}

/** Origin feat cards (Soldier already grants Savage Attacker, so it is excluded here). */
export function renderFeatPicker(d: CharacterDraft): string {
  const soldierFeat = featDef('savage_attacker');
  const cards = ORIGIN_FEATS.filter(f => f.id !== 'savage_attacker').map(f => {
    const isSel = d.originFeat === f.id;
    const badge = f.recommend === 'new' ? '<span class="cc-rec-badge new">Recommended for new players</span>'
      : f.recommend === 'experienced' ? '<span class="cc-rec-badge exp">Experienced pick</span>' : '';
    return `<button type="button" class="cc-feat${isSel ? ' selected' : ''}" data-feat="${f.id}" aria-pressed="${isSel}">`
      + `<span class="cc-feat-icon">${icon(f.icon, 'cc-icon-lg')}</span>`
      + `<span class="cc-feat-body"><span class="cc-feat-name">${esc(f.name)}</span>${badge}`
      + `<span class="cc-feat-tagline">${esc(f.tagline)}</span>`
      + `<span class="cc-feat-detail">${esc(f.detail)}</span></span>`
      + `${isSel ? icon('check', 'cc-skill-check') : ''}</button>`;
  }).join('');
  return `<div class="cc-feats" role="group" aria-label="Choose your origin feat">`
    + `<div class="cc-feat-grid">${cards}</div>`
    + `<p class="cc-note">${icon('info')} Your Soldier background also grants <strong>${esc(soldierFeat?.name ?? 'Savage Attacker')}</strong> — `
    + `${esc(soldierFeat?.detail ?? '')}</p></div>`;
}

export function bindFeatPicker(root: HTMLElement, d: CharacterDraft, opts: FeatPickerOptions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-feat]').forEach(btn => {
    btn.addEventListener('click', () => {
      d.originFeat = btn.dataset.feat as OriginFeatId;
      opts.onChange();
    });
  });
}
