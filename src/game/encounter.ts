/**
 * The spatial turn-based encounter engine.
 *
 * Every combatant has a real position in world metres, so reach, ranged
 * increments, cover, opportunity attacks and movement budgets are all decided
 * by the same geometry the renderer draws. The engine owns no Three.js types:
 * the world layer feeds it terrain and line-of-sight callbacks and reads the
 * resulting positions back onto the actors.
 */
import { DiceStream, parseDice, rollDice } from './dice';
import { MONSTERS, type Monster, type MonsterAction } from './bestiary';
import {
  ARMOR, WEAPONS, abilityForWeapon, isRanged, rangePenalty,
  type Weapon,
} from './equipment';
import {
  abilityModifier, addCondition, applyDamage, attackerAttackEffects, canAct, canMove, combineAdvantage,
  coverAcBonus, defenderAttackEffects, feetToMetres, grantTemporaryHp, hasCondition, heal, metresToFeet,
  newHealth, newTurnBudget, proficiencyBonus, removeCondition, resolveCheck, rollDeathSave, rollInitiative,
  tickConditions,
  type ActiveCondition, type CheckResult, type Cover, type HealthState, type RulesActor, type TurnBudget,
} from './rules';
import {
  castSpell, concentrationCheck, consumeSlot, lowestAvailableSlot, restoreAllSlots, SPELLS,
  spellSaveDc, type CasterProfile, type SpellSlots, type SpellTargetState,
} from './spells';
import type { CharacterSheet } from './character';
import { scaledMonsterHp, type SoloProfile } from './solo-balance';

export interface Vec2 { x: number; z: number }

export type Side = 'party' | 'enemy';

export interface Combatant {
  id: string;
  name: string;
  side: Side;
  actor: RulesActor;
  health: HealthState;
  armorClass: number;
  /** Metres. */
  position: Vec2;
  facing: number;
  /** Feet per round. */
  speed: number;
  size: 'small' | 'medium' | 'large';
  conditions: ActiveCondition[];
  budget: TurnBudget;
  initiative: number;
  /** Party members only. */
  weapons: string[];
  equippedWeapon: string;
  spells: string[];
  slots: SpellSlots;
  caster?: CasterProfile;
  concentratingOn?: { spellId: string; targetIds: string[] };
  attacksPerAction: number;
  reactionUsed: boolean;
  /** Enemies only. */
  monsterId?: string;
  /** Ids this creature already provoked from this round. */
  provokedBy: string[];
  /** Purely presentational, consumed by the renderer. */
  animation: 'idle' | 'attack' | 'cast' | 'hurt' | 'move' | 'down' | 'dead';
  animationUntil: number;
  xp: number;
  /** Per-turn flags, reset when the turn begins. */
  dodging?: boolean;
  disengaging?: boolean;
  helpedBy?: boolean;
  /** Per-rest resources. */
  secondWindUsed?: boolean;
  /** Times Second Wind has been used this encounter (solo play allows several). */
  secondWindCount?: number;
  /** Left the fight alive — fled, captured or surrendered. */
  withdrawn?: boolean;
}

export type LogKind = 'round' | 'turn' | 'attack' | 'spell' | 'move' | 'damage' | 'heal' | 'condition' | 'death' | 'save' | 'victory' | 'defeat' | 'info';

export interface LogEntry {
  id: number;
  kind: LogKind;
  text: string;
  actorId?: string;
  targetId?: string;
  amount?: number;
  roll?: CheckResult;
  detail?: string[];
  /**
   * Presentation payload for attack entries: the raw dice the renderer needs
   * to stage a physical strike (and to roll real dice on screen) without
   * parsing prose.
   */
  attack?: AttackPresentation;
}

export interface AttackPresentation {
  weapon: string;
  ranged: boolean;
  /** Every d20 rolled (advantage rolls both); `kept` is the one that counts. */
  d20: number[];
  kept: number;
  modifier: number;
  total: number;
  dc?: number;
  critical: boolean;
  hit: boolean;
  /** Damage actually applied, and the dice that produced it. */
  damage: number;
  damageDice: number[];
  damageSides: number;
  damageBonus: number;
  damageType: string;
  killed: boolean;
}

export interface EncounterOptions {
  id: string;
  seed: number;
  /** Terrain sampler in world metres; returns a height. */
  heightAt?: (x: number, z: number) => number;
  /** True when a straight line between two points is unobstructed. */
  lineOfSight?: (a: Vec2, b: Vec2) => boolean;
  /** Cover the defender enjoys from the attacker's position. */
  coverBetween?: (a: Vec2, b: Vec2) => Cover;
  /** True when a creature may stand at this position. */
  passable?: (x: number, z: number) => boolean;
  /**
   * Solo-play adjustments. D&D assumes four characters; this game has one, so
   * the encounter applies a declared handicap in both directions rather than
   * pretending the printed numbers are fair for a party of one.
   */
  solo?: SoloProfile;
}

export type ActionId =
  | { type: 'attack'; targetId: string; weaponId?: string }
  | { type: 'cast'; spellId: string; targetIds: string[]; slotLevel?: number }
  | { type: 'move'; to: Vec2 }
  | { type: 'dash' }
  | { type: 'disengage' }
  | { type: 'dodge' }
  | { type: 'hide' }
  | { type: 'help'; targetId: string }
  | { type: 'shove'; targetId: string }
  | { type: 'secondWind' }
  | { type: 'stabilize'; targetId: string }
  | { type: 'endTurn' };

export interface ActionOutcome { ok: boolean; reason?: string; entries: LogEntry[] }

const distanceMetres = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
export const distanceFeet = (a: Vec2, b: Vec2) => metresToFeet(distanceMetres(a, b));

/** Creatures occupy space; reach is measured edge to edge, not centre to centre. */
const radiusOf = (c: Combatant) => (c.size === 'large' ? 0.9 : c.size === 'small' ? 0.35 : 0.45);

export class Encounter {
  readonly combatants: Combatant[] = [];
  readonly log: LogEntry[] = [];
  readonly stream: DiceStream;
  round = 0;
  turnIndex = 0;
  finished = false;
  outcome: 'victory' | 'defeat' | null = null;
  awardedXp = 0;
  /** Set while a downed party member owes a death save at the start of a turn. */
  private nextLogId = 1;
  /** Entry ids already written to the public log, so publishing is idempotent. */
  private loggedIds = new Set<number>();
  private clock = 0;
  private surpriseIds = new Set<string>();
  onChange: () => void = () => {};

  constructor(private options: EncounterOptions) {
    this.stream = new DiceStream(options.seed);
  }

  // -- construction -------------------------------------------------------

