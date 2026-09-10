import type * as THREE from 'three';
import type { OneShotName } from './AnimationStateMachine';
import type { SocketName } from './SocketManager';

/** Weapon set selects the animation sub-graph (sprite variants today, GLB clips in future). */
export type WeaponSet = 'sword_shield' | 'two_hand' | 'dual' | 'bow' | 'unarmed';

/**
 * Stable character-model interface. Today backed by the painted 2.5D sprite
 * actor; a future GLB rig implements the same contract.
 */
export interface CharacterModel {
  readonly root: THREE.Object3D;
  weaponSet: WeaponSet;
  setWeaponSet(ws: WeaponSet): void;
  /** One-shot overlays (dip/glow/seat) applied after the movement controller updates. */
  postUpdate(): void;
  playOneShot(name: OneShotName): Promise<void>;
  anchorPosition(name: SocketName, target: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}
