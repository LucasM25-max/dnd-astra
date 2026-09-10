import * as THREE from 'three';
import type { FighterActor } from '../engine/actors/fighter';
import type { PlayerController } from '../engine/controller';
import { AnimationStateMachine, type OneShotName } from './AnimationStateMachine';
import type { CharacterModel, WeaponSet } from './CharacterModel';
import { ensureSockets, socketPosition, type SocketName } from './SocketManager';

/** Sprite-backed CharacterModel: wraps the player's FighterActor with one-shot overlays. */
export class SpriteCharacterModel implements CharacterModel {
  readonly root: THREE.Object3D;
  weaponSet: WeaponSet = 'sword_shield';
  private glow: THREE.PointLight;
  private tmp = new THREE.Vector3();

  constructor(
    private actor: FighterActor,
    private controller: PlayerController,
    private scene: THREE.Scene,
    private anim: AnimationStateMachine = new AnimationStateMachine(),
  ) {
    this.root = actor.root;
    ensureSockets(actor);
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
    const { dip, glow } = this.anim.update(performance.now());
    this.actor.root.position.y = dip;
    this.controller.forceSeated = this.anim.seated;
    if (glow > 0.01) {
      this.actor.root.getWorldPosition(this.tmp);
      this.glow.position.set(this.tmp.x, this.tmp.y + 1.1, this.tmp.z);
      this.glow.intensity = glow * 14;
    } else {
      this.glow.intensity = 0;
    }
  }

  playOneShot(name: OneShotName): Promise<void> {
    const ms = this.anim.playOneShot(name, performance.now());
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => {
      window.setTimeout(resolve, ms);
    });
  }

  anchorPosition(name: SocketName, target: THREE.Vector3): THREE.Vector3 {
    return socketPosition(this.actor, name, target);
  }

  dispose(): void {
    this.scene.remove(this.glow);
    this.glow.dispose();
  }
}
