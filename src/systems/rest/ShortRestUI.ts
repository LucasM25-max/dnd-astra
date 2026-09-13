import type { PlayerCharacter } from '../../game/character';

const ZAP = '<svg class="camp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';

/** Short-rest card: spend Hit Dice to heal, recharge Second Wind. */
export class ShortRestUI {
  static cardHTML(c: PlayerCharacter): string {
    const conMod = c.abilityScores.CON.modifier;
    const sign = conMod >= 0 ? '+' : '';
    const dice = c.hitDice.current;
    const usable = dice > 0 && c.hp.current < c.hp.max;
    return `
      <div class="camp-card" id="camp-short">
        <div class="camp-card-title">${ZAP} SHORT REST</div>
        <p class="camp-card-sub">Take a breather by the fire. Spend a Hit Die to heal and catch your breath.</p>
        <div class="camp-rows">
          <div class="camp-row"><span>Available Hit Dice</span><strong>${dice}d10</strong></div>
          <div class="camp-row"><span>Potential healing</span><strong>1d10 ${sign}${conMod}</strong></div>
          <div class="camp-row"><span>Second Wind</span><strong>${c.features.secondWind.usesCurrent} / ${c.features.secondWind.usesMax} → ${c.features.secondWind.usesMax} / ${c.features.secondWind.usesMax}</strong></div>
        </div>
        <button class="camp-primary" data-camp="short-spend" ${usable ? '' : 'disabled'}>${dice > 0 ? 'SPEND HIT DIE' : 'NO HIT DICE LEFT'}</button>
        ${c.hp.current >= c.hp.max ? '<div class="camp-note">You are already at full health.</div>' : ''}
      </div>`;
  }
}
