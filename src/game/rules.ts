/**
 * The deterministic rules kernel.
 *
 * Rendering, animation, UI and AI must not roll dice themselves. The kernel
 * consumes an explicit request plus a `DiceStream` (or a seed) and returns an
 * explainable result. This makes rules replayable, testable, and safe to
 * present in either real-time exploration or turn-based combat.
 */
import { DiceStream, rollDice, type DiceRoll } from './dice';

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITY_LIST: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export type Skill = 'acrobatics' | 'animalHandling' | 'arcana' | 'athletics' | 'deception' | 'history' | 'insight' | 'intimidation' | 'investigation' | 'medicine' | 'nature' | 'perception' | 'performance' | 'persuasion' | 'religion' | 'sleightOfHand' | 'stealth' | 'survival';
export const SKILL_ABILITY: Record<Skill, Ability> = {
  acrobatics: 'dex', animalHandling: 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int', insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis', performance: 'cha', persuasion: 'cha', religion: 'int', sleightOfHand: 'dex', stealth: 'dex', survival: 'wis',
};
export const SKILL_LIST = Object.keys(SKILL_ABILITY) as Skill[];

export type AdvantageState = 'normal' | 'advantage' | 'disadvantage';
export type CheckKind = 'ability' | 'skill' | 'savingThrow' | 'attack' | 'deathSave' | 'initiative';

export interface RulesActor {
  id: string;
  level: number;
  abilities: Record<Ability, number>;
  proficientAbilities?: Ability[];
  skills?: Partial<Record<Skill, { proficient: boolean; expertise?: boolean }>>;
  proficiencyBonus?: number;
}

export interface CheckRequest {
  kind: CheckKind;
  actor: RulesActor;
  ability: Ability;
  skill?: Skill;
  dc?: number;
  /** Explicit state, or let the kernel combine sources below. */
  advantage?: AdvantageState;
  advantageSources?: string[];
  disadvantageSources?: string[];
  modifiers?: { label: string; value: number }[];
  /** The die number at or above which an attack crits (Champion lowers it). */
  criticalRange?: number;
  /** Provide a stream for a live encounter, or a seed for a one-off check. */
  stream?: DiceStream;
  seed?: number;
}

export interface CheckResult {
  kind: CheckKind;
  actorId: string;
  ability: Ability;
  skill?: Skill;
  dice: number[];
  kept: number;
  modifier: number;
  total: number;
  dc?: number;
  success?: boolean;
  advantage: AdvantageState;
  /** Set for attacks and death saves only. */
  critical?: 'hit' | 'miss';
  explanation: string[];
}

export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);
export function proficiencyBonus(level: number) { return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4); }

/**
 * Advantage never stacks numerically. Any number of advantage sources still
 * means two dice, and if both advantage and disadvantage apply they cancel and
 * the roll is made normally.
 */
export function combineAdvantage(advantage: readonly string[] = [], disadvantage: readonly string[] = []): AdvantageState {
  const up = advantage.length > 0, down = disadvantage.length > 0;
  if (up && down) return 'normal';
  if (up) return 'advantage';
  if (down) return 'disadvantage';
  return 'normal';
}

