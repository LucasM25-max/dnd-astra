import * as THREE from 'three';
import type { PlayerController } from '../engine/controller';
import { portraitDef, type PlayerCharacter } from '../game/character';
import type { OneShotName, OneShotOptions } from './AnimationStateMachine';
import { EquipmentManager } from './EquipmentManager';
import { SkeletalCharacterModel } from './SkeletalCharacterModel';
import { SkeletalHero } from './skeletal/SkeletalHero';
import type { SocketName } from './SocketManager';

const domCanvasFactory = (w: number, h: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
};

/**
 * Owns the visible hero: equipment → socket sync, weapon-set sub-graphs,
 * locomotion drive, and one-shot poses. Movement physics stays in
 * PlayerController; this controller only dresses and animates its avatar.
 */
export class PlayerCharacterController {
  readonly equipment = new EquipmentManager();
  readonly model: SkeletalCharacterModel;
  private glow: THREE.PointLight;
  private glowLevel = 0;

  constructor(
    private controller: PlayerController,
    private scene: THREE.Scene,
  ) {
    const hero = new SkeletalHero({ canvasFactory: domCanvasFactory });
    this.model = new SkeletalCharacterModel(hero);
    // The skeletal hero replaces the painted sprite on the player's avatar.
    controller.setSkeletalRoot(hero.root);
    controller.handAnchor = (side, target) =>
      hero.anchorPosition(side === 'left' ? 'offhand' : 'mainhand', target);
    this.glow = new THREE.PointLight('#e8c96a', 0, 7, 1.6);
    this.scene.add(this.glow);
    this.equipment.onChange = loadout => {
      hero.setPortrait(portraitDef(loadout.preset));
      hero.setEquipment(loadout.mainHand, loadout.offHand);
      this.model.setWeaponSet(hero.weaponSet);
    };
  }

  get animation(): SkeletalCharacterModel['animation'] {
    return this.model.animation;
  }

  syncFromCharacter(c: PlayerCharacter): void {
    this.equipment.syncFromCharacter(c);
  }

  /** Call after the movement controller updates each frame. */
  update(dt: number): void {
    const speed = Math.hypot(this.controller.velocity.x, this.controller.velocity.z);
    this.model.animation.updateLocomotion({
      speed,
      sprint: this.controller.sprinting,
      seated: this.controller.controlMode === 'wagon',
    });
    this.model.update(dt);
    // Golden Second Wind shimmer follows the hero.
    const target = this.model.animation.activeShot === 'second_wind' ? 1 : 0;
    this.glowLevel = THREE.MathUtils.damp(this.glowLevel, target, 6, Math.max(dt, 0.001));
    if (this.glowLevel > 0.01) {
      this.controller.avatar.getWorldPosition(this.glow.position);
      this.glow.position.y += 1.1;
      this.glow.intensity = this.glowLevel * 14;
    } else {
      this.glow.intensity = 0;
    }
  }

  playOneShot(name: OneShotName, opts?: OneShotOptions): Promise<void> {
    return this.model.playOneShot(name, opts);
  }

  releaseHold(fade?: number): void {
    this.model.releaseHold(fade);
  }

  anchorPosition(name: SocketName, target: THREE.Vector3): THREE.Vector3 {
    return this.model.anchorPosition(name, target);
  }

  /** Face a world point (interaction cinematics). */
  faceTowards(point: THREE.Vector3): void {
    const p = this.controller.position;
    this.controller.avatar.rotation.y = Math.atan2(-(point.x - p.x), -(point.z - p.z));
  }

  /** Lock/unlock foot input (interaction cinematics). */
  setCinematicLock(locked: boolean): void {
    this.controller.setControlMode(locked ? 'cinematic' : 'foot');
  }

  dispose(): void {
    this.scene.remove(this.glow);
    this.glow.dispose();
    this.controller.handAnchor = null;
    this.controller.clearSkeletalRoot();
    this.model.dispose();
  }
}
