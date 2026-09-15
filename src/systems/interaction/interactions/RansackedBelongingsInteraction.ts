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
 * The ransacked belongings: kneel + a slow, close camera dolly + narrator
 * voice read in the story box + dust motes. No pop-up panel. Re-press yields
 * the short line with no camera move.
 *
 * The first inspection is a lingering shot: the lens drifts in low and close
 * over the looted saddlebags, holds there for the whole line, and only eases
 * back to the follow-cam once the Narrator has finished.
 */
const DOLLY_IN_MS = 2600;
const DOLLY_OUT_MS = 2200;

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
          undefined,
          { heading: 'The ambush clearing', chapter: 'THE AMBUSH CLEARING', dollyIn: DOLLY_IN_MS, dollyOut: DOLLY_OUT_MS },
        );
        await kneel;
        opts.setInspected();
      } else {
        await ctx.narrator.narrate('nothing_of_interest', 'Nothing more of interest here.', null, 2.0, {
          heading: 'The ambush clearing', chapter: 'THE AMBUSH CLEARING',
        });
      }
    },
  };
}
