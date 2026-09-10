import { DEFAULT_LOOK, lookKey, type FighterLook } from '../engine/actors/fighter';
import { portraitDef, type CharacterDraft, type PlayerCharacter } from '../game/character';
import type { WeaponSet } from './CharacterModel';

/** Darken a #rrggbb hex colour by `amount` (0..1). */
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(c * (1 - amount))));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function lookFromPortraitAndGear(
  presetId: string, mainHand: string, offHand: string | null, ranged: string,
): FighterLook {
  const p = portraitDef(presetId);
  const main: FighterLook['mainHand'] =
    mainHand === 'longsword' ? 'longsword'
    : mainHand === 'battleaxe' ? 'battleaxe'
    : mainHand === 'warhammer' ? 'warhammer'
    : 'greatsword';
  const off: FighterLook['offHand'] =
    offHand === 'shield' ? 'shield' : offHand === 'shortsword' ? 'shortsword' : null;
  return {
    skin: p.skin,
    skinShade: darken(p.skin, 0.18),
    hairColor: p.hairColor,
    hairStyle: p.hairStyle,
    helm: p.helm,
    mainHand: main,
    offHand: off,
    bow: ranged === 'longbow',
  };
}

export const lookFromCharacter = (c: PlayerCharacter): FighterLook =>
  lookFromPortraitAndGear(c.portrait.preset, c.equipment.mainHand, c.equipment.offHand, c.equipment.ranged);

export const lookFromDraft = (d: CharacterDraft): FighterLook =>
  lookFromPortraitAndGear(d.portrait, d.mainHand, d.offHand, 'longbow');

export function weaponSetFor(mainHand: string, offHand: string | null): WeaponSet {
  if (offHand === 'shortsword') return 'dual';
  if (offHand === 'shield') return 'sword_shield';
  if (mainHand === 'longbow') return 'bow';
  return 'sword_shield';
}

/** Owns look synchronisation: character/draft → FighterLook → actor repaint. */
export class EquipmentManager {
  private look: FighterLook = DEFAULT_LOOK;
  private key = lookKey(DEFAULT_LOOK);
  onChange: (look: FighterLook, weaponSet: WeaponSet) => void = () => {};

  syncFromCharacter(c: PlayerCharacter): void {
    this.apply(lookFromCharacter(c), weaponSetFor(c.equipment.mainHand, c.equipment.offHand));
  }

  syncFromDraft(d: CharacterDraft): void {
    this.apply(lookFromDraft(d), weaponSetFor(d.mainHand, d.offHand));
  }

  private apply(look: FighterLook, weaponSet: WeaponSet): void {
    const key = lookKey(look);
    if (key === this.key) return;
    this.key = key;
    this.look = look;
    this.onChange(look, weaponSet);
  }

  get current(): FighterLook { return this.look; }
}
