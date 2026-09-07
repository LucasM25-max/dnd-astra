/**
 * Weapon, armour and pack data, structured from the Player's Handbook
 * equipment chapter. Values are stored as data so the rules kernel can reason
 * about them; all display prose is original.
 */
import type { Ability } from './rules';

export type DamageType =
  | 'bludgeoning' | 'piercing' | 'slashing'
  | 'acid' | 'cold' | 'fire' | 'force' | 'lightning' | 'necrotic' | 'poison' | 'psychic' | 'radiant' | 'thunder';

export type WeaponProperty = 'finesse' | 'heavy' | 'light' | 'loading' | 'reach' | 'thrown' | 'twoHanded' | 'versatile' | 'ammunition';
export type WeaponCategory = 'simpleMelee' | 'simpleRanged' | 'martialMelee' | 'martialRanged';

export interface Weapon {
  id: string;
  name: string;
  category: WeaponCategory;
  damage: string;
  versatileDamage?: string;
  damageType: DamageType;
  properties: WeaponProperty[];
  /** Feet. Melee weapons use `reach`; ranged use normal/long. */
  reach?: number;
  range?: { normal: number; long: number };
  weight: number;
  /** Copper pieces, to keep money in exact integers. */
  cost: number;
}

export const WEAPONS: Record<string, Weapon> = {
  club: { id: 'club', name: 'Club', category: 'simpleMelee', damage: '1d4', damageType: 'bludgeoning', properties: ['light'], reach: 5, weight: 2, cost: 10 },
  dagger: { id: 'dagger', name: 'Dagger', category: 'simpleMelee', damage: '1d4', damageType: 'piercing', properties: ['finesse', 'light', 'thrown'], reach: 5, range: { normal: 20, long: 60 }, weight: 1, cost: 200 },
  handaxe: { id: 'handaxe', name: 'Handaxe', category: 'simpleMelee', damage: '1d6', damageType: 'slashing', properties: ['light', 'thrown'], reach: 5, range: { normal: 20, long: 60 }, weight: 2, cost: 500 },
  mace: { id: 'mace', name: 'Mace', category: 'simpleMelee', damage: '1d6', damageType: 'bludgeoning', properties: [], reach: 5, weight: 4, cost: 500 },
  quarterstaff: { id: 'quarterstaff', name: 'Quarterstaff', category: 'simpleMelee', damage: '1d6', versatileDamage: '1d8', damageType: 'bludgeoning', properties: ['versatile'], reach: 5, weight: 4, cost: 20 },
  spear: { id: 'spear', name: 'Spear', category: 'simpleMelee', damage: '1d6', versatileDamage: '1d8', damageType: 'piercing', properties: ['thrown', 'versatile'], reach: 5, range: { normal: 20, long: 60 }, weight: 3, cost: 100 },
  lightCrossbow: { id: 'lightCrossbow', name: 'Light crossbow', category: 'simpleRanged', damage: '1d8', damageType: 'piercing', properties: ['ammunition', 'loading', 'twoHanded'], range: { normal: 80, long: 320 }, weight: 5, cost: 2500 },
  shortbow: { id: 'shortbow', name: 'Shortbow', category: 'simpleRanged', damage: '1d6', damageType: 'piercing', properties: ['ammunition', 'twoHanded'], range: { normal: 80, long: 320 }, weight: 2, cost: 2500 },
  longsword: { id: 'longsword', name: 'Longsword', category: 'martialMelee', damage: '1d8', versatileDamage: '1d10', damageType: 'slashing', properties: ['versatile'], reach: 5, weight: 3, cost: 1500 },
  greatsword: { id: 'greatsword', name: 'Greatsword', category: 'martialMelee', damage: '2d6', damageType: 'slashing', properties: ['heavy', 'twoHanded'], reach: 5, weight: 6, cost: 5000 },
  battleaxe: { id: 'battleaxe', name: 'Battleaxe', category: 'martialMelee', damage: '1d8', versatileDamage: '1d10', damageType: 'slashing', properties: ['versatile'], reach: 5, weight: 4, cost: 1000 },
  rapier: { id: 'rapier', name: 'Rapier', category: 'martialMelee', damage: '1d8', damageType: 'piercing', properties: ['finesse'], reach: 5, weight: 2, cost: 2500 },
  shortsword: { id: 'shortsword', name: 'Shortsword', category: 'martialMelee', damage: '1d6', damageType: 'piercing', properties: ['finesse', 'light'], reach: 5, weight: 2, cost: 1000 },
  scimitar: { id: 'scimitar', name: 'Scimitar', category: 'martialMelee', damage: '1d6', damageType: 'slashing', properties: ['finesse', 'light'], reach: 5, weight: 3, cost: 2500 },
  longbow: { id: 'longbow', name: 'Longbow', category: 'martialRanged', damage: '1d8', damageType: 'piercing', properties: ['ammunition', 'heavy', 'twoHanded'], range: { normal: 150, long: 600 }, weight: 2, cost: 5000 },
  unarmed: { id: 'unarmed', name: 'Unarmed strike', category: 'simpleMelee', damage: '1', damageType: 'bludgeoning', properties: [], reach: 5, weight: 0, cost: 0 },
};

