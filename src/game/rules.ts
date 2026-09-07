/**
 * The deterministic rules kernel for Astra's first rules slice.
 *
 * Rendering, animation, UI and networking must not roll dice themselves. The
 * kernel consumes a seed and an explicit request, then returns an explainable
 * result. This makes rules replayable, testable, and safe to present in either
 * real-time exploration or turn-based combat.
 */
export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type Skill = 'acrobatics' | 'animalHandling' | 'arcana' | 'athletics' | 'deception' | 'history' | 'insight' | 'intimidation' | 'investigation' | 'medicine' | 'nature' | 'perception' | 'performance' | 'persuasion' | 'religion' | 'sleightOfHand' | 'stealth' | 'survival';
export const SKILL_ABILITY: Record<Skill, Ability> = {
  acrobatics: 'dex', animalHandling: 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int', insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis', performance: 'cha', persuasion: 'cha', religion: 'int', sleightOfHand: 'dex', stealth: 'dex', survival: 'wis',
};
export type AdvantageState = 'normal' | 'advantage' | 'disadvantage';
export type CheckKind = 'ability' | 'skill' | 'savingThrow' | 'attack';
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
  advantage?: AdvantageState;
  modifiers?: { label: string; value: number }[];
  /** A stable encounter/action id. Never use Math.random for a rules roll. */
  seed: number;
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
  critical?: 'hit' | 'miss';
  explanation: string[];
}
export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);
export function proficiencyBonus(level: number) { return 2 + Math.max(0, Math.ceil(Math.max(1, level) / 4) - 1); }
function roll(seed: number) {
  let n = (seed | 0) + 0x6D2B79F5 | 0;
  n = Math.imul(n ^ n >>> 15, 1 | n); n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
}
function d20(seed: number) { return Math.floor(roll(seed) * 20) + 1; }
export function resolveCheck(request: CheckRequest): CheckResult {
  const { actor, ability, skill, kind } = request;
  const state = request.advantage ?? 'normal';
  const dice = state === 'normal' ? [d20(request.seed)] : [d20(request.seed), d20(request.seed ^ 0x9e3779b9)];
  const kept = state === 'advantage' ? Math.max(...dice) : state === 'disadvantage' ? Math.min(...dice) : dice[0];
  const trained = skill ? actor.skills?.[skill] : undefined;
  const proficient = kind === 'skill' ? !!trained?.proficient : actor.proficientAbilities?.includes(ability) ?? false;
  const expertise = !!trained?.expertise;
  const prof = proficient ? proficiencyBonus(actor.level) * (expertise ? 2 : 1) : 0;
  const base = abilityModifier(actor.abilities[ability]) + prof;
  const extras = request.modifiers ?? [];
  const modifier = base + extras.reduce((sum, item) => sum + item.value, 0);
  const total = kept + modifier;
  const result: CheckResult = { kind, actorId: actor.id, ability, skill, dice, kept, modifier, total, dc: request.dc, explanation: [] };
  result.explanation.push(`${ability.toUpperCase()} ${abilityModifier(actor.abilities[ability]) >= 0 ? '+' : ''}${abilityModifier(actor.abilities[ability])}`);
  if (proficient) result.explanation.push(`${skill ? 'proficiency' : 'saving throw'} ${expertise ? 'expertise ' : ''}+${prof}`);
  for (const item of extras) if (item.value) result.explanation.push(`${item.label} ${item.value >= 0 ? '+' : ''}${item.value}`);
  if (state !== 'normal') result.explanation.push(state === 'advantage' ? 'advantage: highest d20 kept' : 'disadvantage: lowest d20 kept');
  if (request.dc !== undefined) result.success = total >= request.dc;
  if (kind === 'attack') {
    result.critical = kept === 20 ? 'hit' : kept === 1 ? 'miss' : result.success === false ? 'miss' : 'hit';
  }
  return result;
}

