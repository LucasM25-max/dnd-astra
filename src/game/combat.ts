import { applyDamage, newTurnBudget, resolveCheck, type ActiveCondition, type HealthState, type RulesActor, type TurnBudget } from './rules';
import { castSpell, SPELLS } from './spells';
export interface Combatant { actor: RulesActor; hp: HealthState; armorClass: number; conditions: ActiveCondition[]; budget: TurnBudget; side: 'party' | 'enemy'; spells: string[] }
export interface CombatEvent { type: 'turn' | 'attack' | 'spell' | 'defeat' | 'victory'; text: string; actorId?: string; targetId?: string; amount?: number }
export interface CombatState { round: number; activeId: string; combatants: Combatant[]; log: CombatEvent[]; finished: boolean; xp: number }
const clone = <T>(v: T): T => structuredClone(v);
export function createTrainingCombat(hero: Combatant): CombatState {
  const goblin = (id: string, dex: number): Combatant => ({ actor: { id, level: 1, abilities: { str: 8, dex, con: 10, int: 8, wis: 8, cha: 8 } }, hp: { hp: 7, maxHp: 7, temporaryHp: 0, deathSaveSuccesses: 0, deathSaveFailures: 0, stable: false }, armorClass: 13, conditions: [], budget: newTurnBudget(30), side: 'enemy', spells: [] });
  const state: CombatState = { round: 1, activeId: hero.actor.id, combatants: [clone(hero), goblin('goblin-scout', 14), goblin('goblin-raider', 12)], log: [], finished: false, xp: 0 };
  state.log.push({ type: 'turn', text: 'The ambush becomes a fight. Choose an action.' }); return state;
}
export function active(state: CombatState) { return state.combatants.find(c => c.actor.id === state.activeId)!; }
export function living(state: CombatState, side: Combatant['side']) { return state.combatants.filter(c => c.side === side && c.hp.hp > 0); }
function nextTurn(state: CombatState) {
  const order = state.combatants.filter(c => c.hp.hp > 0); const index = order.findIndex(c => c.actor.id === state.activeId); const next = order[(index + 1) % order.length];
  if (!next) return; if (next.actor.id === order[0].actor.id) state.round++;
  state.activeId = next.actor.id; next.budget = newTurnBudget(30); state.log.push({ type: 'turn', actorId: next.actor.id, text: `${next.actor.id}'s turn.` });
}
function finishIfNeeded(state: CombatState) { if (!living(state, 'enemy').length) { state.finished = true; state.xp = 100; state.log.push({ type: 'victory', text: 'Victory. The trail is yours again.' }); } else if (!living(state, 'party').length) { state.finished = true; state.log.push({ type: 'defeat', text: 'The party falls. The world rewinds to before the encounter.' }); } }
export function takeAttack(state: CombatState, targetId: string, seed: number) {
  const attacker = active(state), target = state.combatants.find(c => c.actor.id === targetId); if (state.finished || !target || attacker.side !== 'party' || target.hp.hp <= 0) return false;
  if (!attacker.budget.action) return false; attacker.budget.action = false;
  const result = resolveCheck({ kind: 'attack', actor: attacker.actor, ability: 'str', dc: target.armorClass, seed }); const amount = result.critical === 'hit' ? (result.critical === 'hit' && result.kept === 20 ? 10 : 5) : 0;
  if (amount) target.hp = applyDamage(target.hp, amount); state.log.push({ type: 'attack', actorId: attacker.actor.id, targetId, amount, text: amount ? `${attacker.actor.id} hits ${targetId} for ${amount}.` : `${attacker.actor.id} misses ${targetId}.` }); finishIfNeeded(state); if (!state.finished) nextTurn(state); return true;
}
export function takeSpell(state: CombatState, spellId: string, targetId: string, seed: number) {
  const attacker = active(state), target = state.combatants.find(c => c.actor.id === targetId); const spell = SPELLS[spellId]; if (state.finished || !target || !spell || attacker.side !== 'party' || !attacker.spells.includes(spellId) || !attacker.budget.action) return false;
  attacker.budget.action = false; const cast = castSpell(spellId, attacker.actor, { ...target.actor, armorClass: target.armorClass } as RulesActor, seed); if (cast.amount) target.hp = cast.spell.healing ? target.hp : applyDamage(target.hp, cast.amount); state.log.push({ type: 'spell', actorId: attacker.actor.id, targetId, amount: cast.amount, text: cast.message }); finishIfNeeded(state); if (!state.finished) nextTurn(state); return true;
}
export function enemyTurn(state: CombatState, seed: number) { const enemy = active(state), target = living(state, 'party')[0]; if (state.finished || enemy.side !== 'enemy' || !target) return false; const result = resolveCheck({ kind: 'attack', actor: enemy.actor, ability: 'dex', dc: target.armorClass, seed }); const amount = result.critical === 'hit' ? 3 : 0; if (amount) target.hp = applyDamage(target.hp, amount); state.log.push({ type: 'attack', actorId: enemy.actor.id, targetId: target.actor.id, amount, text: amount ? `${enemy.actor.id} strikes for ${amount}.` : `${enemy.actor.id} misses.` }); finishIfNeeded(state); if (!state.finished) nextTurn(state); return true; }
