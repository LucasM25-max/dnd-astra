import * as THREE from 'three';
import type { Adventure } from '../../../engine/adventure';
import type { InventoryStore } from '../../../game/save';
import { skillModifier } from '../../../game/character';
import { roll } from '../../dice/DiceRoller';
import type { InteractionDef } from '../InteractionManager';

export interface TieHorsesOptions {
  position: THREE.Vector3;
  radius?: number;
  adventure: Adventure;
  inventory: InventoryStore;
  canInteract: () => boolean;
  setTied: () => void;
}

const HEADING = 'The ambush clearing';
const CHAPTER = 'THE AMBUSH CLEARING';

/**
 * After the ransacked belongings have been checked, the player can calm the
 * two loose horses and tie them off at the roadside stakes: a DC 12 Animal
 * Handling check on the shared dice mechanics.
 * When successful, the hero walks over to the hitching posts, knots the lead
 * ropes while the horses lead themselves in and settle. A failed check spooks
 * them and can be retried.
 */
export function createTieHorsesInteraction(opts: TieHorsesOptions): InteractionDef {
  return {
    id: 'tie_horses',
    position: opts.position,
    radius: opts.radius ?? 3.4,
    prompt: 'Calm and tie off the horses',
    when: opts.canInteract,
    async onInteract(ctx) {
      const character = opts.inventory.getCharacter();
      const modifier = character ? skillModifier(character, 'animal_handling') : 0;
      await ctx.narrator.narrate(
        'horses_settle',
        'Two horses crop the grass at the edge of the clearing, unhurt but wary. A length of lead rope dangles from the nearer halter.',
        null, undefined, { heading: HEADING, chapter: CHAPTER },
      );
      const result = await roll({ die: 20, modifier, label: 'Animal Handling', dc: 12 });
      if (result.success) {
        // Walk over to the roadside hitching stakes to tie the knot
        const postSpot = new THREE.Vector3(7.25, 0, 2.75);
        await ctx.hero.walkTo(postSpot);
        ctx.hero.faceTowards(new THREE.Vector3(7.25, 0, 3.55));

        opts.adventure.beginTie();
        const knot = ctx.hero.playOneShot('tie_knot');
        await ctx.narrator.narrate(
          'horses_tied',
          'You knot both lead ropes to the hitching stakes. The horses blow softly through their noses and settle, heads low, finally at ease.',
          null, undefined, { heading: HEADING, chapter: CHAPTER },
        );
        await knot;
        opts.setTied();
      } else {
        opts.adventure.startleHorses();
        await ctx.narrator.narrate(
          'horses_refuse',
          'The bay jerks back against the rope and whirls, hooves striking sparks from a stone. Steadier hands, or a better roll, are needed here.',
          null, undefined, { heading: HEADING, chapter: CHAPTER },
        );
      }
    },
  };
}
