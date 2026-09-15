import * as THREE from 'three';
import type { CanvasFactory } from '../../character/skeletal/HeroTextures';
import type { AdventureMaterials } from './materials';
import { seededRandom } from '../../character/skeletal/HeroTextures';
import { SkeletalQuadruped, type QuadGait, type QuadOneShot } from './quadruped/SkeletalQuadruped';
import type { QuadSpecies } from './quadruped/QuadrupedRig';

/**
 * Living animals: skeletal, textured, gait-coupled quadrupeds. Oxen pull the
 * wagon; the two horses wander and graze the ambush clearing until the player
 * ties them off.
 *
 * `AnimalActor` is the behaviour wrapper the wagon and the clearing talk to.
 * It reads a travelled distance each frame and turns it into
 *   speed → gait (idle / walk / trot, with the clip's playback rate coupled to
 *   the speed so hooves plant instead of skating),
 *   downtime → idle flourishes (fly bites, tail swats, shakes, pawing),
 *   proximity → the head tracking the player.
 * Story beats take over with `setGait`, exactly as before.
 */

export type AnimalSpecies = QuadSpecies;

// Dun and grey-brown draught hides: pale enough to read as cattle, dark enough
// to separate from the limestone trail they haul the wagon along.
export const OX_COLORS = ['#8f7c60', '#6f5c46', '#a08a70', '#7b6650'];
export const HORSE_COLORS = ['#765339', '#b0aca0', '#4a3527', '#8a6a45'];

export interface AnimalUpdate {
  /** Metres travelled since the previous frame. */
  distance: number;
  /** Story override: force this gait instead of deriving one. */
  gait?: QuadGait | null;
  /** Allow grazing/sniffing while standing (loose horses, not a yoked team). */
  forage?: boolean;
  /** Something worth looking at — usually the player's head. */
  lookAt?: THREE.Vector3 | null;
  /** True while the simulation is paused: hold still, keep breathing shallow. */
  paused?: boolean;
}

