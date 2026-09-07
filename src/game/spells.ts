/**
 * Spellcasting: structured spell data, slot tracking, concentration, and a
 * resolver that returns an explainable outcome. Damage is rolled from real
 * dice expressions and cantrips scale by character level, as the PHB
 * describes. Descriptions are original prose.
 */
import { averageOf, rollDice, type DiceStream } from './dice';
import {
  abilityModifier, proficiencyBonus, resolveCheck,
  type Ability, type CheckResult, type Condition, type RulesActor,
} from './rules';
import type { DamageType } from './equipment';

export type SpellSchool = 'Abjuration' | 'Conjuration' | 'Divination' | 'Enchantment' | 'Evocation' | 'Illusion' | 'Necromancy' | 'Transmutation';
export type SpellTarget = 'creature' | 'self' | 'point' | 'area';

export interface SpellDefinition {
  id: string;
  name: string;
  level: number;               // 0 = cantrip
  school: SpellSchool;
  castingTime: 'action' | 'bonusAction' | 'reaction' | 'minute';
  /** Feet. 0 means self, 5 means touch. */
  range: number;
  target: SpellTarget;
  /** Radius in feet for area spells. */
  areaRadius?: number;
  concentration?: boolean;
  /** Rounds the effect lasts, when it has a duration. */
  duration?: number;
  ritual?: boolean;

  attack?: boolean;            // requires a spell attack roll
  save?: Ability;              // requires the target to make a saving throw
  halfOnSave?: boolean;
  damage?: string;
  damageType?: DamageType;
  /** Extra dice per slot level above the spell's own level. */
  upcastDamage?: string;
  /** Cantrips add a die at 5th, 11th and 17th level. */
  cantripScaling?: boolean;

  healing?: string;
  upcastHealing?: string;
  temporaryHp?: string;
  condition?: Condition;
  acBonus?: number;

  description: string;
}

