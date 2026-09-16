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
 * The ransacked belongings:
 * Camera pan happens first, followed by a slightly longer kneel inspection
 * animation sifting through the belongings, then pans out.
 */
const DOLLY_IN_MS = 1000;
const DOLLY_OUT_MS = 900;

export function createRansackedBelongingsInteraction(opts: RansackedOptions): InteractionDef {
  return {
    id: 'ransacked_belongings',
    position: opts.position,
    radius: opts.radius ?? 2.5,
    prompt: 'Examine the ransacked belongings',
    when: opts.canInteract,
    async onInteract(ctx) {
      if (!opts.isInspected()) {
        await ctx.narrator.narrate(
          'ransacked_belongings',
          "The horses' saddlebags have been looted. An empty leather map case lies nearby.",
          opts.focus,
          undefined,
          {
            heading: 'The ambush clearing',
            chapter: 'THE AMBUSH CLEARING',
            dollyIn: DOLLY_IN_MS,
            dollyOut: DOLLY_OUT_MS,
            async onFocus() {
              ctx.hero.faceTowards(opts.position);
              const kneel = ctx.hero.playOneShot('interact');
              window.setTimeout(() => opts.dustBurst(opts.position), 350);
              await kneel;
              opts.setInspected();
            },
          },
        );
        opts.setInspected();
      } else {
        await ctx.narrator.narrate('nothing_of_interest', 'Nothing more of interest here.', null, 2.0, {
          heading: 'The ambush clearing', chapter: 'THE AMBUSH CLEARING',
        });
      }
    },
  };
}