export function resolveCheck(request: CheckRequest): CheckResult {
  const { actor, ability, skill, kind } = request;
  const stream = request.stream ?? new DiceStream(request.seed ?? 0);
  const state = request.advantage ?? combineAdvantage(request.advantageSources, request.disadvantageSources);
  const dice = state === 'normal' ? [stream.d20()] : [stream.d20(), stream.d20()];
  const kept = state === 'advantage' ? Math.max(...dice) : state === 'disadvantage' ? Math.min(...dice) : dice[0];

  const bonus = actor.proficiencyBonus ?? proficiencyBonus(actor.level);
  const trained = skill ? actor.skills?.[skill] : undefined;
  const proficient = kind === 'skill' ? !!trained?.proficient
    : kind === 'savingThrow' || kind === 'attack' ? actor.proficientAbilities?.includes(ability) ?? false
      : false;
  const expertise = !!trained?.expertise;
  const prof = proficient ? bonus * (expertise ? 2 : 1) : 0;
  const abilityMod = kind === 'deathSave' ? 0 : abilityModifier(actor.abilities[ability]);
  const extras = request.modifiers ?? [];
  const modifier = abilityMod + prof + extras.reduce((sum, item) => sum + item.value, 0);
  const total = kept + modifier;

  const result: CheckResult = { kind, actorId: actor.id, ability, skill, dice, kept, modifier, total, dc: request.dc, advantage: state, explanation: [] };
  if (kind !== 'deathSave') result.explanation.push(`${ability.toUpperCase()} ${abilityMod >= 0 ? '+' : ''}${abilityMod}`);
  if (prof) result.explanation.push(`${expertise ? 'expertise' : 'proficiency'} +${prof}`);
  for (const item of extras) if (item.value) result.explanation.push(`${item.label} ${item.value >= 0 ? '+' : ''}${item.value}`);
  if (state !== 'normal') {
    const reasons = state === 'advantage' ? request.advantageSources : request.disadvantageSources;
    result.explanation.push(`${state}${reasons?.length ? ` (${reasons.join(', ')})` : ''}: ${state === 'advantage' ? 'highest' : 'lowest'} of ${dice.join('/')}`);
  } else if (request.advantageSources?.length && request.disadvantageSources?.length) {
    result.explanation.push('advantage and disadvantage cancel');
  }

  if (kind === 'attack') {
    // A natural 20 always hits and a natural 1 always misses, regardless of AC.
    const critRange = request.criticalRange ?? 20;
    if (kept >= critRange) { result.critical = 'hit'; result.success = true; }
    else if (kept === 1) { result.critical = 'miss'; result.success = false; }
    else result.success = request.dc === undefined ? undefined : total >= request.dc;
    if (result.critical === 'hit') result.explanation.push('critical hit');
    if (result.critical === 'miss') result.explanation.push('critical miss');
  } else if (kind === 'deathSave') {
    if (kept === 20) { result.critical = 'hit'; result.success = true; }
    else if (kept === 1) { result.critical = 'miss'; result.success = false; }
    else result.success = total >= (request.dc ?? 10);
  } else if (request.dc !== undefined) {
    result.success = total >= request.dc;
  }
  return result;
}

/** Initiative: a Dexterity check, ties broken by the higher Dexterity score. */
export function rollInitiative(actor: RulesActor, stream: DiceStream, modifiers: { label: string; value: number }[] = []) {
  return resolveCheck({ kind: 'initiative', actor, ability: 'dex', modifiers, stream });
}

