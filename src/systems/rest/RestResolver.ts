import restConfigJson from '../../data/rest/rest-config.json';
import { skillModifier, type CharacterCondition, type PlayerCharacter } from '../../game/character';

/** Pure long/short rest math. No DOM, no audio — fully unit-testable. */
export interface RestConfig {
  ambushChance: number;
  ambushThreshold: number;
  cooldownHours: number;
  longRestHours: number;
  shortRestHours: number;
  perceptionDC: number;
  partialHealFraction: number;
  poorlyRested: { name: string; effect: string; value: number; durationHours: number };
  cinematicMs: { dollyOut: number; nightHold: number; dawnHold: number; fadeMs: number };
}
export const REST_CONFIG = restConfigJson as unknown as RestConfig;

export function hoursSince(lastEpochMin: number | null, nowEpochMin: number): number {
  if (lastEpochMin === null) return Infinity;
  return (nowEpochMin - lastEpochMin) / 60;
}

export function longRestAvailable(c: PlayerCharacter, nowEpochMin: number): { ok: boolean; reason: string | null } {
  if (c.hp.current < 1) return { ok: false, reason: 'You must have at least 1 HP to rest.' };
  const hours = hoursSince(c.lastLongRestEpochMin, nowEpochMin);
  if (hours < REST_CONFIG.cooldownHours) {
    return { ok: false, reason: "You've already rested today. You need to adventure more before sleeping again." };
  }
  return { ok: true, reason: null };
}

export function isWellRested(c: PlayerCharacter): boolean {
  return (
    c.hp.current >= c.hp.max &&
    c.features.secondWind.usesCurrent >= c.features.secondWind.usesMax &&
    c.features.heroicInspiration.available
  );
}

export function pruneConditions(c: PlayerCharacter, nowEpochMin: number): void {
  c.conditions = c.conditions.filter(cond => cond.expiresEpochMin > nowEpochMin);
}

/** Full long-rest benefits. Returns HP restored. */
export function applyLongRest(c: PlayerCharacter): { hpRestored: number } {
  const hpRestored = c.hp.max - c.hp.current;
  c.hp.current = c.hp.max;
  const recovered = Math.max(1, Math.floor(c.hitDice.max / 2));
  c.hitDice.current = Math.min(c.hitDice.max, c.hitDice.current + recovered);
  c.features.secondWind.usesCurrent = c.features.secondWind.usesMax;
  if (c.species === 'Human') c.features.heroicInspiration.available = true;
  c.conditions = c.conditions.filter(cond => cond.persistsThroughRest === true);
  return { hpRestored };
}

/** Interrupted rest: recover a fraction of missing HP. Returns amount healed. */
export function partialRest(c: PlayerCharacter, fraction = REST_CONFIG.partialHealFraction): number {
  const healed = Math.floor((c.hp.max - c.hp.current) * fraction);
  c.hp.current = Math.min(c.hp.max, c.hp.current + healed);
  return healed;
}

/** Spend one Hit Die after a visible d10 roll. Returns HP actually restored. */
export function spendHitDie(c: PlayerCharacter, rollTotal: number): number {
  if (c.hitDice.current < 1) return 0;
  c.hitDice.current -= 1;
  const healed = Math.min(rollTotal, c.hp.max - c.hp.current);
  c.hp.current += Math.max(0, healed);
  c.features.secondWind.usesCurrent = c.features.secondWind.usesMax;
  return Math.max(0, healed);
}

export function addPoorlyRested(c: PlayerCharacter, nowEpochMin: number): void {
  const p = REST_CONFIG.poorlyRested;
  c.conditions = c.conditions.filter(cond => cond.name !== p.name);
  const condition: CharacterCondition = {
    name: p.name,
    effect: p.effect,
    value: p.value,
    expiresEpochMin: nowEpochMin + p.durationHours * 60,
  };
  c.conditions.push(condition);
}

export function activePerceptionModifier(c: PlayerCharacter, nowEpochMin: number): number {
  pruneConditions(c, nowEpochMin);
  return skillModifier(c, 'perception');
}
