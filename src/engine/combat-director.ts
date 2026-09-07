import * as THREE from 'three';
import {
  AMBUSHERS, AMBUSH_CENTRE, AMBUSH_TRIGGER_RADIUS, AFTERMATH_NOTE, CAPTURE,
  DEFEAT_OUTCOME, GOBLIN_TRAIL_MOUTH, TRAIL_DISCOVERY,
} from '../game/ambush';
import { Encounter, distanceFeet, type ActionId, type Combatant, type LogEntry } from '../game/encounter';
import { WEAPONS, isRanged } from '../game/equipment';
import { SPELLS } from '../game/spells';
import { feetToMetres, metresToFeet, resolveCheck, type Cover } from '../game/rules';
import { addExperience } from '../game/progression';
import { applySoloProfile, baselineOf, soloProfile, type SoloProfile } from '../game/solo-balance';
import { encounterDifficulty } from '../game/bestiary';
import { saveCharacter, type CharacterSheet } from '../game/character';
import { EncounterView, chooseWeapon, makeVisibility } from './encounter-view';
import { AmbushSite, buildTrailMarker } from './ambush-props';
import type { CombatMaterials } from './actors/combat-materials';
import type { CollisionField } from './landscape';
import { terrainHeight } from './landscape';
import type { PlayerController } from './controller';

/**
 * Runs the Cragmaw ambush as a real event in the 3D world.
 *
 * The director owns the state machine — hidden, sprung, fighting, resolved —
 * and mediates between the player's physical position in the world and the
 * deterministic encounter engine. Combat is turn-based and tactical, but it
 * happens on the actual road, with the actual trees providing the actual
 * cover, and the player walks their own movement rather than clicking a grid.
 */

export type CombatPhase = 'dormant' | 'sprung' | 'active' | 'resolved' | 'lost';

export interface CombatSnapshot {
  phase: CombatPhase;
  round: number;
  activeId: string | null;
  isPlayerTurn: boolean;
  finished: boolean;
  outcome: 'victory' | 'defeat' | null;
  combatants: {
    id: string; name: string; side: 'party' | 'enemy';
    hp: number; maxHp: number; ac: number; initiative: number;
    conditions: string[]; distanceFeet: number; dead: boolean; downed: boolean;
    deathSaves: { successes: number; failures: number };
  }[];
  budget: { movementLeft: number; movementTotal: number; action: boolean; bonusAction: boolean; attacks: number } | null;
  log: LogEntry[];
  /** Live attack preview for whatever the player is pointing at. */
  preview: {
    targetId: string; targetName: string; hitChance: number; damage: string;
    cover: Cover; gap: number; inRange: boolean; state: string;
    advantage: string[]; disadvantage: string[]; weapon: string;
  } | null;
  spells: { id: string; name: string; level: number; available: boolean; slots: string }[];
  hero: { hp: number; maxHp: number; ac: number; slots: number[]; slotsUsed: number[] } | null;
  notice: string | null;
  /** The declared solo-play handicap, shown to the player. */
  solo: { notes: string[]; luck: number } | null;
}

