import { describe, expect, it } from 'vitest';
import { defaultDraft, finalizeCharacter } from '../src/game/character';
import { addExperience } from '../src/game/progression';
describe('progression', () => { it('levels a character and derives new proficiency and hit points', () => { const sheet = finalizeCharacter({ ...defaultDraft(), name: 'Aster' }); const result = addExperience(sheet, 300); expect(result.levels).toBe(1); expect(result.sheet.level).toBe(2); expect(result.sheet.xp).toBe(300); expect(result.sheet.maxHp).toBe(sheet.maxHp + 6); }); });