  addCharacter(sheet: CharacterSheet, position: Vec2, facing = 0): Combatant {
    const actor: RulesActor = {
      id: sheet.id, level: sheet.level, abilities: sheet.abilities,
      proficientAbilities: sheet.savingThrows,
      skills: Object.fromEntries(sheet.skillProficiencies.map(s => [s, { proficient: true }])),
      proficiencyBonus: sheet.proficiencyBonus,
    };
    const combatant: Combatant = {
      id: sheet.id, name: sheet.name, side: 'party', actor,
      health: { ...newHealth(sheet.maxHp), hp: sheet.currentHp ?? sheet.maxHp },
      armorClass: sheet.armorClass, position: { ...position }, facing,
      speed: sheet.speed, size: 'medium', conditions: [],
      budget: newTurnBudget(sheet.speed, sheet.attacksPerAction ?? 1),
      initiative: 0, weapons: sheet.weapons ?? ['unarmed'], equippedWeapon: sheet.weapons?.[0] ?? 'unarmed',
      spells: sheet.spellsKnown ?? [], slots: sheet.slots ?? { max: [], used: [] },
      caster: sheet.spellcasting ? { ability: sheet.spellcasting, kind: sheet.casterKind ?? 'none' } : undefined,
      attacksPerAction: sheet.attacksPerAction ?? 1, reactionUsed: false, provokedBy: [],
      animation: 'idle', animationUntil: 0, xp: 0,
    };
    this.combatants.push(combatant);
    return combatant;
  }

  addMonster(monsterId: string, instanceId: string, position: Vec2, facing = 0): Combatant {
    const monster: Monster = MONSTERS[monsterId];
    if (!monster) throw new Error(`Unknown monster: ${monsterId}`);
    const rolled = Math.max(1, rollDice(monster.hitDice, this.stream).total);
    // Solo play thins the pack rather than deleting members of it, so the
    // ambush still looks and reads like four goblins.
    const hp = this.options.solo ? scaledMonsterHp(monster, rolled, this.options.solo) : rolled;
    const actor: RulesActor = {
      id: instanceId, level: Math.max(1, Math.ceil(monster.challenge)), abilities: monster.abilities,
      proficientAbilities: monster.savingThrows,
      skills: Object.fromEntries(Object.keys(monster.skills ?? {}).map(s => [s, { proficient: true }])),
      proficiencyBonus: monster.proficiencyBonus,
    };
    const combatant: Combatant = {
      id: instanceId, name: monster.name, side: 'enemy', actor,
      health: newHealth(hp), armorClass: monster.armorClass,
      position: { ...position }, facing, speed: monster.speed,
      size: monster.size === 'tiny' ? 'small' : monster.size === 'large' ? 'large' : monster.size === 'small' ? 'small' : 'medium',
      conditions: [], budget: newTurnBudget(monster.speed), initiative: 0,
      weapons: [], equippedWeapon: '', spells: [], slots: { max: [], used: [] },
      attacksPerAction: monsterId === 'goblinBoss' ? 2 : 1, reactionUsed: false, provokedBy: [],
      monsterId, animation: 'idle', animationUntil: 0, xp: monster.xp,
    };
    this.combatants.push(combatant);
    return combatant;
  }

  /** Creatures that were not aware of the ambush lose their first turn. */
  markSurprised(ids: string[]) { for (const id of ids) this.surpriseIds.add(id); }

  start() {
    this.round = 1;
    for (const c of this.combatants) {
      const roll = rollInitiative(c.actor, this.stream);
      // Ties are broken by the higher Dexterity score, then by a stable id sort.
      c.initiative = roll.total + abilityModifier(c.actor.abilities.dex) / 100;
      this.entry('info', `${c.name} rolls ${roll.total} for initiative.`, { actorId: c.id, roll });
    }
    this.combatants.sort((a, b) => b.initiative - a.initiative || a.id.localeCompare(b.id));
    this.turnIndex = 0;
    this.entry('round', 'Round 1. Initiative is set.');
    this.beginTurn();
    this.onChange();
  }

  // -- queries ------------------------------------------------------------

  get active(): Combatant | undefined { return this.combatants[this.turnIndex]; }
  get isPlayerTurn() { return !this.finished && this.active?.side === 'party' && this.active.health.hp > 0; }
  byId(id: string) { return this.combatants.find(c => c.id === id); }
  living(side: Side) { return this.combatants.filter(c => c.side === side && c.health.hp > 0 && !c.health.dead); }
  /** A downed but not dead party member still counts as present. */
  standing(side: Side) { return this.combatants.filter(c => c.side === side && !c.health.dead); }

  gapFeet(a: Combatant, b: Combatant) {
    return Math.max(0, metresToFeet(distanceMetres(a.position, b.position) - radiusOf(a) - radiusOf(b)));
  }

  coverFor(attacker: Combatant, target: Combatant): Cover {
    if (!this.options.coverBetween) return 'none';
    return this.options.coverBetween(attacker.position, target.position);
  }

  canSee(attacker: Combatant, target: Combatant) {
    if (hasCondition(target.conditions, 'invisible')) return false;
    if (this.coverFor(attacker, target) === 'total') return false;
    return this.options.lineOfSight ? this.options.lineOfSight(attacker.position, target.position) : true;
  }

  weaponFor(c: Combatant): Weapon { return WEAPONS[c.equippedWeapon] ?? WEAPONS.unarmed; }

  /** Everything the UI needs to preview an attack before committing to it. */
  previewAttack(attackerId: string, targetId: string, weaponId?: string) {
    const attacker = this.byId(attackerId), target = this.byId(targetId);
    if (!attacker || !target) return null;
    const weapon = WEAPONS[weaponId ?? attacker.equippedWeapon] ?? WEAPONS.unarmed;
    const gap = this.gapFeet(attacker, target);
    const cover = this.coverFor(attacker, target);
    const range = rangePenalty(weapon, gap);
    const { advantage, disadvantage } = this.attackAdvantage(attacker, target, weapon, gap, range);
    const state = combineAdvantage(advantage, disadvantage);
    const bonus = this.attackBonus(attacker, weapon);
    const ac = target.armorClass + coverAcBonus(cover);
    const single = Math.max(0.05, Math.min(0.95, (21 - (ac - bonus)) / 20));
    const chance = state === 'advantage' ? 1 - (1 - single) ** 2 : state === 'disadvantage' ? single ** 2 : single;
    return {
      weapon, gap: Math.round(gap), cover, inRange: range !== 'outOfRange', advantage, disadvantage, state,
      attackBonus: bonus, targetAc: ac, hitChance: Math.round(chance * 100),
      damage: `${weapon.damage}${this.damageModifier(attacker, weapon) ? `+${this.damageModifier(attacker, weapon)}` : ''}`,
    };
  }

  // -- attack maths -------------------------------------------------------

