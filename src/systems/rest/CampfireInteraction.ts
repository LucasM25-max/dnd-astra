import * as THREE from 'three';
import type { InteractionDef } from '../interaction/InteractionManager';

export interface CampfireOptions {
  position: THREE.Vector3;
  radius?: number;
  canInteract: () => boolean;
  onOpenCamp: () => Promise<void>;
}

/** [E] Set Up Camp — the gateway to the camp menu. (World prompt; menu owned by RestSystem.) */
export function createCampfireInteraction(opts: CampfireOptions): InteractionDef {
  return {
    id: 'campfire',
    position: opts.position,
    radius: opts.radius ?? 3.2,
    prompt: 'Set Up Camp',
    icon: 'moon',
    when: opts.canInteract,
    async onInteract() {
      await opts.onOpenCamp();
    },
  };
}
