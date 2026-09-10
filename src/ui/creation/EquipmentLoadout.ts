import { FIGHTER, PACKS, weaponDef, type CharacterDraft } from '../../game/character';
import { esc, icon } from './creation-helpers';

export interface EquipmentLoadoutOptions {
  onChange: () => void;
  flourish: (kind: 'attack' | 'hit' | 'down') => void;
}

function weaponCard(id: string, group: 'primary' | 'offhand', selectedId: string | null): string {
  const w = weaponDef(id);
  if (!w) return '';
  const isSel = selectedId === id;
  const img = w.texture
    ? `<img class="cc-weapon-img" src="${esc(w.texture)}" alt="" loading="lazy" onerror="this.style.display='none'"/>`
    : '';
  return `<button type="button" class="cc-weapon${isSel ? ' selected' : ''}" data-weapon-${group}="${id}" aria-pressed="${isSel}">`
    + `${img}<span class="cc-weapon-body"><span class="cc-weapon-name">${icon(w.icon)} ${esc(w.name)}</span>`
    + `<span class="cc-weapon-stats">${w.damageDie ? `${esc(w.damageDie)} damage · ` : ''}${esc(w.properties.join(' · '))}</span>`
    + `<span class="cc-weapon-pitch">${esc(w.pitch)}</span></span>`
    + `${isSel ? icon('check', 'cc-skill-check') : ''}</button>`;
}

/** Starting equipment: primary / off-hand choices plus the fixed kit (bow, quiver, mail, pack). */
export function renderEquipmentLoadout(d: CharacterDraft): string {
  const eq = FIGHTER.equipment;
  const bow = weaponDef(eq.ranged);
  const quiver = weaponDef('quiver');
  const pack = PACKS.find(p => p.id === eq.pack);
  const fixedImg = (w: ReturnType<typeof weaponDef>): string =>
    w?.texture ? `<img class="cc-fixed-img" src="${esc(w.texture)}" alt="" loading="lazy" onerror="this.style.display='none'"/>` : '';
  return `<div class="cc-loadout">`
    + `<h4>Primary weapon</h4><div class="cc-weapon-grid" role="group" aria-label="Primary weapon">`
    + eq.primary.map(id => weaponCard(id, 'primary', d.mainHand)).join('') + `</div>`
    + `<h4>Off hand</h4><div class="cc-weapon-grid" role="group" aria-label="Off hand">`
    + eq.offhand.map(id => weaponCard(id, 'offhand', d.offHand)).join('') + `</div>`
    + `<h4>Always carried</h4><ul class="cc-fixed">`
    + `<li>${fixedImg(bow)}<span><strong>${esc(bow?.name ?? 'Longbow')}</strong> + ${fixedImg(quiver)}<strong>Quiver</strong> — ${eq.arrows} arrows for answers at range.</span></li>`
    + `<li>${icon('shield')}<span><strong>Chain Mail</strong> — 16 AC · Disadvantage on Stealth.</span></li>`
    + `<li>${icon('pack')}<span><strong>${esc(pack?.name ?? 'Explorer\u2019s Pack')}</strong> — ${pack ? esc(pack.contents.map(c => c.name).join(', ')) : 'bedroll, rations, rope and more'}.</span></li>`
    + `</ul></div>`;
}

export function bindEquipmentLoadout(root: HTMLElement, d: CharacterDraft, opts: EquipmentLoadoutOptions): void {
  root.querySelectorAll<HTMLButtonElement>('[data-weapon-primary]').forEach(btn => {
    btn.addEventListener('click', () => {
      d.mainHand = btn.dataset.weaponPrimary ?? d.mainHand;
      opts.onChange();
      opts.flourish('attack');
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-weapon-offhand]').forEach(btn => {
    btn.addEventListener('click', () => {
      d.offHand = btn.dataset.weaponOffhand ?? d.offHand;
      opts.onChange();
    });
  });
}
