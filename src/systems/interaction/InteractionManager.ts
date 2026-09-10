import * as THREE from 'three';
import type { PlayerCharacterController } from '../../character/PlayerCharacterController';
import type { NarratorSystem } from '../narration/NarratorSystem';

export interface InteractContext {
  hero: PlayerCharacterController;
  narrator: NarratorSystem;
}

export interface InteractionDef {
  id: string;
  position: THREE.Vector3;
  radius: number;
  prompt: string;
  icon?: string;
  when: () => boolean;
  onInteract: (ctx: InteractContext) => Promise<void>;
}

/** Proximity + E-key registry for world interactions. */
export class InteractionManager {
  private defs = new Map<string, InteractionDef>();
  busy = false;

  register(def: InteractionDef): void {
    this.defs.set(def.id, def);
  }

  unregister(id: string): void {
    this.defs.delete(id);
  }

  nearest(player: THREE.Vector3): InteractionDef | null {
    let best: InteractionDef | null = null;
    let bestDistance = Infinity;
    for (const def of this.defs.values()) {
      if (!def.when()) continue;
      const d = Math.hypot(player.x - def.position.x, player.z - def.position.z);
      if (d < def.radius && d < bestDistance) {
        best = def;
        bestDistance = d;
      }
    }
    return best;
  }

  async interact(ctx: InteractContext, def: InteractionDef): Promise<boolean> {
    if (this.busy || !def.when()) return false;
    this.busy = true;
    try {
      await def.onInteract(ctx);
      return true;
    } finally {
      this.busy = false;
    }
  }
}
