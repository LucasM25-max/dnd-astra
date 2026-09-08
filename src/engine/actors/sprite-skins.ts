import * as THREE from 'three';
import { terrainHeight } from '../landscape';
import type { AnimalCommand, LivingAnimal } from './animals';
import type { SpriteFigure } from './sprite-figure';

/**
 * A photoreal sprite card that mirrors a LivingAnimal.
 *
 * The animal rig keeps doing every job it already did — footfall events for
 * audio, terrain-honest leg IK, behaviour springs, collision volumes — but its
 * procedural mesh is hidden, and this card draws the animal instead: the same
 * position and yaw, a 16-direction painted view chosen for the camera angle,
 * and a 2D walk cycle whose cadence follows the animal's real ground speed.
 */
export class QuadrupedSpriteSkin {
  constructor(private animal: LivingAnimal, readonly figure: SpriteFigure, scene: THREE.Scene) {
    animal.mesh.visible = false;
    scene.add(figure.root);
  }

  update(dt: number, cmd: AnimalCommand, camera: THREE.Camera) {
    const a = this.animal;
    this.figure.root.position.set(a.root.position.x, terrainHeight(a.root.position.x, a.root.position.z), a.root.position.z);
    this.figure.root.rotation.y = a.root.rotation.y;
    const grazing = cmd.head.pitch > .45 && Math.abs(cmd.speed) < .12;
    const alerted = cmd.alert > .5;
    this.figure.setAnimalState(grazing ? 'graze' : alerted ? 'alert' : Math.abs(cmd.speed) > .05 ? 'walk' : 'idle');
    this.figure.update(dt, { speed: cmd.speed, pose: 'idle', crouch: 0, actionPhase: 0, lookAt: undefined }, camera);
  }

  dispose() {
    this.figure.dispose();
  }
}
