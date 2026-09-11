import type * as THREE from 'three';
import type { OneShotName, OneShotOptions } from './AnimationStateMachine';
import type { SocketName } from './SocketManager';

/** Weapon set selects the animation sub-graph (idle stances + flourish sets). */
export type WeaponSet = 'sword_shield' | 'two_hand' | 'dual' | 'bow' | 'unarmed';

/**
 * Stable character-model interface, backed by the skeletal hero. The legacy
 * painted-sprite actor survives only inside engine/actors (NPC/fallback use).
 */
export interface CharacterModel {
  readonly root: THREE.Object3D;
  weaponSet: WeaponSet;
  setWeaponSet(ws: WeaponSet): void;
  /** Advance the mixer one frame (call after the movement controller updates). */
  update(dt: number): void;
  playOneShot(name: OneShotName, opts?: OneShotOptions): Promise<void>;
  /** Release a held one-shot pose back to locomotion. */
  releaseHold(fade?: number): void;
  anchorPosition(name: SocketName, target: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}
