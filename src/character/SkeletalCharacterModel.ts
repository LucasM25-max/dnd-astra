import * as THREE from 'three';
import { AnimationStateMachine, type OneShotName, type OneShotOptions } from './AnimationStateMachine';
import type { CharacterModel, WeaponSet } from './CharacterModel';
import { socketPosition, type SocketName } from './SocketManager';
import type { SkeletalHero } from './skeletal/SkeletalHero';

/** Skeletal CharacterModel: a SkeletalHero driven by the animation state machine. */
export class SkeletalCharacterModel implements CharacterModel {
  readonly animation: AnimationStateMachine;

  constructor(readonly hero: SkeletalHero) {
    this.animation = new AnimationStateMachine(hero);
  }

  get root(): THREE.Object3D {
    return this.hero.root;
  }

  get weaponSet(): WeaponSet {
    return this.animation.weaponSet;
  }

  setWeaponSet(ws: WeaponSet): void {
    this.animation.setWeaponSet(ws);
  }

  update(dt: number): void {
    this.hero.update(dt);
  }

  playOneShot(name: OneShotName, opts?: OneShotOptions): Promise<void> {
    return this.animation.playOneShot(name, opts);
  }

  releaseHold(fade?: number): void {
    this.animation.releaseHold(fade);
  }

  anchorPosition(name: SocketName, target: THREE.Vector3): THREE.Vector3 {
    return socketPosition(this.hero, name, target);
  }

  dispose(): void {
    this.hero.dispose();
  }
}
