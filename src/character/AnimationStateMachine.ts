import { CLIP_DEFS, PREVIEW_ONLY_CLIPS, type ClipName } from './skeletal/HeroClips';
import { IDLE_FOR_WEAPON_SET } from './skeletal/SkeletalHero';
import type { WeaponSet } from './CharacterModel';

/**
 * Skeletal animation brain: locomotion selection (idle/walk/run by speed,
 * idle stance by weapon set, auto sit/stand for seats) plus one-shot
 * gameplay poses. DOM-free — tests drive it with a recording fake player.
 *
 * NO-COMBAT: preview-only clips (attacks, hit, death, salute) are rejected
 * unless `allowPreview` is set, which only the creation viewport does.
 */
export type OneShotName = 'interact' | 'second_wind' | 'long_rest_sit' | 'stand_up' | 'flourish';

export interface OneShotOptions {
  /** Clamp the final pose until released (kneel-through-narration, campfire sit). */
  hold?: boolean;
  fade?: number;
}

export interface LocomotionInput {
  /** Horizontal speed in m/s. */
  speed: number;
  sprint: boolean;
  /** Actually sitting on something (wagon seat). Campfire sits are explicit one-shots. */
  seated: boolean;
}

/** Narrow clip-player surface — SkeletalHero satisfies it structurally. */
export interface ClipPlayer {
  playLocomotion(name: ClipName, fade?: number, rate?: number): void;
  playOneShot(name: ClipName, opts?: { hold?: boolean; fade?: number }): Promise<void>;
  releaseHold(fade?: number): void;
  readonly currentClip: ClipName;
  readonly isHeld: boolean;
  update(dt: number): void;
}

const ONESHOT_CLIP: Record<OneShotName, ClipName> = {
  interact: 'interact',
  second_wind: 'second_wind',
  long_rest_sit: 'long_rest_sit',
  stand_up: 'stand_up',
  flourish: 'salute',
};

/** Expected one-shot durations in ms, derived from the clip catalogue. */
export const ONESHOT_MS: Record<OneShotName, number> = {
  interact: CLIP_DEFS.interact.duration * 1000,
  second_wind: CLIP_DEFS.second_wind.duration * 1000,
  long_rest_sit: CLIP_DEFS.long_rest_sit.duration * 1000,
  stand_up: CLIP_DEFS.stand_up.duration * 1000,
  flourish: CLIP_DEFS.salute.duration * 1000,
};

const WALK_SPEED = 2.25;
const RUN_SPEED = 4.7;

export class AnimationStateMachine {
  weaponSet: WeaponSet = 'sword_shield';
  seated = false;
  allowPreview = false;
  private shot: OneShotName | null = null;
  private loco: ClipName = 'idle';

  constructor(private player: ClipPlayer) {}

  get activeShot(): OneShotName | null {
    return this.shot;
  }

  get locomotion(): ClipName {
    return this.loco;
  }

  setWeaponSet(ws: WeaponSet): void {
    this.weaponSet = ws;
    if (!this.shot && !this.seated) this.applyLocomotion(IDLE_FOR_WEAPON_SET[ws], 0.25, 1);
  }

  /**
   * Per-frame locomotion selection. Seat transitions always win (even
   * mid-shot); otherwise an active one-shot owns the pose until it ends.
   */
  updateLocomotion(input: LocomotionInput): void {
    if (input.seated !== this.seated) {
      if (input.seated) {
        void this.playOneShot('long_rest_sit', { hold: true });
      } else {
        void this.playOneShot('stand_up');
      }
      return;
    }
    if (this.shot || this.seated) return;
    if (input.speed > 0.25) {
      const running = input.sprint && input.speed > 3;
      const rate = running
        ? Math.min(1.4, Math.max(0.6, input.speed / RUN_SPEED))
        : Math.min(1.4, Math.max(0.6, input.speed / WALK_SPEED));
      this.applyLocomotion(running ? 'run' : 'walk', 0.25, rate);
    } else {
      this.applyLocomotion(IDLE_FOR_WEAPON_SET[this.weaponSet], 0.25, 1);
    }
  }

  /** Begin a one-shot; resolves when its clip finishes (a held pose stays clamped). */
  async playOneShot(name: OneShotName, opts: OneShotOptions = {}): Promise<void> {
    const clip = ONESHOT_CLIP[name];
    if (PREVIEW_ONLY_CLIPS.has(clip) && !this.allowPreview) {
      throw new Error(`preview-only clip rejected in gameplay: ${clip}`);
    }
    if (name === 'long_rest_sit' && this.seated) return;
    if (name === 'stand_up' && !this.seated) return;
    if (name === 'long_rest_sit') this.seated = true;
    if (name === 'stand_up') this.seated = false;
    this.shot = name;
    try {
      await this.player.playOneShot(clip, {
        hold: opts.hold ?? name === 'long_rest_sit',
        fade: opts.fade,
      });
    } finally {
      if (this.shot === name) this.shot = null;
    }
  }

  /** Release a held pose (kneel/sit) back to the locomotion layer. */
  releaseHold(fade = 0.3): void {
    this.player.releaseHold(fade);
  }

  private applyLocomotion(name: ClipName, fade: number, rate: number): void {
    if (name === this.loco) {
      this.player.playLocomotion(name, 0, rate);
      return;
    }
    this.loco = name;
    this.player.playLocomotion(name, fade, rate);
  }
}
