/**
 * Character data: species, class, background, ability generation and the
 * derived sheet the rules kernel consumes. Values follow the Player's
 * Handbook; every description is original prose written for Astra.
 */
import { ARMOR, WEAPONS, armorClassFor, type LoadoutSlots } from './equipment';
import { slotsForLevel, type CasterKind, type SpellSlots } from './spells';
import {
  abilityModifier, passiveScore, proficiencyBonus,
  type Ability, type Skill,
} from './rules';

export const CHARACTER_STORAGE_KEY = 'astra-character-v2';
export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
export const ABILITY_BLURB: Record<Ability, string> = {
  str: 'Carrying, climbing, shoving, and the weight behind a heavy blade.',
  dex: 'Aim, balance, stealth, initiative, and your armour class in light armour.',
  con: 'Hit points, holding concentration, and enduring poison and exhaustion.',
  int: 'Recall, investigation, arcane theory — and a wizard\u2019s spell save DC.',
  wis: 'Perception, insight, survival — and a cleric\u2019s or druid\u2019s magic.',
  cha: 'Persuasion, deception, presence — and a bard\u2019s or sorcerer\u2019s magic.',
};

export const SKILL_NAMES: Record<Skill, string> = {
  acrobatics: 'Acrobatics', animalHandling: 'Animal Handling', arcana: 'Arcana', athletics: 'Athletics',
  deception: 'Deception', history: 'History', insight: 'Insight', intimidation: 'Intimidation',
  investigation: 'Investigation', medicine: 'Medicine', nature: 'Nature', perception: 'Perception',
  performance: 'Performance', persuasion: 'Persuasion', religion: 'Religion', sleightOfHand: 'Sleight of Hand',
  stealth: 'Stealth', survival: 'Survival',
};

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

export type SpeciesId = 'human' | 'highElf' | 'woodElf' | 'hillDwarf' | 'mountainDwarf' | 'lightfootHalfling' | 'halfOrc' | 'tiefling';

export interface Species {
  id: SpeciesId; name: string; summary: string; details: string;
  abilityBonuses: Partial<Record<Ability, number>>;
  /** Humans distribute a floating +1 to every score. */
  allAbilities?: number;
  speed: number;
  size: 'small' | 'medium';
  darkvision: number;
  traits: { name: string; text: string }[];
  skills?: Skill[];
  languages: string[];
}

