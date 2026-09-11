import fighterJson from '../data/classes/fighter.json';
import humanJson from '../data/species/human.json';
import soldierJson from '../data/backgrounds/soldier.json';
import featsJson from '../data/feats/origin-feats.json';
import weaponsJson from '../data/equipment/weapons.json';
import armourJson from '../data/equipment/armour.json';
import packsJson from '../data/equipment/packs.json';
import { cryptoRandomInt } from '../systems/dice/DiceResultResolver';

/** XPHB 2024 Fighter/Human/Soldier level-1 rules, video-game-ified. No tabletop look-ups at runtime. */

export type AbilityKey = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';
export const ABILITY_KEYS: AbilityKey[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
export const ABILITY_NAMES: Record<AbilityKey, string> = {
  STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma',
};

export interface AbilityScore { base: number; backgroundBonus: 0 | 1 | 2; racialBonus: 0; total: number; modifier: number }
export type AbilityScores = Record<AbilityKey, AbilityScore>;

export interface CharacterCondition {
  name: string; effect: string; value: number; expiresEpochMin: number; persistsThroughRest?: boolean;
}

export type FightingStyleId = 'defense' | 'dueling' | 'great_weapon' | 'two_weapon';
export type OriginFeatId = 'alert' | 'tough' | 'savage_attacker';

export interface PlayerCharacter {
  name: string; species: 'Human'; class: 'Fighter'; level: 1; background: 'Soldier';
  abilityScores: AbilityScores;
  hp: { max: number; current: number };
  hitDice: { max: number; current: number; die: 10 };
  ac: number; speed: 30; proficiencyBonus: 2;
  proficiencies: {
    armour: string[]; weapons: string[]; savingThrows: ['STR', 'CON'];
    skills: string[]; tools: string[]; languages: string[];
  };
  fightingStyle: FightingStyleId;
  features: {
    secondWind: { usesMax: 1; usesCurrent: number; healDie: 10; healBonus: 1 };
    heroicInspiration: { available: boolean };
  };
  originFeat: OriginFeatId; backgroundFeat: 'savage_attacker';
  equipment: {
    mainHand: string; offHand: string | null; ranged: 'longbow';
    ammo: { arrows: number }; armour: 'chain_mail'; pack: 'explorer'; gold: number;
  };
  personality: { trait: string; ideal: string; bond: string; flaw: string };
  portrait: { preset: string; faceTexture: string; hairMesh: string };
  conditions: CharacterCondition[];
  lastLongRestEpochMin: number | null;
  campfireSeen: boolean;
  alertForFutureCombat: boolean | null;
}

// --- Typed content (validated shapes of the JSON data files) ---

export interface SkillDef { id: string; name: string; ability: AbilityKey; pitch: string }
export interface FightingStyleDef { id: FightingStyleId; name: string; pitch: string; icon: string }
export interface FeatDef { id: OriginFeatId; name: string; tagline: string; detail: string; icon: string; recommend: string | null }
export interface WeaponDef {
  id: string; name: string; slot: string; damageDie: string | null; properties: string[];
  socket: string; animSet: string; icon: string; pitch: string;
  paint?: { blade?: string; length?: number; guard?: string; grip?: string };
  /** Albedo texture for the Phase-B skeletal mesh (painted sprite fallback until then). */
  texture?: string;
  /** Hand-socket local offset for the Phase-B mesh, in metres [x, y, z]. */
  socketOffset?: [number, number, number];
}
export interface PortraitPreset {
  id: string; label: string; skin: string; hairColor: string;
  hairStyle: 'short' | 'long' | 'braid'; helm: boolean;
  /** Base body the preset is built on (female reads ~3cm shorter). */
  sex: 'male' | 'female';
  /** Front-facing face texture under /textures/character/. */
  faceTexture: string;
}

const fighter = fighterJson as unknown as {
  skillChoices: { count: number; options: SkillDef[] };
  fightingStyles: FightingStyleDef[];
  secondWind: { usesMax: number; healDie: number; healBonus: number; pitch: string };
  equipment: { primary: string[]; offhand: string[]; ranged: string; arrows: number; armour: string; pack: string };
  proficiencies: { armour: string[]; weapons: string[]; savingThrows: string[] };
  flavour: string; title: string;
};
const human = humanJson as unknown as {
  abilityRanks: { score: number; rank: string }[];
  abilityGuidance: Record<AbilityKey, string>;
  recommendedBuild: Record<AbilityKey, number> & { rationale: string };
  languages: { fixed: string[]; choices: string[]; recommended: string; recommendReason: string };
  pointBuy: { points: number; min: number; max: number };
  speed: number;
};
const soldier = soldierJson as unknown as {
  abilityIncreases: { plusTwoFrom: AbilityKey[]; plusOneFrom: AbilityKey[]; recommended: { plusTwo: AbilityKey; plusOne: AbilityKey } };
  skills: string[]; tools: string[]; toolNote: string; gold: number; feat: string;
  personality: { traits: string[]; ideals: string[]; bonds: string[]; flaws: string[] };
  flavour: string; title: string;
};
const feats = (featsJson as unknown as { feats: FeatDef[] }).feats;
const weapons = (weaponsJson as unknown as { weapons: WeaponDef[] }).weapons;

export const FIGHTER = fighter;
export const HUMAN = human;
export const SOLDIER = soldier;
export const ORIGIN_FEATS = feats;
export const WEAPONS = weapons;
export const ARMOUR_AC = (armourJson as unknown as { armour: { id: string; ac: number; stealthDisadvantage: boolean }[] }).armour;
export const PACKS = (packsJson as unknown as { packs: { id: string; name: string; contents: { name: string; icon: string }[] }[] }).packs;

export const SUGGESTED_NAMES = ['Aldric', 'Maren', 'Theron', 'Sylva', 'Kael'];
export const SKILL_IDS = fighter.skillChoices.options.map(s => s.id);
export const skillDef = (id: string): SkillDef | undefined => fighter.skillChoices.options.find(s => s.id === id);
export const weaponDef = (id: string): WeaponDef | undefined => weapons.find(w => w.id === id);
export const featDef = (id: string): FeatDef | undefined => feats.find(f => f.id === id);

export const PORTRAITS: PortraitPreset[] = [
  { id: 'male_01', label: 'Aldric — weathered', skin: '#d9b38c', hairColor: '#4a3524', hairStyle: 'short', helm: true, sex: 'male', faceTexture: '/textures/character/face_m01.png' },
  { id: 'male_02', label: 'Bram — scarred', skin: '#c99a72', hairColor: '#1f1a14', hairStyle: 'short', helm: false, sex: 'male', faceTexture: '/textures/character/face_m02.png' },
  { id: 'male_03', label: 'Cedric — fair', skin: '#e8c39a', hairColor: '#8a6a3a', hairStyle: 'short', helm: true, sex: 'male', faceTexture: '/textures/character/face_m03.png' },
  { id: 'female_01', label: 'Maren — keen', skin: '#d9b38c', hairColor: '#5c3a22', hairStyle: 'braid', helm: false, sex: 'female', faceTexture: '/textures/character/face_f01.png' },
  { id: 'female_02', label: 'Sylva — silver', skin: '#e3bfa0', hairColor: '#b9b2a4', hairStyle: 'long', helm: false, sex: 'female', faceTexture: '/textures/character/face_f02.png' },
  { id: 'female_03', label: 'Ysolde — bold', skin: '#a9744f', hairColor: '#14100c', hairStyle: 'braid', helm: true, sex: 'female', faceTexture: '/textures/character/face_f03.png' },
];
export const portraitDef = (id: string): PortraitPreset => PORTRAITS.find(p => p.id === id) ?? PORTRAITS[0];

// --- Derivations (pure, unit-tested) ---

export const abilityModifier = (total: number): number => Math.floor((total - 10) / 2);

/** Point-buy cost to reach `score` from 8 (spec table: every step 1, except 14→15 costs 2). */
export function pointBuyCost(score: number): number {
  if (score <= 8) return 0;
  if (score <= 14) return score - 8;
  return 8;
}
export function pointsSpent(bases: Record<AbilityKey, number>): number {
  return ABILITY_KEYS.reduce((n, k) => n + pointBuyCost(bases[k]), 0);
}
export function rankFor(score: number): string {
  const ranks = [...human.abilityRanks].sort((a, b) => a.score - b.score);
  let rank = ranks[0].rank;
  for (const r of ranks) if (score >= r.score) rank = r.rank;
  return rank;
}
export function buildScores(bases: Record<AbilityKey, number>, plusTwo: AbilityKey | null, plusOne: AbilityKey | null): AbilityScores {
  const out = {} as AbilityScores;
  for (const k of ABILITY_KEYS) {
    const backgroundBonus = (k === plusTwo ? 2 : 0) + (k === plusOne ? 1 : 0);
    // Humans carry no racial ASI in XPHB 2024; the slot stays explicit for saves/Phase B.
    const racialBonus = 0;
    const total = bases[k] + backgroundBonus + racialBonus;
    out[k] = { base: bases[k], backgroundBonus: backgroundBonus as 0 | 1 | 2, racialBonus, total, modifier: abilityModifier(total) };
  }
  return out;
}
export function maxHPFor(scores: AbilityScores, originFeat: OriginFeatId): number {
  return 10 + scores.CON.modifier + (originFeat === 'tough' ? 2 : 0);
}
export function acFor(offHand: string | null, style: FightingStyleId): number {
  return 16 + (offHand === 'shield' ? 2 : 0) + (style === 'defense' ? 1 : 0);
}
export function skillModifier(c: PlayerCharacter, skillId: string): number {
  const def = skillDef(skillId);
  const abilityMod = def ? c.abilityScores[def.ability].modifier : 0;
  const proficient = c.proficiencies.skills.includes(skillId);
  let total = abilityMod + (proficient ? c.proficiencyBonus : 0);
  for (const cond of c.conditions) {
    if (cond.effect === 'perception_penalty' && skillId === 'perception') total += cond.value;
  }
  return total;
}

// --- Creation draft ---

export interface CharacterDraft {
  name: string;
  classSkills: string[];
  fightingStyle: FightingStyleId | null;
  mainHand: string;
  offHand: string | null;
  bases: Record<AbilityKey, number>;
  language: string | null;
  skillful: string | null;
  originFeat: OriginFeatId | null;
  plusTwo: AbilityKey | null;
  plusOne: AbilityKey | null;
  trait: string; ideal: string; bond: string; flaw: string;
  portrait: string;
}

export function newDraft(): CharacterDraft {
  return {
    name: '', classSkills: [], fightingStyle: null, mainHand: 'longsword', offHand: 'shield',
    bases: { STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 },
    language: null, skillful: null, originFeat: null, plusTwo: null, plusOne: null,
    trait: soldier.personality.traits[0], ideal: soldier.personality.ideals[0],
    bond: soldier.personality.bonds[0], flaw: soldier.personality.flaws[0],
    portrait: 'male_01',
  };
}

/** One-tap recommended hero (also used by automated smoke tests). */
export function recommendedDraft(name = 'Aldric'): CharacterDraft {
  const b = human.recommendedBuild;
  return {
    name,
    classSkills: ['perception', 'survival'],
    fightingStyle: 'defense',
    mainHand: 'longsword', offHand: 'shield',
    bases: { STR: b.STR, DEX: b.DEX, CON: b.CON, INT: b.INT, WIS: b.WIS, CHA: b.CHA },
    language: 'Goblin', skillful: 'insight', originFeat: 'tough',
    plusTwo: 'STR', plusOne: 'CON',
    trait: soldier.personality.traits[0], ideal: soldier.personality.ideals[2],
    bond: soldier.personality.bonds[2], flaw: soldier.personality.flaws[0],
    portrait: 'male_01',
  };
}

export function randomPersonality(d: CharacterDraft): void {
  const p = soldier.personality;
  d.trait = p.traits[cryptoRandomInt(0, p.traits.length - 1)];
  d.ideal = p.ideals[cryptoRandomInt(0, p.ideals.length - 1)];
  d.bond = p.bonds[cryptoRandomInt(0, p.bonds.length - 1)];
  d.flaw = p.flaws[cryptoRandomInt(0, p.flaws.length - 1)];
}

export const classDone = (d: CharacterDraft): boolean =>
  d.classSkills.length === 2 && d.fightingStyle !== null && d.mainHand !== '' && d.offHand !== null;
export const speciesDone = (d: CharacterDraft): boolean =>
  d.language !== null && d.skillful !== null && d.originFeat !== null;
export const backgroundDone = (d: CharacterDraft): boolean =>
  d.plusTwo !== null && d.plusOne !== null && d.plusTwo !== d.plusOne;
export const nameDone = (d: CharacterDraft): boolean => d.name.trim().length >= 2;
export const draftComplete = (d: CharacterDraft): boolean =>
  classDone(d) && speciesDone(d) && backgroundDone(d) && nameDone(d) && d.originFeat !== 'savage_attacker';

export function draftToCharacter(d: CharacterDraft): PlayerCharacter {
  const scores = buildScores(d.bases, d.plusTwo, d.plusOne);
  const originFeat = d.originFeat ?? 'tough';
  const max = Math.max(1, maxHPFor(scores, originFeat));
  const skills = [...soldier.skills, ...d.classSkills, ...(d.skillful ? [d.skillful] : [])];
  const portrait = portraitDef(d.portrait);
  return {
    name: d.name.trim(), species: 'Human', class: 'Fighter', level: 1, background: 'Soldier',
    abilityScores: scores,
    hp: { max, current: max },
    hitDice: { max: 1, current: 1, die: 10 },
    ac: acFor(d.offHand, d.fightingStyle ?? 'defense'),
    speed: 30, proficiencyBonus: 2,
    proficiencies: {
      armour: [...fighter.proficiencies.armour],
      weapons: [...fighter.proficiencies.weapons],
      savingThrows: ['STR', 'CON'],
      skills: [...new Set(skills)],
      tools: [...soldier.tools],
      languages: [...human.languages.fixed, d.language ?? 'Goblin'],
    },
    fightingStyle: d.fightingStyle ?? 'defense',
    features: {
      secondWind: { usesMax: 1, usesCurrent: 1, healDie: 10, healBonus: 1 },
      heroicInspiration: { available: true },
    },
    originFeat, backgroundFeat: 'savage_attacker',
    equipment: {
      mainHand: d.mainHand, offHand: d.offHand, ranged: 'longbow',
      ammo: { arrows: fighter.equipment.arrows }, armour: 'chain_mail', pack: 'explorer', gold: soldier.gold,
    },
    personality: { trait: d.trait, ideal: d.ideal, bond: d.bond, flaw: d.flaw },
    portrait: { preset: portrait.id, faceTexture: portrait.faceTexture, hairMesh: portrait.hairStyle },
    conditions: [], lastLongRestEpochMin: null, campfireSeen: false, alertForFutureCombat: null,
  };
}

export function defaultCharacter(): PlayerCharacter {
  return draftToCharacter(recommendedDraft());
}

// --- Validation (for saves; tolerant of older shapes) ---

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validateCharacter(v: unknown): v is PlayerCharacter {
  if (!isRecord(v)) return false;
  if (typeof v.name !== 'string' || v.name.length < 1 || v.name.length > 32) return false;
  if (v.species !== 'Human' || v.class !== 'Fighter' || v.level !== 1 || v.background !== 'Soldier') return false;
  if (!isRecord(v.abilityScores)) return false;
  for (const k of ABILITY_KEYS) {
    const s = v.abilityScores[k];
    if (!isRecord(s)) return false;
    if (typeof s.base !== 'number' || s.base < 8 || s.base > 15) return false;
    if (typeof s.total !== 'number' || typeof s.modifier !== 'number') return false;
  }
  if (!isRecord(v.hp) || typeof v.hp.max !== 'number' || typeof v.hp.current !== 'number') return false;
  if (v.hp.max < 1 || v.hp.max > 40 || v.hp.current < 0 || v.hp.current > v.hp.max) return false;
  if (!isRecord(v.hitDice) || v.hitDice.die !== 10) return false;
  if (typeof v.ac !== 'number' || v.ac < 10 || v.ac > 25) return false;
  if (!isRecord(v.proficiencies) || !Array.isArray(v.proficiencies.skills)) return false;
  if (!isRecord(v.features) || !isRecord(v.features.secondWind) || !isRecord(v.features.heroicInspiration)) return false;
  if (!['alert', 'tough', 'savage_attacker'].includes(v.originFeat as string)) return false;
  if (!isRecord(v.equipment) || typeof v.equipment.mainHand !== 'string') return false;
  if (!isRecord(v.personality) || !isRecord(v.portrait)) return false;
  if (!Array.isArray(v.conditions)) return false;
  if (v.lastLongRestEpochMin !== null && typeof v.lastLongRestEpochMin !== 'number') return false;
  return true;
}
