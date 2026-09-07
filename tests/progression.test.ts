import { describe, expect, it } from 'vitest';
import { defaultDraft, finalizeCharacter, modifierOf, withDefaultChoices } from '../src/game/character';
import { addExperience, LEVEL_XP, levelProgress, longRest, MAX_LEVEL, shortRest, xpToNext } from '../src/game/progression';

const hero = () => finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Aster' }));

describe('progression', () => {
  it('levels once at 300 xp and recomputes hit points from the hit die', () => {
    const sheet = hero();
    const result = addExperience(sheet, 300);
    expect(result.levels).toBe(1);
    expect(result.sheet.level).toBe(2);
    expect(result.sheet.xp).toBe(300);
    // Fighter d10: average 6 rounded up, plus the CON modifier, per level.
    expect(result.sheet.maxHp).toBe(sheet.maxHp + 6 + modifierOf(sheet, 'con'));
    expect(result.summaries).toHaveLength(1);
  });

  it('crosses several thresholds at once and raises the proficiency bonus at 5', () => {
    const result = addExperience(hero(), LEVEL_XP[4]);
    expect(result.sheet.level).toBe(5);
    expect(result.levels).toBe(4);
    expect(result.sheet.proficiencyBonus).toBe(3);
  });

  it('caps at level 20 and stops reporting a next threshold', () => {
    const result = addExperience(hero(), 1_000_000);
    expect(result.sheet.level).toBe(MAX_LEVEL);
    expect(result.nextLevelAt).toBeNull();
    expect(xpToNext(result.sheet.level)).toBeNull();
  });

  it('reports fractional progress toward the next level', () => {
    const sheet = addExperience(hero(), 150).sheet;
    expect(levelProgress(sheet)).toBeCloseTo(0.5, 5);
  });

  it('spends hit dice on a short rest and never heals past the maximum', () => {
    const sheet = { ...hero(), currentHp: 2 };
    const rested = shortRest(sheet, 1, 8);
    expect(rested.currentHp).toBe(Math.min(sheet.maxHp, 2 + 8 + modifierOf(sheet, 'con')));
    expect(rested.hitDice.remaining).toBe(sheet.hitDice.remaining - 1);
  });

  it('restores hit points, hit dice and spell slots on a long rest', () => {
    const wizard = finalizeCharacter(withDefaultChoices({ ...defaultDraft(), name: 'Orren', classId: 'wizard' }));
    // Level up first so there are hit dice to have spent.
    const grown = addExperience(wizard, 900).sheet;
    const spent = { ...grown, currentHp: 1, hitDice: { ...grown.hitDice, remaining: 0 }, slots: { ...grown.slots, used: grown.slots.max.map(() => 1) } };
    const rested = longRest(spent);
    expect(rested.currentHp).toBe(grown.maxHp);
    // A long rest returns half the total hit dice, minimum one.
    expect(rested.hitDice.remaining).toBe(Math.max(1, Math.floor(grown.hitDice.total / 2)));
    expect(rested.slots.used.every(u => u === 0)).toBe(true);
  });
});