export const SPELLS: Record<string, SpellDefinition> = {
  // --- Cantrips -----------------------------------------------------------
  fireBolt: {
    id: 'fireBolt', name: 'Fire Bolt', level: 0, school: 'Evocation', castingTime: 'action', range: 120, target: 'creature',
    attack: true, damage: '1d10', damageType: 'fire', cantripScaling: true,
    description: 'You fling a mote of flame at a target you can see. Flammable objects it strikes begin to burn.',
  },
  rayOfFrost: {
    id: 'rayOfFrost', name: 'Ray of Frost', level: 0, school: 'Evocation', castingTime: 'action', range: 60, target: 'creature',
    attack: true, damage: '1d8', damageType: 'cold', cantripScaling: true, duration: 1,
    description: 'A pale beam of freezing air streaks toward one creature, numbing its limbs and slowing its next step.',
  },
  sacredFlame: {
    id: 'sacredFlame', name: 'Sacred Flame', level: 0, school: 'Evocation', castingTime: 'action', range: 60, target: 'creature',
    save: 'dex', damage: '1d8', damageType: 'radiant', cantripScaling: true,
    description: 'Light like a struck bell falls on the target. Cover offers no protection from it.',
  },
  poisonSpray: {
    id: 'poisonSpray', name: 'Poison Spray', level: 0, school: 'Conjuration', castingTime: 'action', range: 10, target: 'creature',
    save: 'con', damage: '1d12', damageType: 'poison', cantripScaling: true,
    description: 'A puff of noxious gas bursts from your hand at close range.',
  },
  viciousMockery: {
    id: 'viciousMockery', name: 'Vicious Mockery', level: 0, school: 'Enchantment', castingTime: 'action', range: 60, target: 'creature',
    save: 'wis', damage: '1d4', damageType: 'psychic', cantripScaling: true, duration: 1,
    description: 'You loose a string of insults laced with enchantment. The target flinches and its next swing goes wide.',
  },

  // --- 1st level ----------------------------------------------------------
  magicMissile: {
    id: 'magicMissile', name: 'Magic Missile', level: 1, school: 'Evocation', castingTime: 'action', range: 120, target: 'creature',
    damage: '3d4+3', damageType: 'force', upcastDamage: '1d4+1',
    description: 'Three darts of glowing force leap from your fingers. They never miss.',
  },
  burningHands: {
    id: 'burningHands', name: 'Burning Hands', level: 1, school: 'Evocation', castingTime: 'action', range: 15, target: 'area', areaRadius: 15,
    save: 'dex', halfOnSave: true, damage: '3d6', damageType: 'fire', upcastDamage: '1d6',
    description: 'A sheet of flame fans out from your spread fingers across everything in front of you.',
  },
  cureWounds: {
    id: 'cureWounds', name: 'Cure Wounds', level: 1, school: 'Evocation', castingTime: 'action', range: 5, target: 'creature',
    healing: '1d8', upcastHealing: '1d8',
    description: 'At your touch, a wound closes and strength returns. It does nothing for the undead or for constructs.',
  },
  healingWord: {
    id: 'healingWord', name: 'Healing Word', level: 1, school: 'Evocation', castingTime: 'bonusAction', range: 60, target: 'creature',
    healing: '1d4', upcastHealing: '1d4',
    description: 'A word of power carries across the fight and lifts a fallen ally back to their feet.',
  },
  shield: {
    id: 'shield', name: 'Shield', level: 1, school: 'Abjuration', castingTime: 'reaction', range: 0, target: 'self',
    acBonus: 5, duration: 1,
    description: 'An invisible barrier of force snaps into place, turning a blow that would have landed.',
  },
  guidingBolt: {
    id: 'guidingBolt', name: 'Guiding Bolt', level: 1, school: 'Evocation', castingTime: 'action', range: 120, target: 'creature',
    attack: true, damage: '4d6', damageType: 'radiant', upcastDamage: '1d6', duration: 1,
    description: 'A lance of light strikes the target and clings to it, marking the next attack for everyone.',
  },
  sleep: {
    id: 'sleep', name: 'Sleep', level: 1, school: 'Enchantment', castingTime: 'action', range: 90, target: 'area', areaRadius: 20,
    condition: 'unconscious', duration: 10, damage: '5d8', upcastDamage: '2d8',
    description: 'A slow enchantment rolls over a patch of ground; the weakest minds within it simply stop.',
  },
  thunderwave: {
    id: 'thunderwave', name: 'Thunderwave', level: 1, school: 'Evocation', castingTime: 'action', range: 15, target: 'area', areaRadius: 15,
    save: 'con', halfOnSave: true, damage: '2d8', damageType: 'thunder', upcastDamage: '1d8',
    description: 'A wave of concussive force bursts outward and shoves everything it touches away from you.',
  },
  bless: {
    id: 'bless', name: 'Bless', level: 1, school: 'Enchantment', castingTime: 'action', range: 30, target: 'creature',
    concentration: true, duration: 10,
    description: 'You call a blessing on your companions. Their strikes and their courage both come a little easier.',
  },
  faerieFire: {
    id: 'faerieFire', name: 'Faerie Fire', level: 1, school: 'Evocation', castingTime: 'action', range: 60, target: 'area', areaRadius: 20,
    save: 'dex', concentration: true, duration: 10,
    description: 'Pale outlines of light cling to everything in the area. Nothing caught in it can hide.',
  },
};

export const SPELL_IDS = Object.keys(SPELLS);
export const spellsOfLevel = (level: number) => SPELL_IDS.filter(id => SPELLS[id].level === level);

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** Full-caster slot progression (wizard, cleric, bard, druid, sorcerer). */
export const FULL_CASTER_SLOTS: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
/** Third-caster progression (Eldritch Knight, Arcane Trickster). */
export const THIRD_CASTER_SLOTS: number[][] = [
  [], [], [2], [3], [3], [3], [4, 2], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
];

export type CasterKind = 'none' | 'full' | 'third';

export interface SpellSlots { max: number[]; used: number[] }

export function slotsForLevel(kind: CasterKind, level: number): SpellSlots {
  const table = kind === 'full' ? FULL_CASTER_SLOTS : kind === 'third' ? THIRD_CASTER_SLOTS : [];
  const max = [...(table[Math.max(0, Math.min(19, level - 1))] ?? [])];
  return { max, used: max.map(() => 0) };
}
export const slotsRemaining = (slots: SpellSlots, level: number) => (slots.max[level - 1] ?? 0) - (slots.used[level - 1] ?? 0);
export function consumeSlot(slots: SpellSlots, level: number) {
  if (level <= 0) return true;             // cantrips are free
  if (slotsRemaining(slots, level) <= 0) return false;
  slots.used[level - 1]++;
  return true;
}
export function restoreAllSlots(slots: SpellSlots): SpellSlots { return { max: [...slots.max], used: slots.max.map(() => 0) }; }
/** The lowest slot that can cast the spell, or null when none is available. */
export function lowestAvailableSlot(slots: SpellSlots, spellLevel: number): number | null {
  if (spellLevel <= 0) return 0;
  for (let l = spellLevel; l <= slots.max.length; l++) if (slotsRemaining(slots, l) > 0) return l;
  return null;
}

