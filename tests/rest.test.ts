import { describe, it, expect } from 'vitest';
import { defaultCharacter } from '../src/game/character';
import {
  REST_CONFIG,
  activePerceptionModifier,
  addPoorlyRested,
  applyLongRest,
  hoursSince,
  isWellRested,
  longRestAvailable,
  partialRest,
  pruneConditions,
  spendHitDie,
} from '../src/systems/rest/RestResolver';

describe('long rest availability', () => {
  it('allows the first rest and then enforces a 24h cooldown', () => {
    const c = defaultCharacter();
    expect(longRestAvailable(c, 1000).ok).toBe(true);
    c.lastLongRestEpochMin = 1000;
    expect(longRestAvailable(c, 1000 + 23 * 60).ok).toBe(false);
    expect(longRestAvailable(c, 1000 + 24 * 60).ok).toBe(true);
    expect(hoursSince(null, 1000)).toBe(Infinity);
  });
  it('refuses rest at 0 HP', () => {
    const c = defaultCharacter();
    c.hp.current = 0;
    expect(longRestAvailable(c, 5000).ok).toBe(false);
  });
});

describe('long rest benefits', () => {
  it('restores HP, Hit Dice, Second Wind, and Inspiration', () => {
    const c = defaultCharacter();
    c.hp.current = 3;
    c.hitDice.current = 0;
    c.features.secondWind.usesCurrent = 0;
    c.features.heroicInspiration.available = false;
    const { hpRestored } = applyLongRest(c);
    expect(hpRestored).toBe(c.hp.max - 3);
    expect(c.hp.current).toBe(c.hp.max);
    expect(c.hitDice.current).toBe(1);
    expect(c.features.secondWind.usesCurrent).toBe(1);
    expect(c.features.heroicInspiration.available).toBe(true);
  });
  it('clears conditions that do not persist through rest', () => {
    const c = defaultCharacter();
    addPoorlyRested(c, 2000);
    expect(c.conditions).toHaveLength(1);
    applyLongRest(c);
    expect(c.conditions).toHaveLength(0);
  });
  it('detects a well-rested hero', () => {
    const c = defaultCharacter();
    expect(isWellRested(c)).toBe(true);
    c.hp.current = 1;
    expect(isWellRested(c)).toBe(false);
  });
});

describe('interrupted rest', () => {
  it('recovers a fraction of missing HP', () => {
    const c = defaultCharacter();
    c.hp.current = 4;
    const healed = partialRest(c);
    expect(healed).toBe(Math.floor((c.hp.max - 4) * REST_CONFIG.partialHealFraction));
    expect(c.hp.current).toBe(4 + healed);
  });
  it('applies Poorly Rested with a 1-hour expiry', () => {
    const c = defaultCharacter();
    addPoorlyRested(c, 3000);
    expect(activePerceptionModifier(c, 3000)).toBe(2); // 3 − 1
    pruneConditions(c, 3000 + 61);
    expect(activePerceptionModifier(c, 3000 + 61)).toBe(3);
  });
});

describe('short rest', () => {
  it('spends a Hit Die to heal and refreshes Second Wind', () => {
    const c = defaultCharacter();
    c.hp.current = 5;
    c.features.secondWind.usesCurrent = 0;
    const healed = spendHitDie(c, 8);
    expect(healed).toBe(8);
    expect(c.hp.current).toBe(13);
    expect(c.hitDice.current).toBe(0);
    expect(c.features.secondWind.usesCurrent).toBe(1);
  });
  it('never overheals and never spends without dice', () => {
    const c = defaultCharacter();
    c.hp.current = 13;
    expect(spendHitDie(c, 8)).toBe(1);
    expect(c.hp.current).toBe(14);
    expect(spendHitDie(c, 8)).toBe(0);
  });
});
