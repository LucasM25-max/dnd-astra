import * as THREE from 'three';
import type { PlayerController } from '../engine/controller';
import { AnimationStateMachine, ONESHOT_CLIP, type OneShotName } from './AnimationStateMachine';
import type { CharacterModel, PlayOneShotOptions, WeaponSet } from './CharacterModel';
import { socketPosition, type SocketName } from './SocketManager';
import { PREVIEW_ONLY_CLIPS } from './skeletal/HeroClips';
import type { SkeletalHero } from './skeletal/SkeletalHero';

/** Skeletal CharacterModel: gameplay poses, seating sync, and Second Wind glow. */
export class SkeletalCharacterModel implements CharacterModel {
  readonly root: THREE.Object3D;
  weaponSet: WeaponSet = 'sword_shield';
  private glow: THREE.PointLight;
  private tmp = new THREE.Vector3();

  constructor(
    private hero: SkeletalHero,
    private anim: AnimationStateMachine,
    private controller: PlayerController,
    private scene: THREE.Scene,
  ) {
    this.root = hero.root;
    this.glow = new THREE.PointLight('#e8c96a', 0, 7, 1.6);
    this.scene.add(this.glow);
  }

  get animation(): AnimationStateMachine {
    return this.anim;
  }

  setWeaponSet(ws: WeaponSet): void {
    this.weaponSet = ws;
    this.anim.setWeaponSet(ws);
  }

  postUpdate(): void {
    this.controller.forceSeated = this.anim.seated;
    const glow = this.anim.secondWindGlow();
    if (glow > 0.01) {
      this.hero.root.getWorldPosition(this.tmp);
      this.glow.position.set(this.tmp.x, this.tmp.y + 1.1, this.tmp.z);
      this.glow.intensity = glow * 14;
    } else {
      this.glow.intensity = 0;
    }
  }

  playOneShot(name: OneShotName, opts: PlayOneShotOptions = {}): Promise<void> {
    const clip = ONESHOT_CLIP[name];
    if (PREVIEW_ONLY_CLIPS.has(clip)) {
      throw new Error(`preview-only clip blocked in gameplay: ${clip}`);
    }
    return this.anim.playOneShot(name, opts);
  }

  releaseHold(): void {
    this.anim.releaseHold();
  }

  /** Turn the hero's body to face a world position (examinations, campfire). */
  faceTowards(worldPos: THREE.Vector3): void {
    const avatar = this.controller.avatar;
    const dx = worldPos.x - avatar.position.x;
    const dz = worldPos.z - avatar.position.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    avatar.rotation.y = Math.atan2(-dx, -dz);
  }

  anchorPosition(name: SocketName, target: THREE.Vector3): THREE.Vector3 {
    return socketPosition(this.hero, name, target);
  }

  dispose(): void {
    this.scene.remove(this.glow);
    this.glow.dispose();
  }
}