export const SPECIES: Record<SpeciesId, Species> = {
  human: {
    id: 'human', name: 'Human', summary: 'Adaptable, ambitious, everywhere.',
    details: 'Humans spread further and adapt faster than any other people on the Sword Coast. What they lack in long memory they make up for in appetite.',
    abilityBonuses: {}, allAbilities: 1, speed: 30, size: 'medium', darkvision: 0,
    traits: [{ name: 'Versatile', text: 'Every ability score increases by one.' }],
    languages: ['Common', 'One of your choice'],
  },
  highElf: {
    id: 'highElf', name: 'High elf', summary: 'Keen-eyed, long-lived, arcane by birth.',
    details: 'Raised among libraries and starlight, high elves carry a scrap of wizardry from childhood and an eye that misses very little.',
    abilityBonuses: { dex: 2, int: 1 }, speed: 30, size: 'medium', darkvision: 60,
    traits: [
      { name: 'Darkvision', text: 'You see in dim light within sixty feet as though it were bright light.' },
      { name: 'Fey Ancestry', text: 'Advantage on saves against being charmed, and magic cannot put you to sleep.' },
      { name: 'Trance', text: 'Four hours of meditation gives you the benefit of eight hours of sleep.' },
      { name: 'Cantrip', text: 'You know one wizard cantrip; Intelligence is your spellcasting ability for it.' },
    ],
    skills: ['perception'], languages: ['Common', 'Elvish', 'One of your choice'],
  },
  woodElf: {
    id: 'woodElf', name: 'Wood elf', summary: 'Silent in the trees, quick on the trail.',
    details: 'Wood elves keep to the deep forest and move through it without leaving a bent stem. They are patient, watchful, and very hard to follow.',
    abilityBonuses: { dex: 2, wis: 1 }, speed: 35, size: 'medium', darkvision: 60,
    traits: [
      { name: 'Darkvision', text: 'You see in dim light within sixty feet as though it were bright light.' },
      { name: 'Fey Ancestry', text: 'Advantage on saves against being charmed, and magic cannot put you to sleep.' },
      { name: 'Mask of the Wild', text: 'You can attempt to hide even when only lightly obscured by foliage, rain, or mist.' },
    ],
    skills: ['perception'], languages: ['Common', 'Elvish'],
  },
  hillDwarf: {
    id: 'hillDwarf', name: 'Hill dwarf', summary: 'Stubborn, hardy, hard to put down.',
    details: 'Hill dwarves carry the long memory of their clans and a constitution that shrugs off what would flatten anyone else.',
    abilityBonuses: { con: 2, wis: 1 }, speed: 25, size: 'medium', darkvision: 60,
    traits: [
      { name: 'Darkvision', text: 'You see in dim light within sixty feet as though it were bright light.' },
      { name: 'Dwarven Resilience', text: 'Advantage on saves against poison, and resistance to poison damage.' },
      { name: 'Dwarven Toughness', text: 'Your hit point maximum increases by one at every level.' },
      { name: 'Stonecunning', text: 'You add double your proficiency bonus to History checks about stonework.' },
    ],
    languages: ['Common', 'Dwarvish'],
  },
  mountainDwarf: {
    id: 'mountainDwarf', name: 'Mountain dwarf', summary: 'Broad-shouldered and armoured from birth.',
    details: 'Raised on high, cold stone, mountain dwarves are trained in armour before they are trained in letters.',
    abilityBonuses: { str: 2, con: 2 }, speed: 25, size: 'medium', darkvision: 60,
    traits: [
      { name: 'Darkvision', text: 'You see in dim light within sixty feet as though it were bright light.' },
      { name: 'Dwarven Resilience', text: 'Advantage on saves against poison, and resistance to poison damage.' },
      { name: 'Dwarven Armour Training', text: 'You are proficient with light and medium armour.' },
    ],
    languages: ['Common', 'Dwarvish'],
  },
  lightfootHalfling: {
    id: 'lightfootHalfling', name: 'Lightfoot halfling', summary: 'Small, lucky, and impossible to corner.',
    details: 'Halflings survive by being somewhere else when the trouble arrives, and by an unreasonable amount of luck when they are not.',
    abilityBonuses: { dex: 2, cha: 1 }, speed: 25, size: 'small', darkvision: 0,
    traits: [
      { name: 'Lucky', text: 'When you roll a natural one on an attack, ability check, or save, you may reroll it once.' },
      { name: 'Brave', text: 'Advantage on saves against being frightened.' },
      { name: 'Naturally Stealthy', text: 'You can hide behind a creature at least one size larger than you.' },
    ],
    languages: ['Common', 'Halfling'],
  },
  halfOrc: {
    id: 'halfOrc', name: 'Half-orc', summary: 'Strong, loud, and very hard to finish.',
    details: 'Half-orcs feel everything at full volume, and a blow that would drop anyone else only makes them angrier.',
    abilityBonuses: { str: 2, con: 1 }, speed: 30, size: 'medium', darkvision: 60,
    traits: [
      { name: 'Darkvision', text: 'You see in dim light within sixty feet as though it were bright light.' },
      { name: 'Relentless Endurance', text: 'When reduced to zero hit points, you may drop to one instead. Once per long rest.' },
      { name: 'Savage Attacks', text: 'On a critical hit with a melee weapon, roll one of its damage dice an extra time.' },
    ],
    skills: ['intimidation'], languages: ['Common', 'Orc'],
  },
  tiefling: {
    id: 'tiefling', name: 'Tiefling', summary: 'Infernal blood and a long memory of it.',
    details: 'A bargain struck generations ago still shows in the horns, the eyes, and the way a room quiets when you enter it.',
    abilityBonuses: { cha: 2, int: 1 }, speed: 30, size: 'medium', darkvision: 60,
    traits: [
      { name: 'Darkvision', text: 'You see in dim light within sixty feet as though it were bright light.' },
      { name: 'Hellish Resistance', text: 'You have resistance to fire damage.' },
      { name: 'Infernal Legacy', text: 'You know the Thaumaturgy cantrip; Charisma is your spellcasting ability.' },
    ],
    languages: ['Common', 'Infernal'],
  },
};

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export type ClassId = 'fighter' | 'wizard' | 'rogue' | 'cleric' | 'ranger';