export interface LivingAnimal {
  readonly species: AnimalSpecies;
  readonly root: THREE.Group;
  readonly actor: SkeletalQuadruped;
  setGait(gait: QuadGait | null): void;
  update(dt: number, sample: AnimalUpdate): void;
  bitPosition(target?: THREE.Vector3): THREE.Vector3;
  collarPosition(target?: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

/** Idle flourishes and how often each one comes knocking, per species. */
const FLOURISH: Record<AnimalSpecies, { clip: QuadOneShot; every: number; while: 'stand' | 'any'; weight: number }[]> = {
  horse: [
    { clip: 'swat', every: 11, while: 'any', weight: 0.9 },
    { clip: 'bugbite', every: 17, while: 'any', weight: 0.8 },
    { clip: 'shake', every: 34, while: 'stand', weight: 0.55 },
    { clip: 'paw', every: 41, while: 'stand', weight: 0.5 },
  ],
  ox: [
    { clip: 'swat', every: 8, while: 'any', weight: 1 },
    { clip: 'bugbite', every: 13, while: 'any', weight: 0.9 },
    { clip: 'shake', every: 27, while: 'stand', weight: 0.6 },
  ],
};

export class AnimalActor implements LivingAnimal {
  readonly root: THREE.Group;
  private speed = 0;
  private forced: QuadGait | null = null;
  private clock = 0;
  private forageUntil = 0;
  private foraging = false;
  private readonly next: number[];
  private readonly rand: () => number;
  private flourishCooldown = 0;

  constructor(readonly actor: SkeletalQuadruped, readonly species: AnimalSpecies, seed = 1) {
    this.root = actor.root;
    this.rand = seededRandom(seed * 977 + 31);
    this.next = FLOURISH[species].map(f => f.every * (0.4 + this.rand() * 0.9));
  }

  /** Story override (e.g. tied at the roadside). Pass null to resume behaviour. */
  setGait(gait: QuadGait | null): void {
    this.forced = gait;
    if (gait) this.actor.setGait(gait);
    if (!gait) this.foraging = false;
  }

  get gait(): QuadGait {
    return this.forced ?? (this.speed > 0.1 ? (this.speed > this.trotSpeed ? 'trot' : 'walk') : this.foraging ? 'graze' : 'idle');
  }

  private get trotSpeed(): number {
    return this.actor.rig.spec.gait.trotSpeed;
  }

  update(dt: number, sample: AnimalUpdate): void {
    dt = Math.max(0, Math.min(0.1, dt));
    this.clock += dt;
    const target = dt > 1e-4 ? Math.min(4.5, sample.distance / dt) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 6);
    const moving = this.speed > 0.1 && !sample.gait;
    // Foraging: a loose horse puts its head down for a mouthful, then lifts it
    // again to look at you. Timed off the wander cycle so it never twitches.
    if (!moving && !sample.gait) {
      if (this.clock > this.forageUntil) {
        this.foraging = !!sample.forage && !this.foraging;
        this.forageUntil = this.clock + (this.foraging ? 4.5 + this.rand() * 7 : 2.5 + this.rand() * 6);
      }
    } else if (moving) this.foraging = false;

    const gait: QuadGait = sample.gait ?? (moving ? (this.speed > this.trotSpeed ? 'trot' : 'walk') : this.foraging ? 'graze' : 'idle');
    if (!sample.paused) {
      this.actor.setGait(gait);
      this.actor.setSpeed(sample.paused ? 0 : this.speed);
      // Watch what's nearby while standing; face where you're going otherwise.
      const look = sample.lookAt && !moving ? sample.lookAt : null;
      const dist = look ? this.root.position.distanceTo(look) : 0;
      this.actor.setLookAt(look, look ? THREE.MathUtils.clamp(1.35 - (dist - 2.2) / 6, 0, 1) : 0);
      this.playFlourishes(dt, gait);
      this.actor.update(dt);
    }
  }

  /** Schedule the small stuff: flies, itching, impatience. Never while moving. */
  private playFlourishes(dt: number, gait: QuadGait): void {
    this.flourishCooldown -= dt;
    if (this.flourishCooldown > 0) return;
    const table = FLOURISH[this.species];
    for (let i = 0; i < table.length; i++) {
      if (this.clock < this.next[i]) continue;
      if (table[i].while === 'stand' && gait !== 'idle' && gait !== 'tied' && gait !== 'graze') continue;
      if (this.rand() < table[i].weight) {
        this.actor.playOneShot(table[i].clip);
        this.flourishCooldown = 1.2;
      }
      this.next[i] = this.clock + table[i].every * (0.55 + this.rand());
      break;
    }
  }

  bitPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.actor.bitPosition(target);
  }
  /** Where the hames hook sits: the trace ropes pull from here, not from air. */
  collarPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.actor.collarPosition(target);
  }

  dispose(): void {
    this.actor.dispose();
  }
}

/**
 * Builds skeletal animals. Textures are painted once per individual on canvas
 * (deterministic, no downloads), so the factory owns a canvas provider and a
 * disposal list; the shared adventure materials stay in charge of wood, rope
 * and iron for the wagon and the reins.
 */
export class AnimalFactory {
  private readonly actors: AnimalActor[] = [];
  private constructor(
    readonly materials: AdventureMaterials,
    private readonly canvasFactory: CanvasFactory,
    private readonly textureScale: number,
  ) {}

  static load(materials: AdventureMaterials, canvasFactory: CanvasFactory, textureScale = 1): AnimalFactory {
    return new AnimalFactory(materials, canvasFactory, textureScale);
  }

  create(species: AnimalSpecies, color: string, seed: number, marking?: 'plain' | 'blaze' | 'stripe' | 'star' | 'snip' | 'patched'): AnimalActor {
    const actor = new SkeletalQuadruped(species, {
      canvasFactory: this.canvasFactory, tint: color, seed, marking, textureScale: this.textureScale,
    });
    const animal = new AnimalActor(actor, species, seed);
    this.actors.push(animal);
    return animal;
  }

  dispose(): void {
    for (const a of this.actors) a.dispose();
    this.actors.length = 0;
  }
}