  private attackBonus(attacker: Combatant, weapon: Weapon) {
    if (attacker.monsterId) {
      const action = this.monsterAction(attacker, isRanged(weapon) ? 'ranged' : 'melee');
      return action?.attackBonus ?? 3;
    }
    const ability = abilityForWeapon(weapon, attacker.actor.abilities.str, attacker.actor.abilities.dex);
    const prof = attacker.actor.proficiencyBonus ?? proficiencyBonus(attacker.actor.level);
    return abilityModifier(attacker.actor.abilities[ability]) + prof;
  }

  private damageModifier(attacker: Combatant, weapon: Weapon) {
    if (attacker.monsterId) return 0;
    const ability = abilityForWeapon(weapon, attacker.actor.abilities.str, attacker.actor.abilities.dex);
    return abilityModifier(attacker.actor.abilities[ability]);
  }

  private monsterAction(c: Combatant, prefer: 'melee' | 'ranged'): MonsterAction | undefined {
    const monster = c.monsterId ? MONSTERS[c.monsterId] : undefined;
    if (!monster) return undefined;
    return monster.actions.find(a => a.kind === prefer) ?? monster.actions[0];
  }

  private attackAdvantage(attacker: Combatant, target: Combatant, weapon: Weapon, gap: number, range: ReturnType<typeof rangePenalty>) {
    const melee = !isRanged(weapon);
    const fromDefender = defenderAttackEffects(target.conditions, melee);
    const fromAttacker = attackerAttackEffects(attacker.conditions);
    const advantage = [...fromDefender.advantage, ...fromAttacker.advantage];
    const disadvantage = [...fromDefender.disadvantage, ...fromAttacker.disadvantage];
    if (range === 'disadvantage') disadvantage.push('long range');
    // Firing into melee while an enemy is within five feet of you is awkward.
    if (!melee && this.combatants.some(c => c.side !== attacker.side && c.health.hp > 0 && c !== target && this.gapFeet(attacker, c) <= 5)) {
      disadvantage.push('enemy within reach');
    }
    if (target.dodging) disadvantage.push('target dodging');
    if (attacker.helpedBy) advantage.push('helped by an ally');
    // Pack tactics: a wolf with a friend adjacent to the target.
    if (attacker.monsterId && MONSTERS[attacker.monsterId]?.traits.some(t => t.name === 'Pack Tactics')
      && this.combatants.some(c => c !== attacker && c.side === attacker.side && c.health.hp > 0 && this.gapFeet(c, target) <= 5)) {
      advantage.push('pack tactics');
    }
    if (fromDefender.autoCritical && melee && gap <= 5) advantage.push('helpless target');
    return { advantage, disadvantage, autoCritical: fromDefender.autoCritical && melee && gap <= 5 };
  }

  // -- turn flow ----------------------------------------------------------

  /**
   * Build a log entry without publishing it.
   *
   * An attack is built out of order — the entry that says "hits for 9" is
   * assembled first so the presentation queue can lead with it, while the
   * death it causes is only known afterwards. Publishing at creation time
   * meant the combat log read "Goblin drops and does not move again" *above*
   * the blow that dropped it. Callers now stage their entries and publish
   * them in the order a reader should see.
   */
  private stage(kind: LogKind, text: string, extra: Partial<LogEntry> = {}): LogEntry {
    return { id: this.nextLogId++, kind, text, ...extra };
  }

