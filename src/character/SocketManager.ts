import type * as THREE from 'three';
import type { SkeletalHero } from './skeletal/SkeletalHero';

/** Real bone-socket attachment points on the skeletal hero. */
export type SocketName = 'mainhand' | 'offhand' | 'back' | 'hip' | 'quiver';

/** World position of a named bone socket (updates the bone chain first). */
export function socketPosition(
  hero: SkeletalHero,
  name: SocketName,
  target: THREE.Vector3,
): THREE.Vector3 {
  return hero.anchorPosition(name, target);
}
