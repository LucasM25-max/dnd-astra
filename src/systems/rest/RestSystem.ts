import * as THREE from 'three';
import type { PlayerCharacterController } from '../../character/PlayerCharacterController';
import type { GameClock } from '../../game/time';
import { gameState } from '../../game/state';
import type { InventoryStore } from '../../game/save';
import { roll, rollHidden } from '../dice/DiceRoller';
import { diceSfx } from '../dice/DiceSfx';
import type { NarratorSystem } from '../narration/NarratorSystem';
import type { FloatingText } from '../../world/FloatingText';
import type { ParticleEffects } from '../../world/ParticleEffects';
import { CampMenu } from './CampMenu';
import { RestCinematic } from './RestCinematic';
import {
  REST_CONFIG,
  activePerceptionModifier,
  addPoorlyRested,
  applyLongRest,
  isWellRested,
  longRestAvailable,
  partialRest,
  spendHitDie,
} from './RestResolver';

export interface RestSystemDeps {
  store: InventoryStore;
  clock: GameClock;
  hero: PlayerCharacterController;
  heroPosition: () => THREE.Vector3;
  narrator: NarratorSystem;
  cinematic: RestCinematic;
  fx: ParticleEffects;
  floatText: FloatingText;
  firePosition: () => THREE.Vector3;
  pause: (reason: string) => void;
  resume: (reason: string) => void;
  toast: (message: string) => void;
  openInventory: () => void;
  openSheet: () => void;
}

/** Camp orchestration: menu, long/short rests, ambush nights, recovery. */
export class RestSystem {
  readonly menu: CampMenu;
  private resting = false;

  constructor(private deps: RestSystemDeps) {
    this.menu = new CampMenu({
      getCharacter: () => this.deps.store.getCharacter(),
      cooldownReason: () => {
        const c = this.deps.store.getCharacter();
        if (!c) return 'No character record.';
        return longRestAvailable(c, this.deps.clock.epochMinutes).reason;
      },
      onLongRest: () => void this.initiateLongRest(),
      onShortRest: () => void this.initiateShortRest(),
      onInventory: () => this.deps.openInventory(),
      onSheet: () => this.deps.openSheet(),
      onClose: () => this.closeCamp(),
    });
  }

  async openCamp(): Promise<void> {
    if (this.resting || this.menu.isOpen) return;
    const c = this.deps.store.getCharacter();
    if (!c) {
      this.deps.toast('You need a character record to make camp.');
      return;
    }
    gameState.enter('CAMP', 'menu');
    this.deps.pause('camp');
    if (!c.campfireSeen) {
      c.campfireSeen = true;
      this.deps.store.saveCharacter(c);
      await this.deps.narrator.narrate(
        'rest_while_you_can',
        'The road ahead is long, and the shadows grow deeper. Best to rest while you can.',
        null,
        4.0,
      );
    }
    // Hold a static wide shot of the whole campsite behind the menu.
    await this.deps.cinematic.wideShot(this.deps.firePosition());
    this.menu.show();
  }

  closeCamp(): void {
    if (this.resting) return;
    this.menu.hide();
    void this.deps.cinematic.releaseWide();
    this.deps.resume('camp');
    gameState.exit('CAMP', 'menu');
  }