export function passiveScore(actor: RulesActor, skill: Skill, advantage: AdvantageState = 'normal') {
  const trained = actor.skills?.[skill];
  const bonus = actor.proficiencyBonus ?? proficiencyBonus(actor.level);
  const prof = trained?.proficient ? bonus * (trained.expertise ? 2 : 1) : 0;
  return 10 + abilityModifier(actor.abilities[SKILL_ABILITY[skill]]) + prof + (advantage === 'advantage' ? 5 : advantage === 'disadvantage' ? -5 : 0);
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type Condition = 'blinded' | 'charmed' | 'deafened' | 'frightened' | 'grappled' | 'incapacitated' | 'invisible' | 'paralyzed' | 'petrified' | 'poisoned' | 'prone' | 'restrained' | 'stunned' | 'unconscious';
export const CONDITION_NAMES: Record<Condition, string> = {
  blinded: 'Blinded', charmed: 'Charmed', deafened: 'Deafened', frightened: 'Frightened', grappled: 'Grappled',
  incapacitated: 'Incapacitated', invisible: 'Invisible', paralyzed: 'Paralysed', petrified: 'Petrified', poisoned: 'Poisoned',
  prone: 'Prone', restrained: 'Restrained', stunned: 'Stunned', unconscious: 'Unconscious',
};
export const CONDITION_TEXT: Record<Condition, string> = {
  blinded: 'Cannot see. Attacks against this creature have advantage; its own attacks have disadvantage.',
  charmed: 'Cannot attack the charmer, who has advantage on social checks against it.',
  deafened: 'Cannot hear and automatically fails hearing-based checks.',
  frightened: 'Disadvantage while the source of fear is in sight, and cannot willingly move closer to it.',
  grappled: 'Speed is zero until the grapple ends.',
  incapacitated: 'Cannot take actions or reactions.',
  invisible: 'Attacks against this creature have disadvantage; its own attacks have advantage.',
  paralyzed: 'Incapacitated and unable to move or speak. Melee hits within five feet are critical.',
  petrified: 'Transformed to stone, incapacitated, and resistant to all damage.',
  poisoned: 'Disadvantage on attack rolls and ability checks.',
  prone: 'Melee attacks against it have advantage, ranged attacks have disadvantage, and its own attacks have disadvantage.',
  restrained: 'Speed is zero. Attacks against it have advantage, its attacks have disadvantage, and Dexterity saves have disadvantage.',
  stunned: 'Incapacitated, cannot move, and automatically fails Strength and Dexterity saves.',
  unconscious: 'Incapacitated, prone and unaware. Melee hits within five feet are critical.',
};

export interface ActiveCondition { id: string; type: Condition; sourceId?: string; rounds?: number; concentration?: boolean }

export function hasCondition(conditions: readonly ActiveCondition[], type: Condition) { return conditions.some(c => c.type === type); }

export function addCondition(conditions: readonly ActiveCondition[], condition: ActiveCondition): ActiveCondition[] {
  if (hasCondition(conditions, condition.type)) return conditions.map(c => c.type === condition.type ? {
    ...c,
    // An untimed condition is permanent until explicitly removed; it must not
    // accidentally become a zero-round effect when another instance arrives.
    rounds: c.rounds === undefined || condition.rounds === undefined ? undefined : Math.max(c.rounds, condition.rounds),
  } : c);
  return [...conditions, { ...condition }];
}
export function removeCondition(conditions: readonly ActiveCondition[], type: Condition) { return conditions.filter(c => c.type !== type); }
export function tickConditions(conditions: readonly ActiveCondition[], rounds = 1) {
  return conditions.flatMap(c => c.rounds === undefined ? [c] : c.rounds - rounds > 0 ? [{ ...c, rounds: c.rounds - rounds }] : []);
}

/** Conditions that stop a creature acting at all. */
export const INCAPACITATING: Condition[] = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];
export const canAct = (conditions: readonly ActiveCondition[]) => !INCAPACITATING.some(t => hasCondition(conditions, t));
export const canMove = (conditions: readonly ActiveCondition[]) => canAct(conditions) && !hasCondition(conditions, 'grappled') && !hasCondition(conditions, 'restrained');

/** How a defender's conditions change an incoming attack. */
export function defenderAttackEffects(conditions: readonly ActiveCondition[], melee: boolean) {
  const advantage: string[] = [], disadvantage: string[] = [];
  if (hasCondition(conditions, 'blinded')) advantage.push('target blinded');
  if (hasCondition(conditions, 'restrained')) advantage.push('target restrained');
  if (hasCondition(conditions, 'paralyzed')) advantage.push('target paralysed');
  if (hasCondition(conditions, 'stunned')) advantage.push('target stunned');
  if (hasCondition(conditions, 'unconscious')) advantage.push('target unconscious');
  if (hasCondition(conditions, 'invisible')) disadvantage.push('target unseen');
  if (hasCondition(conditions, 'prone')) (melee ? advantage : disadvantage).push('target prone');
  const autoCritical = melee && (hasCondition(conditions, 'paralyzed') || hasCondition(conditions, 'unconscious'));
  return { advantage, disadvantage, autoCritical };
}

