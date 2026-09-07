/**
 * Experience, levelling and rests.
 *
 * Hit points on level-up use the fixed average the PHB offers as an
 * alternative to rolling, so a character sheet is never worse for reloading.
 */
import { CLASSES, type CharacterSheet } from './character';
import { abilityModifier, proficiencyBonus } from './rules';
import { slotsForLevel } from './spells';
import { modifierOf } from './character';

/** Total experience required to reach each level, 1 through 20. */
export const LEVEL_XP = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
export const MAX_LEVEL = 20;

/** Total experience needed for the next level, or null at level 20. */
export function xpToNext(level: number): number | null {
  return level >= MAX_LEVEL ? null : LEVEL_XP[level];
}

/** Progress through the current level, 0..1. */
export function levelProgress(sheet: Pick<CharacterSheet, 'level' | 'xp'>) {
  const floor = LEVEL_XP[sheet.level - 1] ?? 0;
  const ceiling = xpToNext(sheet.level);
  if (ceiling === null) return 1;
  return Math.max(0, Math.min(1, (sheet.xp - floor) / (ceiling - floor)));
}

export interface LevelUpSummary { level: number; hpGained: number; newFeatures: { name: string; text: string }[]; proficiencyBonus: number; newSlots: number[] }

/** Fixed hit points per level after the first: half the die, rounded up, +1. */
const fixedHitPointGain = (hitDie: number) => Math.floor(hitDie / 2) + 1;

export function addExperience(sheet: CharacterSheet, amount: number) {
  const gained = Math.max(0, Math.floor(amount));
  const next: CharacterSheet = { ...sheet, xp: sheet.xp + gained };
  const klass = CLASSES[sheet.classId];
  const summaries: LevelUpSummary[] = [];

  while (next.level < MAX_LEVEL && next.xp >= (xpToNext(next.level) ?? Infinity)) {
    next.level++;
    const con = abilityModifier(next.finalAbilities.con);
    const dwarfBonus = next.species === 'hillDwarf' ? 1 : 0;
    const hpGained = Math.max(1, fixedHitPointGain(klass.hitDie) + con + dwarfBonus);
    next.maxHp += hpGained;
    next.currentHp += hpGained;
    next.proficiencyBonus = proficiencyBonus(next.level);
    next.hitDice = { size: klass.hitDie, total: next.level, remaining: Math.min(next.level, next.hitDice.remaining + 1) };

    const newFeatures = klass.features.filter(f => f.level === next.level);
    next.features = [...next.features, ...newFeatures];
    // Extra Attack is the one feature the encounter engine reads directly.
    if (newFeatures.some(f => f.name === 'Extra Attack')) next.attacksPerAction = 2;

    const before = next.slots.max;
    next.slots = { max: slotsForLevel(next.casterKind, next.level).max, used: [...next.slots.used] };
    while (next.slots.used.length < next.slots.max.length) next.slots.used.push(0);
    next.slots.used.length = next.slots.max.length;

    summaries.push({
      level: next.level, hpGained, newFeatures, proficiencyBonus: next.proficiencyBonus,
      newSlots: next.slots.max.map((m, i) => m - (before[i] ?? 0)),
    });
  }

  return { sheet: next, levels: summaries.length, summaries, xpRemaining: next.xp, nextLevelAt: xpToNext(next.level) };
}

/**
 * A short rest lets the character spend hit dice; slots do not return.
 *
 * PHB: each die spent regains its roll *plus the Constitution modifier*, and a
 * die can never heal for less than zero even with a negative modifier.
 */
export function shortRest(sheet: CharacterSheet, diceSpent: number, rolled: number): CharacterSheet {
  const spend = Math.max(0, Math.min(sheet.hitDice.remaining, Math.floor(diceSpent)));
  const con = modifierOf(sheet, 'con');
  const regained = Math.max(0, rolled) + spend * con;
  return {
    ...sheet,
    currentHp: Math.min(sheet.maxHp, sheet.currentHp + Math.max(0, regained)),
    hitDice: { ...sheet.hitDice, remaining: sheet.hitDice.remaining - spend },
  };
}

/** A long rest restores all hit points, all slots and half the hit dice. */
export function longRest(sheet: CharacterSheet): CharacterSheet {
  return {
    ...sheet,
    currentHp: sheet.maxHp,
    hitDice: { ...sheet.hitDice, remaining: Math.min(sheet.hitDice.total, sheet.hitDice.remaining + Math.max(1, Math.floor(sheet.hitDice.total / 2))) },
    slots: { max: [...sheet.slots.max], used: sheet.slots.max.map(() => 0) },
  };
}
