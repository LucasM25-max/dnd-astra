import { CLIP_DEFS, PREVIEW_ONLY_CLIPS, type ClipName } from './skeletal/HeroClips';
import { IDLE_FOR_WEAPON_SET, type SkeletalHero } from './skeletal/SkeletalHero';
import type { WeaponSet } from './CharacterModel';

/**
 * Skeletal animation state machine: locomotion blended by speed (idle / walk
 * / run with 0.2 s crossfades), per-weapon-set idle stances, and one-shot
 * gameplay poses (kneel, Second Wind breath, held sits) over the top.
 *
 * Combat clips (attack / hit / death) have no mapping here and are rejected
 * outright — gameplay can never reach them (tested). Creation preview plays
 * the hero directly and is the only caller allowed preview-only names.
 */
export type OneShotName =
  | 'interact'
  | 'second_wind'
  | 'long_rest_sit'
  | 'stand_up'
  | 'sit_chair'
  | 'stand_chair'
  | 'flourish';

export const ONESHOT_CLIP: Record<OneShotName, ClipName> = {
  interact: 'interact',
  second_wind: 'second_wind',
  long_rest_sit: 'long_rest_sit',
  stand_up: 'stand_up',
  sit_chair: 'sit_chair',
  stand_chair: 'stand_chair',
  flourish: 'salute',
};

/** One-shot durations in ms, derived from the authored clip catalogue. */
export const ONESHOT_MS: Record<OneShotName, number> = Object.fromEntries(
  (Object.entries(ONESHOT_CLIP) as [OneShotName, ClipName][]).map(([shot, clip]) => [
    shot,
    Math.round(CLIP_DEFS[clip].duration * 1000),
  ]),
) as Record<OneShotName, number>;

/** Shots that clamp their last frame until released or replaced. */
export const HOLD_ONESHOTS: ReadonlySet<OneShotName> = new Set(['long_rest_sit', 'sit_chair']);

export type SeatKind = 'ground' | 'chair';

export class AnimationStateMachine {
  weaponSet: WeaponSet = 'sword_shield';
  seated = false;
  private shot: OneShotName | null = null;
  private loco: ClipName = 'idle';
  /** Which seat the held sit pose belongs to (stand matches the sit). */
  private seatHeld: SeatKind = 'ground';

  constructor(private hero: SkeletalHero) {}

  setWeaponSet(ws: WeaponSet): void {
    this.weaponSet = ws;
    if (!this.shot && !this.seated) this.playIdle();
  }

  get activeShot(): OneShotName | null {
    return this.shot;
  }

  /** Begin a one-shot; resolves when its authored duration elapses. */
  playOneShot(name: OneShotName, opts: { hold?: boolean } = {}): Promise<void> {
    const clip = ONESHOT_CLIP[name];
    if (PREVIEW_ONLY_CLIPS.has(clip)) {
      throw new Error(`preview-only clip blocked in gameplay: ${clip}`);
    }
    if (name === 'long_rest_sit' || name === 'sit_chair') {
      this.seated = true;
      this.seatHeld = name === 'sit_chair' ? 'chair' : 'ground';
    }
    if (name === 'stand_up' || name === 'stand_chair') this.seated = false;
    this.shot = name;
    const hold = opts.hold ?? HOLD_ONESHOTS.has(name);
    return this.hero.playOneShot(clip, { hold }).then(() => {
      // Held poses keep reporting until released or replaced.
      if (this.shot === name && !hold) this.shot = null;
    });
  }

  /** Release a held pose back to locomotion. */
  releaseHold(): void {
    this.shot = null;
    this.hero.releaseShot(0.25);
  }

  /** Golden Second Wind glow envelope (0..1) for the character light. */
  secondWindGlow(): number {
    if (this.shot !== 'second_wind') return 0;
    const progress = this.hero.shotProgress() ?? 0;
    return Math.sin(progress * Math.PI);
  }

  /**
   * Per-frame locomotion: auto sit/stand on seat changes, speed-blended
   * idle/walk/run otherwise, then step the mixer. The mixer always steps —
   * world pause freezes movement input, never the hero's pose track, so
   * kneels and sits play through rest/interaction cinematics.
   */
  updateLocomotion(dt: number, speed: number, sprint: boolean, seated: boolean, seat: SeatKind): void {
    if (seated && !this.seated && !this.shot) {
      this.seatHeld = seat;
      void this.playOneShot(seat === 'chair' ? 'sit_chair' : 'long_rest_sit');
    } else if (!seated && this.seated && !this.shot) {
      void this.playOneShot(this.seatHeld === 'chair' ? 'stand_chair' : 'stand_up');
    }
    this.hero.setSidearmStowed(this.seated && this.seatHeld === 'chair');
    if (!this.shot && !this.seated) {
      const target: ClipName =
        speed < 0.15 ? IDLE_FOR_WEAPON_SET[this.weaponSet] : speed > 3.2 || (sprint && speed > 1.5) ? 'run' : 'walk';
      if (target !== this.loco) {
        this.loco = target;
        this.hero.playLocomotion(target, 0.2);
      }
    }
    this.hero.update(dt);
  }

  private playIdle(): void {
    this.loco = IDLE_FOR_WEAPON_SET[this.weaponSet];
    this.hero.playLocomotion(this.loco, 0.2);
  }
}