// ---------------------------------------------------------------------------
// Casting statistics
// ---------------------------------------------------------------------------

export interface CasterProfile { ability: Ability; kind: CasterKind }

export function spellAttackBonus(actor: RulesActor, ability: Ability) {
  return abilityModifier(actor.abilities[ability]) + (actor.proficiencyBonus ?? proficiencyBonus(actor.level));
}
export function spellSaveDc(actor: RulesActor, ability: Ability) { return 8 + spellAttackBonus(actor, ability); }

/** Cantrips gain a damage die at levels 5, 11 and 17. */
export function cantripDice(level: number) { return level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1; }

function damageExpressionFor(spell: SpellDefinition, casterLevel: number, slotLevel: number) {
  if (!spell.damage) return null;
  const base = spell.damage;
  if (spell.cantripScaling) {
    const multiplier = cantripDice(casterLevel);
    const match = /^(\d+)d(\d+)$/.exec(base);
    if (match) return `${Number(match[1]) * multiplier}d${match[2]}`;
    return base;
  }
  if (spell.upcastDamage && slotLevel > spell.level) {
    const extra = slotLevel - spell.level;
    const baseMatch = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(base);
    const upMatch = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(spell.upcastDamage);
    if (baseMatch && upMatch && baseMatch[2] === upMatch[2]) {
      const count = Number(baseMatch[1]) + Number(upMatch[1]) * extra;
      const bonus = Number(baseMatch[3] ?? 0) + Number(upMatch[3] ?? 0) * extra;
      return `${count}d${baseMatch[2]}${bonus ? `+${bonus}` : ''}`;
    }
  }
  return base;
}

function healingExpressionFor(spell: SpellDefinition, slotLevel: number) {
  if (!spell.healing) return null;
  if (spell.upcastHealing && slotLevel > spell.level) {
    const extra = slotLevel - spell.level;
    const baseMatch = /^(\d+)d(\d+)$/.exec(spell.healing), upMatch = /^(\d+)d(\d+)$/.exec(spell.upcastHealing);
    if (baseMatch && upMatch && baseMatch[2] === upMatch[2]) return `${Number(baseMatch[1]) + Number(upMatch[1]) * extra}d${baseMatch[2]}`;
  }
  return spell.healing;
}

export interface SpellTargetState {
  id: string;
  armorClass: number;
  /** For saving throws. */
  actor: RulesActor;
  resistant?: boolean;
  vulnerable?: boolean;
  immune?: boolean;
  currentHp?: number;
}

export interface SpellEffect {
  targetId: string;
  attack?: CheckResult;
  save?: CheckResult;
  damage: number;
  damageType?: DamageType;
  healing: number;
  temporaryHp: number;
  condition?: Condition;
  critical: boolean;
  message: string;
}

export interface SpellCastResult {
  spell: SpellDefinition;
  casterId: string;
  slotLevel: number;
  effects: SpellEffect[];
  concentration: boolean;
  message: string;
  explanation: string[];
}

export interface CastOptions {
  caster: RulesActor;
  profile: CasterProfile;
  targets: SpellTargetState[];
  slotLevel?: number;
  stream: DiceStream;
  /** Cover only affects attack rolls and Dexterity saves, never Sacred Flame. */
  coverBonus?: number;
}

/**
 * Resolve one casting. Slot accounting is the caller's responsibility so that
 * the encounter can validate reach, line of sight and concentration first.
 */
