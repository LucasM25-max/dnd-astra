import { describe, expect, it } from 'vitest';
import { createTrainingCombat, takeAttack, takeSpell } from '../src/game/combat';
import { newTurnBudget } from '../src/game/rules';
const hero = { actor: { id: 'hero', level: 1, abilities: { str: 16, dex: 12, con: 12, int: 16, wis: 10, cha: 10 }, proficientAbilities: ['str'] as const }, hp: { hp: 12, maxHp: 12, temporaryHp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: false }, armorClass: 16, conditions: [], budget: newTurnBudget(30), side: 'party' as const, spells: ['fireBolt'] };
describe('combat loop', () => {
  it('spends one action and advances to the enemy turn', () => { const state = createTrainingCombat(hero); expect(takeAttack(state, 'goblin-scout', 1)).toBe(true); expect(state.activeId).not.toBe('hero'); expect(state.log.some(e => e.type === 'attack')).toBe(true); });
  it('resolves a wizard spell against the target armor class', () => { const state = createTrainingCombat({ ...hero, spells: ['fireBolt'] }); expect(takeSpell(state, 'fireBolt', 'goblin-scout', 4)).toBe(true); expect(state.log.some(e => e.type === 'spell')).toBe(true); });
  it('rejects a second action during the same turn', () => { const state = createTrainingCombat(hero); expect(takeAttack(state, 'goblin-scout', 1)).toBe(true); expect(takeAttack(state, 'goblin-raider', 2)).toBe(false); });
});
