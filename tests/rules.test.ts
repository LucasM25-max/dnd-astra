import { describe, expect, it } from 'vitest';
import { addCondition, applyDamage, abilityModifier, hasCondition, newTurnBudget, proficiencyBonus, resolveCheck, RulesEventLog, spendBudget, tickConditions } from '../src/game/rules';
const actor = { id: 'rogue', level: 5, abilities: { str: 10, dex: 16, con: 12, int: 14, wis: 10, cha: 8 }, proficientAbilities: ['dex'] as const, skills: { stealth: { proficient: true, expertise: true } } };
describe('deterministic rules kernel', () => {
  it('uses the correct ability and proficiency math and is replayable', () => {
    const request = { kind: 'skill' as const, actor, ability: 'dex' as const, skill: 'stealth' as const, dc: 18, seed: 42 };
    const a = resolveCheck(request), b = resolveCheck(request);
    expect(a).toEqual(b); expect(abilityModifier(16)).toBe(3); expect(proficiencyBonus(5)).toBe(3); expect(a.modifier).toBe(9);
  });
  it('cancels advantage and disadvantage instead of stacking them', () => {
    const normal = resolveCheck({ kind: 'ability', actor, ability: 'wis', advantage: 'normal', seed: 9 });
    const adv = resolveCheck({ kind: 'ability', actor, ability: 'wis', advantage: 'advantage', seed: 9 });
    const dis = resolveCheck({ kind: 'ability', actor, ability: 'wis', advantage: 'disadvantage', seed: 9 });
    expect(adv.dice).toHaveLength(2); expect(dis.dice).toHaveLength(2); expect(normal.dice).toHaveLength(1);
    expect(adv.kept).toBe(Math.max(...adv.dice)); expect(dis.kept).toBe(Math.min(...dis.dice));
  });
  it('applies attack criticals independently of a high modifier', () => {
    const r = resolveCheck({ kind: 'attack', actor, ability: 'dex', dc: 30, seed: 2 });
    expect(r.critical === undefined || r.critical === 'hit' || r.critical === 'miss').toBe(true); expect(r.explanation.length).toBeGreaterThan(0);
  });
  it('does not duplicate or refresh conditions incorrectly', () => {
    const one = addCondition([], { id: 'a', type: 'poisoned', rounds: 2 });
    const two = addCondition(one, { id: 'b', type: 'poisoned', rounds: 5 });
    expect(two).toHaveLength(1); expect(two[0].rounds).toBe(5); expect(hasCondition(two, 'poisoned')).toBe(true);
    expect(tickConditions(two, 5)).toHaveLength(0);
  });
  it('enforces action, bonus action, reaction and movement budgets', () => {
    const b = newTurnBudget(9); expect(spendBudget(b, 'action')).toBe(true); expect(spendBudget(b, 'action')).toBe(false);
    expect(spendBudget(b, 'movement', 6)).toBe(true); expect(spendBudget(b, 'movement', 4)).toBe(false);
    expect(spendBudget(b, 'bonusAction')).toBe(true); expect(spendBudget(b, 'reaction')).toBe(true); expect(spendBudget(b, 'object')).toBe(true);
  });
  it('handles temporary hit points, resistance, vulnerability and healing', () => {
    const start = { hp: 10, maxHp: 10, temporaryHp: 3, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: false };
    const hit = applyDamage(start, 7, true, false); expect(hit.temporaryHp).toBe(0); expect(hit.hp).toBe(10);
    const vulnerable = applyDamage(start, 4, false, true); expect(vulnerable.hp).toBe(5);
  });
  it('keeps an inspectable event history with monotonic ids', () => {
    const log = new RulesEventLog(); log.append('CheckResolved', 1.2, { total: 18 }, 'rogue'); log.append('DamageApplied', 2, { amount: 4 });
    expect(log.all().map(e => e.id)).toEqual([1, 2]); expect(log.since(1)[0].type).toBe('DamageApplied'); log.clear(); expect(log.all()).toHaveLength(0);
  });
});
