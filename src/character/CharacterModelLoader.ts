import { portraitDef } from '../game/character';
import type { HeroGear } from './EquipmentManager';
import type { SkeletalHero } from './skeletal/SkeletalHero';

/** Applies gear to the hero, debounced so creation scrubs don't rebuild every frame. */
export class CharacterModelLoader {
  private timer = 0;
  private pending: HeroGear | null = null;

  constructor(private hero: SkeletalHero) {}

  applyGear(gear: HeroGear, immediate = false): void {
    if (immediate) {
      window.clearTimeout(this.timer);
      this.pending = null;
      this.dress(gear);
      return;
    }
    this.pending = gear;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.pending) this.dress(this.pending);
      this.pending = null;
    }, 60);
  }

  private dress(gear: HeroGear): void {
    this.hero.setPortrait(portraitDef(gear.preset));
    this.hero.setEquipment(gear.mainHand, gear.offHand);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
  }
}