export class CombatDirector {
  phase: CombatPhase = 'dormant';
  encounter: Encounter | null = null;
  view: EncounterView | null = null;
  site: AmbushSite | null = null;
  private trailMarker: THREE.Object3D | null = null;
  private heroId = '';
  private lastNotice: string | null = null;
  private enemyTurnTimer = 0;
  private pendingEnemyTurn = false;
  private fledId: string | null = null;
  private aftermathShown = false;
  spotted = false;
  solo: SoloProfile | null = null;
  private capturedIds = new Set<string>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  onNotice: (message: string) => void = () => {};
  onLog: (entries: LogEntry[]) => void = () => {};
  onPhaseChange: (phase: CombatPhase) => void = () => {};
  onCameraFocus: (target: THREE.Vector3 | null) => void = () => {};

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private controller: PlayerController,
    private collision: CollisionField,
    private materials: CombatMaterials,
    private quality: 'performance' | 'balanced' | 'high',
  ) {}

  /** Build the evidence at the site; the goblins spawn hidden with it. */
  prepare() {
    this.site = new AmbushSite(this.materials);
    this.site.addTo(this.scene);
  }

  /** Springs when the player walks within reach of the looted horses. */
  checkTrigger(playerPosition: THREE.Vector3, character: CharacterSheet | null, onFoot: boolean) {
    if (this.phase !== 'dormant' || !character || !onFoot) return false;
    const gap = Math.hypot(playerPosition.x - AMBUSH_CENTRE.x, playerPosition.z - AMBUSH_CENTRE.z);
    if (gap > AMBUSH_TRIGGER_RADIUS) return false;
    this.spring(playerPosition, character);
    return true;
  }

  private spring(playerPosition: THREE.Vector3, character: CharacterSheet) {
    const visibility = makeVisibility(this.collision);

    // The module's four goblins are written for a party of four. Work out how
    // far over the line that puts a lone hero and hand the encounter a
    // declared handicap, rather than shipping an unwinnable opening fight.
    const difficulty = encounterDifficulty(AMBUSHERS.map(a => a.monsterId), character.level, 1);
    this.solo = soloProfile(character.level, difficulty.adjusted, baselineOf(character));
    const buffed = applySoloProfile(character, this.solo);

    const encounter = new Encounter({
      id: 'cragmaw-ambush',
      // The seed is stable per character, so a reload replays the same fight.
      seed: Math.abs(hashString(character.id)) | 0,
      lineOfSight: visibility.lineOfSight,
      coverBetween: visibility.coverBetween,
      passable: visibility.passable,
      solo: this.solo,
    });

    const hero = encounter.addCharacter(buffed, { x: playerPosition.x, z: playerPosition.z }, this.controller.yaw);
    this.heroId = hero.id;

    for (const spawn of AMBUSHERS) {
      const goblin = encounter.addMonster(spawn.monsterId, spawn.id, spawn.hide);
      goblin.name = spawn.name;
      // They break cover to their strike position the moment initiative rolls.
      goblin.position = { ...spawn.hide };
      goblin.facing = Math.atan2(playerPosition.x - spawn.hide.x, playerPosition.z - spawn.hide.z);
    }

    // Per the module, the goblins have Stealth +6 and surprise the party only
    // if they beat the traveller's passive Perception. A watchful character
    // spots the ambush and acts on round one.
    const stealth = 12 + 6;   // fixed DC 12 hide roll plus the goblin bonus
    this.spotted = character.passivePerception >= stealth;
    if (!this.spotted) encounter.markSurprised([hero.id]);

    this.view = new EncounterView(encounter, this.materials, this.quality);
    this.view.spawnAll(this.scene);
    this.view.onFootfall = undefined;

    encounter.start();
    this.encounter = encounter;
    this.phase = 'sprung';
    this.onPhaseChange(this.phase);

    // Break cover: move each goblin from its hide to its strike position.
    for (const spawn of AMBUSHERS) {
      const goblin = encounter.byId(spawn.id);
      if (goblin) goblin.position = { ...spawn.strike };
    }
    this.view.reveal();

    this.notice(this.spotted
      ? 'You catch the movement in the bracken a heartbeat early. Four goblins — two each side.'
      : 'Ambush! Four goblins break from the thickets on both sides of the road.');
    this.onLog(encounter.log.slice(-6));
    this.phase = 'active';
    this.onPhaseChange(this.phase);
    this.scheduleEnemyTurnIfNeeded();
  }

  private notice(message: string) { this.lastNotice = message; this.onNotice(message); }

  // -- player actions -------------------------------------------------------

  /** The player's avatar position is authoritative during their own turn. */
  syncHeroPosition(position: THREE.Vector3) {
    const hero = this.hero;
    if (!hero || !hero.position || !this.encounter) return;
    if (!this.encounter.isPlayerTurn) return;
    // Charge the movement actually walked, and stop the player when it runs out.
    const walked = distanceFeet(hero.position, { x: position.x, z: position.z });
    if (walked < 0.01) return;
    const left = hero.budget.movement - hero.budget.movementUsed;
    if (walked > left) return;      // the controller clamps before we get here
    hero.budget.movementUsed += walked;
    hero.position = { x: position.x, z: position.z };
    hero.facing = this.controller.yaw;
  }

  /** Metres of movement the player has left this turn. */
  movementLeftMetres() {
    const hero = this.hero;
    if (!hero || !this.encounter?.isPlayerTurn) return Infinity;
    return feetToMetres(Math.max(0, hero.budget.movement - hero.budget.movementUsed));
  }

  get hero(): Combatant | undefined { return this.encounter?.byId(this.heroId); }

  attack(targetId: string): boolean {
    if (!this.encounter?.isPlayerTurn) return false;
    const hero = this.hero, target = this.encounter.byId(targetId);
    if (!hero || !target) return false;
    const gap = this.encounter.gapFeet(hero, target);
    const weaponId = chooseWeapon(hero, gap);
    const weapon = WEAPONS[weaponId];

    const before = target.health.hp;
    const outcome = this.encounter.perform({ type: 'attack', targetId, weaponId });
    if (!outcome.ok) { this.notice(outcome.reason ?? 'You cannot do that.'); return false; }

    // Show the shot travelling, and only then let the log land.
    if (weapon && isRanged(weapon) && this.view) {
      const from = new THREE.Vector3(hero.position.x, terrainHeight(hero.position.x, hero.position.z) + 1.3, hero.position.z);
      const to = this.view.positionOf(targetId);
      if (to) this.view.spawnTracer(from, to.clone().setY(to.y + 0.9), 'arrow');
    }
    void before;
    this.onLog(outcome.entries);
    this.afterPlayerAction();
    return true;
  }

  cast(spellId: string, targetIds: string[], slotLevel?: number): boolean {
    if (!this.encounter?.isPlayerTurn) return false;
    const hero = this.hero;
    if (!hero) return false;
    const spell = SPELLS[spellId];
    const outcome = this.encounter.perform({ type: 'cast', spellId, targetIds, slotLevel });
    if (!outcome.ok) { this.notice(outcome.reason ?? 'The spell fails.'); return false; }

    if (this.view && spell?.damageType) {
      const from = new THREE.Vector3(hero.position.x, terrainHeight(hero.position.x, hero.position.z) + 1.4, hero.position.z);
      const kind = spell.damageType === 'fire' ? 'fire' : spell.damageType === 'cold' ? 'frost' : 'force';
      for (const id of targetIds) {
        const to = this.view.positionOf(id);
        if (to) this.view.spawnTracer(from, to.clone().setY(to.y + 0.9), kind);
      }
    }
    this.onLog(outcome.entries);
    this.afterPlayerAction();
    return true;
  }

  /** Any non-attack action the UI exposes. */
  act(action: ActionId): boolean {
    if (!this.encounter?.isPlayerTurn) return false;
    const outcome = this.encounter.perform(action);
    if (!outcome.ok) { this.notice(outcome.reason ?? 'You cannot do that.'); return false; }
    this.onLog(outcome.entries);
    this.afterPlayerAction();
    return true;
  }

  endTurn() {
    if (!this.encounter?.isPlayerTurn) return false;
    const entries = this.encounter.endTurn();
    this.onLog(entries);
    this.afterPlayerAction();
    return true;
  }

  private afterPlayerAction() {
    if (!this.encounter) return;
    this.checkFleeCondition();
    if (this.encounter.finished) { this.resolve(); return; }
    // If the player has nothing left, roll straight into the enemy turns.
    const hero = this.hero;
    if (hero && this.encounter.isPlayerTurn && !hero.budget.action && !hero.budget.bonusAction
      && hero.budget.movementUsed >= hero.budget.movement - 0.5) {
      this.onLog(this.encounter.endTurn());
    }
    this.scheduleEnemyTurnIfNeeded();
  }

  private scheduleEnemyTurnIfNeeded() {
    if (!this.encounter || this.encounter.finished) return;
    const active = this.encounter.active;
    if (active && active.side === 'enemy') {
      this.pendingEnemyTurn = true;
      // A short beat so the player can read what just happened.
      this.enemyTurnTimer = 0.75;
      this.onCameraFocus(this.view?.positionOf(active.id) ?? null);
    } else {
      this.pendingEnemyTurn = false;
      this.onCameraFocus(null);
    }
  }

  /**
   * The goblins fight to the death until one remains; that one flees for the
   * trail rather than dying in place.
   */
  private checkFleeCondition() {
    if (!this.encounter || this.fledId) return;
    const alive = this.encounter.living('enemy');
    if (alive.length !== 1) return;
    const last = alive[0];
    this.fledId = last.id;
    // It leaves the fight alive. Routing it through the engine's own withdraw
    // path is what re-checks the win condition — marking it dead by hand here
    // left the encounter running with no living enemies and no end.
    const entries = this.encounter.withdraw(
      last.id,
      'The survivor turns and bolts for a gap in the northern thickets. It knows exactly where it is going.',
    );
    this.view?.fleeToTrail(last.id);
    this.notice('The last goblin breaks and runs northwest into the trees.');
    this.onLog(entries);
  }

  // -- per-frame ------------------------------------------------------------

  update(dt: number, playerPosition: THREE.Vector3, character: CharacterSheet | null, onFoot: boolean, realDelta = dt) {
    this.site?.update(dt, playerPosition, this.phase === 'dormant' || this.phase === 'resolved');

    if (this.phase === 'dormant') {
      this.checkTrigger(playerPosition, character, onFoot);
      return;
    }
    if (!this.encounter || !this.view) return;

    this.view.update(dt, this.camera, playerPosition);

    if (this.phase === 'active' && this.pendingEnemyTurn) {
      // Pacing is wall-clock, not frame-clock: a slow frame must not stretch
      // the beat between enemy turns into a stall.
      this.enemyTurnTimer -= Math.min(realDelta, 0.5);
      if (this.enemyTurnTimer <= 0) {
        const entries = this.encounter.runEnemyTurn();
        this.onLog(entries);
        // Show any arrows the goblins loosed.
        const active = this.encounter.active;
        void active;
        this.checkFleeCondition();
        if (this.encounter.finished) this.resolve();
        else this.scheduleEnemyTurnIfNeeded();
      }
    }
  }

  /** Cursor targeting, so the player aims with the mouse in the 3D world. */
  setPointer(clientX: number, clientY: number, width: number, height: number) {
    if (!this.view) return;
    this.pointer.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.view.hoveredActorId = this.view.pick(this.raycaster);
    // Also project onto the ground for the movement path preview.
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -terrainHeight(this.camera.position.x, this.camera.position.z));
    const hit = new THREE.Vector3();
    this.view.hoverPoint = this.raycaster.ray.intersectPlane(ground, hit) ? hit.clone() : null;
  }

  get hoveredId() { return this.view?.hoveredActorId ?? null; }

  // -- resolution -----------------------------------------------------------

  private resolve() {
    if (!this.encounter) return;
    if (this.encounter.outcome === 'victory') {
      this.phase = 'resolved';
      this.revealTrail();
      if (!this.aftermathShown) {
        this.aftermathShown = true;
        this.onLog([{ id: -2, kind: 'info', text: AFTERMATH_NOTE }]);
      }
    } else {
      // The goblins do not finish you. They loot you and go.
      this.phase = 'lost';
      this.onLog([{ id: -3, kind: 'info', text: DEFEAT_OUTCOME.text }, { id: -4, kind: 'info', text: DEFEAT_OUTCOME.note }]);
      this.revealTrail();
    }
    this.onPhaseChange(this.phase);
  }

  private revealTrail() {
    if (this.trailMarker) return;
    this.trailMarker = buildTrailMarker(this.materials, this.collision);
    this.scene.add(this.trailMarker);
  }

  /** Called by the UI once the player dismisses the after-action panel. */
  finish(character: CharacterSheet | null): CharacterSheet | null {
    if (!this.encounter || !character) return character;
    let sheet = character;
    if (this.encounter.outcome === 'victory' && this.encounter.awardedXp) {
      const result = addExperience(sheet, this.encounter.awardedXp);
      sheet = result.sheet;
      if (result.levels) this.notice(`You reach level ${sheet.level}.`);
    }
    // Carry wounds out of the fight; they are healed by resting, not by exiting.
    const hero = this.hero;
    if (hero) {
      // The solo bonus hit points are a combat-only loan; the saved sheet keeps
      // the character's real maximum, so the buff never compounds across fights.
      const bonus = this.solo?.bonusHp ?? 0;
      const trueHp = Math.max(0, Math.min(sheet.maxHp, hero.health.hp - bonus));
      sheet = {
        ...sheet,
        currentHp: this.encounter.outcome === 'defeat' ? 1 : Math.max(1, trueHp),
        slots: { max: [...hero.slots.max], used: [...hero.slots.used] },
      };
    }
    saveCharacter(sheet);
    return sheet;
  }

  /** A survival check on the trail, once the fight is over. */
  readTrail(character: CharacterSheet): { success: boolean; text: string } {
    const actor = {
      id: character.id, level: character.level, abilities: character.finalAbilities,
      proficiencyBonus: character.proficiencyBonus,
      skills: Object.fromEntries(character.skillProficiencies.map(s => [s, { proficient: true }])),
    };
    const check = resolveCheck({
      kind: 'skill', actor, ability: 'wis', skill: 'survival',
      dc: TRAIL_DISCOVERY.check.dc, seed: hashString(`${character.id}:trail`),
    });
    return { success: !!check.success, text: check.success ? TRAIL_DISCOVERY.check.success : TRAIL_DISCOVERY.check.failure };
  }

  /** Goblins dropped by bludgeoning damage can be questioned later. */
  recordCapture(id: string) { this.capturedIds.add(id); }
  get captured() { return [...this.capturedIds]; }
  get captureNote() { return CAPTURE; }

  // -- snapshot for the HUD -------------------------------------------------

  snapshot(playerPosition: THREE.Vector3): CombatSnapshot | null {
    if (!this.encounter) return null;
    const e = this.encounter;
    const hero = this.hero;
    const hoveredId = this.view?.hoveredActorId ?? null;

    const preview = hoveredId && hero && e.isPlayerTurn
      ? (() => {
        const target = e.byId(hoveredId);
        if (!target || target.health.hp <= 0) return null;
        const gap = e.gapFeet(hero, target);
        const weaponId = chooseWeapon(hero, gap);
        const p = e.previewAttack(hero.id, hoveredId, weaponId);
        if (!p) return null;
        return {
          targetId: hoveredId, targetName: target.name, hitChance: p.hitChance, damage: p.damage,
          cover: p.cover, gap: p.gap, inRange: p.inRange, state: p.state,
          advantage: p.advantage, disadvantage: p.disadvantage, weapon: p.weapon.name,
        };
      })()
      : null;

    const spells = hero
      ? hero.spells.map(id => {
        const spell = SPELLS[id];
        const remaining = spell.level === 0 ? Infinity : (hero.slots.max[spell.level - 1] ?? 0) - (hero.slots.used[spell.level - 1] ?? 0);
        return {
          id, name: spell.name, level: spell.level,
          available: spell.level === 0 || remaining > 0,
          slots: spell.level === 0 ? 'cantrip' : `${Math.max(0, remaining)} left`,
        };
      })
      : [];

    return {
      phase: this.phase,
      round: e.round,
      activeId: e.active?.id ?? null,
      isPlayerTurn: e.isPlayerTurn,
      finished: e.finished,
      outcome: e.outcome,
      combatants: e.combatants.map(c => ({
        id: c.id, name: c.name, side: c.side,
        hp: Math.max(0, c.health.hp), maxHp: c.health.maxHp, ac: c.armorClass,
        initiative: Math.floor(c.initiative),
        conditions: c.conditions.map(x => x.type),
        distanceFeet: Math.round(metresToFeet(Math.hypot(c.position.x - playerPosition.x, c.position.z - playerPosition.z))),
        dead: c.health.dead, downed: c.health.hp <= 0 && !c.health.dead,
        deathSaves: { successes: c.health.deathSaveSuccesses, failures: c.health.deathSaveFailures },
      })),
      budget: hero ? {
        movementLeft: Math.max(0, Math.round(hero.budget.movement - hero.budget.movementUsed)),
        movementTotal: hero.budget.movement,
        action: hero.budget.action, bonusAction: hero.budget.bonusAction,
        attacks: hero.budget.attacksRemaining,
      } : null,
      log: e.log.slice(-30),
      preview,
      spells,
      hero: hero ? {
        hp: Math.max(0, hero.health.hp), maxHp: hero.health.maxHp, ac: hero.armorClass,
        slots: [...hero.slots.max], slotsUsed: [...hero.slots.used],
      } : null,
      notice: this.lastNotice,
      solo: this.solo ? { notes: this.solo.notes, luck: this.solo.luck } : null,
    };
  }

  dispose() {
    this.view?.dispose(this.scene);
    this.site?.dispose(this.scene);
    if (this.trailMarker) this.scene.remove(this.trailMarker);
    this.view = null; this.site = null; this.encounter = null;
  }
}

/** A stable 32-bit hash, so a character always fights the same ambush. */
function hashString(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

export { GOBLIN_TRAIL_MOUTH };