export interface CharacterClass {
  id: ClassId; name: string; summary: string; details: string;
  hitDie: number;
  primary: Ability[];
  savingThrows: Ability[];
  skillChoices: Skill[];
  skillCount: number;
  armorProficiencies: string[];
  weaponProficiencies: string[];
  casterKind: CasterKind;
  spellcasting?: Ability;
  /** Cantrips and prepared/known spells at level one. */
  cantrips?: string[];
  levelOneSpells?: string[];
  startingLoadout: LoadoutSlots;
  startingWeapons: string[];
  features: { level: number; name: string; text: string }[];
}

export const CLASSES: Record<ClassId, CharacterClass> = {
  fighter: {
    id: 'fighter', name: 'Fighter', summary: 'The one still standing when the line breaks.',
    details: 'Fighters are the most versatile martial class in the game: any armour, any weapon, and more attacks than anyone else by the time it matters.',
    hitDie: 10, primary: ['str', 'dex'], savingThrows: ['str', 'con'],
    skillChoices: ['acrobatics', 'animalHandling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'], skillCount: 2,
    armorProficiencies: ['light', 'medium', 'heavy', 'shield'], weaponProficiencies: ['simple', 'martial'],
    casterKind: 'none',
    startingLoadout: { armor: 'chainMail', mainHand: 'longsword', shield: true },
    startingWeapons: ['longsword', 'handaxe', 'lightCrossbow'],
    features: [
      { level: 1, name: 'Fighting Style: Defence', text: 'While you wear armour you gain a +1 bonus to your armour class.' },
      { level: 1, name: 'Second Wind', text: 'As a bonus action, once per rest, regain 1d10 + your level hit points.' },
      { level: 2, name: 'Action Surge', text: 'Once per rest, take one additional action on your turn.' },
      { level: 5, name: 'Extra Attack', text: 'You attack twice whenever you take the Attack action.' },
    ],
  },
  wizard: {
    id: 'wizard', name: 'Wizard', summary: 'Fragile, and the most dangerous person present.',
    details: 'A wizard solves problems steel cannot. The cost is a d6 hit die and a spellbook that must be prepared before it is useful.',
    hitDie: 6, primary: ['int'], savingThrows: ['int', 'wis'],
    skillChoices: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'], skillCount: 2,
    armorProficiencies: [], weaponProficiencies: ['dagger', 'quarterstaff', 'lightCrossbow'],
    casterKind: 'full', spellcasting: 'int',
    cantrips: ['fireBolt', 'rayOfFrost', 'poisonSpray'],
    levelOneSpells: ['magicMissile', 'burningHands', 'shield', 'sleep', 'thunderwave'],
    startingLoadout: { mainHand: 'quarterstaff' },
    startingWeapons: ['quarterstaff', 'dagger'],
    features: [
      { level: 1, name: 'Spellcasting', text: 'Intelligence is your spellcasting ability. You prepare spells from your book after each long rest.' },
      { level: 1, name: 'Arcane Recovery', text: 'Once per day after a short rest, recover expended spell slots totalling half your level, rounded up.' },
      { level: 2, name: 'Arcane Tradition', text: 'You choose a school of magic to specialise in.' },
    ],
  },
  rogue: {
    id: 'rogue', name: 'Rogue', summary: 'One good hit, from somewhere you were not looking.',
    details: 'Rogues do not win by trading blows. They win by choosing the moment, and by being very good at everything that is not fighting.',
    hitDie: 8, primary: ['dex'], savingThrows: ['dex', 'int'],
    skillChoices: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleightOfHand', 'stealth'], skillCount: 4,
    armorProficiencies: ['light'], weaponProficiencies: ['simple', 'shortsword', 'rapier', 'longbow'],
    casterKind: 'none',
    startingLoadout: { armor: 'leather', mainHand: 'shortsword', offHand: 'dagger' },
    startingWeapons: ['shortsword', 'dagger', 'shortbow'],
    features: [
      { level: 1, name: 'Sneak Attack', text: 'Once per turn, add 1d6 damage to a finesse or ranged hit when you have advantage or an ally is beside the target.' },
      { level: 1, name: 'Expertise', text: 'Double your proficiency bonus for two chosen skills.' },
      { level: 2, name: 'Cunning Action', text: 'Dash, Disengage, or Hide as a bonus action on every turn.' },
    ],
  },
  cleric: {
    id: 'cleric', name: 'Cleric', summary: 'A weapon and a mercy, in the same hand.',
    details: 'Clerics keep a party alive and can hold a shield wall while doing it. Their magic answers to Wisdom and to something older.',
    hitDie: 8, primary: ['wis'], savingThrows: ['wis', 'cha'],
    skillChoices: ['history', 'insight', 'medicine', 'persuasion', 'religion'], skillCount: 2,
    armorProficiencies: ['light', 'medium', 'shield'], weaponProficiencies: ['simple'],
    casterKind: 'full', spellcasting: 'wis',
    cantrips: ['sacredFlame'],
    levelOneSpells: ['cureWounds', 'healingWord', 'guidingBolt', 'bless'],
    startingLoadout: { armor: 'scaleMail', mainHand: 'mace', shield: true },
    startingWeapons: ['mace', 'lightCrossbow'],
    features: [
      { level: 1, name: 'Spellcasting', text: 'Wisdom is your spellcasting ability. You prepare spells from the full cleric list after each long rest.' },
      { level: 1, name: 'Divine Domain', text: 'Your calling grants extra spells and a domain feature.' },
      { level: 2, name: 'Channel Divinity', text: 'Turn undead, or invoke your domain\u2019s power, once per rest.' },
    ],
  },
  ranger: {
    id: 'ranger', name: 'Ranger', summary: 'The trail, the bow, and the thing at the end of it.',
    details: 'Rangers read ground the way other people read a page. They fight at range, travel further, and know what left the tracks.',
    hitDie: 10, primary: ['dex', 'wis'], savingThrows: ['str', 'dex'],
    skillChoices: ['animalHandling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'], skillCount: 3,
    armorProficiencies: ['light', 'medium', 'shield'], weaponProficiencies: ['simple', 'martial'],
    casterKind: 'none',
    startingLoadout: { armor: 'leather', mainHand: 'shortsword', ranged: 'longbow' },
    startingWeapons: ['shortsword', 'longbow', 'dagger'],
    features: [
      { level: 1, name: 'Favoured Enemy', text: 'Advantage on Survival checks to track your chosen quarry, and on Intelligence checks to recall lore about it.' },
      { level: 1, name: 'Natural Explorer', text: 'Difficult terrain does not slow your group in your chosen landscape, and you are never lost there.' },
      { level: 2, name: 'Fighting Style: Archery', text: 'You gain a +2 bonus to attack rolls with ranged weapons.' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

export type BackgroundId = 'soldier' | 'sage' | 'criminal' | 'folkHero' | 'acolyte' | 'outlander';

export interface Background {
  id: BackgroundId; name: string; summary: string; details: string;
  skills: Skill[]; tools: string[]; languages: number;
  feature: { name: string; text: string };
  equipment: string[];
  /** Copper pieces of starting coin. */
  coin: number;
}

export const BACKGROUNDS: Record<BackgroundId, Background> = {
  soldier: {
    id: 'soldier', name: 'Soldier', summary: 'You served, and you remember the orders.',
    details: 'You marched under a banner, learned to read a treeline, and kept the habits of a watchful camp long after the war ended.',
    skills: ['athletics', 'intimidation'], tools: ['Dice set', 'Land vehicles'], languages: 0,
    feature: { name: 'Military Rank', text: 'Soldiers loyal to your old company still recognise your authority and will offer shelter and simple aid.' },
    equipment: ['An insignia of rank', 'A trophy from a fallen enemy', 'A set of bone dice', 'Traveller\u2019s clothes'], coin: 1000,
  },
  sage: {
    id: 'sage', name: 'Sage', summary: 'You live for the answer nobody else looked for.',
    details: 'Years among old books taught you where to look, what to question, and when a story is hiding something true.',
    skills: ['arcana', 'history'], tools: [], languages: 2,
    feature: { name: 'Researcher', text: 'When you do not know something, you usually know who does and where their books are kept.' },
    equipment: ['A bottle of black ink', 'A quill', 'A small knife', 'A letter from a dead colleague posing a question you cannot yet answer'], coin: 1000,
  },
  criminal: {
    id: 'criminal', name: 'Criminal', summary: 'You know which doors are only pretending to be locked.',
    details: 'You made a living outside the law and you were good enough at it to still be walking around.',
    skills: ['deception', 'stealth'], tools: ['Thieves\u2019 tools', 'One gaming set'], languages: 0,
    feature: { name: 'Criminal Contact', text: 'You know a fence who can move messages and merchandise across the region.' },
    equipment: ['A crowbar', 'Dark common clothes with a hood', 'Thieves\u2019 tools'], coin: 1500,
  },
  folkHero: {
    id: 'folkHero', name: 'Folk hero', summary: 'One village will never let you buy your own drink.',
    details: 'You stood up when nobody else would, and the story of it travelled further and larger than you did.',
    skills: ['animalHandling', 'survival'], tools: ['One artisan\u2019s tools', 'Land vehicles'], languages: 0,
    feature: { name: 'Rustic Hospitality', text: 'Common folk will hide you, feed you, and lie to anyone who comes asking.' },
    equipment: ['A set of artisan\u2019s tools', 'A shovel', 'An iron pot', 'Common clothes'], coin: 1000,
  },
  acolyte: {
    id: 'acolyte', name: 'Acolyte', summary: 'You kept the rites long before you kept a sword.',
    details: 'You spent your formative years in a temple, learning the words, the silences, and who actually pays for the candles.',
    skills: ['insight', 'religion'], tools: [], languages: 2,
    feature: { name: 'Shelter of the Faithful', text: 'Temples of your faith will house and heal you, and will vouch for you to strangers.' },
    equipment: ['A holy symbol', 'A prayer book', 'Five sticks of incense', 'Vestments'], coin: 1500,
  },
  outlander: {
    id: 'outlander', name: 'Outlander', summary: 'You were raised where there were no roads.',
    details: 'You grew up beyond the last farm, and the wilderness is not a hazard to you. It is the part of the world that makes sense.',
    skills: ['athletics', 'survival'], tools: ['One musical instrument'], languages: 1,
    feature: { name: 'Wanderer', text: 'You remember the shape of any land you have crossed and can find food and water for six people each day.' },
    equipment: ['A staff', 'A hunting trap', 'A trophy from an animal you killed', 'Traveller\u2019s clothes'], coin: 1000,
  },
};

export const PERSONALITIES = [
  { id: 'watchful', name: 'Watchful', text: 'You notice the small things before they become large ones.' },
  { id: 'kind', name: 'Kind-hearted', text: 'You would rather make a friend than win an argument.' },
  { id: 'restless', name: 'Restless', text: 'Still water has never held your attention for long.' },
  { id: 'blunt', name: 'Blunt', text: 'You say the true thing first and apologise for it later, if at all.' },
  { id: 'wry', name: 'Wry', text: 'You have never met a solemn moment you could not undercut.' },
] as const;
export const PRONOUNS = ['They / them', 'She / her', 'He / him'] as const;

// ---------------------------------------------------------------------------
// Ability generation
// ---------------------------------------------------------------------------

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
/** Point-buy cost table from the PHB variant rule. */
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;

export function pointBuyCost(scores: Record<Ability, number>) {
  return ABILITIES.reduce((sum, a) => sum + (POINT_BUY_COST[scores[a]] ?? Infinity), 0);
}
export function pointBuyValid(scores: Record<Ability, number>) {
  return ABILITIES.every(a => scores[a] >= 8 && scores[a] <= 15) && pointBuyCost(scores) <= POINT_BUY_BUDGET;
}

/** Species bonuses applied on top of the chosen base scores. */
export function applySpeciesBonuses(base: Record<Ability, number>, speciesId: SpeciesId): Record<Ability, number> {
  const species = SPECIES[speciesId];
  const out = { ...base };
  for (const a of ABILITIES) {
    out[a] = base[a] + (species.abilityBonuses[a] ?? 0) + (species.allAbilities ?? 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Draft and sheet
// ---------------------------------------------------------------------------

export type AbilityMethod = 'standardArray' | 'pointBuy';

export interface CharacterDraft {
  version: 2;
  name: string;
  pronouns: string;
  species: SpeciesId;
  classId: ClassId;
  background: BackgroundId;
  personality: string;
  method: AbilityMethod;
  /** Base scores before species bonuses. */
  abilities: Record<Ability, number>;
  skillChoices: Skill[];
  /** Cantrips and level-one spells chosen for a caster. */
  cantripChoices: string[];
  spellChoices: string[];
}

export interface CharacterSheet extends CharacterDraft {
  id: string;
  xp: number;
  level: number;
  /** After species bonuses. */
  finalAbilities: Record<Ability, number>;
  speed: number;
  size: 'small' | 'medium';
  darkvision: number;
  maxHp: number;
  currentHp: number;
  hitDice: { size: number; total: number; remaining: number };
  armorClass: number;
  initiative: number;
  passivePerception: number;
  passiveInvestigation: number;
  passiveInsight: number;
  proficiencyBonus: number;
  savingThrows: Ability[];
  skillProficiencies: Skill[];
  traits: { name: string; text: string }[];
  features: { level: number; name: string; text: string }[];
  backgroundFeature: { name: string; text: string };
  equipment: string[];
  loadout: LoadoutSlots;
  weapons: string[];
  attacksPerAction: number;
  spellcasting?: Ability;
  casterKind: CasterKind;
  spellsKnown: string[];
  slots: SpellSlots;
  languages: string[];
  tools: string[];
  /** Copper pieces. */
  coin: number;
}

export function defaultDraft(): CharacterDraft {
  const draft: CharacterDraft = {
    version: 2, name: '', pronouns: PRONOUNS[0], species: 'human', classId: 'fighter', background: 'soldier',
    personality: 'watchful', method: 'standardArray',
    abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    skillChoices: [], cantripChoices: [], spellChoices: [],
  };
  // Seed the choice lists from the class itself, so the default draft is always
  // internally valid no matter how the class or background tables change.
  return withDefaultChoices(draft);
}

/**
 * Fills any unmade choices with the first legal options. Used for the default
 * draft and whenever the player switches class or background and their old
 * picks stop being offered.
 */
export function withDefaultChoices(draft: CharacterDraft): CharacterDraft {
  const skillPool = availableSkillChoices(draft);
  const skills = draft.skillChoices.filter(s => skillPool.includes(s));
  for (const skill of skillPool) {
    if (skills.length >= requiredSkillCount(draft)) break;
    if (!skills.includes(skill)) skills.push(skill);
  }
  const next = { ...draft, skillChoices: skills.slice(0, requiredSkillCount(draft)) };

  const cantripPool = availableCantrips(next);
  const cantrips = next.cantripChoices.filter(c => cantripPool.includes(c));
  for (const id of cantripPool) {
    if (cantrips.length >= requiredCantripCount(next)) break;
    if (!cantrips.includes(id)) cantrips.push(id);
  }
  next.cantripChoices = cantrips.slice(0, requiredCantripCount(next));

  const spellPool = availableSpells(next);
  const spells = next.spellChoices.filter(c => spellPool.includes(c));
  for (const id of spellPool) {
    if (spells.length >= requiredSpellCount(next)) break;
    if (!spells.includes(id)) spells.push(id);
  }
  next.spellChoices = spells.slice(0, requiredSpellCount(next));
  return next;
}

/** Skills the class offers, minus the ones the background already grants. */
export function availableSkillChoices(draft: CharacterDraft): Skill[] {
  const granted = new Set<Skill>([...(BACKGROUNDS[draft.background]?.skills ?? []), ...(SPECIES[draft.species]?.skills ?? [])]);
  return (CLASSES[draft.classId]?.skillChoices ?? []).filter(s => !granted.has(s));
}
export function requiredSkillCount(draft: CharacterDraft) { return CLASSES[draft.classId]?.skillCount ?? 0; }

export function availableCantrips(draft: CharacterDraft) { return CLASSES[draft.classId]?.cantrips ?? []; }
export function availableSpells(draft: CharacterDraft) { return CLASSES[draft.classId]?.levelOneSpells ?? []; }
/** Wizards prepare Intelligence modifier + level spells; clerics likewise with Wisdom. */
export function requiredSpellCount(draft: CharacterDraft) {
  const klass = CLASSES[draft.classId];
  if (!klass.spellcasting) return 0;
  const final = applySpeciesBonuses(draft.abilities, draft.species);
  return Math.max(1, Math.min(availableSpells(draft).length, abilityModifier(final[klass.spellcasting]) + 1));
}
export function requiredCantripCount(draft: CharacterDraft) {
  const klass = CLASSES[draft.classId];
  if (!klass.spellcasting) return 0;
  return klass.id === 'wizard' ? 3 : Math.min(2, availableCantrips(draft).length);
}

export function validateDraft(draft: CharacterDraft): string[] {
  const errors: string[] = [];
  const name = (draft.name ?? '').trim();
  if (!name || name.length > 32) errors.push('Choose a name between 1 and 32 characters.');
  if (!SPECIES[draft.species]) errors.push('Choose a valid species.');
  if (!CLASSES[draft.classId]) errors.push('Choose a valid class.');
  if (!BACKGROUNDS[draft.background]) errors.push('Choose a valid background.');
  if (!PRONOUNS.includes(draft.pronouns as typeof PRONOUNS[number])) errors.push('Choose valid pronouns.');
  if (!PERSONALITIES.some(p => p.id === draft.personality)) errors.push('Choose a personality.');
  if (!SPECIES[draft.species] || !CLASSES[draft.classId] || !BACKGROUNDS[draft.background]) return errors;

  const numbers = ABILITIES.map(a => draft.abilities[a]);
  if (numbers.some(n => !Number.isInteger(n) || n < 3 || n > 20)) errors.push('Ability scores must be whole numbers from 3 to 20.');
  else if (draft.method === 'pointBuy' && !pointBuyValid(draft.abilities)) {
    errors.push(`Point buy allows scores from 8 to 15 within ${POINT_BUY_BUDGET} points; this spread costs ${pointBuyCost(draft.abilities)}.`);
  } else if (draft.method === 'standardArray') {
    const sorted = [...numbers].sort((a, b) => b - a).join(',');
    if (sorted !== STANDARD_ARRAY.join(',')) errors.push('The standard array must use 15, 14, 13, 12, 10 and 8 exactly once each.');
  }

  const allowed = new Set<Skill>(availableSkillChoices(draft));
  if (draft.skillChoices.some(s => !allowed.has(s))) errors.push('A selected skill is not granted by this class.');
  if (new Set(draft.skillChoices).size !== draft.skillChoices.length) errors.push('A skill cannot be selected twice.');
  if (draft.skillChoices.length !== requiredSkillCount(draft)) errors.push(`Choose exactly ${requiredSkillCount(draft)} skills.`);

  const cantripsWanted = requiredCantripCount(draft);
  if (cantripsWanted) {
    const pool = new Set(availableCantrips(draft));
    if (draft.cantripChoices.some(c => !pool.has(c))) errors.push('A selected cantrip is not on this class list.');
    if (draft.cantripChoices.length !== cantripsWanted) errors.push(`Choose exactly ${cantripsWanted} cantrips.`);
  }
  const spellsWanted = requiredSpellCount(draft);
  if (spellsWanted) {
    const pool = new Set(availableSpells(draft));
    if (draft.spellChoices.some(s => !pool.has(s))) errors.push('A selected spell is not on this class list.');
    if (draft.spellChoices.length !== spellsWanted) errors.push(`Prepare exactly ${spellsWanted} first-level spells.`);
  }
  return errors;
}

export function finalizeCharacter(draft: CharacterDraft): CharacterSheet {
  const errors = validateDraft(draft);
  if (errors.length) throw new Error(errors.join(' '));
  const species = SPECIES[draft.species], klass = CLASSES[draft.classId], background = BACKGROUNDS[draft.background];
  const finalAbilities = applySpeciesBonuses(draft.abilities, draft.species);
  const level = 1, prof = proficiencyBonus(level);
  const con = abilityModifier(finalAbilities.con), dex = abilityModifier(finalAbilities.dex);

  const skillProficiencies = [...new Set<Skill>([...background.skills, ...(species.skills ?? []), ...draft.skillChoices])];

  // Only wear what the class is trained in; an untrained wizard in chain mail
  // would be a bug, not a build.
  const loadout: LoadoutSlots = { ...klass.startingLoadout };
  if (loadout.armor) {
    const armor = ARMOR[loadout.armor];
    const trained = klass.armorProficiencies.includes(armor.category)
      || (draft.species === 'mountainDwarf' && (armor.category === 'light' || armor.category === 'medium'));
    if (!trained) delete loadout.armor;
    else if (armor.strengthRequirement && finalAbilities.str < armor.strengthRequirement) delete loadout.armor;
  }
  if (loadout.shield && !klass.armorProficiencies.includes('shield')) loadout.shield = false;

  const defenceStyle = klass.id === 'fighter' && loadout.armor ? 1 : 0;
  const armorClass = armorClassFor({ dex, loadout }) + defenceStyle;

  const maxHp = klass.hitDie + con + (draft.species === 'hillDwarf' ? 1 : 0);
  const actorForPassives = {
    id: 'draft', level, abilities: finalAbilities, proficiencyBonus: prof,
    skills: Object.fromEntries(skillProficiencies.map(s => [s, { proficient: true }])),
  };

  const spellsKnown = klass.spellcasting ? [...draft.cantripChoices, ...draft.spellChoices] : [];
  const languages = [...new Set([...species.languages])];

  return {
    ...draft,
    name: draft.name.trim(),
    id: `${draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'traveller'}-${Date.now().toString(36)}`,
    xp: 0, level,
    finalAbilities,
    speed: species.speed, size: species.size, darkvision: species.darkvision,
    maxHp, currentHp: maxHp,
    hitDice: { size: klass.hitDie, total: level, remaining: level },
    armorClass,
    initiative: dex,
    passivePerception: passiveScore(actorForPassives, 'perception'),
    passiveInvestigation: passiveScore(actorForPassives, 'investigation'),
    passiveInsight: passiveScore(actorForPassives, 'insight'),
    proficiencyBonus: prof,
    savingThrows: klass.savingThrows,
    skillProficiencies,
    traits: species.traits,
    features: klass.features.filter(f => f.level <= level),
    backgroundFeature: background.feature,
    equipment: [...background.equipment, ...klass.startingWeapons.map(w => WEAPONS[w]?.name ?? w), ...(loadout.armor ? [ARMOR[loadout.armor].name] : []), ...(loadout.shield ? ['Shield'] : [])],
    loadout,
    weapons: klass.startingWeapons,
    attacksPerAction: 1,
    spellcasting: klass.spellcasting,
    casterKind: klass.casterKind,
    spellsKnown,
    slots: slotsForLevel(klass.casterKind, level),
    languages,
    tools: background.tools,
    coin: background.coin,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadCharacter(storage?: Storage): CharacterSheet | null {
  try {
    const store = storage ?? window.localStorage;
    const raw = store.getItem(CHARACTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CharacterSheet;
    if (!parsed || parsed.version !== 2) return null;
    // A stored sheet must still satisfy the current rules; a stale or hand-edited
    // save is discarded rather than fed to the encounter engine.
    if (validateDraft(parsed).length) return null;
    if (!Number.isFinite(parsed.maxHp) || parsed.maxHp <= 0) return null;
    parsed.currentHp = Math.max(0, Math.min(parsed.maxHp, parsed.currentHp ?? parsed.maxHp));
    if (!parsed.slots || !Array.isArray(parsed.slots.max)) parsed.slots = slotsForLevel(parsed.casterKind ?? 'none', parsed.level ?? 1);
    return parsed;
  } catch { return null; }
}

export function saveCharacter(sheet: CharacterSheet, storage?: Storage) {
  try {
    const store = storage ?? window.localStorage;
    store.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(sheet));
    return true;
  } catch { return false; }
}

/** Ability modifier for display, e.g. "+3" / "−1". */
export const formatModifier = (value: number) => `${value >= 0 ? '+' : '\u2212'}${Math.abs(value)}`;
export const modifierOf = (sheet: CharacterSheet, ability: Ability) => abilityModifier(sheet.finalAbilities[ability]);

/** Gold/silver/copper display from an exact copper amount. */
export function formatCoin(copper: number) {
  const gp = Math.floor(copper / 100), sp = Math.floor((copper % 100) / 10), cp = copper % 10;
  return [gp && `${gp} gp`, sp && `${sp} sp`, cp && `${cp} cp`].filter(Boolean).join(' ') || '0 gp';
}
