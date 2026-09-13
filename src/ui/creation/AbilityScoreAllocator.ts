import {
  ABILITY_KEYS, ABILITY_NAMES, HUMAN, SOLDIER, abilityModifier, pointBuyCost, pointsSpent, rankFor,
  type AbilityKey, type CharacterDraft,
} from '../../game/character';
import { esc, icon } from './creation-helpers';

export interface AllocatorOptions {
  /** Called after any change; the panel re-renders. */
  onChange: () => void;
}

/** Point-buy allocator with cost preview, rank labels, and ASI badges. */
export function renderAbilityAllocator(d: CharacterDraft): string {
  const spent = pointsSpent(d.bases);
  const remaining = HUMAN.pointBuy.points - spent;
  const rows = ABILITY_KEYS.map(k => {
    const base = d.bases[k];
    const asi = (k === d.plusTwo ? 2 : 0) + (k === d.plusOne ? 1 : 0);
    const total = base + asi;
    const mod = abilityModifier(total);
    const upCost = base >= HUMAN.pointBuy.max ? null : pointBuyCost(base + 1) - pointBuyCost(base);
    const canUp = upCost !== null && remaining >= upCost;
    const canDown = base > HUMAN.pointBuy.min;
    return `<div class="cc-asi-row" data-ability="${k}">`
      + `<div class="cc-asi-name" title="${esc(HUMAN.abilityGuidance[k])}">${ABILITY_NAMES[k]}${icon('info', 'cc-asi-info')}</div>`
      + `<div class="cc-stepper" role="group" aria-label="${ABILITY_NAMES[k]} score">`
      + `<button type="button" class="cc-step" data-abase="${k}" data-delta="-1" ${canDown ? '' : 'disabled'} aria-label="Decrease ${ABILITY_NAMES[k]}">−</button>`
      + `<span class="cc-asi-val" aria-live="polite">${base}${asi ? `<em class="cc-asi-badge">+${asi}</em>` : ''}</span>`
      + `<button type="button" class="cc-step" data-abase="${k}" data-delta="1" ${canUp ? '' : 'disabled'} aria-label="Increase ${ABILITY_NAMES[k]}${upCost ? `, costs ${upCost} points` : ''}">+</button>`
      + `</div>`
      + `<div class="cc-asi-meta"><span class="cc-rank" title="Score ${total} with bonuses">${esc(rankFor(total))}</span>`
      + `<span class="cc-asi-mod" title="${esc(HUMAN.abilityGuidance[k])}">${mod >= 0 ? `+${mod}` : mod} mod</span>`
      + `<span class="cc-asi-cost">${upCost === null ? 'max' : `${upCost} pt${upCost === 1 ? '' : 's'} ↑`}</span></div>`
      + `</div>`;
  }).join('');
  return `<div class="cc-allocator">`
    + `<div class="cc-points" role="status">Points remaining: <strong>${remaining}</strong> of ${HUMAN.pointBuy.points}`
    + `<div class="cc-points-bar"><i style="width:${Math.round(spent / HUMAN.pointBuy.points * 100)}%"></i></div></div>`
    + `<div class="cc-asi-rows">${rows}</div>`
    + `<button type="button" class="cc-recommended" data-recommended-build>${icon('sparkles')} Use recommended scores</button>`
    + `<p class="cc-note">${esc(SOLDIER.abilityIncreases ? 'Your Soldier background adds +2 and +1 — assign them in the Background step.' : '')}</p>`
    + `</div>`;
}

export function bindAbilityAllocator(root: HTMLElement, d: CharacterDraft, opts: AllocatorOptions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-abase]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.abase as AbilityKey;
      const delta = Number(btn.dataset.delta);
      const next = d.bases[key] + delta;
      if (next < HUMAN.pointBuy.min || next > HUMAN.pointBuy.max) return;
      if (delta > 0) {
        const cost = pointBuyCost(next) - pointBuyCost(d.bases[key]);
        if (pointsSpent(d.bases) + cost > HUMAN.pointBuy.points) return;
      }
      d.bases[key] = next;
      opts.onChange();
    });
  });
  root.querySelector('[data-recommended-build]')?.addEventListener('click', () => {
    const b = HUMAN.recommendedBuild;
    for (const k of ABILITY_KEYS) d.bases[k] = b[k];
    opts.onChange();
  });
}
