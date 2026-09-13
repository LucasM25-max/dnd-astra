import { PORTRAITS, portraitDef, type CharacterDraft, type PortraitPreset } from '../../game/character';
import { paintPortraitBust } from '../../character/skeletal/HeroTextures';
import { esc, icon } from './creation-helpers';

/**
 * Portrait picker drawn, not painted-by-artist: each card is a small canvas
 * rendered with the same procedural face routine the 3D head uses, so the
 * card and the live model can never disagree — and no AI art sits in the
 * creation flow.
 */
export interface PortraitSelectorOptions {
  onChange: () => void;
}

const BUST_W = 176;
const BUST_H = 208;

function drawBust(canvas: HTMLCanvasElement, preset: PortraitPreset): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  try {
    paintPortraitBust(ctx, canvas.width, canvas.height, preset);
  } catch {
    // Canvas2D unavailable (odd browser/privacy mode): the label still reads.
    ctx.fillStyle = '#22322a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

export function renderPortraitSelector(d: CharacterDraft): string {
  const cards = PORTRAITS.map(p => {
    const isSel = d.portrait === p.id;
    return `<button type="button" class="cc-portrait${isSel ? ' selected' : ''}" data-portrait="${p.id}" aria-pressed="${isSel}" title="${esc(p.label)}">`
      + `<canvas class="cc-portrait-img" width="${BUST_W}" height="${BUST_H}"></canvas>`
      + `<span class="cc-portrait-label">${esc(p.label.split(' — ')[0])}</span>`
      + `${p.helm ? `<span class="cc-portrait-helm" title="Wears a helm">${icon('helmet')}</span>` : ''}`
      + `${isSel ? icon('check', 'cc-skill-check') : ''}</button>`;
  }).join('');
  return `<div class="cc-portraits" role="group" aria-label="Choose your portrait"><div class="cc-portrait-grid">${cards}</div></div>`;
}

/** Paint every bust after the markup lands, then wire the picks. */
export function bindPortraitSelector(root: HTMLElement, d: CharacterDraft, opts: PortraitSelectorOptions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-portrait]').forEach(btn => {
    const canvas = btn.querySelector('canvas');
    if (canvas) drawBust(canvas, portraitDef(btn.dataset.portrait ?? d.portrait));
    btn.addEventListener('click', () => {
      d.portrait = btn.dataset.portrait ?? d.portrait;
      opts.onChange();
    });
  });
}
