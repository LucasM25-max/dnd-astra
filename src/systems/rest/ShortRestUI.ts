import type { PlayerCharacter } from '../../game/character';

/** Short-rest card: spend Hit Dice to heal, recharge Second Wind. */
export class ShortRestUI {
  static cardHTML(c: PlayerCharacter): string {
    const conMod = c.abilityScores.CON.modifier;
    const sign = conMod >= 0 ? '+' : '';
    const dice = c.hitDice.current;
    const usable = dice > 0 && c.hp.current < c.hp.max;
    return `
      <div class="camp-card" id="camp-short">
        <div class="camp-card-title">⚡ SHORT REST</div>
        <p class="camp-card-sub">Take a breather. Spend Hit Dice to heal.</p>
        <div class="camp-rows">
          <div class="camp-row"><span>Available Hit Dice</span><strong>${dice}d10</strong></div>
          <div class="camp-row"><span>Potential healing</span><strong>1d10 ${sign}${conMod}</strong></div>
          <div class="camp-row"><span>Second Wind</span><strong>${c.features.secondWind.usesCurrent}/${c.features.secondWind.usesMax} → ${c.features.secondWind.usesMax}/${c.features.secondWind.usesMax}</strong></div>
        </div>
        <button class="camp-primary" data-camp="short-spend" ${usable ? '' : 'disabled'}>${dice > 0 ? 'SPEND HIT DIE' : 'NO HIT DICE LEFT'}</button>
        ${c.hp.current >= c.hp.max ? '<div class="camp-note">You are already at full health.</div>' : ''}
      </div>`;
  }
}
