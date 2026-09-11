import { portraitDef, type CharacterDraft, type PlayerCharacter } from '../game/character';
import type { WeaponId } from './skeletal/HeroWeapons';
import type { WeaponSet } from './CharacterModel';

/** Everything the skeletal hero needs to dress: preset + socketed weapons. */
export interface HeroLoadout {
  preset: string;
  mainHand: WeaponId;
  offHand: WeaponId | null;
}

const WEAPON_IDS: ReadonlySet<string> = new Set([
  'longsword', 'battleaxe', 'warhammer', 'shortsword', 'longbow', 'quiver', 'shield',
]);

function asWeaponId(id: string, fallback: WeaponId): WeaponId {
  return (WEAPON_IDS.has(id) ? id : fallback) as WeaponId;
}

function asOffHand(id: string | null): WeaponId | null {
  if (id === 'shield' || id === 'shortsword') return id;
  return null;
}

export function loadoutFromCharacter(c: PlayerCharacter): HeroLoadout {
  return {
    preset: portraitDef(c.portrait.preset).id,
    mainHand: asWeaponId(c.equipment.mainHand, 'longsword'),
    offHand: asOffHand(c.equipment.offHand),
  };
}

export function loadoutFromDraft(d: CharacterDraft): HeroLoadout {
  return {
    preset: portraitDef(d.portrait).id,
    mainHand: asWeaponId(d.mainHand, 'longsword'),
    offHand: asOffHand(d.offHand),
  };
}

export function weaponSetFor(mainHand: string, offHand: string | null): WeaponSet {
  if (offHand === 'shortsword') return 'dual';
  if (offHand === 'shield') return 'sword_shield';
  if (mainHand === 'longbow') return 'bow';
  return 'sword_shield';
}

/** Owns loadout synchronisation: character/draft → socketed hero + anim-set switch. */
export class EquipmentManager {
  private key = '';
  private loadout: HeroLoadout | null = null;
  onChange: (loadout: HeroLoadout, weaponSet: WeaponSet) => void = () => {};

  syncFromCharacter(c: PlayerCharacter): void {
    this.apply(loadoutFromCharacter(c));
  }

  syncFromDraft(d: CharacterDraft): void {
    this.apply(loadoutFromDraft(d));
  }

  private apply(loadout: HeroLoadout): void {
    const key = `${loadout.preset}|${loadout.mainHand}|${loadout.offHand ?? '-'}`;
    if (key === this.key) return;
    this.key = key;
    this.loadout = loadout;
    this.onChange(loadout, weaponSetFor(loadout.mainHand, loadout.offHand));
  }

  get current(): HeroLoadout | null {
    return this.loadout;
  }
}
