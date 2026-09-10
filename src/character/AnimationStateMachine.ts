import type { WeaponSet } from './CharacterModel';

/**
 * One-shot overlay track over locomotion (interact dips, golden second wind,
 * campfire seat). Locomotion blending itself lives in the sprite actor's
 * gait system; the weapon set selects the painted variant sub-graph.
 */
export type OneShotName = 'interact' | 'second_wind' | 'long_rest_sit' | 'stand_up' | 'flourish';

export const ONESHOT_MS: Record<OneShotName, number> = {
  interact: 850,
  second_wind: 1300,
  long_rest_sit: 700,
  stand_up: 650,
  flourish: 1100,
};

export class AnimationStateMachine {
  weaponSet: WeaponSet = 'sword_shield';
  seated = false;
  private shot: { name: OneShotName; t0: number } | null = null;

  setWeaponSet(ws: WeaponSet): void {
    this.weaponSet = ws;
  }

  /** Begin a one-shot; returns its duration in ms (0 = nothing to wait for). */
  playOneShot(name: OneShotName, nowMs: number): number {
    if (name === 'long_rest_sit') this.seated = true;
    if (name === 'stand_up') this.seated = false;
    this.shot = { name, t0: nowMs };
    return ONESHOT_MS[name];
  }

  get activeShot(): OneShotName | null {
    return this.shot?.name ?? null;
  }

  /** Root-space dip (metres, negative = crouch) and golden glow (0..1). Pure curves. */
  update(nowMs: number): { dip: number; glow: number } {
    if (!this.shot) return { dip: this.seated ? -0.34 : 0, glow: 0 };
    const duration = ONESHOT_MS[this.shot.name];
    const progress = Math.min(1, Math.max(0, (nowMs - this.shot.t0) / Math.max(1, duration)));
    if (progress >= 1) {
      const held = this.shot.name === 'long_rest_sit';
      this.shot = null;
      return { dip: this.seated ? -0.34 : 0, glow: 0, ...(held ? {} : {}) };
    }
    switch (this.shot.name) {
      case 'interact':
        return { dip: -Math.sin(progress * Math.PI) * 0.34, glow: 0 };
      case 'second_wind': {
        const dip = progress < 0.45 ? -Math.sin((progress / 0.45) * Math.PI * 0.5) * 0.26 : -0.26 * (1 - (progress - 0.45) / 0.55);
        return { dip, glow: Math.sin(progress * Math.PI) };
      }
      case 'long_rest_sit':
        return { dip: -0.34 * (progress * progress * (3 - 2 * progress)), glow: 0 };
      case 'stand_up':
        return { dip: -0.34 * (1 - progress * progress * (3 - 2 * progress)), glow: 0 };
      case 'flourish':
        return { dip: 0, glow: Math.sin(progress * Math.PI) * 0.5 };
    }
  }
}
