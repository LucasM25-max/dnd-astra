import type * as THREE from 'three';
import type { PlayerController } from '../engine/controller';
import type { PlayerCharacter } from '../game/character';
import { AnimationStateMachine, type OneShotName } from './AnimationStateMachine';
import { CharacterModelLoader } from './CharacterModelLoader';
import { EquipmentManager } from './EquipmentManager';
import { SpriteCharacterModel } from './SpriteCharacterModel';

/**
 * Owns the visible hero: equipment → look sync, weapon-set sub-graphs, and
 * one-shot overlays. Movement physics stays in PlayerController.
 */
export class PlayerCharacterController {
  readonly equipment = new EquipmentManager();
  readonly animation = new AnimationStateMachine();
  readonly model: SpriteCharacterModel;
  private loader: CharacterModelLoader;

  constructor(controller: PlayerController, scene: THREE.Scene) {
    this.model = new SpriteCharacterModel(controller.actor, controller, scene, this.animation);
    this.loader = new CharacterModelLoader(controller.actor);
    this.equipment.onChange = (look, weaponSet) => {
      this.loader.applyLook(look);
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

  playOneShot(name: OneShotName): Promise<void> {
    return this.model.playOneShot(name);
  }

  anchorPosition(name: 'mainhand' | 'offhand' | 'back' | 'hip' | 'quiver', target: THREE.Vector3): THREE.Vector3 {
    return this.model.anchorPosition(name, target);
  }

  dispose(): void {
    this.loader.dispose();
    this.model.dispose();
  }
}
