import type * as THREE from 'three';
import type { OneShotName } from './AnimationStateMachine';
import type { SocketName } from './SocketManager';

/** Weapon set selects the animation sub-graph (idle stance family). */
export type WeaponSet = 'sword_shield' | 'two_hand' | 'dual' | 'bow' | 'unarmed';

export interface PlayOneShotOptions {
  /** Clamp the last frame (sit/kneel poses) until released or replaced. */
  hold?: boolean;
}

/**
 * Stable character-model interface, backed by the skeletal hero: bone
 * sockets, socketed weapons/armour, and the mixer-driven state machine.
 */
export interface CharacterModel {
  readonly root: THREE.Object3D;
  weaponSet: WeaponSet;
  setWeaponSet(ws: WeaponSet): void;
  /** Per-frame sync after the movement controller updates (glow, seating). */
  postUpdate(): void;
  playOneShot(name: OneShotName, opts?: PlayOneShotOptions): Promise<void>;
  /** Release a held pose back to locomotion. */
  releaseHold(): void;
  anchorPosition(name: SocketName, target: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}