export type Condition = 'blinded' | 'charmed' | 'deafened' | 'frightened' | 'grappled' | 'incapacitated' | 'invisible' | 'paralyzed' | 'petrified' | 'poisoned' | 'prone' | 'restrained' | 'stunned' | 'unconscious' | 'exhausted';
export interface ActiveCondition { id: string; type: Condition; sourceId?: string; rounds?: number; concentration?: boolean }
export function hasCondition(conditions: ActiveCondition[], type: Condition) { return conditions.some(c => c.type === type); }
export function addCondition(conditions: ActiveCondition[], condition: ActiveCondition) {
  if (hasCondition(conditions, condition.type)) return conditions.map(c => c.type === condition.type ? {
    ...c,
    // An untimed condition is permanent until explicitly removed; it must not
    // accidentally become a zero-round effect when another instance arrives.
    rounds: c.rounds === undefined || condition.rounds === undefined ? undefined : Math.max(c.rounds, condition.rounds),
  } : c);
  return [...conditions, { ...condition }];
}
export function tickConditions(conditions: ActiveCondition[], rounds = 1) { return conditions.flatMap(c => c.rounds === undefined ? [c] : c.rounds - rounds > 0 ? [{ ...c, rounds: c.rounds - rounds }] : []); }

export type ActionType = 'action' | 'bonusAction' | 'reaction' | 'movement' | 'object' | 'free';
export interface TurnBudget { movement: number; movementUsed: number; action: boolean; bonusAction: boolean; reaction: boolean; object: boolean; freeSpeech: boolean }
export const newTurnBudget = (movement: number): TurnBudget => ({ movement, movementUsed: 0, action: true, bonusAction: true, reaction: true, object: true, freeSpeech: true });
export function spendBudget(budget: TurnBudget, type: ActionType, amount = 0) {
  if (type === 'movement') { if (amount < 0 || budget.movementUsed + amount > budget.movement) return false; budget.movementUsed += amount; return true; }
  if (type === 'free') return budget.freeSpeech ? (budget.freeSpeech = false, true) : false;
  if (type === 'object') return budget.object ? (budget.object = false, true) : false;
  if (type === 'action') return budget.action ? (budget.action = false, true) : false;
  if (type === 'bonusAction') return budget.bonusAction ? (budget.bonusAction = false, true) : false;
  return budget.reaction ? (budget.reaction = false, true) : false;
}

export interface RulesEvent { id: number; type: string; time: number; actorId?: string; payload: Record<string, unknown> }
export class RulesEventLog {
  private events: RulesEvent[] = [];
  private nextId = 1;
  append(type: string, time: number, payload: Record<string, unknown>, actorId?: string) { const event = { id: this.nextId++, type, time, actorId, payload }; this.events.push(event); return { ...event, payload: { ...payload } }; }
  all() { return this.events.map(e => ({ ...e, payload: { ...e.payload } })); }
  since(id: number) { return this.events.filter(e => e.id > id).map(e => ({ ...e, payload: { ...e.payload } })); }
  clear() { this.events = []; this.nextId = 1; }
}
export interface HealthState { hp: number; maxHp: number; temporaryHp: number; deathSaveSuccesses: number; deathSaveFailures: number; stable: boolean }
export function applyDamage(state: HealthState, amount: number, resistance = false, vulnerability = false): HealthState {
  let damage = Math.max(0, Math.floor(amount));
  if (resistance) damage = Math.floor(damage / 2);
  if (vulnerability) damage *= 2;
  const temporaryHp = Math.max(0, state.temporaryHp - damage);
  damage = Math.max(0, damage - state.temporaryHp);
  return { ...state, hp: Math.max(0, state.hp - damage), temporaryHp, stable: state.hp - damage > 0 ? state.stable : state.stable };
}
export function heal(state: HealthState, amount: number) { return { ...state, hp: Math.min(state.maxHp, state.hp + Math.max(0, Math.floor(amount))), stable: false }; }
export function isDowned(state: HealthState) { return state.hp <= 0; }