/** How an attacker's own conditions change its attack. */
export function attackerAttackEffects(conditions: readonly ActiveCondition[]) {
  const advantage: string[] = [], disadvantage: string[] = [];
  if (hasCondition(conditions, 'invisible')) advantage.push('attacker unseen');
  if (hasCondition(conditions, 'poisoned')) disadvantage.push('poisoned');
  if (hasCondition(conditions, 'blinded')) disadvantage.push('blinded');
  if (hasCondition(conditions, 'frightened')) disadvantage.push('frightened');
  if (hasCondition(conditions, 'prone')) disadvantage.push('prone');
  if (hasCondition(conditions, 'restrained')) disadvantage.push('restrained');
  return { advantage, disadvantage };
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

export type Cover = 'none' | 'half' | 'threeQuarters' | 'total';
export const coverAcBonus = (cover: Cover) => (cover === 'half' ? 2 : cover === 'threeQuarters' ? 5 : 0);
export const COVER_NAMES: Record<Cover, string> = { none: 'In the open', half: 'Half cover', threeQuarters: 'Three-quarters cover', total: 'Fully obscured' };

// ---------------------------------------------------------------------------
// Action economy
// ---------------------------------------------------------------------------

export type ActionType = 'action' | 'bonusAction' | 'reaction' | 'movement' | 'object' | 'free';
export interface TurnBudget { movement: number; movementUsed: number; action: boolean; bonusAction: boolean; reaction: boolean; object: boolean; freeSpeech: boolean; attacksRemaining: number }
export const newTurnBudget = (movement: number, attacks = 1): TurnBudget =>
  ({ movement, movementUsed: 0, action: true, bonusAction: true, reaction: true, object: true, freeSpeech: true, attacksRemaining: attacks });
export const movementLeft = (budget: TurnBudget) => Math.max(0, budget.movement - budget.movementUsed);

export function spendBudget(budget: TurnBudget, type: ActionType, amount = 0) {
  if (type === 'movement') { if (amount < 0 || budget.movementUsed + amount > budget.movement + 1e-6) return false; budget.movementUsed += amount; return true; }
  if (type === 'free') return budget.freeSpeech ? (budget.freeSpeech = false, true) : false;
  if (type === 'object') return budget.object ? (budget.object = false, true) : false;
  if (type === 'action') return budget.action ? (budget.action = false, true) : false;
  if (type === 'bonusAction') return budget.bonusAction ? (budget.bonusAction = false, true) : false;
  return budget.reaction ? (budget.reaction = false, true) : false;
}

// ---------------------------------------------------------------------------
// Health, damage and dying
// ---------------------------------------------------------------------------

export interface HealthState {
  hp: number; maxHp: number; temporaryHp: number;
  deathSaveSuccesses: number; deathSaveFailures: number; stable: boolean; dead: boolean;
}
export const newHealth = (maxHp: number): HealthState =>
  ({ hp: maxHp, maxHp, temporaryHp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: false, dead: false });

export interface DamageOptions { resistant?: boolean; vulnerable?: boolean; immune?: boolean; /** A downed creature taking a hit fails death saves. */ melee?: boolean; critical?: boolean }

export function applyDamage(state: HealthState, amount: number, options: DamageOptions | boolean = {}, legacyVulnerable = false): HealthState {
  // Older call sites passed (state, amount, resistant, vulnerable).
  const opts: DamageOptions = typeof options === 'boolean' ? { resistant: options, vulnerable: legacyVulnerable } : options;
  let damage = Math.max(0, Math.floor(amount));
  if (opts.immune) damage = 0;
  else {
    if (opts.resistant) damage = Math.floor(damage / 2);
    if (opts.vulnerable) damage *= 2;
  }
  const next: HealthState = { ...state };
  const absorbed = Math.min(next.temporaryHp, damage);
  next.temporaryHp -= absorbed;
  damage -= absorbed;

  if (next.hp <= 0 && !next.dead && damage > 0) {
    // A hit on a creature already at zero hit points is an automatic death-save
    // failure — two of them if the blow was a critical.
    next.deathSaveFailures = Math.min(3, next.deathSaveFailures + (opts.critical ? 2 : 1));
    next.stable = false;
    if (next.deathSaveFailures >= 3) next.dead = true;
    return next;
  }

  const remaining = next.hp - damage;
  if (remaining <= 0) {
    const overkill = -remaining;
    next.hp = 0;
    next.stable = false;
    next.deathSaveSuccesses = 0; next.deathSaveFailures = 0;
    // Damage that exceeds the creature's hit point maximum kills outright.
    if (overkill >= next.maxHp) next.dead = true;
  } else next.hp = remaining;
  return next;
}

export function heal(state: HealthState, amount: number): HealthState {
  if (state.dead) return state;
  const healed = Math.max(0, Math.floor(amount));
  if (!healed) return state;
  return { ...state, hp: Math.min(state.maxHp, state.hp + healed), stable: false, deathSaveSuccesses: 0, deathSaveFailures: 0 };
}

export function stabilize(state: HealthState): HealthState {
  return state.hp > 0 || state.dead ? state : { ...state, stable: true, deathSaveSuccesses: 0, deathSaveFailures: 0 };
}
export function grantTemporaryHp(state: HealthState, amount: number): HealthState {
  // Temporary hit points never stack; the larger pool wins.
  return { ...state, temporaryHp: Math.max(state.temporaryHp, Math.max(0, Math.floor(amount))) };
}

export interface DeathSaveOutcome { health: HealthState; result: CheckResult; note: string }

export function rollDeathSave(actor: RulesActor, state: HealthState, stream: DiceStream): DeathSaveOutcome {
  const result = resolveCheck({ kind: 'deathSave', actor, ability: 'con', dc: 10, stream });
  const next = { ...state };
  let note: string;
  if (result.critical === 'hit') { next.hp = 1; next.deathSaveSuccesses = 0; next.deathSaveFailures = 0; note = 'A natural twenty — they wake with one hit point.'; }
  else if (result.critical === 'miss') { next.deathSaveFailures = Math.min(3, next.deathSaveFailures + 2); note = 'A natural one counts as two failures.'; }
  else if (result.success) { next.deathSaveSuccesses = Math.min(3, next.deathSaveSuccesses + 1); note = 'A success.'; }
  else { next.deathSaveFailures = Math.min(3, next.deathSaveFailures + 1); note = 'A failure.'; }
  if (next.deathSaveSuccesses >= 3) { next.stable = true; next.deathSaveSuccesses = 3; note = 'Three successes — they are stable.'; }
  if (next.deathSaveFailures >= 3) { next.dead = true; note = 'Three failures. They are gone.'; }
  return { health: next, result, note };
}

export const isDowned = (state: HealthState) => state.hp <= 0;
export const isDying = (state: HealthState) => state.hp <= 0 && !state.dead && !state.stable;

// ---------------------------------------------------------------------------
// Rests
// ---------------------------------------------------------------------------

export interface HitDicePool { size: number; total: number; remaining: number }

/** Spending one hit die during a short rest. */
export function spendHitDie(health: HealthState, pool: HitDicePool, conModifier: number, stream: DiceStream) {
  if (pool.remaining <= 0 || health.hp <= 0 || health.hp >= health.maxHp) return { health, pool, roll: null as DiceRoll | null };
  const roll = rollDice({ count: 1, sides: pool.size, bonus: conModifier }, stream);
  return { health: heal(health, Math.max(1, roll.total)), pool: { ...pool, remaining: pool.remaining - 1 }, roll };
}

/** A long rest restores all hit points and half of the character's hit dice. */
export function longRest(health: HealthState, pool: HitDicePool) {
  return {
    health: { ...health, hp: health.dead ? 0 : health.maxHp, temporaryHp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: true },
    pool: { ...pool, remaining: Math.min(pool.total, pool.remaining + Math.max(1, Math.floor(pool.total / 2))) },
  };
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

export interface RulesEvent { id: number; type: string; time: number; actorId?: string; payload: Record<string, unknown> }
export class RulesEventLog {
  private events: RulesEvent[] = [];
  private nextId = 1;
  private limit = 2000;
  append(type: string, time: number, payload: Record<string, unknown>, actorId?: string) {
    const event = { id: this.nextId++, type, time, actorId, payload };
    this.events.push(event);
    // Keep long sessions bounded; the journal only ever shows the recent tail.
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
    return { ...event, payload: { ...payload } };
  }
  all() { return this.events.map(e => ({ ...e, payload: { ...e.payload } })); }
  since(id: number) { return this.events.filter(e => e.id > id).map(e => ({ ...e, payload: { ...e.payload } })); }
  clear() { this.events = []; this.nextId = 1; }
}

// ---------------------------------------------------------------------------
// Distance helpers — the world is in metres, the rules are in feet.
// ---------------------------------------------------------------------------

export const METRES_PER_FOOT = 0.3048;
export const feetToMetres = (feet: number) => feet * METRES_PER_FOOT;
export const metresToFeet = (metres: number) => metres / METRES_PER_FOOT;
/** Round to the 5-foot step the rules assume without imposing a visible grid. */
export const snapFeet = (feet: number) => Math.round(feet / 5) * 5;
