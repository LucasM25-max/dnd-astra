import { PORTRAITS, type CharacterDraft } from '../../game/character';
import { esc, icon } from './creation-helpers';

export interface PortraitSelectorOptions {
  onChange: () => void;
}

/** Six painted portraits with face textures; the live model follows the pick. */
export function renderPortraitSelector(d: CharacterDraft): string {
  const cards = PORTRAITS.map(p => {
    const isSel = d.portrait === p.id;
    return `<button type="button" class="cc-portrait${isSel ? ' selected' : ''}" data-portrait="${p.id}" aria-pressed="${isSel}" title="${esc(p.label)}">`
      + `<img class="cc-portrait-img" src="${esc(p.faceTexture)}" alt="${esc(p.label)}" loading="lazy" onerror="this.style.display='none'"/>`
      + `<span class="cc-portrait-label">${esc(p.label.split(' — ')[0])}</span>`
      + `${p.helm ? `<span class="cc-portrait-helm" title="Wears a helm">${icon('helmet')}</span>` : ''}`
      + `${isSel ? icon('check', 'cc-skill-check') : ''}</button>`;
  }).join('');
  return `<div class="cc-portraits" role="group" aria-label="Choose your portrait"><div class="cc-portrait-grid">${cards}</div></div>`;
}

export function bindPortraitSelector(root: HTMLElement, d: CharacterDraft, opts: PortraitSelectorOptions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-portrait]').forEach(btn => {
    btn.addEventListener('click', () => {
      d.portrait = btn.dataset.portrait ?? d.portrait;
      opts.onChange();
    });
  });
}
