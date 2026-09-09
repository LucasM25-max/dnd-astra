import * as THREE from 'three';
import {
  AMBUSHERS, AMBUSH_CENTRE, AMBUSH_TRIGGER_RADIUS, AFTERMATH_NOTE, CAPTURE,
  DEFEAT_OUTCOME, GOBLIN_TRAIL_MOUTH, TRAIL_DISCOVERY,
} from '../game/ambush';
import { Encounter, distanceFeet, type ActionId, type AttackPresentation, type Combatant, type LogEntry } from '../game/encounter';
import { WEAPONS } from '../game/equipment';
import { SPELLS } from '../game/spells';
import { feetToMetres, metresToFeet, resolveCheck, type Cover } from '../game/rules';
import { addExperience } from '../game/progression';
import { applySoloProfile, baselineOf, soloProfile, type SoloProfile } from '../game/solo-balance';
import { encounterDifficulty } from '../game/bestiary';
import { saveCharacter, type CharacterSheet } from '../game/character';
import { EncounterView, chooseWeapon, makeVisibility } from './encounter-view';
import { AmbushSite, buildTrailMarker } from './ambush-props';
import type { CombatMaterials } from './actors/combat-materials';
import type { SpriteLibrary } from './actors/sprite-figure';
import { DiceTray } from './actors/dice';
import { CombatFx } from './combat-fx';
import type { CollisionField } from './landscape';
import { terrainHeight } from './landscape';
import type { PlayerController } from './controller';
import type { CombatAudio } from './audio';

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

/**
 * One staged attack in the presentation timeline: the engine resolved it
 * instantly; the director now replays it as a physical event — movement
 * finishes, dice tumble (the hero's rolls), the body winds up, an arrow
 * flies, and only then do the log, the blood, the number and the health
 * bar land, all on the same frame the blow connects.
 */
interface StrikeCluster {
  attackerId: string;
  attackerIsHero: boolean;
  targetId: string | null;
  attack: AttackPresentation;
  attackEntry: LogEntry;
  followEntries: LogEntry[];
  phase: 'waitMove' | 'dice' | 'windup' | 'flight' | 'linger';
  timer: number;
  windupDuration: number;
  flightDuration: number;
  damageKind: 'fire' | 'frost' | 'force' | 'arrow' | 'melee';
}

