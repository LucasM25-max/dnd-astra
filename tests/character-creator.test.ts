import { describe, expect, it } from 'vitest';
import { CharacterCreator } from '../src/ui/character-creator';
import {
  defaultDraft, finalizeCharacter, requiredCantripCount, requiredSkillCount,
  requiredSpellCount, availableSkillChoices, CLASSES,
} from '../src/game/character';

const creator = (name = 'Mira') => {
  const c = new CharacterCreator(defaultDraft());
  c.update('name', name);
  return c;
};

describe('character creator', () => {
  it('starts legal once a name is given', () => {
    expect(creator().valid).toBe(true);
    const blank = new CharacterCreator(defaultDraft());
    expect(blank.valid).toBe(false);
  });

  it('re-derives choices when the class changes so the draft stays legal', () => {
    // Regression: the old form kept the previous class's skills selected and
    // never re-rendered, producing "a selected skill is not granted" on submit.
    const c = creator();
    c.update('class', 'wizard');
    expect(c.valid).toBe(true);
    expect(c.draft.skillChoices.every(s => availableSkillChoices(c.draft).includes(s))).toBe(true);

    c.update('class', 'rogue');
    expect(c.valid).toBe(true);
    expect(c.draft.skillChoices).toHaveLength(requiredSkillCount(c.draft));
    expect(() => finalizeCharacter(c.draft)).not.toThrow();
  });

  it('picks the right number of skills for every class', () => {
    for (const id of Object.keys(CLASSES)) {
      const c = creator();
      c.update('class', id);
      expect(c.draft.skillChoices, id).toHaveLength(requiredSkillCount(c.draft));
      expect(c.valid, id).toBe(true);
    }
  });

  it('offers cantrips and spells only to casters, in the right quantity', () => {
    const fighter = creator();
    expect(requiredCantripCount(fighter.draft)).toBe(0);
    expect(fighter.draft.cantripChoices).toHaveLength(0);

    const wizard = creator();
    wizard.update('class', 'wizard');
    expect(wizard.draft.cantripChoices).toHaveLength(requiredCantripCount(wizard.draft));
    expect(wizard.draft.spellChoices).toHaveLength(requiredSpellCount(wizard.draft));
    expect(wizard.valid).toBe(true);
  });

  it('replaces the oldest pick once the limit is reached rather than blocking', () => {
    const c = creator();
    const pool = availableSkillChoices(c.draft);
    const limit = requiredSkillCount(c.draft);
    // Select more than the limit; the list must never exceed it.
    for (const skill of pool) c.update('skill', skill, true);
    expect(c.draft.skillChoices).toHaveLength(limit);
    expect(c.valid).toBe(true);
  });

  it('deselects a chosen skill when unchecked', () => {
    const c = creator();
    const chosen = c.draft.skillChoices[0];
    c.update('skill', chosen, false);
    expect(c.draft.skillChoices).not.toContain(chosen);
  });

  it('keeps the standard array legal and point buy within 27 points', () => {
    const c = creator();
    c.update('method', 'standardArray');
    expect(c.valid).toBe(true);
    expect([...c.draft.abilities ? Object.values(c.draft.abilities) : []].sort((a, b) => b - a))
      .toEqual([15, 14, 13, 12, 10, 8]);

    c.update('method', 'pointBuy');
    expect(c.valid).toBe(true);
    for (const score of Object.values(c.draft.abilities)) {
      expect(score).toBeGreaterThanOrEqual(8);
      expect(score).toBeLessThanOrEqual(15);
    }
  });

  it('renders without throwing for every class and species combination', () => {
    const c = creator();
    for (const id of Object.keys(CLASSES)) {
      c.update('class', id);
      const html = c.render();
      expect(html).toContain('id="dialog-title"');
      // Regression: features used to render as [object Object].
      expect(html).not.toContain('[object Object]');
      expect(html).not.toContain('undefined');
    }
  });

  it('escapes a hostile name rather than injecting markup', () => {
    const c = creator('<img src=x onerror=alert(1)>');
    expect(c.render()).not.toContain('<img src=x');
  });
});
