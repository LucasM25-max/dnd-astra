import { abilityModifier, proficiencyBonus, type Ability, type Skill } from './rules';

export const CHARACTER_STORAGE_KEY = 'astra-character-v1';
export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
export const SKILL_NAMES: Partial<Record<Skill, string>> = { athletics: 'Athletics', acrobatics: 'Acrobatics', arcana: 'Arcana', history: 'History', perception: 'Perception', survival: 'Survival', persuasion: 'Persuasion', stealth: 'Stealth' };
export type SpeciesId = 'human' | 'elf';
export type ClassId = 'fighter' | 'wizard';
export type BackgroundId = 'soldier' | 'sage';
export interface CharacterOption { id: string; name: string; summary: string; details: string }
export const SPECIES: Record<SpeciesId, CharacterOption & { speed: number; traits: string[] }> = {
  human: { id: 'human', name: 'Human', summary: 'Adaptable and determined.', details: 'A versatile traveller with an extra skill and a broad knack for survival.', speed: 30, traits: ['Versatile', 'Extra skill proficiency'] },
  elf: { id: 'elf', name: 'High elf', summary: 'Keen-eyed and arcane-minded.', details: 'Darkvision, an ancient connection to magic, and an uncanny eye for detail.', speed: 30, traits: ['Darkvision', 'Keen senses', 'Minor magic'] },
};
export const CLASSES: Record<ClassId, CharacterOption & { hitDie: number; primary: Ability; savingThrows: Ability[]; features: string[] }> = {
  fighter: { id: 'fighter', name: 'Fighter', summary: 'A resilient master of arms.', details: 'Reliable in a fight, comfortable with every common weapon, and built to hold the line.', hitDie: 10, primary: 'str', savingThrows: ['str', 'con'], features: ['Second Wind', 'Fighting style', 'Martial weapons'] },
  wizard: { id: 'wizard', name: 'Wizard', summary: 'A scholar who shapes the arcane.', details: 'Fragile but versatile, with a spellbook full of solutions for problems steel cannot solve.', hitDie: 6, primary: 'int', savingThrows: ['int', 'wis'], features: ['Spellbook', 'Arcane recovery', 'Cantrips'] },
};
export const BACKGROUNDS: Record<BackgroundId, CharacterOption & { skills: Skill[]; equipment: string[] }> = {
  soldier: { id: 'soldier', name: 'Soldier', summary: 'You know discipline and the road.', details: 'You served under a banner, learned to read danger, and carry the habits of a watchful camp.', skills: ['athletics', 'intimidation'], equipment: ['Traveler’s clothes', 'A keepsake insignia', 'A bedroll'] },
  sage: { id: 'sage', name: 'Sage', summary: 'You live for forgotten answers.', details: 'Years among old books taught you where to look, what to question, and when a story is hiding a truth.', skills: ['arcana', 'history'], equipment: ['A notebook', 'Ink and quill', 'A small reference book'] },
};
export const PERSONALITIES = [
  { id: 'watchful', name: 'Watchful', text: 'You notice the small things before they become large ones.' },
  { id: 'kind', name: 'Kind-hearted', text: 'You would rather make a friend than win an argument.' },
  { id: 'restless', name: 'Restless', text: 'Still water has never held your attention for long.' },
] as const;
export const PRONOUNS = ['They / them', 'She / her', 'He / him'] as const;
export interface CharacterDraft {
  version: 1; name: string; pronouns: string; species: SpeciesId; classId: ClassId; background: BackgroundId; personality: string; abilities: Record<Ability, number>; skillChoices: Skill[];
}
export interface CharacterSheet extends CharacterDraft {
  id: string; xp: number; level: number; speed: number; maxHp: number; armorClass: number; initiative: number; passivePerception: number; proficiencyBonus: number; savingThrows: Ability[]; skillProficiencies: Skill[]; traits: string[]; features: string[]; equipment: string[];
}
export function defaultDraft(): CharacterDraft { return { version: 1, name: '', pronouns: PRONOUNS[0], species: 'human', classId: 'fighter', background: 'soldier', personality: 'watchful', abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, skillChoices: ['perception'] }; }
export function availableSkillChoices(draft: CharacterDraft): Skill[] {
  return [...new Set([...(BACKGROUNDS[draft.background]?.skills ?? []), 'perception' as Skill, ...(draft.species === 'human' ? ['survival' as Skill] : [])])];
}
export function validateDraft(draft: CharacterDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim() || draft.name.trim().length > 32) errors.push('Choose a name between 1 and 32 characters.');
  if (!SPECIES[draft.species]) errors.push('Choose a valid species.');
  if (!CLASSES[draft.classId]) errors.push('Choose a valid class.');
  if (!BACKGROUNDS[draft.background]) errors.push('Choose a valid background.');
  if (!PRONOUNS.includes(draft.pronouns as typeof PRONOUNS[number])) errors.push('Choose valid pronouns.');
  const numbers = ABILITIES.map(a => draft.abilities[a]);
  if (numbers.some(n => !Number.isInteger(n) || n < 3 || n > 20)) errors.push('Ability scores must be whole numbers from 3 to 20.');
  const allowed = new Set<Skill>(availableSkillChoices(draft));
  if (draft.skillChoices.some(s => !allowed.has(s))) errors.push('A selected skill is not granted by this character.');
  if (new Set(draft.skillChoices).size !== draft.skillChoices.length) errors.push('A skill cannot be selected twice.');
  return errors;
}
export function finalizeCharacter(draft: CharacterDraft): CharacterSheet {
  const errors = validateDraft(draft); if (errors.length) throw new Error(errors.join(' '));
  const species = SPECIES[draft.species], klass = CLASSES[draft.classId], background = BACKGROUNDS[draft.background];
  const skillProficiencies = [...new Set([...background.skills, ...draft.skillChoices])];
  const con = abilityModifier(draft.abilities.con), dex = abilityModifier(draft.abilities.dex), wis = abilityModifier(draft.abilities.wis);
  return { ...draft, id: `${draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`, name: draft.name.trim(), xp: 0, level: 1, speed: species.speed, maxHp: klass.hitDie + con, armorClass: 10 + dex, initiative: dex, passivePerception: 10 + wis + (skillProficiencies.includes('perception') ? proficiencyBonus(1) : 0), proficiencyBonus: proficiencyBonus(1), savingThrows: klass.savingThrows, skillProficiencies, traits: species.traits, features: klass.features, equipment: [...background.equipment, klass.id === 'fighter' ? 'Longsword and shield' : 'Spellbook and quarterstaff'] };
}
export function loadCharacter(storage?: Storage): CharacterSheet | null {
  try { const store = storage ?? window.localStorage; const raw = store.getItem(CHARACTER_STORAGE_KEY); if (!raw) return null; const parsed = JSON.parse(raw) as CharacterSheet; return parsed && parsed.version === 1 && !validateDraft(parsed).length ? parsed : null; } catch { return null; }
}
export function saveCharacter(sheet: CharacterSheet, storage?: Storage) { try { const store = storage ?? window.localStorage; store.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(sheet)); return true; } catch { return false; } }
