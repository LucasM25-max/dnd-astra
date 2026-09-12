import type { CharacterDraft, PlayerCharacter } from '../game/character';
import type { WeaponId } from './skeletal/HeroWeapons';
import { weaponSetForLoadout } from './skeletal/SkeletalHero';
import type { WeaponSet } from './CharacterModel';

/** Everything the skeletal hero needs to dress: portrait + wielded gear. */
export interface HeroGear {
  preset: string;
  mainHand: WeaponId;
  offHand: WeaponId | null;
}

const asMainHand = (id: string): WeaponId =>
  id === 'battleaxe' || id === 'warhammer' ? id : 'longsword';

const asOffHand = (id: string | null): WeaponId | null =>
  id === 'shield' ? 'shield' : id === 'shortsword' ? 'shortsword' : null;

export function gearFromCharacter(c: PlayerCharacter): HeroGear {
  return {
    preset: c.portrait.preset,
    mainHand: asMainHand(c.equipment.mainHand),
    offHand: asOffHand(c.equipment.offHand),
  };
}

export function gearFromDraft(d: CharacterDraft): HeroGear {
  return { preset: d.portrait, mainHand: asMainHand(d.mainHand), offHand: asOffHand(d.offHand) };
}

export function weaponSetFor(mainHand: string, offHand: string | null): WeaponSet {
  return weaponSetForLoadout(asMainHand(mainHand), asOffHand(offHand));
}

const gearKey = (gear: HeroGear): string => `${gear.preset}|${gear.mainHand}|${gear.offHand ?? '-'}`;

/** Owns gear synchronisation: character/draft → HeroGear → hero re-dress. */
export class EquipmentManager {
  private gear: HeroGear = { preset: 'male_01', mainHand: 'longsword', offHand: 'shield' };
  private key = gearKey(this.gear);
  onChange: (gear: HeroGear, weaponSet: WeaponSet) => void = () => {};

  syncFromCharacter(c: PlayerCharacter): void {
    this.apply(gearFromCharacter(c));
  }

  syncFromDraft(d: CharacterDraft): void {
    this.apply(gearFromDraft(d));
  }

  private apply(gear: HeroGear): void {
    const key = gearKey(gear);
    if (key === this.key) return;
    this.key = key;
    this.gear = gear;
    this.onChange(gear, weaponSetForLoadout(gear.mainHand, gear.offHand));
  }

  get current(): HeroGear {
    return this.gear;
  }
}
