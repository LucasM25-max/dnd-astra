import * as THREE from 'three';
import { animalPose, animalPalette, paintAnimal, ANIMAL_SHEET, type AnimalSpecies } from './animalSprite';
import { buildSheet, SpriteActor, v3, type ActorState, type SheetAction, type SpriteSheet, type V3 } from './sprites';
import type { AdventureMaterials } from './materials';

/**
 * Animals are 16-direction painted billboards (see sprites.ts). The factory
 * keeps the game-facing API: create(species, colour, seed) → LivingAnimal
 * with root, bitPosition() and update(dt, distance, sniff).
 */

export class AnimalActor extends SpriteActor {
  constructor(camera: THREE.Camera, public readonly species: AnimalSpecies, public readonly color: string, seed = 0) {
    super(buildSheet({
      ...ANIMAL_SHEET,
      directionGroups: 2,
      actions: species === 'ox'
        ? [{ name: 'idle', frames: 1 }, { name: 'walk', frames: 6 }]
        : [{ name: 'idle', frames: 1 }, { name: 'walk', frames: 6 }, { name: 'sniff', frames: 2 }],
      paint: (ctx, view) => {
        const walking = view.action === 'walk' ? 1 : 0;
        const headDown = view.action === 'sniff' ? (view.frame === 0 ? .55 : .95) : 0;
        paintAnimal(ctx, view, animalPose(species, view.phase, view.t, headDown, walking), animalPalette(color));
      },
    }), camera, {
      name: species === 'ox' ? 'Yoked draught ox' : 'Living horse',
      shadowRadius: species === 'ox' ? 1.05 : .95,
      gaitHz: species === 'ox' ? 5.3 / (Math.PI * 2) : 5.7 / (Math.PI * 2),
    });
    this.gait = (seed * 1.37) % (Math.PI * 2);
    this.clock = seed * 2.19;
    this.anchor('bit', this.bitLocal(0));
    this.anchor('nose', this.noseLocal(0));
  }
  protected pickAction(state: ActorState, sheet: SpriteSheet): SheetAction {
    if (state.speed > .06) return sheet.actions.find(a => a.name === 'walk')!;
    if (this.species === 'horse' && state.sniff) return sheet.actions.find(a => a.name === 'sniff')!;
    return sheet.actions[0]; // idle
  }
  update(state: ActorState) {
    // The sniff loop cycles slowly off the actor clock (two painted head-down poses).
    const sniffing = this.species === 'horse' && !!state.sniff && state.speed <= .06;
    this.frameOverride = sniffing ? Math.floor(this.clock * .55) % 2 : undefined;
    super.update(state);
  }
  protected applyPose(_state: ActorState) {
    const headDown = this.actionName === 'sniff' ? (this.frame === 0 ? .55 : .95) : 0;
    const walking = this.actionName === 'walk' ? 1 : 0;
    const pose = animalPose(this.species, this.gait, this.clock, headDown, walking);
    this.plane.position.y = 0; // feet stay on the ground; body bob is painted in
    this.setAnchor('bit', this.localMuzzle(pose.muzzle));
    this.setAnchor('nose', this.localMuzzle(pose.muzzleTip));
  }
  /**
   * Pose space follows the painter's convention (+z = the side the face is
   * seen from); the root's local +z points the other way, so world-facing
   * attachment points (halter bit, nose) need their z negated.
   */
  private localMuzzle(p: V3): V3 { return v3(p.x, p.y, -p.z); }
  private bitLocal(headDown: number): V3 { return this.localMuzzle(posePoint(this.species, 0, 0, headDown, 0).muzzle); }
  private noseLocal(headDown: number): V3 { return this.localMuzzle(posePoint(this.species, 0, 0, headDown, 0).muzzleTip); }
  dispose() {
    this.anchors.forEach(a => a.removeFromParent());
    super.dispose();
  }
}
function posePoint(species: AnimalSpecies, phase: number, t: number, headDown: number, walking: number) {
  return animalPose(species, phase, t, headDown, walking);
}

export class LivingAnimal {
  readonly root: THREE.Group;
  constructor(public readonly actor: AnimalActor, public readonly species: AnimalSpecies, color: string, seed: number) {
    this.root = actor.root;
    this.root.name = species === 'ox' ? 'Yoked draught ox · 16-position sprite' : 'Living horse · 16-position sprite';
    void color; void seed;
  }
  /** The halter bit, where the reins attach (world space). */
  bitPosition(target = new THREE.Vector3()) { return this.actor.anchorPosition('bit', target); }
  update(dt: number, distance: number, sniff = false) {
    dt = Math.max(0, Math.min(.1, dt));
    const speed = dt > 0 ? Math.abs(distance) / Math.max(dt, 1e-3) : 0;
    this.actor.update({ dt, speed, sniff });
  }
  dispose() { this.actor.dispose(); }
}

export class AnimalFactory {
  constructor(readonly materials: AdventureMaterials, private readonly camera: THREE.Camera) {}
  static load(materials: AdventureMaterials, camera: THREE.Camera): Promise<AnimalFactory> {
    return Promise.resolve(new AnimalFactory(materials, camera));
  }
  create(species: AnimalSpecies, color: string, seed = 0): LivingAnimal {
    return new LivingAnimal(new AnimalActor(this.camera, species, color, seed), species, color, seed);
  }
  dispose() { /* sheets live inside the actors and are disposed with them */ }
}
