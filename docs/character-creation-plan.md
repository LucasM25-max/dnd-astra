# Astra character creation plan

## Goal

Character creation should make a character the player understands and wants to inhabit, while remaining faithful to the licensed Player's Handbook rules. It should produce a valid, playable sheet and a visible in-world identity without asking a new player to understand every rule up front.

## Experience flow

1. **Concept first** — a short prompt such as “a watchful wilderness guide” or “a scholarly survivor” filters backgrounds, classes, proficiencies, and recommended ability priorities. It never removes the advanced path.
2. **Ancestry/species** — show appearance, movement, senses, languages, traits, and cultural description in separate mechanical and narrative tabs. Preview the character in Astra’s real lighting and scale.
3. **Background** — choose origin, skill/tool/language proficiencies, starting equipment, contacts, and a personal drive. Background is also the source of early journal hooks.
4. **Class** — show role, resource loop, primary ability, armor/weapons, level-one features, and a ten-second combat preview. Use plain-language “what you do every turn” examples.
5. **Ability scores** — support the licensed generation methods, with an optional recommended allocation. Show modifiers, saving throws, initiative, carrying capacity, and how the proposed build changes.
6. **Skills and proficiencies** — present every granted proficiency, allow legal choices, explain overlap, and never silently discard a choice. Expertise and saving throw proficiency are visually distinct.
7. **Equipment** — offer rules-valid packages, an advanced item picker, weight/encumbrance preview, and a physical preview of worn/carried items. Starting gold and equipment must be derived from the rules data, not UI code.
8. **Personality and appearance** — name, pronouns, voice, face/body presets, skin/hair/eye detail, scars, clothing palette, and optional bonds/flaws/ideals. Keep all appearance choices independent of mechanics.
9. **Review and test scene** — a complete diff of the final sheet, a short training vignette, and the ability to change any step without losing later legal choices. Confirm before saving.

## Data model

Create a versioned `CharacterDraft` separate from the runtime character:

- identity: name, pronouns, portrait seed, voice, appearance preset;
- ancestry/species and selected traits;
- background and selected options;
- class, subclass when available, level, and feature choices;
- ability generation method and six scores;
- skills, tools, languages, weapons, armor, equipment, and currency;
- personality tags, bonds, ideals, flaws, goals, and consent/accessibility settings.

Run a pure validator after every step. The validator should report structured errors (`missing-choice`, `illegal-proficiency`, `duplicate-language`, `equipment-over-capacity`) and warnings separately. Finalization produces an immutable `CharacterSheet` plus a migration version. Never save an incomplete draft as a playable sheet.

## Rule adaptation

- Generate ability scores by a server-independent deterministic seed; display the rolls and the method used.
- Calculate modifiers, proficiency bonus, saving throws, skills, AC, HP, speed, initiative, hit dice, passive scores, attacks, spell save DC, and spell attack bonus in one rules kernel.
- Store choices as IDs from licensed/content-reviewed data, not copied rule paragraphs. UI descriptions are original and link to a compact explanation layer.
- Handle choices that depend on earlier choices through a dependency graph. A change invalidates only dependent selections and explains why.
- Preserve tabletop identity: a player can make a suboptimal but legal choice. Recommendations are optional and never overwrite intent.

## Art and animation pipeline

- Use a modular hero body with consistent skeleton, facial blend shapes, hands, feet, and equipment sockets. Keep body, face, hair, clothing, armor, weapons, and backpacks swappable without visible seams.
- Author 4K hero PBR materials for skin, hair, cloth, leather, metal, wood, and dirt. Use a lower-resolution streaming set for distant companions.
- Preview cloth and armor silhouette in idle, walk, sprint, crouch, climb, swim, hit, downed, and camp poses before final confirmation.
- Keep equipment physically represented in the world and use material response, contact shadows, and grime masks rather than excessive bloom.
- Use procedural variation only for small details; hero faces and hands need curated topology and tested deformation.

## Accessibility and onboarding

- Offer guided, standard, and advanced creation modes.
- Screen-reader labels include both name and mechanical effect. Every color-coded state has text/icon/audio equivalents.
- Allow remapping, text size, dyslexia-friendly font, reduced motion, subtitle detail, narrated choices, and a rules-explanation toggle.
- Provide legal premade characters and a “finish later” draft, but do not allow an incomplete character into a rules encounter.

## Technical implementation order

1. Build content schemas and the pure character validator.
2. Implement the derived-stat calculator and property tests for every dependency.
3. Add draft persistence, migration, undo/back navigation, and finalization checksum.
4. Build the guided flow with a reusable choice-card component and a persistent character summary.
5. Integrate the hero preview scene, equipment sockets, and animation validation poses.
6. Add advanced choices, multiclass prerequisites when supported, and respec rules.
7. Add narrated onboarding, accessibility settings, and the training vignette.
8. Connect the finalized sheet to the deterministic rules event log and save system.

## Acceptance criteria

- Every generated level-one character is legal, explainable, saveable, and reproducible from its seed.
- Editing an early choice never silently changes an unrelated later choice.
- A player can reach a valid character in under ten minutes in guided mode and inspect every rule in advanced mode.
- The preview accurately reflects equipment, silhouette, lighting, movement, and first combat actions.
- Automated tests cover score generation, modifier calculation, proficiency/expertise, HP/AC, starting equipment conservation, dependency invalidation, migrations, and accessibility labels.
