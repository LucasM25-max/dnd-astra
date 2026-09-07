/**
 * Creature stat blocks, structured as data. Numbers follow the monster rules
 * from the licensed Player's Handbook/Monster Manual reference; all flavour
 * text is original.
 */
import type { DamageType } from './equipment';
import type { Ability, Condition, Skill } from './rules';

export interface MonsterAction {
  id: string;
  name: string;
  kind: 'melee' | 'ranged' | 'spell';
  attackBonus: number;
  damage: string;
  damageType: DamageType;
  /** Feet. */
  reach: number;
  longRange?: number;
  save?: Ability;
  saveDc?: number;
  condition?: Condition;
  description: string;
}

export interface MonsterTrait { name: string; text: string }

export interface Monster {
  id: string;
  name: string;
  size: 'tiny' | 'small' | 'medium' | 'large';
  type: string;
  alignment: string;
  armorClass: number;
  armorNote: string;
  hitDice: string;              // e.g. '2d6' — hit points are rolled from this
  averageHp: number;
  speed: number;                // feet per round
  abilities: Record<Ability, number>;
  savingThrows?: Ability[];
  skills?: Partial<Record<Skill, boolean>>;
  senses: string[];
  darkvision?: number;
  languages: string[];
  challenge: number;
  xp: number;
  proficiencyBonus: number;
  traits: MonsterTrait[];
  actions: MonsterAction[];
  resistances?: DamageType[];
  vulnerabilities?: DamageType[];
  immunities?: DamageType[];
  /** Rendering hints for the 3D actor factory. */
  visual: { archetype: 'goblinoid' | 'beast' | 'humanoid'; height: number; skin: string; cloth: string; weapon: 'scimitar' | 'shortbow' | 'club' | 'spear' | 'longsword' };
  description: string;
}