export function castSpell(spellId: string, options: CastOptions): SpellCastResult {
  const spell = SPELLS[spellId];
  if (!spell) throw new Error(`Unknown spell: ${spellId}`);
  const { caster, profile, targets, stream } = options;
  const slotLevel = Math.max(spell.level, options.slotLevel ?? spell.level);
  const attackBonus = spellAttackBonus(caster, profile.ability);
  const dc = spellSaveDc(caster, profile.ability);
  const damageExpr = damageExpressionFor(spell, caster.level, slotLevel);
  const healExpr = healingExpressionFor(spell, slotLevel);
  const abilityMod = abilityModifier(caster.abilities[profile.ability]);
  const explanation: string[] = [`${spell.name}${slotLevel > spell.level ? ` at level ${slotLevel}` : ''}`];
  const effects: SpellEffect[] = [];

  for (const target of targets) {
    const effect: SpellEffect = { targetId: target.id, damage: 0, healing: 0, temporaryHp: 0, critical: false, damageType: spell.damageType, message: '' };

    if (spell.attack) {
      const attack = resolveCheck({
        kind: 'attack', actor: caster, ability: profile.ability,
        dc: target.armorClass + (options.coverBonus ?? 0),
        modifiers: [{ label: 'spell attack', value: attackBonus - abilityMod }],
        stream,
      });
      effect.attack = attack;
      effect.critical = attack.critical === 'hit';
      if (attack.success && damageExpr) {
        const roll = rollDice(damageExpr, stream, effect.critical);
        effect.damage = Math.max(0, roll.total);
        explanation.push(`${damageExpr}${effect.critical ? ' (critical, doubled dice)' : ''} → ${roll.dice.join('+')}${roll.bonus ? `+${roll.bonus}` : ''}`);
      }
      effect.message = attack.success
        ? `${spell.name} strikes ${target.id} for ${effect.damage} ${spell.damageType} damage${effect.critical ? ' — a critical hit' : ''}.`
        : `${spell.name} goes wide of ${target.id}.`;
    } else if (spell.save) {
      const save = resolveCheck({ kind: 'savingThrow', actor: target.actor, ability: spell.save, dc, stream });
      effect.save = save;
      if (damageExpr) {
        const roll = rollDice(damageExpr, stream);
        effect.damage = save.success && spell.halfOnSave ? Math.floor(roll.total / 2) : save.success ? 0 : roll.total;
        explanation.push(`${target.id} ${spell.save.toUpperCase()} save ${save.total} vs DC ${dc}`);
      }
      if (!save.success && spell.condition) effect.condition = spell.condition;
      effect.message = save.success
        ? `${target.id} resists ${spell.name}${effect.damage ? ` but still takes ${effect.damage}` : ''}.`
        : `${spell.name} catches ${target.id} for ${effect.damage} ${spell.damageType ?? ''} damage.`.replace('  ', ' ');
    } else if (healExpr) {
      const roll = rollDice(healExpr, stream);
      effect.healing = Math.max(1, roll.total + abilityMod);
      explanation.push(`${healExpr}+${abilityMod} → ${effect.healing}`);
      effect.message = `${spell.name} restores ${effect.healing} hit points to ${target.id}.`;
    } else if (damageExpr) {
      // Automatic-hit damage, such as Magic Missile.
      const roll = rollDice(damageExpr, stream);
      effect.damage = roll.total;
      explanation.push(`${damageExpr} → ${roll.total} (no attack roll)`);
      effect.message = `${spell.name} hits ${target.id} unerringly for ${effect.damage} ${spell.damageType} damage.`;
    } else {
      effect.condition = spell.condition;
      effect.message = `${spell.name} settles over ${target.id}.`;
    }

    // Resistance and vulnerability are applied by the encounter when the damage
    // lands, but the preview here keeps the log honest about the raw roll.
    effects.push(effect);
  }

  const message = effects.length
    ? effects.map(e => e.message).join(' ')
    : `${spell.name} takes hold.`;
  return { spell, casterId: caster.id, slotLevel, effects, concentration: !!spell.concentration, message, explanation };
}

/**
 * Concentration check after taking damage: a Constitution save against DC 10
 * or half the damage taken, whichever is higher.
 */
export function concentrationCheck(actor: RulesActor, damage: number, stream: DiceStream) {
  return resolveCheck({ kind: 'savingThrow', actor, ability: 'con', dc: Math.max(10, Math.floor(damage / 2)), stream });
}

/** Expected damage, used by enemy AI to choose between options. */
export function expectedSpellDamage(spell: SpellDefinition, casterLevel: number, slotLevel = spell.level) {
  const expr = damageExpressionFor(spell, casterLevel, slotLevel);
  return expr ? averageOf(expr) : 0;
}
