import {
  ABILITY_KEYS, ABILITY_NAMES, SOLDIER, featDef, skillDef,
  type AbilityKey, type CharacterDraft,
} from '../../game/character';
import { esc, icon, SKILL_ICONS } from './creation-helpers';
import { renderPersonalityPicker, bindPersonalityPicker } from './PersonalityPicker';
import type { PanelContext } from './ClassPanel';

/** Click-to-assign fallback selection (survives re-renders; drag-and-drop is primary). */
let selectedToken: '+2' | '+1' | null = null;

/** Soldier panel: draggable ASI tokens, confirmed grants, coin pouch, personality. */
export function renderBackgroundPanel(d: CharacterDraft): string {
  const ai = SOLDIER.abilityIncreases;
  const feat = featDef(SOLDIER.feat);
  const token = (kind: '+2' | '+1', placed: AbilityKey | null): string =>
    `<button type="button" class="cc-token${selectedToken === kind ? ' armed' : ''}${placed ? ' placed' : ''}"`
    + ` data-token="${kind}" draggable="true" aria-pressed="${selectedToken === kind}"`
    + ` title="Drag onto an ability, or click then click an ability">`
    + `${kind}${placed ? ` → ${placed}` : ''}</button>`;
  const target = (k: AbilityKey): string => {
    const bonus = (k === d.plusTwo ? 2 : 0) + (k === d.plusOne ? 1 : 0);
    const total = d.bases[k] + bonus;
    const accepts2 = ai.plusTwoFrom.includes(k), accepts1 = ai.plusOneFrom.includes(k);
    return `<div class="cc-asi-target${bonus ? ' filled' : ''}" data-asi-target="${k}"`
    + ` tabindex="0" role="button" aria-label="${ABILITY_NAMES[k]}: base ${d.bases[k]}${bonus ? `, plus ${bonus} background` : ''}, total ${total}">`
    + `<span class="cc-asi-target-name">${k}</span>`
    + `<span class="cc-asi-target-val">${d.bases[k]}${bonus ? ` <em>+${bonus}</em>` : ''} = <strong>${total}</strong></span>`
    + `<span class="cc-asi-target-accept">${accepts2 ? '+2' : ''}${accepts2 && accepts1 ? ' / ' : ''}${accepts1 ? '+1' : ''}</span>`
    + `</div>`;
  };
  const grantedCard = (id: string): string => {
    const def = skillDef(id);
    if (!def) return '';
    return `<span class="cc-granted-card" title="${esc(def.pitch)}">`
      + `${icon(SKILL_ICONS[id] ?? 'info')} <strong>${esc(def.name)}</strong> ${icon('check', 'cc-granted-check')}</span>`;
  };
  return `<div class="cc-panel" data-panel="background">`
    + `<div class="cc-identity"><h3>${esc(SOLDIER.title)}</h3>`
    + `<p>${esc(SOLDIER.flavour)}</p></div>`
    + `<div class="cc-identity-grid">`
    + `<div><h4>Granted skills</h4><div class="cc-granted-row">${grantedCard('athletics')}${grantedCard('intimidation')}</div></div>`
    + `<div><h4>Tool</h4><p class="cc-note">${icon('pack')} <strong>${esc(SOLDIER.tools.join(', '))}</strong> — ${esc(SOLDIER.toolNote)}</p></div>`
    + `<div><h4>Starting gold</h4><div class="cc-coinpouch" title="Soldier backpay, paid out before the road.">`
    + `${icon('coin', 'cc-coinpouch-icon')}<span><strong>${SOLDIER.gold} gp</strong><small>Soldier backpay</small></span></div></div>`
    + `<div><h4>Background feat</h4><p class="cc-note">${icon('zap')} <strong>${esc(feat?.name ?? SOLDIER.feat)}</strong> — ${esc(feat?.detail ?? '')}</p></div>`
    + `</div>`
    + `<h4>Background ability increases</h4>`
    + `<p class="cc-note">Drag each token onto an ability (or click a token, then an ability). Recommended: +2 ${ai.recommended.plusTwo}, +1 ${ai.recommended.plusOne}.</p>`
    + `<div class="cc-tokens" role="group" aria-label="Background bonus tokens">${token('+2', d.plusTwo)}${token('+1', d.plusOne)}`
    + `<button type="button" class="cc-recommended" data-asi-clear>Clear</button></div>`
    + `<div class="cc-asi-targets">${ABILITY_KEYS.map(target).join('')}</div>`
    + `<h4>Personality</h4>${renderPersonalityPicker(d)}`
    + `</div>`;
}

export function bindBackgroundPanel(el: HTMLElement, d: CharacterDraft, ctx: PanelContext): void {
  const ai = SOLDIER.abilityIncreases;
  const place = (kind: '+2' | '+1', k: AbilityKey): void => {
    const allowed = kind === '+2' ? ai.plusTwoFrom : ai.plusOneFrom;
    if (!allowed.includes(k)) return;
    if (kind === '+2') {
      d.plusTwo = k;
      if (d.plusOne === k) d.plusOne = null;
    } else {
      d.plusOne = k;
      if (d.plusTwo === k) d.plusTwo = null;
    }
    selectedToken = null;
    ctx.refresh();
  };
  el.querySelectorAll<HTMLButtonElement>('[data-token]').forEach(btn => {
    const kind = btn.dataset.token as '+2' | '+1';
    btn.addEventListener('click', () => {
      selectedToken = selectedToken === kind ? null : kind;
      ctx.refresh();
    });
    btn.addEventListener('dragstart', e => {
      e.dataTransfer?.setData('text/plain', kind);
      e.dataTransfer?.setDragImage(btn, 20, 20);
    });
  });
  el.querySelectorAll<HTMLElement>('[data-asi-target]').forEach(t => {
    const k = t.dataset.asiTarget as AbilityKey;
    t.addEventListener('click', () => { if (selectedToken) place(selectedToken, k); });
    t.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && selectedToken) { e.preventDefault(); place(selectedToken, k); }
    });
    t.addEventListener('dragover', e => e.preventDefault());
    t.addEventListener('drop', e => {
      e.preventDefault();
      const kind = e.dataTransfer?.getData('text/plain') as '+2' | '+1';
      if (kind === '+2' || kind === '+1') place(kind, k);
    });
  });
  el.querySelector('[data-asi-clear]')?.addEventListener('click', () => {
    d.plusTwo = null; d.plusOne = null; selectedToken = null;
    ctx.refresh();
  });
  bindPersonalityPicker(el, d, { onChange: ctx.refresh });
}
