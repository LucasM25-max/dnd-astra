import { describe, it, expect } from 'vitest';
import {
  abilityModifier,
  acFor,
  buildScores,
  defaultCharacter,
  draftComplete,
  draftToCharacter,
  maxHPFor,
  newDraft,
  pointBuyCost,
  pointsSpent,
  rankFor,
  recommendedDraft,
  skillModifier,
  validateCharacter,
} from '../src/game/character';

describe('point buy', () => {
  it('costs every step 1 except 14→15 which costs 2', () => {
    expect(pointBuyCost(8)).toBe(0);
    expect(pointBuyCost(12)).toBe(4);
    expect(pointBuyCost(14)).toBe(6);
    expect(pointBuyCost(15)).toBe(8);
  });
  it('keeps the recommended build inside 27 points', () => {
    expect(pointsSpent(recommendedDraft().bases)).toBeLessThanOrEqual(27);
  });
});

describe('ability scores', () => {
  it('derives modifiers and ranks from totals', () => {
    expect(abilityModifier(17)).toBe(3);
    expect(abilityModifier(8)).toBe(-1);
    expect(rankFor(15)).toBe('Heroic');
    expect(rankFor(8)).toBe('Feeble');
  });
  it('applies Soldier +2/+1 on top of bought bases', () => {
    const scores = buildScores({ STR: 15, DEX: 12, CON: 14, INT: 8, WIS: 13, CHA: 10 }, 'STR', 'CON');
    expect(scores.STR.total).toBe(17);
    expect(scores.STR.modifier).toBe(3);
    expect(scores.CON.total).toBe(15);
    expect(scores.INT.total).toBe(8);
  });
});

describe('level-1 derivations', () => {
  it('computes HP as 10 + CON + Tough', () => {
    const scores = buildScores({ STR: 15, DEX: 12, CON: 14, INT: 8, WIS: 13, CHA: 10 }, 'STR', 'CON');
    expect(maxHPFor(scores, 'tough')).toBe(14);
    expect(maxHPFor(scores, 'alert')).toBe(12);
  });
  it('computes AC from chain mail, shield, and Defense', () => {
    expect(acFor('shield', 'defense')).toBe(19);
    expect(acFor('shield', 'dueling')).toBe(18);
    expect(acFor('shortsword', 'defense')).toBe(17);
  });
});

describe('draft to character', () => {
  it('forges the recommended hero with a complete record', () => {
    const c = draftToCharacter(recommendedDraft('Maren'));
    expect(draftComplete(recommendedDraft('Maren'))).toBe(true);
    expect(c.name).toBe('Maren');
    expect(c.hp.max).toBe(c.hp.current);
    expect(c.hitDice).toEqual({ max: 1, current: 1, die: 10 });
    expect(c.proficiencies.savingThrows).toEqual(['STR', 'CON']);
    expect(c.proficiencies.skills).toContain('athletics');
    expect(c.proficiencies.skills).toContain('perception');
    expect(c.equipment.ranged).toBe('longbow');
    expect(c.originFeat).toBe('tough');
    expect(c.backgroundFeat).toBe('savage_attacker');
    expect(validateCharacter(c)).toBe(true);
  });
  it('rejects duplicate Savage Attacker as an Origin feat', () => {
    const d = recommendedDraft();
    d.originFeat = 'savage_attacker';
    expect(draftComplete(d)).toBe(false);
  });
  it('requires a name, skills, feat, style, ASI, and language', () => {
    expect(draftComplete(newDraft())).toBe(false);
  });
  it('computes skill modifiers with proficiency and conditions', () => {
    const c = defaultCharacter();
    // Recommended: WIS 13 (+1) + perception proficient (+2).
    expect(skillModifier(c, 'perception')).toBe(3);
    c.conditions.push({ name: 'Poorly Rested', effect: 'perception_penalty', value: -1, expiresEpochMin: 999999 });
    expect(skillModifier(c, 'perception')).toBe(2);
  });
  it('validates saves strictly', () => {
    const c = defaultCharacter();
    expect(validateCharacter(c)).toBe(true);
    expect(validateCharacter({ ...c, hp: { max: 14, current: 99 } })).toBe(false);
    expect(validateCharacter({ ...c, originFeat: 'lucky' })).toBe(false);
    expect(validateCharacter(null)).toBe(false);
  });
});
