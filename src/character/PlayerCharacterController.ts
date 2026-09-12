import type * as THREE from 'three';
import type { PlayerController } from '../engine/controller';
import type { PlayerCharacter } from '../game/character';
import type { AnimationStateMachine } from './AnimationStateMachine';
import type { OneShotName } from './AnimationStateMachine';
import type { PlayOneShotOptions } from './CharacterModel';
import { CharacterModelLoader } from './CharacterModelLoader';
import { EquipmentManager } from './EquipmentManager';
import { SkeletalCharacterModel } from './SkeletalCharacterModel';
import type { SocketName } from './SocketManager';

/**
 * Owns the visible hero: gear → skeletal re-dress, weapon-set sub-graphs,
 * and gameplay one-shots. Movement physics stays in PlayerController;
 * locomotion blending runs in the shared animation state machine.
 */
export class PlayerCharacterController {
  readonly equipment = new EquipmentManager();
  readonly animation: AnimationStateMachine;
  readonly model: SkeletalCharacterModel;
  private loader: CharacterModelLoader;

  constructor(controller: PlayerController, scene: THREE.Scene) {
    this.animation = controller.actor.anim;
    this.model = new SkeletalCharacterModel(controller.actor.hero, this.animation, controller, scene);
    this.loader = new CharacterModelLoader(controller.actor.hero);
    this.equipment.onChange = (gear, weaponSet) => {
      this.loader.applyGear(gear);
      this.model.setWeaponSet(weaponSet);
    };
  }

  syncFromCharacter(c: PlayerCharacter): void {
    this.equipment.syncFromCharacter(c);
  }

  /** Call after the movement controller updates each frame. */
  update(): void {
    this.model.postUpdate();
  }

  playOneShot(name: OneShotName, opts: PlayOneShotOptions = {}): Promise<void> {
    return this.model.playOneShot(name, opts);
  }

  releaseHold(): void {
    this.model.releaseHold();
  }

  faceTowards(worldPos: THREE.Vector3): void {
    this.model.faceTowards(worldPos);
  }

  anchorPosition(name: SocketName, target: THREE.Vector3): THREE.Vector3 {
    return this.model.anchorPosition(name, target);
  }

  dispose(): void {
    this.loader.dispose();
    this.model.dispose();
  }
}
