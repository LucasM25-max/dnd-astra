import * as THREE from 'three';
import type { FighterActor } from '../engine/actors/fighter';

/** Attachment points. Sprites use anchors; a future rig parents these to bones. */
export type SocketName = 'mainhand' | 'offhand' | 'back' | 'hip' | 'quiver';

const STATIC_OFFSETS: Record<'back' | 'hip' | 'quiver', [number, number, number]> = {
  back: [0, 1.25, -0.22],
  hip: [-0.2, 0.85, 0.05],
  quiver: [0.22, 1.45, -0.2],
};

/** Ensure static anchors exist (hand anchors are refreshed every frame by the actor). */
export function ensureSockets(actor: FighterActor): void {
  for (const [name, [x, y, z]] of Object.entries(STATIC_OFFSETS) as ['back' | 'hip' | 'quiver', [number, number, number]][]) {
    if (!actor.anchors.has(name)) actor.anchor(name, { x, y, z });
  }
}

export function socketPosition(actor: FighterActor, name: SocketName, target: THREE.Vector3): THREE.Vector3 {
  ensureSockets(actor);
  if (name === 'mainhand') return actor.anchorPosition('handR', target);
  if (name === 'offhand') return actor.anchorPosition('handL', target);
  return actor.anchorPosition(name, target);
}
