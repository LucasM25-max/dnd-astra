import { icon } from './creation-helpers';

/**
 * The premium vitality block shared by the class step and the review sheet:
 * a big serif HP readout over a meter that reads like inlaid garnet, plus a
 * transparent derivation of where the number comes from. Pure CSS/typography
 * — the same visual language as the world HUD's floating bar.
 */
export interface VitalityTerm { label: string; note: string; tone?: 'good' | 'bad' }

export function renderVitality(current: number, max: number, terms: VitalityTerm[], footnote: string): string {
  const frac = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  return `<div class="cc-vitality-block">
    <div class="cc-vit-top"><span class="cc-vit-eyebrow">${icon('heart')} HIT POINTS</span><span class="cc-vit-fraction">${current} / ${max}</span></div>
    <div class="cc-vit-figure"><b>${current}</b><small>hp at level 1</small></div>
    <div class="cc-vit-meter" role="img" aria-label="Hit points ${current} of ${max}"><i style="width:${(frac * 100).toFixed(1)}%"></i><span class="cc-vit-ticks" aria-hidden="true"></span><span class="cc-vit-sheen" aria-hidden="true"></span></div>
    <div class="cc-vit-terms">${terms.map(t => `<div class="cc-vit-term${t.tone ? ` ${t.tone}` : ''}"><strong>${t.label}</strong><span>${t.note}</span></div>`).join('<em class="cc-vit-op">+</em>')}</div>
    <p class="cc-vit-note">${icon('flame')} ${footnote}</p>
  </div>`;
}