  async initiateLongRest(): Promise<void> {
    const c = this.deps.store.getCharacter();
    if (!c || this.resting) return;
    const availability = longRestAvailable(c, this.deps.clock.epochMinutes);
    if (!availability.ok) {
      this.deps.toast(availability.reason ?? 'You cannot rest right now.');
      return;
    }
    this.resting = true;
    this.menu.setBusy(true);
    this.menu.hide();
    gameState.enter('CINEMATIC', 'rest');
    try {
      if (isWellRested(c)) {
        await this.deps.narrator.narrate(
          'well_rested_already',
          "You're well-rested already. The night won't make you any readier.",
          null,
          3.5,
        );
      }
      const fire = this.deps.firePosition();
      const sitDown = this.deps.hero.playOneShot('long_rest_sit');
      await this.deps.cinematic.begin(fire);
      await sitDown;

      // Hidden ambush roll (10%): decided up front, revealed at midnight.
      const ambush = rollHidden(20) <= REST_CONFIG.ambushThreshold;
      if (ambush) {
        await this.deps.cinematic.sweepToNight();
        diceSfx.startNightAmbience();
        await this.deps.cinematic.holdNight();
        await this.deps.hero.playOneShot('stand_up');
        await this.deps.narrator.narrate('something_stirs', 'Something stirs in the darkness…', null, 2.5);
        const perceptionMod = activePerceptionModifier(c, this.deps.clock.epochMinutes);
        const check = await roll({ die: 20, modifier: perceptionMod, label: 'Perception Check', dc: REST_CONFIG.perceptionDC });
        c.alertForFutureCombat = check.success === true;
        const healed = partialRest(c);
        this.deps.store.saveCharacter(c);
        if (healed > 0) {
          this.deps.floatText.show(`+${healed} HP`, 'heal', this.deps.heroPosition());
          this.deps.fx.healingSparkles(this.deps.heroPosition());
        }
        await this.deps.narrator.narrate(
          'retreated_for_now',
          'Whatever lurked in the shadows has retreated… for now. You sleep uneasily for the rest of the night.',
          null,
          4.5,
        );
        const resumeSit = this.deps.hero.playOneShot('long_rest_sit');
        diceSfx.stopNightAmbience();
        diceSfx.dawnChorus();
        await this.deps.cinematic.sweepToDawn();
        await resumeSit;
        const { hpRestored } = applyLongRest(c);
        addPoorlyRested(c, this.deps.clock.epochMinutes);
        c.lastLongRestEpochMin = Math.floor(this.deps.clock.epochMinutes);
        this.deps.store.saveCharacter(c);
        await this.deps.cinematic.end();
        await this.deps.hero.playOneShot('stand_up');
        this.showWakeEffects(hpRestored);
        this.deps.toast('Poorly Rested: −1 to Perception for 1 hour.');
      } else {
        await this.deps.cinematic.sweepToNight();
        diceSfx.startNightAmbience();
        await this.deps.cinematic.holdNight();
        diceSfx.stopNightAmbience();
        diceSfx.dawnChorus();
        await this.deps.cinematic.sweepToDawn();
        const { hpRestored } = applyLongRest(c);
        c.lastLongRestEpochMin = Math.floor(this.deps.clock.epochMinutes);
        this.deps.store.saveCharacter(c);
        await this.deps.cinematic.end();
        await this.deps.hero.playOneShot('stand_up');
        this.showWakeEffects(hpRestored);
      }
      // A long rest rolls the world to the next 6:00 am.
      const rolledOver = this.deps.clock.restUntilMorning();
      this.deps.toast(
        rolledOver
          ? `${this.deps.clock.dateLabel()} — dawn of a new day on the road.`
          : `Dawn, ${this.deps.clock.dateLabel()} — an early start.`,
      );
      await this.deps.narrator.narrate('dawn_breaks', 'Dawn breaks. You feel renewed.', null, 2.5);
    } finally {
      diceSfx.stopNightAmbience();
      this.resting = false;
      this.menu.setBusy(false);
      gameState.exit('CINEMATIC', 'rest');
      // Stay in camp after resting so the player can review the refreshed sheet.
      this.menu.refresh();
      this.menu.show();
    }
  }

  async initiateShortRest(): Promise<void> {
    const c = this.deps.store.getCharacter();
    if (!c || this.resting) return;
    if (c.hitDice.current < 1) {
      this.deps.toast('No Hit Dice left. Take a long rest to recover them.');
      return;
    }
    if (c.hp.current >= c.hp.max && c.features.secondWind.usesCurrent >= c.features.secondWind.usesMax) {
      this.deps.toast('You are already hale and ready — a short rest would change nothing.');
      return;
    }
    this.resting = true;
    this.menu.setBusy(true);
    try {
      const breathe = this.deps.hero.playOneShot('second_wind');
      const conMod = c.abilityScores.CON.modifier;
      const result = await roll({ die: 10, modifier: conMod, label: 'Hit Die — Healing' });
      await breathe;
      const healed = spendHitDie(c, result.total);
      this.deps.clock.advanceHours(REST_CONFIG.shortRestHours);
      this.deps.store.saveCharacter(c);
      if (healed > 0) {
        this.deps.floatText.show(`+${healed} HP`, 'heal', this.deps.heroPosition());
        this.deps.fx.healingSparkles(this.deps.heroPosition());
        diceSfx.heal();
      } else {
        this.deps.toast('Second Wind refreshed.');
      }
      this.menu.refresh();
    } finally {
      this.resting = false;
      this.menu.setBusy(false);
    }
  }

  private showWakeEffects(hpRestored: number): void {
    const pos = this.deps.heroPosition();
    if (hpRestored > 0) {
      this.deps.floatText.show(`+${hpRestored} HP`, 'heal', pos);
      this.deps.fx.healingSparkles(pos);
    }
    this.deps.fx.inspirationShimmer(pos);
    diceSfx.restChime();
  }
}
