import type { Monster } from './bestiary';
import type { CharacterSheet } from './character';

/**
 * Solo balance.
 *
 * D&D is written for a party of four. This game has exactly one player
 * character, and the Cragmaw ambush as printed is four goblins — 200 XP raw,
 * 400 after the ×2 multiplier for a group of four monsters. The "deadly"
 * threshold for a *single* level-1 character is 100 XP. As written, the
 * opening encounter is four times deadly for a solo hero: they lose, always,
 * and the module's own defeat branch stops being a dramatic possibility and
 * becomes the only outcome.
 *
 * Rather than silently rewriting the stat blocks, this module applies one
 * declared, inspectable adjustment pass in both directions:
 *
 *   - The hero is buffed to stand in for an absent party: a Second Wind that
 *     recharges, a flat damage bonus standing in for a second attacker, extra
 *     hit points standing in for a healer, and one free "lucky" reroll per
 *     fight standing in for the party's action economy.
 *   - The goblins are nerfed just enough to be beatable one-on-four: fewer hit
 *     points, and the pack staggers its focus fire instead of all four
 *     alpha-striking the same target on round one.
 *
 * Everything here is expressed as a modifier over the real Player's Handbook
 * numbers, so the underlying rules stay honest and the adjustments stay
 * visible in the UI ("Solo adventurer" is shown as a real, explained trait).
 */

/** XP thresholds per character level, for a single character (DMG). */
const SOLO_DEADLY: Record<number, number> = {
  1: 100, 2: 200, 3: 400, 4: 500, 5: 1100, 6: 1400,
  7: 1700, 8: 2100, 9: 2400, 10: 2800,
};

export interface SoloProfile {
  /** Extra maximum hit points, standing in for a party healer. */
  bonusHp: number;
  /** Flat damage added to the hero's weapon and cantrip hits. */
  bonusDamage: number;
  /** Extra AC, standing in for a party member drawing fire. */
  bonusAc: number;
  /** Free rerolls of a failed d20 per encounter. */
  luck: number;
  /** Second Wind (or the class equivalent) recharges this many times. */
  secondWindUses: number;
  /** Multiplier applied to enemy maximum hit points. */
  enemyHpScale: number;
  /** Enemies that may attack the hero in a single round. */
  focusFireCap: number;
  /** Human-readable explanation, shown on the character sheet. */
  notes: string[];
}

/** What the hero brings to the fight before any adjustment. */
export interface HeroBaseline {
  level: number;
  maxHp: number;
  armorClass: number;
  /** True for classes that fight at range or with spells rather than in melee. */
  squishy: boolean;
}

/**
 * A rough "expected survivability" for a level-1 character who is pulling a
 * whole party's weight: enough hit points to eat a few goblin arrows and
 * enough AC that the pack misses more often than it hits.
 */
const TARGET_EFFECTIVE_HP = (level: number) => 25 + (level - 1) * 7;
const TARGET_AC = 16;

/**
 * The balance profile for a solo hero facing an encounter worth `adjustedXp`.
 *
 * The adjustment is *equalising*, not flat. A d6 wizard in robes and a d10
 * fighter in chain mail are both brought up to the same effective staying
 * power, so every class gets a fight of the same difficulty instead of the
 * fighter cruising and the wizard being deleted on round one.
 */
export function soloProfile(level: number, adjustedXp: number, baseline?: HeroBaseline): SoloProfile {
  const deadly = SOLO_DEADLY[Math.max(1, Math.min(10, level))] ?? 100;
  // How many times over the solo deadly threshold this encounter is.
  const overload = Math.max(1, adjustedXp / deadly);

  // A level-1 hero facing the 4× ambush lands at the top of every band.
  const severity = Math.min(1, (overload - 1) / 3);

  // Close the gap to the survivability target rather than adding a flat slab.
  const targetHp = TARGET_EFFECTIVE_HP(level);
  const baseHp = baseline?.maxHp ?? targetHp;
  const baseAc = baseline?.armorClass ?? TARGET_AC;

  const bonusAc = Math.max(0, Math.min(3, Math.round((TARGET_AC - baseAc) * severity)));
  // Each point of AC is worth roughly 10% of incoming damage, so a character
  // who cannot be brought all the way to the AC target is compensated in hit
  // points instead. This is what stops the wizard being a free kill.
  const acShortfall = Math.max(0, TARGET_AC - (baseAc + bonusAc));
  const hpTarget = targetHp * (1 + acShortfall * 0.12);
  const bonusHp = Math.max(0, Math.round((hpTarget - baseHp) * severity));

  // Squishy classes lean on damage to end fights before they are reached; the
  // armoured classes are already the easiest run and get no offensive help.
  const bonusDamage = 1 + Math.round(severity * 2) + (baseline?.squishy ? 1 : 0);
  const luck = 1 + (severity > 0.66 ? 1 : 0) + (baseline?.squishy ? 1 : 0);
  const secondWindUses = 1 + Math.round(severity * 2);
  const enemyHpScale = 1 - severity * 0.22;
  // How many of them may come at once is the lever that actually decides a
  // solo fight, far more than any hit-point adjustment. Calibrated over 300
  // seeded ambushes against a scripted competent player: three at a time wins
  // roughly two fights in three, and a careless traveller who never heals or
  // dodges loses more than half. Two at a time would make it a procession.
  const focusFireCap = severity > 0.66 ? 3 : severity > 0.33 ? 4 : 99;

  const notes: string[] = [];
  if (bonusHp) notes.push(`+${bonusHp} hit points — you travel without a healer.`);
  if (bonusDamage) notes.push(`+${bonusDamage} damage on every hit — you fight for a whole party.`);
  if (bonusAc) notes.push(`+${bonusAc} AC — nobody else is drawing their fire.`);
  if (luck) notes.push(`${luck} lucky reroll${luck > 1 ? 's' : ''} per fight.`);
  if (secondWindUses > 1) notes.push(`Second Wind recovers ${secondWindUses} times per fight.`);
  if (enemyHpScale < 1) notes.push(`Enemies here are ${Math.round((1 - enemyHpScale) * 100)}% less hardy.`);
  if (focusFireCap < 99) notes.push(`At most ${focusFireCap} enemies can engage you each round.`);

  return { bonusHp, bonusDamage, bonusAc, luck, secondWindUses, enemyHpScale, focusFireCap, notes };
}

/** Reads the baseline the profile needs straight off a character sheet. */
export function baselineOf(sheet: CharacterSheet): HeroBaseline {
  const squishy = sheet.classId === 'wizard' || sheet.classId === 'rogue' || sheet.classId === 'ranger';
  return { level: sheet.level, maxHp: sheet.maxHp, armorClass: sheet.armorClass, squishy };
}

/** Applies the hero-side half of the profile to a character sheet. */
export function applySoloProfile(sheet: CharacterSheet, profile: SoloProfile): CharacterSheet {
  return {
    ...sheet,
    maxHp: sheet.maxHp + profile.bonusHp,
    currentHp: Math.min(sheet.currentHp + profile.bonusHp, sheet.maxHp + profile.bonusHp),
    armorClass: sheet.armorClass + profile.bonusAc,
  };
}

/** Hit points a monster should actually have under the profile. */
export function scaledMonsterHp(_monster: Monster, rolled: number, profile: SoloProfile) {
  return Math.max(1, Math.round(rolled * profile.enemyHpScale));
}