export const MONSTERS: Record<string, Monster> = {
  goblin: {
    id: 'goblin', name: 'Goblin', size: 'small', type: 'humanoid (goblinoid)', alignment: 'neutral evil',
    armorClass: 15, armorNote: 'leather armour, shield', hitDice: '2d6', averageHp: 7, speed: 30,
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    skills: { stealth: true }, senses: ['Darkvision 60 ft.'], darkvision: 60,
    languages: ['Common', 'Goblin'], challenge: 0.25, xp: 50, proficiencyBonus: 2,
    traits: [{ name: 'Nimble Escape', text: 'The goblin can Disengage or Hide as a bonus action on each of its turns.' }],
    actions: [
      { id: 'scimitar', name: 'Scimitar', kind: 'melee', attackBonus: 4, damage: '1d6+2', damageType: 'slashing', reach: 5, description: 'A short curved blade, kept keen and swung low.' },
      { id: 'shortbow', name: 'Shortbow', kind: 'ranged', attackBonus: 4, damage: '1d6+2', damageType: 'piercing', reach: 80, longRange: 320, description: 'A crude but effective bow drawn from cover.' },
    ],
    visual: { archetype: 'goblinoid', height: 1.2, skin: '#7d8a5a', cloth: '#5b4632', weapon: 'scimitar' },
    description: 'Small, quick and vicious in numbers. Goblins fight from cover and scatter the moment a fight turns.',
  },
  goblinArcher: {
    id: 'goblinArcher', name: 'Goblin archer', size: 'small', type: 'humanoid (goblinoid)', alignment: 'neutral evil',
    armorClass: 13, armorNote: 'leather armour', hitDice: '2d6', averageHp: 7, speed: 30,
    abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
    skills: { stealth: true }, senses: ['Darkvision 60 ft.'], darkvision: 60,
    languages: ['Common', 'Goblin'], challenge: 0.25, xp: 50, proficiencyBonus: 2,
    traits: [{ name: 'Nimble Escape', text: 'The goblin can Disengage or Hide as a bonus action on each of its turns.' }],
    actions: [
      { id: 'shortbow', name: 'Shortbow', kind: 'ranged', attackBonus: 4, damage: '1d6+2', damageType: 'piercing', reach: 80, longRange: 320, description: 'Black-fletched arrows loosed from the undergrowth.' },
      { id: 'dagger', name: 'Dagger', kind: 'melee', attackBonus: 4, damage: '1d4+2', damageType: 'piercing', reach: 5, description: 'A last resort when something reaches the treeline.' },
    ],
    visual: { archetype: 'goblinoid', height: 1.16, skin: '#6f8455', cloth: '#4a4130', weapon: 'shortbow' },
    description: 'The goblins who set the ambush shoot first and only draw steel when cornered.',
  },
  goblinBoss: {
    id: 'goblinBoss', name: 'Goblin boss', size: 'small', type: 'humanoid (goblinoid)', alignment: 'neutral evil',
    armorClass: 17, armorNote: 'chain shirt, shield', hitDice: '6d6', averageHp: 21, speed: 30,
    abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 8, cha: 10 },
    skills: { stealth: true }, senses: ['Darkvision 60 ft.'], darkvision: 60,
    languages: ['Common', 'Goblin'], challenge: 1, xp: 200, proficiencyBonus: 2,
    traits: [
      { name: 'Nimble Escape', text: 'The boss can Disengage or Hide as a bonus action on each of its turns.' },
      { name: 'Redirect Attack', text: 'When a creature the boss can see targets it with an attack, it can swap places with an adjacent goblin and make that goblin the target instead.' },
    ],
    actions: [
      { id: 'scimitar', name: 'Scimitar', kind: 'melee', attackBonus: 4, damage: '1d6+2', damageType: 'slashing', reach: 5, description: 'A looted blade with a wrapped grip, used twice a turn.' },
      { id: 'javelin', name: 'Javelin', kind: 'ranged', attackBonus: 4, damage: '1d6+2', damageType: 'piercing', reach: 30, longRange: 120, description: 'A thrown shaft, hurled while shouting orders.' },
    ],
    visual: { archetype: 'goblinoid', height: 1.34, skin: '#86915c', cloth: '#6b2f28', weapon: 'scimitar' },
    description: 'Louder, better armed and far more dangerous. The boss keeps the others in the fight.',
  },
  wolf: {
    id: 'wolf', name: 'Wolf', size: 'medium', type: 'beast', alignment: 'unaligned',
    armorClass: 13, armorNote: 'natural armour', hitDice: '2d8+2', averageHp: 11, speed: 40,
    abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    skills: { perception: true, stealth: true }, senses: ['Keen hearing and smell'],
    languages: [], challenge: 0.25, xp: 50, proficiencyBonus: 2,
    traits: [
      { name: 'Keen Hearing and Smell', text: 'Advantage on Perception checks that rely on hearing or scent.' },
      { name: 'Pack Tactics', text: 'Advantage on an attack roll when an ally of the wolf is within five feet of the target.' },
    ],
    actions: [
      { id: 'bite', name: 'Bite', kind: 'melee', attackBonus: 4, damage: '2d4+2', damageType: 'piercing', reach: 5, save: 'str', saveDc: 11, condition: 'prone', description: 'A lunge at the legs; a failed Strength save puts the target on the ground.' },
    ],
    visual: { archetype: 'beast', height: 0.85, skin: '#6b6255', cloth: '#5a5248', weapon: 'club' },
    description: 'Lean, grey and patient. Wolves circle until one of them can take you from the side.',
  },
  bugbear: {
    id: 'bugbear', name: 'Bugbear', size: 'medium', type: 'humanoid (goblinoid)', alignment: 'chaotic evil',
    armorClass: 16, armorNote: 'hide armour, shield', hitDice: '5d8+5', averageHp: 27, speed: 30,
    abilities: { str: 15, dex: 14, con: 13, int: 8, wis: 11, cha: 9 },
    skills: { stealth: true, survival: true }, senses: ['Darkvision 60 ft.'], darkvision: 60,
    languages: ['Common', 'Goblin'], challenge: 1, xp: 200, proficiencyBonus: 2,
    traits: [
      { name: 'Brute', text: 'A melee weapon deals one extra die of damage when the bugbear hits with it.' },
      { name: 'Surprise Attack', text: 'A surprised target takes an extra 2d6 damage from the bugbear\u2019s first hit.' },
    ],
    actions: [
      { id: 'morningstar', name: 'Morningstar', kind: 'melee', attackBonus: 4, damage: '2d8+2', damageType: 'piercing', reach: 10, description: 'A heavy spiked head swung on long arms.' },
      { id: 'javelin', name: 'Javelin', kind: 'ranged', attackBonus: 4, damage: '2d6+2', damageType: 'piercing', reach: 30, longRange: 120, description: 'A thrown shaft with brutal weight behind it.' },
    ],
    visual: { archetype: 'goblinoid', height: 1.95, skin: '#8a7a52', cloth: '#4c3b2a', weapon: 'club' },
    description: 'A head taller than a man and twice as quiet. Bugbears open a fight from ambush and rarely need a second swing.',
  },
};

export const MONSTER_IDS = Object.keys(MONSTERS);

/** Encounter XP thresholds so an encounter can be graded before it is run. */
export const XP_THRESHOLDS: Record<number, { easy: number; medium: number; hard: number; deadly: number }> = {
  1: { easy: 25, medium: 50, hard: 75, deadly: 100 },
  2: { easy: 50, medium: 100, hard: 150, deadly: 200 },
  3: { easy: 75, medium: 150, hard: 225, deadly: 400 },
  4: { easy: 125, medium: 250, hard: 375, deadly: 500 },
  5: { easy: 250, medium: 500, hard: 750, deadly: 1100 },
  6: { easy: 300, medium: 600, hard: 900, deadly: 1400 },
};

/** Multiple opponents are harder than their raw XP suggests. */
export function encounterMultiplier(count: number) {
  if (count <= 1) return 1;
  if (count === 2) return 1.5;
  if (count <= 6) return 2;
  if (count <= 10) return 2.5;
  if (count <= 14) return 3;
  return 4;
}

export function encounterDifficulty(monsterIds: string[], partyLevel: number, partySize = 1) {
  const xp = monsterIds.reduce((sum, id) => sum + (MONSTERS[id]?.xp ?? 0), 0);
  const adjusted = xp * encounterMultiplier(monsterIds.length);
  const t = XP_THRESHOLDS[Math.max(1, Math.min(6, partyLevel))];
  const scale = Math.max(1, partySize);
  const tier = adjusted >= t.deadly * scale ? 'deadly' : adjusted >= t.hard * scale ? 'hard' : adjusted >= t.medium * scale ? 'medium' : 'easy';
  return { xp, adjusted, tier } as const;
}
