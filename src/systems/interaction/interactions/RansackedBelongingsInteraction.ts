import * as THREE from 'three';
import type { CameraFocus } from '../../narration/NarratorCamera';
import type { InteractionDef } from '../InteractionManager';

export interface RansackedOptions {
  position: THREE.Vector3;
  focus: CameraFocus;
  radius?: number;
  isInspected: () => boolean;
  setInspected: () => void;
  dustBurst: (position: THREE.Vector3) => void;
  canInteract: () => boolean;
}

/**
 * The ransacked belongings: kneel + camera dolly + narrator voice + subtitles
 * + dust motes. No pop-up box. Re-press yields the short line.
 */
export function createRansackedBelongingsInteraction(opts: RansackedOptions): InteractionDef {
  return {
    id: 'ransacked_belongings',
    position: opts.position,
    radius: opts.radius ?? 2.5,
    prompt: 'Examine the ransacked belongings',
    when: opts.canInteract,
    async onInteract(ctx) {
      if (!opts.isInspected()) {
        const kneel = ctx.hero.playOneShot('interact');
        opts.dustBurst(opts.position);
        await ctx.narrator.narrate(
          'ransacked_belongings',
          "The horses' saddlebags have been looted. An empty leather map case lies nearby.",
          opts.focus,
          4.5,
        );
        await kneel;
        opts.setInspected();
      } else {
        await ctx.narrator.narrate('nothing_of_interest', 'Nothing more of interest here.', null, 2.0);
      }
    },
  };
}
