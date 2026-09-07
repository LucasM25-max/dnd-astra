import { describe, expect, it } from 'vitest';
import { defaultDraft, finalizeCharacter, validateDraft } from '../src/game/character';
describe('character creation', () => {
  it('creates valid fighter and wizard sheets from the sample options', () => {
    const fighter = finalizeCharacter({ ...defaultDraft(), name: 'Mira' });
    expect(fighter.maxHp).toBe(11); expect(fighter.armorClass).toBe(12); expect(fighter.features).toContain('Second Wind');
    const wizard = finalizeCharacter({ ...defaultDraft(), name: 'Orren', classId: 'wizard', species: 'elf', background: 'sage', abilities: { str: 8, dex: 14, con: 12, int: 15, wis: 10, cha: 13 }, skillChoices: [] });
    expect(wizard.maxHp).toBe(7); expect(wizard.traits).toContain('Darkvision'); expect(wizard.features).toContain('Spellbook'); expect(wizard.skillProficiencies).toContain('arcana');
  });
  it('rejects missing names, invalid ability ranges and illegal skills', () => {
    const d = defaultDraft(); d.abilities.str = 22; d.skillChoices = ['arcana'];
    const errors = validateDraft(d); expect(errors.some(e => e.includes('name'))).toBe(true); expect(errors.some(e => e.includes('Ability'))).toBe(true); expect(errors.some(e => e.includes('not granted'))).toBe(true);
  });
  it('derives rules-facing numbers rather than storing UI-only values', () => {
    const sheet = finalizeCharacter({ ...defaultDraft(), name: 'Tamsin', classId: 'wizard', abilities: { str: 10, dex: 12, con: 14, int: 16, wis: 12, cha: 10 } });
    expect(sheet.proficiencyBonus).toBe(2); expect(sheet.initiative).toBe(1); expect(sheet.maxHp).toBe(8); expect(sheet.passivePerception).toBe(13);
  });
});