  /** Append entries to the public log in the order they are given. */
  private publish(entries: LogEntry[]) {
    for (const e of entries) {
      if (this.loggedIds.has(e.id)) continue;
      this.loggedIds.add(e.id);
      this.log.push(e);
    }
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  private entry(kind: LogKind, text: string, extra: Partial<LogEntry> = {}) {
    const item = this.stage(kind, text, extra);
    this.publish([item]);
    return item;
  }

  private beginTurn(): LogEntry[] {
    const entries: LogEntry[] = [];
    const c = this.active;
    if (!c) return entries;
    c.budget = newTurnBudget(c.speed, c.attacksPerAction);
    c.reactionUsed = false;
    c.provokedBy = [];
    c.dodging = false;
    c.helpedBy = false;
    c.disengaging = false;
    c.conditions = tickConditions(c.conditions);

    if (c.health.dead) return this.endTurn();

    // A creature at zero hit points rolls a death saving throw before acting.
    if (c.health.hp <= 0 && !c.health.stable) {
      const save = rollDeathSave(c.actor, c.health, this.stream);
      c.health = save.health;
      entries.push(this.entry('save', `${c.name} fights to stay conscious. ${save.note}`, { actorId: c.id, roll: save.result }));
      if (c.health.dead) {
        c.animation = 'dead';
        entries.push(this.entry('death', `${c.name} does not get up.`, { actorId: c.id }));
      }
      this.checkEnd(entries);
      if (!this.finished) entries.push(...this.endTurn());
      return entries;
    }
    if (c.health.hp <= 0) { entries.push(...this.endTurn()); return entries; }

    if (this.surpriseIds.has(c.id)) {
      this.surpriseIds.delete(c.id);
      entries.push(this.entry('turn', `${c.name} is caught unawares and loses the turn.`, { actorId: c.id }));
      entries.push(...this.endTurn());
      return entries;
    }
    if (!canAct(c.conditions)) {
      entries.push(this.entry('turn', `${c.name} cannot act.`, { actorId: c.id }));
      entries.push(...this.endTurn());
      return entries;
    }
    entries.push(this.entry('turn', `${c.name}'s turn.`, { actorId: c.id }));
    return entries;
  }

  endTurn(): LogEntry[] {
    if (this.finished) return [];
    const entries: LogEntry[] = [];
    for (let guard = 0; guard < this.combatants.length + 2; guard++) {
      this.turnIndex++;
      if (this.turnIndex >= this.combatants.length) {
        this.turnIndex = 0;
        this.round++;
        entries.push(this.entry('round', `Round ${this.round}.`));
      }
      const next = this.active;
      if (!next) break;
      if (next.health.dead) continue;
      entries.push(...this.beginTurn());
      break;
    }
    this.onChange();
    return entries;
  }

  // -- player and AI actions ----------------------------------------------

  perform(action: ActionId): ActionOutcome {
    if (this.finished) return { ok: false, reason: 'The encounter is over.', entries: [] };
    const c = this.active;
    if (!c) return { ok: false, reason: 'No active combatant.', entries: [] };
    switch (action.type) {
      case 'attack': return this.doAttack(c, action.targetId, action.weaponId);
      case 'cast': return this.doCast(c, action.spellId, action.targetIds, action.slotLevel);
      case 'move': return this.doMove(c, action.to);
      case 'dash': return this.doDash(c);
      case 'disengage': return this.doDisengage(c);
      case 'dodge': return this.doDodge(c);
      case 'hide': return this.doHide(c);
      case 'help': return this.doHelp(c, action.targetId);
      case 'shove': return this.doShove(c, action.targetId);
      case 'secondWind': return this.doSecondWind(c);
      case 'stabilize': return this.doStabilize(c, action.targetId);
      case 'endTurn': return { ok: true, entries: this.endTurn() };
    }
  }

  /** Free rerolls the solo hero has left this encounter. */
  private luckRemaining = -1;

  /** Rerolls the solo hero has declared for this fight, lazily initialised. */
  private luckLeft(): number {
    if (this.luckRemaining < 0) this.luckRemaining = this.options.solo?.luck ?? 0;
    return this.luckRemaining;
  }

  /**
   * A solo hero gets a small number of rerolls per fight, standing in for the
   * party members who are not there to turn a bad roll around.
   *
   * The reroll is only *charged* if it actually changes the outcome. Spending
   * it up front — the way this read before — quietly burned both rerolls on
   * swings that missed twice anyway, so the hero fought the whole ambush
   * without the one bonus the character sheet was promising them.
   */
  private chargeLuck(actor: Combatant, helped: boolean | undefined): boolean {
    if (actor.side !== 'party') return false;
    if (!helped) return false;
    if (this.luckLeft() <= 0) return false;
    this.luckRemaining--;
    return true;
  }

  private doAttack(attacker: Combatant, targetId: string, weaponId?: string): ActionOutcome {
    const target = this.byId(targetId);
    if (!target || target.health.hp <= 0) return { ok: false, reason: 'That target is already down.', entries: [] };
    if (!attacker.budget.action && attacker.budget.attacksRemaining <= 0) return { ok: false, reason: 'No attack left this turn.', entries: [] };
    const weapon = WEAPONS[weaponId ?? attacker.equippedWeapon] ?? WEAPONS.unarmed;
    const gap = this.gapFeet(attacker, target);
    if (rangePenalty(weapon, gap) === 'outOfRange') {
      return { ok: false, reason: isRanged(weapon) ? 'The target is beyond this weapon\u2019s range.' : `Out of reach — ${Math.round(gap)} ft away.`, entries: [] };
    }
    if (!this.canSee(attacker, target)) return { ok: false, reason: 'You cannot see the target from here.', entries: [] };

    // The first attack of a turn spends the action; extra attacks do not.
    if (attacker.budget.action) attacker.budget.action = false;
    else if (attacker.budget.attacksRemaining <= 0) return { ok: false, reason: 'No attack left this turn.', entries: [] };
    attacker.budget.attacksRemaining--;

    const entries = this.resolveWeaponAttack(attacker, target, weapon, gap);
    this.checkEnd(entries);
    this.onChange();
    return { ok: true, entries };
  }

  /** Shared by the player, the AI and opportunity attacks. */
  private resolveWeaponAttack(attacker: Combatant, target: Combatant, weapon: Weapon, gap: number): LogEntry[] {
    const entries: LogEntry[] = [];
    const cover = this.coverFor(attacker, target);
    const range = rangePenalty(weapon, gap);
    const { advantage, disadvantage, autoCritical } = this.attackAdvantage(attacker, target, weapon, gap, range);
    const bonus = this.attackBonus(attacker, weapon);
    const monsterAction = attacker.monsterId ? this.monsterAction(attacker, isRanged(weapon) ? 'ranged' : 'melee') : undefined;

    attacker.animation = 'attack'; attacker.animationUntil = this.clock + 0.8;
    attacker.facing = Math.atan2(target.position.x - attacker.position.x, target.position.z - attacker.position.z);

    const roll = resolveCheck({
      kind: 'attack', actor: attacker.actor, ability: 'str',
      dc: target.armorClass + coverAcBonus(cover),
      advantageSources: advantage, disadvantageSources: disadvantage,
      modifiers: [{ label: `${weapon.name} attack`, value: bonus - abilityModifier(attacker.actor.abilities.str) }],
      stream: this.stream,
    });

    let finalRoll = roll;
    // Roll the second swing first, then decide whether it cost anything. A
    // reroll that misses anyway leaves the hero's luck untouched.
    if (!finalRoll.success && this.luckLeft() > 0) {
      const reroll = resolveCheck({
        kind: 'attack', actor: attacker.actor, ability: 'str',
        dc: target.armorClass + coverAcBonus(cover),
        advantageSources: advantage, disadvantageSources: disadvantage,
        modifiers: [{ label: `${weapon.name} attack`, value: bonus - abilityModifier(attacker.actor.abilities.str) }],
        stream: this.stream,
      });
      if (this.chargeLuck(attacker, reroll.success)) {
        entries.push(this.stage('info', `${attacker.name} refuses the miss and swings again.`, { actorId: attacker.id, roll: reroll }));
        finalRoll = reroll;
      }
    }
    if (!finalRoll.success) {
      entries.push(this.stage('attack', `${attacker.name} swings at ${target.name} and misses${cover !== 'none' ? ` — ${cover === 'half' ? 'half' : 'three-quarters'} cover` : ''}.`,
        {
          actorId: attacker.id, targetId: target.id, roll: finalRoll, detail: finalRoll.explanation,
          attack: {
            weapon: weapon.name, ranged: isRanged(weapon), d20: finalRoll.dice, kept: finalRoll.kept,
            modifier: finalRoll.modifier, total: finalRoll.total, dc: finalRoll.dc, critical: false, hit: false,
            damage: 0, damageDice: [], damageSides: 0, damageBonus: 0, damageType: weapon.damageType, killed: false,
          },
        }));
      this.publish(entries);
      return entries;
    }
    const roll2 = finalRoll;

    const critical = roll2.critical === 'hit' || autoCritical;
    const damageExpr = monsterAction ? monsterAction.damage : `${weapon.damage}${this.damageModifier(attacker, weapon) ? `+${this.damageModifier(attacker, weapon)}` : ''}`;
    const damageRoll = rollDice(damageExpr, this.stream, critical);
    // The solo hero hits for a whole party's worth of damage.
    const soloBonus = attacker.side === 'party' ? (this.options.solo?.bonusDamage ?? 0) : 0;
    const amount = Math.max(0, damageRoll.total + soloBonus);
    const targetHealthBefore = target.health.hp;
    entries.push(...this.applyDamageTo(target, amount, { critical, melee: !isRanged(weapon), damageType: monsterAction?.damageType ?? weapon.damageType }, attacker));
    // The attack leads the array — the presentation queue stages a strike from
    // the first entry — but `publish` puts it into the log ahead of the damage
    // and death it caused.
    entries.unshift(this.stage('attack',
      `${attacker.name} hits ${target.name} for ${amount} ${monsterAction?.damageType ?? weapon.damageType} damage${critical ? ' — a critical hit' : ''}.`,
      {
        actorId: attacker.id, targetId: target.id, amount, roll: roll2,
        detail: [...roll2.explanation, `${damageRoll.notation} → ${damageRoll.dice.join('+')}${damageRoll.bonus ? `+${damageRoll.bonus}` : ''}`],
        attack: {
          weapon: monsterAction?.name ?? weapon.name, ranged: isRanged(weapon), d20: roll2.dice, kept: roll2.kept,
          modifier: roll2.modifier, total: roll2.total, dc: roll2.dc, critical, hit: true,
          damage: amount, damageDice: damageRoll.dice, damageSides: damageRoll.dice.length > 0 ? (parseDice(damageExpr).sides || 6) : 0,
          damageBonus: damageRoll.bonus + soloBonus, damageType: monsterAction?.damageType ?? weapon.damageType,
          killed: targetHealthBefore > 0 && target.health.hp <= 0,
        },
      }));

    // A wolf's bite can knock a target prone.
    if (monsterAction?.condition && monsterAction.save && monsterAction.saveDc && target.health.hp > 0) {
      const save = resolveCheck({ kind: 'savingThrow', actor: target.actor, ability: monsterAction.save, dc: monsterAction.saveDc, stream: this.stream });
      if (!save.success) {
        target.conditions = addCondition(target.conditions, { id: `${monsterAction.id}-${target.id}`, type: monsterAction.condition, sourceId: attacker.id });
        entries.push(this.entry('condition', `${target.name} is knocked ${monsterAction.condition}.`, { actorId: attacker.id, targetId: target.id, roll: save }));
      }
    }
    this.publish(entries);
    return entries;
  }

  private applyDamageTo(target: Combatant, amount: number, options: { critical?: boolean; melee?: boolean; damageType?: string }, source?: Combatant): LogEntry[] {
    const entries: LogEntry[] = [];
    const monster = target.monsterId ? MONSTERS[target.monsterId] : undefined;
    const type = options.damageType as never;
    const before = target.health;
    target.health = applyDamage(target.health, amount, {
      critical: options.critical, melee: options.melee,
      resistant: monster?.resistances?.includes(type),
      vulnerable: monster?.vulnerabilities?.includes(type),
      immune: monster?.immunities?.includes(type),
    });
    if (target.health.hp > 0) { target.animation = 'hurt'; target.animationUntil = this.clock + 0.5; }

    // Damage breaks concentration unless the caster makes a Constitution save.
    if (target.concentratingOn && amount > 0) {
      const save = concentrationCheck(target.actor, amount, this.stream);
      if (!save.success) {
        entries.push(this.stage('save', `${target.name} loses concentration on ${SPELLS[target.concentratingOn.spellId]?.name ?? 'the spell'}.`, { actorId: target.id, roll: save }));
        target.concentratingOn = undefined;
      }
    }

    if (before.hp > 0 && target.health.hp <= 0 && !target.health.dead) {
      target.conditions = addCondition(target.conditions, { id: `down-${target.id}`, type: 'unconscious' });
      target.animation = 'down'; target.animationUntil = this.clock + 1.4;
      entries.push(this.stage('death', target.side === 'enemy'
        ? `${target.name} drops and does not move again.`
        : `${target.name} falls, bleeding out. They need help.`, { targetId: target.id, actorId: source?.id }));
      // A defeated monster is simply out of the fight.
      if (target.side === 'enemy') target.health.dead = true;
    } else if (target.health.dead) {
      target.animation = 'dead';
      entries.push(this.stage('death', `${target.name} is killed outright.`, { targetId: target.id, actorId: source?.id }));
    }
    return entries;
  }

  private doCast(caster: Combatant, spellId: string, targetIds: string[], slotLevel?: number): ActionOutcome {
    const spell = SPELLS[spellId];
    if (!spell) return { ok: false, reason: 'You do not know that spell.', entries: [] };
    if (!caster.spells.includes(spellId)) return { ok: false, reason: `${spell.name} is not prepared.`, entries: [] };
    if (!caster.caster) return { ok: false, reason: 'You are not a spellcaster.', entries: [] };

    const costType = spell.castingTime === 'bonusAction' ? 'bonusAction' : 'action';
    if (costType === 'action' && !caster.budget.action) return { ok: false, reason: 'Your action is already spent.', entries: [] };
    if (costType === 'bonusAction' && !caster.budget.bonusAction) return { ok: false, reason: 'Your bonus action is already spent.', entries: [] };

    const level = spell.level === 0 ? 0 : (slotLevel ?? lowestAvailableSlot(caster.slots, spell.level) ?? spell.level);
    if (spell.level > 0 && !consumeSlot(caster.slots, level)) return { ok: false, reason: `No level ${level} spell slot remains.`, entries: [] };

    const targets: SpellTargetState[] = [];
    for (const id of targetIds) {
      const t = this.byId(id);
      if (!t) continue;
      if (spell.range > 0 && spell.target !== 'self') {
        const gap = this.gapFeet(caster, t);
        if (gap > spell.range) return { ok: false, reason: `${t.name} is beyond the spell's ${spell.range} ft range.`, entries: [] };
        if (spell.attack && !this.canSee(caster, t)) return { ok: false, reason: 'You have no clear line to the target.', entries: [] };
      }
      const monster = t.monsterId ? MONSTERS[t.monsterId] : undefined;
      targets.push({
        id: t.id, armorClass: t.armorClass, actor: t.actor, currentHp: t.health.hp,
        resistant: spell.damageType ? monster?.resistances?.includes(spell.damageType) : false,
        vulnerable: spell.damageType ? monster?.vulnerabilities?.includes(spell.damageType) : false,
        immune: spell.damageType ? monster?.immunities?.includes(spell.damageType) : false,
      });
    }
    if (!targets.length && spell.target !== 'self') return { ok: false, reason: 'Choose a target first.', entries: [] };

    if (costType === 'action') caster.budget.action = false; else caster.budget.bonusAction = false;
    caster.animation = 'cast'; caster.animationUntil = this.clock + 1;

    // Starting a new concentration spell ends the previous one.
    if (spell.concentration && caster.concentratingOn) {
      this.entry('info', `${caster.name} lets go of ${SPELLS[caster.concentratingOn.spellId]?.name ?? 'the earlier spell'}.`, { actorId: caster.id });
    }

    const result = castSpell(spellId, { caster: caster.actor, profile: caster.caster, targets, slotLevel: level, stream: this.stream });
    const entries: LogEntry[] = [this.entry('spell', `${caster.name} casts ${spell.name}${level > spell.level ? ` at level ${level}` : ''}.`, { actorId: caster.id, detail: result.explanation })];

    for (const effect of result.effects) {
      const t = this.byId(effect.targetId);
      if (!t) continue;
      if (effect.damage > 0) {
        entries.push(this.entry('damage', effect.message, { actorId: caster.id, targetId: t.id, amount: effect.damage, roll: effect.attack ?? effect.save }));
        entries.push(...this.applyDamageTo(t, effect.damage, { critical: effect.critical, melee: spell.range <= 5, damageType: spell.damageType }, caster));
      } else if (effect.healing > 0) {
        const wasDown = t.health.hp <= 0;
        t.health = heal(t.health, effect.healing);
        if (wasDown && t.health.hp > 0) t.conditions = removeCondition(t.conditions, 'unconscious');
        t.animation = 'idle';
        entries.push(this.entry('heal', `${effect.message}${wasDown ? ' They are back on their feet.' : ''}`, { actorId: caster.id, targetId: t.id, amount: effect.healing }));
      } else {
        entries.push(this.entry('spell', effect.message, { actorId: caster.id, targetId: t.id, roll: effect.attack ?? effect.save }));
      }
      if (effect.condition && t.health.hp > 0) {
        t.conditions = addCondition(t.conditions, { id: `${spellId}-${t.id}`, type: effect.condition, sourceId: caster.id, rounds: spell.duration, concentration: spell.concentration });
        entries.push(this.entry('condition', `${t.name} is ${effect.condition}.`, { targetId: t.id }));
      }
    }

    if (spell.acBonus) {
      caster.armorClass += spell.acBonus;
      entries.push(this.entry('info', `${caster.name}'s armour class rises to ${caster.armorClass} until their next turn.`, { actorId: caster.id }));
    }
    if (spell.temporaryHp) {
      const roll = rollDice(spell.temporaryHp, this.stream);
      caster.health = grantTemporaryHp(caster.health, roll.total);
    }
    caster.concentratingOn = spell.concentration ? { spellId, targetIds: targets.map(t => t.id) } : caster.concentratingOn;

    // Publish before checking the end: `checkEnd` writes its victory entry
    // straight to the log, and it belongs after the damage that earned it.
    this.publish(entries);
    this.checkEnd(entries);
    this.onChange();
    return { ok: true, entries };
  }

  /**
   * Move along a path, spending feet of movement and provoking opportunity
   * attacks from any enemy whose reach you leave.
   */
  private doMove(c: Combatant, to: Vec2): ActionOutcome {
    if (!canMove(c.conditions)) return { ok: false, reason: 'You cannot move right now.', entries: [] };
    const requested = distanceFeet(c.position, to);
    const available = c.budget.movement - c.budget.movementUsed;
    if (requested < 0.5) return { ok: false, reason: 'That is where you already stand.', entries: [] };

    // Clip the move to the remaining budget rather than rejecting it outright.
    const ratio = Math.min(1, available / requested);
    let destination: Vec2 = { x: c.position.x + (to.x - c.position.x) * ratio, z: c.position.z + (to.z - c.position.z) * ratio };
    if (this.options.passable && !this.options.passable(destination.x, destination.z)) {
      // Walk back along the line until the ground is standable.
      let found = false;
      for (let t = ratio; t > 0.05; t -= 0.05) {
        const p = { x: c.position.x + (to.x - c.position.x) * t, z: c.position.z + (to.z - c.position.z) * t };
        if (this.options.passable(p.x, p.z)) { destination = p; found = true; break; }
      }
      if (!found) return { ok: false, reason: 'Something is in the way.', entries: [] };
    }
    // Do not stand inside another creature.
    for (const other of this.combatants) {
      if (other === c || other.health.hp <= 0) continue;
      const min = radiusOf(c) + radiusOf(other) + 0.05;
      const d = distanceMetres(destination, other.position);
      if (d < min) {
        if (d < 0.001) return { ok: false, reason: 'Someone is already standing there.', entries: [] };
        destination = { x: other.position.x + (destination.x - other.position.x) / d * min, z: other.position.z + (destination.z - other.position.z) / d * min };
      }
    }

    const spent = distanceFeet(c.position, destination);
    const entries: LogEntry[] = [];
    const from = { ...c.position };

    if (!c.disengaging) {
      for (const enemy of this.combatants) {
        if (enemy.side === c.side || enemy.health.hp <= 0 || enemy.reactionUsed || !canAct(enemy.conditions)) continue;
        const wasEngaged = this.gapBetween(from, enemy, c) <= 5;
        const stillEngaged = this.gapBetween(destination, enemy, c) <= 5;
        if (wasEngaged && !stillEngaged) {
          enemy.reactionUsed = true;
          const weapon = enemy.monsterId ? WEAPONS.scimitar : this.weaponFor(enemy);
          entries.push(this.entry('info', `${enemy.name} takes an opportunity attack as ${c.name} breaks away.`, { actorId: enemy.id, targetId: c.id }));
          entries.push(...this.resolveWeaponAttack(enemy, c, weapon, 5));
        }
      }
    }

    c.position = destination;
    c.facing = Math.atan2(destination.x - from.x, destination.z - from.z);
    c.budget.movementUsed += spent;
    c.animation = 'move'; c.animationUntil = this.clock + 0.3;
    entries.push(this.entry('move', `${c.name} moves ${Math.round(spent)} ft.`, { actorId: c.id, amount: Math.round(spent) }));
    this.checkEnd(entries);
    this.onChange();
    return { ok: true, entries };
  }

  private gapBetween(position: Vec2, other: Combatant, self: Combatant) {
    return Math.max(0, metresToFeet(distanceMetres(position, other.position) - radiusOf(self) - radiusOf(other)));
  }

  private doDash(c: Combatant): ActionOutcome {
    if (!c.budget.action) return { ok: false, reason: 'Your action is already spent.', entries: [] };
    c.budget.action = false;
    c.budget.movement += c.speed;
    return { ok: true, entries: [this.entry('info', `${c.name} dashes — ${c.speed} extra feet of movement.`, { actorId: c.id })] };
  }

  private doDisengage(c: Combatant): ActionOutcome {
    if (!c.budget.action) return { ok: false, reason: 'Your action is already spent.', entries: [] };
    c.budget.action = false; c.disengaging = true;
    return { ok: true, entries: [this.entry('info', `${c.name} disengages. Moving away provokes nothing this turn.`, { actorId: c.id })] };
  }

  private doDodge(c: Combatant): ActionOutcome {
    if (!c.budget.action) return { ok: false, reason: 'Your action is already spent.', entries: [] };
    c.budget.action = false; c.dodging = true;
    return { ok: true, entries: [this.entry('info', `${c.name} takes the Dodge action. Attacks against them have disadvantage.`, { actorId: c.id })] };
  }

  private doHide(c: Combatant): ActionOutcome {
    if (!c.budget.action) return { ok: false, reason: 'Your action is already spent.', entries: [] };
    c.budget.action = false;
    const check = resolveCheck({ kind: 'skill', actor: c.actor, ability: 'dex', skill: 'stealth', stream: this.stream });
    const watchers = this.combatants.filter(o => o.side !== c.side && o.health.hp > 0);
    const bestPassive = Math.max(10, ...watchers.map(o => 10 + abilityModifier(o.actor.abilities.wis)));
    const hidden = check.total > bestPassive && this.coverFor(watchers[0] ?? c, c) !== 'none';
    if (hidden) c.conditions = addCondition(c.conditions, { id: `hidden-${c.id}`, type: 'invisible', rounds: 1 });
    return { ok: true, entries: [this.entry('info', hidden ? `${c.name} slips out of sight (Stealth ${check.total}).` : `${c.name} finds no cover to hide behind (Stealth ${check.total}).`, { actorId: c.id, roll: check })] };
  }

  private doHelp(c: Combatant, targetId: string): ActionOutcome {
    const ally = this.byId(targetId);
    if (!ally || ally.side !== c.side) return { ok: false, reason: 'Help an ally, not an enemy.', entries: [] };
    if (!c.budget.action) return { ok: false, reason: 'Your action is already spent.', entries: [] };
    c.budget.action = false; ally.helpedBy = true;
    return { ok: true, entries: [this.entry('info', `${c.name} draws the enemy's attention. ${ally.name} attacks with advantage.`, { actorId: c.id, targetId })] };
  }

  private doShove(c: Combatant, targetId: string): ActionOutcome {
    const target = this.byId(targetId);
    if (!target) return { ok: false, reason: 'No such target.', entries: [] };
    if (!c.budget.action) return { ok: false, reason: 'Your action is already spent.', entries: [] };
    if (this.gapFeet(c, target) > 5) return { ok: false, reason: 'Step closer to shove them.', entries: [] };
    c.budget.action = false;
    const attack = resolveCheck({ kind: 'skill', actor: c.actor, ability: 'str', skill: 'athletics', stream: this.stream });
    const defenceSkill = abilityModifier(target.actor.abilities.dex) > abilityModifier(target.actor.abilities.str) ? 'acrobatics' : 'athletics';
    const defence = resolveCheck({ kind: 'skill', actor: target.actor, ability: defenceSkill === 'acrobatics' ? 'dex' : 'str', skill: defenceSkill, stream: this.stream });
    if (attack.total > defence.total) {
      target.conditions = addCondition(target.conditions, { id: `shoved-${target.id}`, type: 'prone', sourceId: c.id });
      return { ok: true, entries: [this.entry('condition', `${c.name} shoves ${target.name} to the ground (${attack.total} vs ${defence.total}).`, { actorId: c.id, targetId, roll: attack })] };
    }
    return { ok: true, entries: [this.entry('info', `${target.name} holds their footing (${defence.total} vs ${attack.total}).`, { actorId: c.id, targetId, roll: defence })] };
  }

  private doSecondWind(c: Combatant): ActionOutcome {
    if (!c.budget.bonusAction) return { ok: false, reason: 'Your bonus action is already spent.', entries: [] };
    // Solo play grants extra uses: there is nobody else to patch you up.
    const allowed = c.side === 'party' ? (this.options.solo?.secondWindUses ?? 1) : 1;
    c.secondWindCount = c.secondWindCount ?? 0;
    if (c.secondWindCount >= allowed) return { ok: false, reason: 'Second Wind returns after a rest.', entries: [] };
    c.budget.bonusAction = false; c.secondWindCount++; c.secondWindUsed = c.secondWindCount >= allowed;
    const roll = rollDice({ count: 1, sides: 10, bonus: c.actor.level }, this.stream);
    c.health = heal(c.health, roll.total);
    return { ok: true, entries: [this.entry('heal', `${c.name} catches their breath and recovers ${roll.total} hit points.`, { actorId: c.id, amount: roll.total })] };
  }

  private doStabilize(c: Combatant, targetId: string): ActionOutcome {
    const target = this.byId(targetId);
    if (!target || target.health.hp > 0 || target.health.dead) return { ok: false, reason: 'They do not need stabilising.', entries: [] };
    if (!c.budget.action) return { ok: false, reason: 'Your action is already spent.', entries: [] };
    if (this.gapFeet(c, target) > 5) return { ok: false, reason: 'You must be beside them.', entries: [] };
    c.budget.action = false;
    const check = resolveCheck({ kind: 'skill', actor: c.actor, ability: 'wis', skill: 'medicine', dc: 10, stream: this.stream });
    if (check.success) {
      target.health = { ...target.health, stable: true, deathSaveSuccesses: 0, deathSaveFailures: 0 };
      return { ok: true, entries: [this.entry('heal', `${c.name} staunches the bleeding. ${target.name} is stable.`, { actorId: c.id, targetId, roll: check })] };
    }
    return { ok: true, entries: [this.entry('info', `${c.name} cannot stop the bleeding (Medicine ${check.total} vs DC 10).`, { actorId: c.id, targetId, roll: check })] };
  }

  // -- enemy AI -----------------------------------------------------------

  /**
   * One enemy turn. The AI picks the target it is most likely to drop, closes
   * the distance if it must, and uses Nimble Escape rather than eating an
   * opportunity attack.
   */
  /** Enemies that have already attacked the party this round. */
  private engagedThisRound = new Set<string>();
  private engagedRound = 0;

  runEnemyTurn(): LogEntry[] {
    const c = this.active;
    if (!c || c.side !== 'enemy' || this.finished) return [];
    const entries: LogEntry[] = [];

    // Solo play staggers the pack. Four goblins alpha-striking a lone level-1
    // hero on round one is not a fight, it is an execution — so the ones over
    // the cap hold position, circle, and come in on a later round.
    const cap = this.options.solo?.focusFireCap ?? 99;
    if (this.engagedRound !== this.round) { this.engagedRound = this.round; this.engagedThisRound.clear(); }
    if (cap < 99 && !this.engagedThisRound.has(c.id) && this.engagedThisRound.size >= cap) {
      entries.push(this.entry('turn', `${c.name} circles wide, looking for an opening.`, { actorId: c.id }));
      c.animation = 'move';
      if (!this.finished) entries.push(...this.endTurn());
      return entries;
    }
    this.engagedThisRound.add(c.id);
    const monster = c.monsterId ? MONSTERS[c.monsterId] : undefined;
    const targets = this.combatants.filter(t => t.side === 'party' && t.health.hp > 0 && !t.health.dead);
    if (!targets.length) { this.checkEnd(entries); return entries.concat(this.endTurn()); }

    const scored = targets.map(t => {
      const gap = this.gapFeet(c, t);
      const preview = { hp: t.health.hp, ac: t.armorClass, gap };
      // Prefer a target that is reachable, wounded and easy to hit.
      return { t, score: -preview.hp * 2 - preview.ac - gap * 0.4 + (this.canSee(c, t) ? 20 : -40) };
    }).sort((a, b) => b.score - a.score);
    const target = scored[0].t;

    let attacks = c.attacksPerAction;
    for (let i = 0; i < attacks + 1; i++) {
      const gap = this.gapFeet(c, target);
      const melee = this.monsterAction(c, 'melee'), ranged = this.monsterAction(c, 'ranged');
      const meleeWeapon = melee ? this.weaponForMonsterAction(melee) : WEAPONS.unarmed;
      const rangedWeapon = ranged ? this.weaponForMonsterAction(ranged) : null;

      if (melee && gap <= (melee.reach ?? 5)) {
        const outcome = this.doAttackAsActive(c, target, meleeWeapon);
        entries.push(...outcome);
      } else if (rangedWeapon && ranged && gap <= (ranged.longRange ?? ranged.reach) && this.canSee(c, target) && c.budget.action) {
        entries.push(...this.doAttackAsActive(c, target, rangedWeapon));
      } else if (c.budget.movement - c.budget.movementUsed > 0) {
        // Close to just inside reach.
        const reachM = feetToMetres(Math.max(5, melee?.reach ?? 5)) + radiusOf(c) + radiusOf(target) - 0.1;
        const dir = { x: target.position.x - c.position.x, z: target.position.z - c.position.z };
        const len = Math.hypot(dir.x, dir.z) || 1;
        const to = { x: target.position.x - dir.x / len * reachM, z: target.position.z - dir.z / len * reachM };
        const move = this.doMove(c, to);
        entries.push(...move.entries);
        if (!move.ok) break;
        // After moving, try the attack once more.
        if (this.gapFeet(c, target) <= (melee?.reach ?? 5) && c.budget.action) {
          entries.push(...this.doAttackAsActive(c, target, meleeWeapon));
        } else break;
      } else break;
      if (this.finished) break;
      attacks = c.budget.attacksRemaining > 0 && !c.budget.action ? attacks : 0;
      if (c.budget.attacksRemaining <= 0) break;
    }

    // Nimble Escape: withdraw safely rather than stand in reach at low health.
    if (!this.finished && monster?.traits.some(t => t.name === 'Nimble Escape') && c.budget.bonusAction && c.health.hp <= c.health.maxHp * 0.34) {
      c.budget.bonusAction = false; c.disengaging = true;
      entries.push(this.entry('info', `${c.name} scrambles back out of reach.`, { actorId: c.id }));
      const dir = { x: c.position.x - target.position.x, z: c.position.z - target.position.z };
      const len = Math.hypot(dir.x, dir.z) || 1;
      entries.push(...this.doMove(c, { x: c.position.x + dir.x / len * 3, z: c.position.z + dir.z / len * 3 }).entries);
    }

    this.checkEnd(entries);
    if (!this.finished) entries.push(...this.endTurn());
    return entries;
  }

  private weaponForMonsterAction(action: MonsterAction): Weapon {
    return {
      id: action.id, name: action.name,
      category: action.kind === 'ranged' ? 'simpleRanged' : 'simpleMelee',
      damage: action.damage, damageType: action.damageType, properties: [],
      reach: action.kind === 'melee' ? action.reach : undefined,
      range: action.kind === 'ranged' ? { normal: action.reach, long: action.longRange ?? action.reach * 4 } : undefined,
      weight: 0, cost: 0,
    };
  }

  private doAttackAsActive(attacker: Combatant, target: Combatant, weapon: Weapon): LogEntry[] {
    if (attacker.budget.action) attacker.budget.action = false;
    else if (attacker.budget.attacksRemaining <= 0) return [];
    attacker.budget.attacksRemaining--;
    const gap = this.gapFeet(attacker, target);
    if (rangePenalty(weapon, gap) === 'outOfRange') return [];
    return this.resolveWeaponAttack(attacker, target, weapon, gap);
  }

  // -- resolution ---------------------------------------------------------

  private checkEnd(entries: LogEntry[]) {
    if (this.finished) return;
    if (!this.living('enemy').length) {
      this.finished = true; this.outcome = 'victory';
      // A goblin that fled is still a goblin dealt with; the module awards the
      // encounter, so withdrawn enemies count toward experience.
      this.awardedXp = this.combatants.filter(c => c.side === 'enemy').reduce((sum, c) => sum + c.xp, 0);
      entries.push(this.entry('victory', `The fight is over. ${this.awardedXp} experience earned.`, { amount: this.awardedXp }));
      this.onChange();
    } else if (!this.combatants.some(c => c.side === 'party' && c.health.hp > 0)) {
      this.finished = true; this.outcome = 'defeat';
      entries.push(this.entry('defeat', 'You go down under the blades. The road ends here — for now.'));
      this.onChange();
    }
  }

  /**
   * Removes a combatant from the fight without killing it — the last goblin
   * bolting for the trail, a captured enemy, a creature that simply gives up.
   * Re-checks the win condition, which is what stops a routed enemy leaving
   * the encounter running forever.
   */
  withdraw(id: string, reason: string): LogEntry[] {
    const c = this.byId(id);
    if (!c || c.health.dead) return [];
    c.health = { ...c.health, dead: true };
    c.animation = 'move';
    c.withdrawn = true;
    const entries = [this.entry('info', reason, { actorId: c.id })];
    this.checkEnd(entries);
    // If it was that creature's turn, move play along.
    if (!this.finished && this.active?.id === id) entries.push(...this.endTurn());
    this.onChange();
    return entries;
  }

  /** Advance presentation timers; the renderer calls this every frame. */
  tick(dt: number) {
    this.clock += dt;
    for (const c of this.combatants) {
      if (c.animation !== 'idle' && c.animation !== 'down' && c.animation !== 'dead' && this.clock > c.animationUntil) c.animation = 'idle';
    }
  }

  /** Restore per-encounter resources when the fight ends. */
  restAfter(sheet: CharacterSheet): CharacterSheet {
    const hero = this.combatants.find(c => c.side === 'party');
    return {
      ...sheet,
      currentHp: hero ? Math.max(hero.health.hp, hero.health.hp > 0 ? hero.health.hp : 1) : sheet.currentHp,
      slots: hero ? { max: [...hero.slots.max], used: [...hero.slots.used] } : sheet.slots,
    };
  }

  longRestReset() {
    for (const c of this.combatants) {
      c.health = newHealth(c.health.maxHp);
      c.slots = restoreAllSlots(c.slots);
      c.conditions = [];
      c.secondWindUsed = false;
    }
  }
}

export const armorClassNote = (id?: string) => (id ? ARMOR[id]?.name ?? 'unarmoured' : 'unarmoured');
export const saveDcFor = spellSaveDc;
