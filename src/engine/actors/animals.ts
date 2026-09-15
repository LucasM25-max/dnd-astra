import * as THREE from 'three';
import type { AdventureMaterials } from './materials';
import { SkeletalQuadruped, type QuadGait } from './quadruped/SkeletalQuadruped';
import type { QuadSpecies } from './quadruped/QuadrupedRig';

/**
 * Living animals: skeletal, textured and animated quadrupeds (the 2D sprite
 * sheets are gone). Oxen pull the wagon; the two horses graze and sniff at
 * the ambush clearing until the player ties them off.
 *
 * `AnimalActor` keeps the small behavioural wrapper the wagon and the
 * clearing expect: feed it a travelled distance each frame and it picks the
 * gait, while `setGait` lets story beats (tying off) take over.
 */

export type AnimalSpecies = QuadSpecies;

export const OX_COLORS = ['#cfbfa0', '#a99676', '#8d7a5e', '#b7a68b'];
export const HORSE_COLORS = ['#765339', '#b0aca0', '#4a3527', '#8a6a45'];

export interface LivingAnimal {
  readonly species: AnimalSpecies;
  readonly root: THREE.Group;
  readonly actor: SkeletalQuadruped;
  setGait(gait: QuadGait | null): void;
  update(dt: number, distance: number, sniff?: boolean): void;
  bitPosition(target?: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export class AnimalActor implements LivingAnimal {
  readonly root: THREE.Group;
  private speed = 0;
  private forced: QuadGait | null = null;

  constructor(readonly actor: SkeletalQuadruped, readonly species: AnimalSpecies) {
    this.root = actor.root;
  }

  /** Story override (e.g. tied at the roadside). Pass null to resume behaviour. */
  setGait(gait: QuadGait | null): void {
    this.forced = gait;
    if (gait) this.actor.setGait(gait);
  }

  get gait(): QuadGait | 'walk' {
    return this.forced ?? (this.speed > 0.1 ? 'walk' : 'idle');
  }

  update(dt: number, distance: number, sniff = false): void {
    const target = dt > 0 ? distance / dt : 0;
    this.speed += (Math.min(target, 4) - this.speed) * Math.min(1, dt * 6);
    const gait: QuadGait = this.forced ?? (this.speed > 0.1 ? 'walk' : sniff && this.species === 'horse' ? 'sniff' : 'idle');
    this.actor.setGait(gait);
    this.actor.update(dt);
  }

  bitPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.actor.bitPosition(target);
  }

  dispose(): void {
    this.actor.dispose();
  }
}

/** Builds skeletal animals from the shared adventure materials. */
export class AnimalFactory {
  private constructor(readonly materials: AdventureMaterials) {}

  static async load(materials: AdventureMaterials): Promise<AnimalFactory> {
    materials.coat.wrapS = materials.coat.wrapT = THREE.RepeatWrapping;
    materials.coat.repeat.set(2.4, 2.4);
    materials.coat.needsUpdate = true;
    return new AnimalFactory(materials);
  }

  create(species: AnimalSpecies, color: string, seed: number): AnimalActor {
    return new AnimalActor(new SkeletalQuadruped(this.materials, species, color, seed), species);
  }

  dispose(): void { /* materials are owned by the adventure */ }
}
