import type * as THREE from 'three';
import type { SkeletalHero } from './skeletal/SkeletalHero';

/** Attachment points — real bone sockets on the skeletal hero. */
export type SocketName = 'mainhand' | 'offhand' | 'back' | 'hip' | 'quiver';

export function socketPosition(
  hero: SkeletalHero,
  name: SocketName,
  target: THREE.Vector3,
): THREE.Vector3 {
  return hero.anchorPosition(name, target);
}