export type ArmorCategory = 'light' | 'medium' | 'heavy' | 'shield';
export interface Armor {
  id: string; name: string; category: ArmorCategory; baseAc: number;
  /** Medium armour caps the Dexterity bonus; heavy armour ignores it. */
  dexCap?: number; addsDex: boolean;
  strengthRequirement?: number; stealthDisadvantage?: boolean; weight: number; cost: number;
}

export const ARMOR: Record<string, Armor> = {
  padded: { id: 'padded', name: 'Padded armour', category: 'light', baseAc: 11, addsDex: true, stealthDisadvantage: true, weight: 8, cost: 500 },
  leather: { id: 'leather', name: 'Leather armour', category: 'light', baseAc: 11, addsDex: true, weight: 10, cost: 1000 },
  studdedLeather: { id: 'studdedLeather', name: 'Studded leather', category: 'light', baseAc: 12, addsDex: true, weight: 13, cost: 4500 },
  hide: { id: 'hide', name: 'Hide armour', category: 'medium', baseAc: 12, dexCap: 2, addsDex: true, weight: 12, cost: 1000 },
  chainShirt: { id: 'chainShirt', name: 'Chain shirt', category: 'medium', baseAc: 13, dexCap: 2, addsDex: true, weight: 20, cost: 5000 },
  scaleMail: { id: 'scaleMail', name: 'Scale mail', category: 'medium', baseAc: 14, dexCap: 2, addsDex: true, stealthDisadvantage: true, weight: 45, cost: 5000 },
  breastplate: { id: 'breastplate', name: 'Breastplate', category: 'medium', baseAc: 14, dexCap: 2, addsDex: true, weight: 20, cost: 40000 },
  ringMail: { id: 'ringMail', name: 'Ring mail', category: 'heavy', baseAc: 14, addsDex: false, stealthDisadvantage: true, weight: 40, cost: 3000 },
  chainMail: { id: 'chainMail', name: 'Chain mail', category: 'heavy', baseAc: 16, addsDex: false, strengthRequirement: 13, stealthDisadvantage: true, weight: 55, cost: 7500 },
  splint: { id: 'splint', name: 'Splint armour', category: 'heavy', baseAc: 17, addsDex: false, strengthRequirement: 15, stealthDisadvantage: true, weight: 60, cost: 20000 },
  shield: { id: 'shield', name: 'Shield', category: 'shield', baseAc: 2, addsDex: false, weight: 6, cost: 1000 },
};

export interface LoadoutSlots {
  mainHand?: string;
  offHand?: string;
  ranged?: string;
  armor?: string;
  shield?: boolean;
}

export interface AcInput { dex: number; loadout: LoadoutSlots; unarmoredBonus?: number }

/**
 * Armour Class per the PHB rules: armour base + a capped Dexterity bonus,
 * plus a shield. Unarmoured is 10 + Dex, with an optional class bonus.
 */
export function armorClassFor({ dex, loadout, unarmoredBonus = 0 }: AcInput) {
  const armor = loadout.armor ? ARMOR[loadout.armor] : undefined;
  let ac: number;
  if (!armor) ac = 10 + dex + unarmoredBonus;
  else if (!armor.addsDex) ac = armor.baseAc;
  else ac = armor.baseAc + Math.min(dex, armor.dexCap ?? Infinity);
  if (loadout.shield) ac += ARMOR.shield.baseAc;
  return ac;
}

/** Whether a weapon may use Dexterity for attack and damage. */
export function usesDexterity(weapon: Weapon, str: number, dex: number) {
  if (weapon.category === 'simpleRanged' || weapon.category === 'martialRanged') return true;
  return weapon.properties.includes('finesse') && dex > str;
}

export const isRanged = (weapon: Weapon) => weapon.category === 'simpleRanged' || weapon.category === 'martialRanged';

/** Effective reach/range in feet for a given weapon. */
export function weaponReach(weapon: Weapon) {
  if (isRanged(weapon)) return weapon.range?.normal ?? 30;
  return weapon.reach ?? 5;
}

/** Long-range attacks are made with disadvantage. */
export function rangePenalty(weapon: Weapon, distanceFeet: number): 'none' | 'disadvantage' | 'outOfRange' {
  if (!isRanged(weapon)) return distanceFeet <= weaponReach(weapon) ? 'none' : 'outOfRange';
  const range = weapon.range!;
  if (distanceFeet <= range.normal) return 'none';
  if (distanceFeet <= range.long) return 'disadvantage';
  return 'outOfRange';
}

export const abilityForWeapon = (weapon: Weapon, str: number, dex: number): Ability => (usesDexterity(weapon, str, dex) ? 'dex' : 'str');