/** A staged spell: cast pose, bolt flight, then the effects reveal at arrival. */
interface SpellCluster {
  casterId: string;
  casterIsHero: boolean;
  targets: { id: string }[];
  kind: 'fire' | 'frost' | 'force';
  entries: LogEntry[];
  phase: 'windup' | 'flight' | 'linger';
  timer: number;
  flight: number;
}

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
  // -- presentation timeline ------------------------------------------------
  private queue: LogEntry[] = [];
  private cluster: StrikeCluster | SpellCluster | null = null;
  private presenting = false;
  private dice: DiceTray | null = null;
  private shakeAmplitude = 0;
  private audio: CombatAudio;
  /** Damped centroid of the fight; steers the top-down combat camera. */
  private combatFocus = new THREE.Vector3();

  onNotice: (message: string) => void = () => {};
  onLog: (entries: LogEntry[]) => void = () => {};
  onPhaseChange: (phase: CombatPhase) => void = () => {};
  onCameraFocus: (target: THREE.Vector3 | null) => void = () => {};

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private renderer: THREE.WebGLRenderer,
    private controller: PlayerController,
    private collision: CollisionField,
    private materials: CombatMaterials,
    private sprites: SpriteLibrary | null,
    private quality: 'performance' | 'balanced' | 'high',
    audio: CombatAudio,
  ) {
    this.audio = audio;
    this.dice = new DiceTray(scene);
  }

  /** Camera shake amplitude, consumed by the world each frame. */
  takeShake(): number {
    const value = this.shakeAmplitude;
    return value;
  }

  private addShake(amount: number) {
    this.shakeAmplitude = Math.min(0.5, Math.max(this.shakeAmplitude, amount));
  }

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

    this.view = new EncounterView(encounter, this.materials, this.quality, this.sprites);
    this.view.spawnAll(this.scene);
    this.view.onFootfall = undefined;

    // Compile every program the fight will use while the ambush beat still
    // covers the screen — no hit, spell, or dice roll may stall on shaders.
    // Software renderers compile hundreds of times slower and gain nothing
    // (their stall just moves), so only real GPUs warm up.
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '');
      if (!/swiftshader|llvmpipe|softpipe|software/i.test(gpu)) {
        this.dice?.precompile(this.renderer, this.scene, this.camera);
        CombatFx.precompile(this.renderer, this.scene, this.camera);
      }
    } catch { /* A warm-up failure must never block the fight. */ }

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
    // Tactical framing for the fight: top-down over the ambush, north-up, on
    // the walking camera. The camera glides there; the grid fades in with it.
    this.controller.setMode('third');
    this.controller.combatCamera = true;
    this.controller.yaw = 0;
    this.combatFocus.set(playerPosition.x, 0, playerPosition.z);
    this.controller.combatFocus.copy(this.combatFocus);
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
    void weapon;

    const outcome = this.encounter.perform({ type: 'attack', targetId, weaponId });
    if (!outcome.ok) { this.notice(outcome.reason ?? 'You cannot do that.'); return false; }

    this.enqueue(outcome.entries);
    this.afterPlayerAction();
    return true;
  }

  cast(spellId: string, targetIds: string[], slotLevel?: number): boolean {
    if (!this.encounter?.isPlayerTurn) return false;
    const hero = this.hero;
    if (!hero) return false;
    void hero;
    const outcome = this.encounter.perform({ type: 'cast', spellId, targetIds, slotLevel });
    if (!outcome.ok) { this.notice(outcome.reason ?? 'The spell fails.'); return false; }

    this.enqueue(outcome.entries);
    this.afterPlayerAction();
    return true;
  }

  /** Any non-attack action the UI exposes. */
  act(action: ActionId): boolean {
    if (!this.encounter?.isPlayerTurn) return false;
    const outcome = this.encounter.perform(action);
    if (!outcome.ok) { this.notice(outcome.reason ?? 'You cannot do that.'); return false; }
    this.enqueue(outcome.entries);
    this.afterPlayerAction();
    return true;
  }

  endTurn() {
    if (!this.encounter?.isPlayerTurn) return false;
    this.enqueue(this.encounter.endTurn());
    this.afterPlayerAction();
    return true;
  }

  private afterPlayerAction() {
    if (!this.encounter) return;
    // If the player has nothing left, roll straight into the enemy turns —
    // but the end-turn entries still queue behind any strike in flight.
    const hero = this.hero;
    if (hero && this.encounter.isPlayerTurn && !hero.budget.action && !hero.budget.bonusAction
      && hero.budget.movementUsed >= hero.budget.movement - 0.5) {
      this.queue.push(...this.encounter.endTurn());
    }
    this.runQueue();
  }

  private scheduleEnemyTurnIfNeeded() {
    if (!this.encounter || this.encounter.finished) return;
    const active = this.encounter.active;
    if (active && active.side === 'enemy') {
      this.pendingEnemyTurn = true;
      // A deliberate beat: the player reads the banner, the goblin turns,
      // and then it comes. Long enough to feel like a turn, not a flicker.
      this.enemyTurnTimer = 1.05;
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
    this.queue.push(...entries);
  }

  // -- per-frame ------------------------------------------------------------

  update(dt: number, playerPosition: THREE.Vector3, character: CharacterSheet | null, onFoot: boolean, realDelta = dt) {
    this.site?.update(dt, playerPosition, this.phase === 'dormant' || this.phase === 'resolved');
    // Camera shake decays on the presentation clock.
    this.shakeAmplitude = Math.max(0, this.shakeAmplitude - realDelta * 1.6);

    if (this.phase === 'dormant') {
      this.checkTrigger(playerPosition, character, onFoot);
      return;
    }
    if (!this.encounter || !this.view) return;

    // Presentation runs on wall clock (capped), so slow frames slow nothing:
    // a goblin's windup takes as long as it takes, not ten times it.
    this.view.update(Math.min(realDelta, 0.25), this.camera, playerPosition);
    this.dice?.update(Math.min(realDelta, 0.25));

    // Every strike aims with the hero anchor, and the top-down frame rides
    // the damped middle of the fight (hero plus living enemies).
    this.view.trackHero(this.controller.position, this.controller.spriteBody?.headHeight ?? 1.62);
    if (this.phase === 'active' || this.phase === 'sprung') {
      const centroid = new THREE.Vector3(this.controller.position.x, 0, this.controller.position.z);
      let count = 1;
      for (const enemy of this.encounter.living('enemy')) {
        if (!enemy.position) continue;
        centroid.x += enemy.position.x; centroid.z += enemy.position.z; count++;
      }
      centroid.x /= count; centroid.z /= count;
      const dx = centroid.x - AMBUSH_CENTRE.x, dz = centroid.z - AMBUSH_CENTRE.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 14) { centroid.x = AMBUSH_CENTRE.x + dx / dist * 14; centroid.z = AMBUSH_CENTRE.z + dz / dist * 14; }
      this.combatFocus.lerp(centroid, 1 - Math.exp(-2.2 * Math.min(realDelta, 0.25)));
      this.controller.combatFocus.copy(this.combatFocus);
    }

    if (this.cluster) {
      this.updateCluster(Math.min(realDelta, 0.25));
      return;
    }

    if (this.queue.length) { this.runQueue(); return; }

    if (this.phase === 'active' && this.pendingEnemyTurn) {
      // Pacing is wall-clock, not frame-clock: a slow frame must not stretch
      // the beat between enemy turns into a stall. The gap is long enough to
      // read whose turn it is and watch them come.
      this.enemyTurnTimer -= Math.min(realDelta, 0.5);
      if (this.enemyTurnTimer <= 0) {
        this.pendingEnemyTurn = false;
        this.enqueue(this.encounter.runEnemyTurn());
        this.runQueue();
      }
    }
  }

  // -- presentation timeline ------------------------------------------------

  /** Queue log entries for staged reveal. */
  private enqueue(entries: LogEntry[]) {
    this.queue.push(...entries);
  }

  /**
   * Walk the queued entries. Most reveal immediately; an attack or a spell
   * becomes a staged cluster and pauses the walk until it has landed.
   */
  private runQueue() {
    if (this.cluster || this.presenting) return;
    this.presenting = true;
    try {
      while (this.queue.length) {
        const entry = this.queue.shift()!;
        if (entry.kind === 'attack' && entry.attack) {
          this.startStrikeCluster(entry);
          return;
        }
        if (entry.kind === 'spell') {
          this.startSpellCluster(entry);
          return;
        }
        this.onLog([entry]);
      }
      this.presenting = false;
      this.onPresentationDone();
      return;
    } finally {
      // If a cluster started, presenting stays effectively paused until it lands.
      if (!this.cluster) this.presenting = false;
    }
  }

  /** Everything the presentation layer needs to know once the queue drains. */
  private onPresentationDone() {
    if (!this.encounter) return;
    this.checkFleeCondition();
    if (this.queue.length) { this.runQueue(); return; }
    if (this.encounter.finished) { this.resolve(); return; }
    this.scheduleEnemyTurnIfNeeded();
  }

  private damageKindOf(attack: AttackPresentation): StrikeCluster['damageKind'] {
    if (!attack.ranged) return 'melee';
    if (attack.damageType === 'fire') return 'fire';
    if (attack.damageType === 'cold') return 'frost';
    if (attack.damageType === 'force' || attack.damageType === 'radiant' || attack.damageType === 'psychic') return 'force';
    return 'arrow';
  }

  private startStrikeCluster(entry: LogEntry) {
    const attack = entry.attack!;
    const hero = this.hero;
    const attackerIsHero = !!hero && entry.actorId === hero.id;
    const cluster: StrikeCluster = {
      attackerId: entry.actorId ?? '',
      attackerIsHero,
      targetId: entry.targetId ?? null,
      attack, attackEntry: entry,
      followEntries: [],
      phase: attackerIsHero ? 'dice' : 'waitMove',
      timer: 0, windupDuration: 0, flightDuration: 0,
      damageKind: this.damageKindOf(attack),
    };
    // Entries that belong to this blow (damage, condition, death) reveal with it.
    while (this.queue.length) {
      const next = this.queue[0];
      if (next.kind === 'attack' || next.kind === 'spell' || next.kind === 'turn' || next.kind === 'round') break;
      cluster.followEntries.push(this.queue.shift()!);
    }
    this.cluster = cluster;

    if (cluster.phase === 'waitMove') {
      // Let the goblin finish running before it starts swinging.
      const remaining = this.view?.remainingMove(cluster.attackerId) ?? 0;
      cluster.timer = Math.min(2.8, remaining / Math.max(0.5, feetToMetres(30) / 6));
      if (remaining < 0.1) this.beginStrikeWindup(cluster);
    } else {
      cluster.timer = 0;
      // The hero's fate dice hit the ground before the blade moves.
      this.beginStrikeDice(cluster);
    }
  }

  private beginStrikeWindup(cluster: StrikeCluster) {
    const windup = cluster.attackerIsHero ? 0.46 : 0.58;
    cluster.phase = 'windup';
    cluster.timer = 0;
    cluster.windupDuration = windup;
    const targetId = cluster.targetId;

    if (cluster.attackerIsHero) {
      const kind = cluster.damageKind === 'melee' ? 'melee' : 'ranged';
      this.controller.playAttack(kind);
    } else if (this.view) {
      const pose = cluster.damageKind === 'melee' ? 'attack' : 'shoot';
      this.view.playPose(cluster.attackerId, pose, windup * 2.3, 0.46);
    }
    // The target's hurt/fall must not leak before the blow connects.
    if (targetId && this.view) this.view.holdPose(targetId, windup + 1.1);
    if (cluster.damageKind === 'melee') this.audio.whoosh(cluster.attack.critical ? 1.25 : 1);
  }

  private beginStrikeDice(cluster: StrikeCluster) {
    cluster.phase = 'dice';
    cluster.timer = 0;
    if (!this.dice || !this.view || !this.hero) { this.beginStrikeWindup(cluster); return; }
    // The fate die lands just ahead of the hero, on open ground in view.
    const yaw = this.controller.yaw;
    const x = this.hero.position.x - Math.sin(yaw) * 1.25;
    const z = this.hero.position.z - Math.cos(yaw) * 1.25;
    const anchor = new THREE.Vector3(x, terrainHeight(x, z), z);
    this.audio.diceClatter(1);
    this.dice.roll({
      d20: cluster.attack.kept,
      d20Pool: cluster.attack.d20,
      anchor,
    }, () => {
      if (cluster.phase !== 'dice') return;
      if (cluster.attack.hit && cluster.attack.damageDice.length && this.dice) {
        // Damage dice follow the fate die, then the blade falls.
        this.audio.diceClatter(cluster.attack.damageDice.length);
        this.dice.roll({
          d20: cluster.attack.kept,
          damage: { dice: cluster.attack.damageDice, sides: cluster.attack.damageSides, bonus: cluster.attack.damageBonus },
          anchor,
        }, () => {
          if (cluster.phase === 'dice') this.beginStrikeWindup(cluster);
        });
      } else {
        this.beginStrikeWindup(cluster);
      }
    });
  }

  private updateCluster(dt: number) {
    const cluster = this.cluster;
    if (!cluster) return;
    cluster.timer += dt;

    if ('attackEntry' in cluster) {
      switch (cluster.phase) {
        case 'waitMove': {
          const settled = this.view?.settled(cluster.attackerId) ?? true;
          if (settled || cluster.timer > 3.2) {
            if (cluster.attackerIsHero) this.beginStrikeDice(cluster);
            else this.beginStrikeWindup(cluster);
          }
          break;
        }
        case 'dice': {
          // The dice callbacks drive this phase; the cap only unstick it.
          if (cluster.timer > 3.8) this.beginStrikeWindup(cluster);
          break;
        }
        case 'windup': {
          if (cluster.timer >= cluster.windupDuration) {
            if (cluster.damageKind === 'melee' || !this.view) {
              this.impactStrike(cluster);
            } else {
              const targetId = cluster.targetId;
              const missed = !cluster.attack.hit;
              const flight = cluster.damageKind === 'arrow' && targetId
                ? this.view.fireArrow(cluster.attackerId, targetId, missed)
                : targetId ? this.view.fireBolt(cluster.attackerId, targetId, cluster.damageKind === 'fire' ? 'fire' : cluster.damageKind === 'frost' ? 'frost' : 'force', missed) : 0.3;
              cluster.phase = 'flight';
              cluster.timer = 0;
              cluster.flightDuration = flight;
              this.audio.bowRelease();
            }
          }
          break;
        }
        case 'flight': {
          if (cluster.timer >= cluster.flightDuration) this.impactStrike(cluster);
          break;
        }
        case 'linger': {
          if (cluster.timer >= 0.4) {
            // Hand the stage back: the presenting guard must drop with the
            // cluster, or runQueue would refuse every entry from here on.
            this.cluster = null;
            this.presenting = false;
            this.runQueue();
          }
          break;
        }
      }
      return;
    }

    // Spell cluster.
    switch (cluster.phase) {
      case 'windup': {
        if (cluster.timer >= 0.6) {
          const damaging = cluster.entries.some(e => e.kind === 'damage');
          if (damaging && this.view && cluster.targets.length) {
            let flight = 0.3;
            for (const t of cluster.targets) flight = Math.max(flight, this.view.fireBolt(cluster.casterId, t.id, cluster.kind));
            cluster.flight = flight;
            cluster.phase = 'flight';
            cluster.timer = 0;
          } else {
            this.impactSpell(cluster);
          }
        }
        break;
      }
      case 'flight': {
        if (cluster.timer >= cluster.flight) this.impactSpell(cluster);
        break;
      }
      case 'linger': {
        if (cluster.timer >= 0.5) {
          // Same hand-back as strikes: drop the presenting guard.
          this.cluster = null;
          this.presenting = false;
          this.runQueue();
        }
        break;
      }
    }
  }

  /** The blow connects: reveal the log, draw the effects, move the body. */
  private impactStrike(cluster: StrikeCluster) {
    const attack = cluster.attack;
    this.onLog([cluster.attackEntry, ...cluster.followEntries]);

    const view = this.view;
    const chest = cluster.targetId ? view?.chestOf(cluster.targetId) : null;
    if (chest && view) {
      if (attack.hit) {
        const attackerChest = view.chestOf(cluster.attackerId);
        if (cluster.damageKind === 'melee' && attackerChest) {
          view.fx.slashArc(attackerChest, chest, attack.critical);
        } else if (cluster.damageKind === 'arrow') {
          view.fx.impact(chest, '#e8dcc0', 9, 1.8, 0.3);
        } else {
          const colour = cluster.damageKind === 'fire' ? '#ff8b3c' : cluster.damageKind === 'frost' ? '#9fd8ff' : '#c4a6ff';
          view.fx.impact(chest, colour, 20, 3.0, 0.45);
        }
        view.fx.blood(chest, Math.min(1.5, 0.45 + attack.damage / 9));
        view.fx.floater(chest, attack.critical ? `CRITICAL ${attack.damage}!` : String(attack.damage),
          attack.critical ? 'crit' : 'damage');
        if (attack.critical && cluster.targetId) {
          const ground = view.positionOf(cluster.targetId);
          if (ground) view.fx.shockRing(ground, 1.25);
        }
        this.audio.impact(attack.critical ? 1.35 : 1);
        if (attack.killed) this.audio.deathCry();
        this.addShake(attack.critical ? 0.3 : cluster.attackerIsHero ? 0.14 : 0.2);
        if (cluster.targetId) {
          if (cluster.targetId === this.heroId) {
            // The hero is the controller's body, not a view actor: flinch, or
            // go down and stay down when the blow drops them.
            this.controller.playHurt();
            if (attack.killed) this.controller.setDowned(true);
          } else view.reactToHit(cluster.targetId, attack.killed);
        }
      } else {
        view.fx.floater(chest, 'MISS', 'miss');
        view.fx.impact(chest, '#b9a888', 7, 1.2, 0.35);
        this.audio.parry();
      }
    }
    cluster.phase = 'linger';
    cluster.timer = 0;
  }

  /** The spell arrives: reveal effects, burst on targets, floaters for numbers. */
  private impactSpell(cluster: SpellCluster) {
    this.onLog(cluster.entries);
    const view = this.view;
    if (view) {
      const colour = cluster.kind === 'fire' ? '#ff8b3c' : cluster.kind === 'frost' ? '#9fd8ff' : '#c4a6ff';
      for (const entry of cluster.entries) {
        if (entry.kind === 'damage' && entry.targetId) {
          const chest = view.chestOf(entry.targetId);
          if (chest) {
            view.fx.impact(chest, colour, 22, 3.2, 0.5);
            view.fx.blood(chest, Math.min(1.4, 0.4 + (entry.amount ?? 4) / 9));
            view.fx.floater(chest, String(entry.amount ?? ''), 'spell');
            const dropped = (this.encounter?.byId(entry.targetId)?.health.hp ?? 1) <= 0;
            if (entry.targetId === this.heroId) {
              this.controller.playHurt();
              if (dropped) this.controller.setDowned(true);
            } else view.reactToHit(entry.targetId, dropped);
            this.audio.impact(1);
          }
        } else if (entry.kind === 'heal' && entry.targetId) {
          const chest = view.chestOf(entry.targetId);
          if (chest) {
            view.fx.impact(chest, '#9fe08a', 14, 1.2, 0.7);
            view.fx.floater(chest, `+${entry.amount ?? ''}`, 'heal');
          }
        }
      }
      this.addShake(0.16);
    }
    cluster.phase = 'linger';
    cluster.timer = 0;
  }

  private startSpellCluster(entry: LogEntry) {
    const hero = this.hero;
    const casterIsHero = !!hero && entry.actorId === hero.id;
    const targets: { id: string }[] = [];
    const effects: LogEntry[] = [];
    while (this.queue.length) {
      const next = this.queue[0];
      if (next.kind === 'attack' || next.kind === 'spell' || next.kind === 'turn' || next.kind === 'round') break;
      const e = this.queue.shift()!;
      if (e.targetId && !targets.some(t => t.id === e.targetId)) targets.push({ id: e.targetId });
      effects.push(e);
    }
    const damageEntry = effects.find(e => e.kind === 'damage');
    const kind: SpellCluster['kind'] = damageEntry
      ? (/fire|flame|burn|scorch/i.test(damageEntry.text) ? 'fire'
        : /cold|frost|ice|chill/i.test(damageEntry.text) ? 'frost' : 'force')
      : 'force';
    const cluster: SpellCluster = {
      casterId: entry.actorId ?? '', casterIsHero, targets, kind,
      entries: [entry, ...effects], phase: 'windup', timer: 0, flight: 0.35,
    };
    this.cluster = cluster;
    if (casterIsHero) this.controller.playAttack('cast');
    else this.view?.playPose(cluster.casterId, 'cast', 1.1, 0.5);
    for (const t of targets) this.view?.holdPose(t.id, 1.7);
    // A flash at the caster's hands sells the release before the bolt flies.
    const origin = this.view?.chestOf(cluster.casterId);
    if (origin && this.view) {
      const colour = kind === 'fire' ? '#ff8b3c' : kind === 'frost' ? '#9fd8ff' : '#c4a6ff';
      this.view.fx.impact(origin, colour, 12, 1.4, 0.5);
    }
    if (damageEntry) this.audio.cast();
  }

  dispose() {
    this.controller.combatCamera = false;
    this.dice?.dispose(); this.dice = null;
    this.view?.dispose(this.scene);
    this.site?.dispose(this.scene);
    if (this.trailMarker) this.scene.remove(this.trailMarker);
    this.view = null; this.site = null; this.encounter = null;
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
    // The fight is decided: hand the camera back to the walking framing and
    // let the grid breathe out with the view update.
    this.controller.combatCamera = false;
    this.view?.revealAllHealth();
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

}

/** A stable 32-bit hash, so a character always fights the same ambush. */
function hashString(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

export { GOBLIN_TRAIL_MOUTH };
