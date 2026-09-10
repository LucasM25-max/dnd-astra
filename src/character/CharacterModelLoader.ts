import type { FighterActor, FighterLook } from '../engine/actors/fighter';

/** Applies looks to the actor, debounced so creation scrubs don't rebuild every frame. */
export class CharacterModelLoader {
  private timer = 0;
  private pending: FighterLook | null = null;

  constructor(private actor: FighterActor) {}

  applyLook(look: FighterLook, immediate = false): void {
    if (immediate) {
      window.clearTimeout(this.timer);
      this.pending = null;
      this.actor.setLook(look);
      return;
    }
    this.pending = look;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.pending) this.actor.setLook(this.pending);
      this.pending = null;
    }, 60);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
  }
}
