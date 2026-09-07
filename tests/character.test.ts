import { describe, expect, it } from 'vitest';
import {
  availableSkillChoices, defaultDraft, finalizeCharacter, modifierOf,
  POINT_BUY_COST, requiredCantripCount, requiredSpellCount, STANDARD_ARRAY,
  validateDraft, withDefaultChoices, type CharacterDraft,
} from '../src/game/character';

const named = (over: Partial<CharacterDraft> = {}): CharacterDraft =>
  withDefaultChoices({ ...defaultDraft(), name: 'Mira', ...over });

describe('character creation', () => {
  it('produces a legal draft out of the box, needing only a name', () => {
    const draft = defaultDraft();
    expect(validateDraft(draft)).toEqual(['Choose a name between 1 and 32 characters.']);
    expect(validateDraft({ ...draft, name: 'Mira' })).toEqual([]);
  });

  it('derives fighter numbers from the Player\u2019s Handbook tables', () => {
    // Human +1 all: STR 16 DEX 15 CON 14.
    // Chain mail is AC 16 flat (heavy armour ignores Dex), +2 shield,
    // +1 for the Defense fighting style the starting fighter takes.
    const fighter = finalizeCharacter(named());
    expect(fighter.level).toBe(1);
    expect(fighter.proficiencyBonus).toBe(2);
    expect(fighter.finalAbilities.con).toBe(14);
    expect(fighter.maxHp).toBe(10 + modifierOf(fighter, 'con'));
    expect(fighter.armorClass).toBe(19);
    expect(fighter.features.map(f => f.name)).toContain('Second Wind');
    expect(fighter.savingThrows).toEqual(expect.arrayContaining(['str', 'con']));
  });

  it('gives a wizard a spellbook, cantrips and prepared spells', () => {
    const draft = named({ classId: 'wizard', species: 'highElf', background: 'sage' });
    const wizard = finalizeCharacter(draft);
    expect(wizard.maxHp).toBe(6 + modifierOf(wizard, 'con'));
    expect(wizard.traits.map(t => (typeof t === 'string' ? t : t.name)).join(' ')).toMatch(/Darkvision/);
    expect(wizard.spellsKnown).toHaveLength(requiredCantripCount(draft) + requiredSpellCount(draft));
    expect(wizard.slots.max[0]).toBe(2);
    expect(wizard.skillProficiencies).toContain('arcana');
  });

  it('rejects blank names, out-of-range abilities and skills the class never offers', () => {
    const draft = named();
    draft.name = '';
    draft.abilities.str = 22;
    draft.skillChoices = ['arcana', 'athletics'];
    const errors = validateDraft(draft);
    expect(errors.some(e => /name/i.test(e))).toBe(true);
    expect(errors.some(e => /Ability/i.test(e))).toBe(true);
    expect(errors.some(e => /not granted/i.test(e))).toBe(true);
    expect(() => finalizeCharacter(draft)).toThrow();
  });

  it('enforces the standard array and the 27-point point-buy budget', () => {
    const bad = named({ method: 'standardArray', abilities: { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 } });
    expect(validateDraft(bad).some(e => /standard array/i.test(e))).toBe(true);

    // The standard array happens to cost exactly the point-buy budget.
    const spent = STANDARD_ARRAY.reduce((sum, score) => sum + (POINT_BUY_COST[score] ?? 0), 0);
    expect(spent).toBe(27);
    const legal = named({ method: 'pointBuy', abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } });
    const cost = Object.values(legal.abilities).reduce((sum, s) => sum + POINT_BUY_COST[s], 0);
    expect(cost).toBe(27);
    expect(validateDraft(legal)).toEqual([]);
  });

  it('re-picks choices that stop being legal when the class changes', () => {
    const rogue = withDefaultChoices({ ...named(), classId: 'rogue' });
    const pool = availableSkillChoices(rogue);
    expect(rogue.skillChoices.every(s => pool.includes(s))).toBe(true);
    expect(rogue.skillChoices).toHaveLength(4);
  });

  it('stores rules-facing numbers, not display strings', () => {
    const sheet = finalizeCharacter(named({ classId: 'wizard' }));
    expect(sheet.initiative).toBe(modifierOf(sheet, 'dex'));
    expect(sheet.passivePerception).toBe(10 + modifierOf(sheet, 'wis')
      + (sheet.skillProficiencies.includes('perception') ? sheet.proficiencyBonus : 0));
    expect(typeof sheet.maxHp).toBe('number');
    expect(sheet.currentHp).toBe(sheet.maxHp);
  });
});
