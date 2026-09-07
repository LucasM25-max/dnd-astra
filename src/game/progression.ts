import type { CharacterSheet } from './character';
export const LEVEL_XP = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000];
export function xpToNext(level: number) { return LEVEL_XP[Math.min(LEVEL_XP.length - 1, level)] ?? Infinity; }
export function addExperience(sheet: CharacterSheet, amount: number) {
  const next = { ...sheet, xp: sheet.xp + Math.max(0, Math.floor(amount)) }; let levels = 0;
  while (next.level < LEVEL_XP.length && next.xp >= xpToNext(next.level)) { next.level++; levels++; next.proficiencyBonus = 2 + Math.max(0, Math.ceil(next.level / 4) - 1); next.maxHp += next.classId === 'fighter' ? 6 : 4; }
  return { sheet: next, levels, xpRemaining: next.xp, nextLevelAt: next.level < LEVEL_XP.length ? xpToNext(next.level) : null };
}
