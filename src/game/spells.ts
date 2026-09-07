import type { Ability, RulesActor } from './rules';
import { abilityModifier, resolveCheck, type CheckResult } from './rules';
export interface SpellDefinition { id: string; name: string; level: number; school: string; range: number; damage?: number; damageType?: string; save?: Ability; attack?: boolean; healing?: number; description: string }
export const SPELLS: Record<string, SpellDefinition> = {
  fireBolt: { id: 'fireBolt', name: 'Fire Bolt', level: 0, school: 'Evocation', range: 120, damage: 5, damageType: 'fire', attack: true, description: 'A bright mote of fire streaks toward one creature.' },
  rayOfFrost: { id: 'rayOfFrost', name: 'Ray of Frost', level: 0, school: 'Evocation', range: 60, damage: 4, damageType: 'cold', attack: true, description: 'A freezing ray slows the target.' },
  shield: { id: 'shield', name: 'Shield', level: 1, school: 'Abjuration', range: 0, description: 'A reaction of force raises your armor class until your next turn.' },
  cureWounds: { id: 'cureWounds', name: 'Cure Wounds', level: 1, school: 'Evocation', range: 5, healing: 7, description: 'Touch a creature and restore its vitality.' },
};
export interface SpellCast { spell: SpellDefinition; casterId: string; targetId: string; check?: CheckResult; amount: number; message: string }
export function spellAttackBonus(actor: RulesActor) { return abilityModifier(actor.abilities.int) + (actor.level >= 1 ? 2 + Math.ceil(Math.max(1, actor.level) / 4) - 1 : 2); }
export function spellSaveDc(actor: RulesActor) { return 8 + spellAttackBonus(actor); }
export function castSpell(spellId: string, caster: RulesActor, target: RulesActor, seed: number): SpellCast {
  const spell = SPELLS[spellId]; if (!spell) throw new Error('Unknown spell.');
  if (spell.attack) { const check = resolveCheck({ kind: 'attack', actor: caster, ability: 'int', dc: (target as RulesActor & { armorClass?: number }).armorClass ?? 10, modifiers: [{ label: 'spell attack', value: spellAttackBonus(caster) - abilityModifier(caster.abilities.int) }], seed }); return { spell, casterId: caster.id, targetId: target.id, check, amount: check.critical === 'miss' ? 0 : spell.damage ?? 0, message: check.critical === 'miss' ? `${spell.name} misses.` : `${spell.name} hits for ${spell.damage} ${spell.damageType} damage.` }; }
  if (spell.healing) return { spell, casterId: caster.id, targetId: target.id, amount: spell.healing + abilityModifier(caster.abilities.int), message: `${spell.name} restores ${spell.healing + abilityModifier(caster.abilities.int)} hit points.` };
  return { spell, casterId: caster.id, targetId: target.id, amount: 0, message: `${spell.name} is ready.` };
}
