# Astra: photorealistic D&D adventure RPG roadmap

## Product target

Astra should feel like a first-person/over-the-shoulder, physically grounded Forgotten Realms adventure rather than a rules reference rendered in 3D. The player sees believable scale, materials, weather, animation, and consequences; the D&D rules remain deterministic underneath and are exposed through readable intent, not spreadsheet controls.

The current opening chapter is a strong vertical-slice foundation: it has a narrated journey, a persistent wagon, cargo conservation, an explorable forest, and a small animal simulation. It is not yet a full game. The roadmap below keeps that opening as the quality bar and grows systems around it.

> Rules/licensing note: use the licensed Player's Handbook supplied to the team as the authoritative design reference. Do not ship scanned or copied text, proprietary art, maps, adventure prose, or trademarks without permission. Store rules as structured data and write original descriptions, UI copy, and quests. Confirm the exact edition and SRD/creator-license scope before production; where the licensed book and the SRD differ, the licensed agreement wins.

## 1. Non-negotiable pillars

1. **Physical presence.** Every important action has a spatial cause: line of sight, reach, cover, noise, footing, light, doors, elevation, and usable objects.
2. **Fast intent, deep choice.** One contextual action handles common cases; a radial/verb menu reveals alternatives. Never force the player to perform tabletop bookkeeping for routine actions.
3. **Rules are authoritative.** A single simulation service resolves checks, combat, conditions, resources, death, and saves. Rendering and UI only present the result.
4. **Consequences over cutscenes.** NPC memory, faction attitude, evidence, time, supplies, and noise persist. Dialogue and encounters react to the actual world state.
5. **Photorealism is a pipeline, not a shader.** Use physically based assets, calibrated lighting, natural animation, correct scale, contact shadows, grounded audio, and restrained post-processing.
6. **Accessibility is part of the design.** Every important visual signal has audio/text alternatives; real-time combat has pause/slow options; color is never the only state cue.

## 2. Fix and stabilize the vertical slice first

### Animals and wagon

- Replace procedural placeholder silhouettes with licensed, rigged ox and horse assets when the art team has approved candidates. Required bones: root, pelvis/chest, neck, head, jaw/ears, tail, upper/lower leg and hoof. Required clips: idle, breathe, walk, trot, graze, startle, turn, strain, and stumble.
- Keep procedural foot placement as a layer over authored animation. Sample terrain under each hoof, solve a constrained two-bone IK chain, and reject targets that would stretch beyond the rig.
- Use one collision contract for wagon, yoke, oxen, horses, player, and props. Animals should push/avoid softly; the player should never become permanently stuck. Add overlap soak tests and replayable bug seeds.
- Use UV-mapped PBR coats, separate muzzle/hoof/horn materials, groomed mane/tail cards, and subtle vertex color variation. Avoid object-space texture projection that creates seams or blotches on legs and heads.
- Give animals goals and needs: graze, drink, investigate scent, startle, avoid the wagon, respond to reins, and remember recent threats. Footstep, breath, tack, snort, low, and whinny events come from animation markers, not random frame checks.
- Profile a representative low-end laptop and a modern desktop. High quality can use groom cards and contact shadows; balanced uses simplified hair and baked AO; performance uses a lower LOD and no expensive transparent layers.

### World and camera

- Build terrain as tiled clipmaps or streamed cells, with authored landmarks and a distant silhouette layer to close the horizon.
- Replace repeated cards with a three-tier vegetation library: hero scanned trees near the camera, instanced midground trees, and merged/billboard distant forest. Use wind only where visible.
- Add wetness, dust, mud, snow, fog, puddles, and leaf litter as material parameters driven by weather and time of day. Keep albedo, roughness, and normal maps in a consistent color-management workflow.
- Use a physically plausible sky/HDRI, cascaded sun shadows near the player, contact shadows for hero actors, screen-space reflections only where useful, and restrained volumetric fog. Avoid sharpening, bloom, and saturated grading as substitutes for detail.
- Make the camera collision-aware and acceleration-based. It should smoothly avoid trees, wagon roofs, and walls rather than popping upward.

## 3. Adapt the PHB rules to play well in 3D

### Character creation and progression

Represent a character as structured data:

- ancestry/species, background, class, level, ability scores and modifiers;
- proficiency bonus, saving throws, skill proficiencies, expertise, languages, senses;
- hit points, hit dice, armor class, speed, initiative, death saves;
- weapons, tools, spellcasting ability, spell slots, prepared/known spells, features;
- conditions, exhaustion, inspiration/heroic resource, currencies, encumbrance, and quest flags.

Character creation should be a guided identity builder, not a form dump. Show the mechanical consequence of every choice, offer recommended builds, allow an advanced view, and preview the character in the actual world. Level-up is a deliberate camp or mentor interaction with a respec confirmation and a full change summary.

### Core checks

Use one resolver for d20 tests. It takes actor, ability/skill, proficiency state, DC, advantage sources, disadvantage sources, situational modifiers, and a seeded roll context. It returns the die, modifiers, total, outcome, and explainable reasons. Never stack advantage numerically: multiple advantage sources still mean two dice and take the higher; any advantage and disadvantage cancel according to the licensed rules.

For exploration, automatically make passive checks only when they add value. For active checks, expose intent: **Look for tracks**, **Force the door**, **Recall lore**, **Sneak past**, or **Persuade**. The UI can show the likely skill and risk without revealing hidden DCs. Let players choose another sensible approach when the fiction supports it.

### Time, movement, and action economy

Keep tabletop rounds only when danger begins. Exploration uses continuous movement and a hidden six-second simulation tick. At encounter start, freeze or slow the world, establish initiative, and convert the character's turn into a readable action budget:

- movement is a path/remaining-distance meter, including difficult terrain and disengage consequences;
- action, bonus action, reaction, object interaction, and free speech are separate affordances;
- attack, dash, dodge, help, hide, ready, search, use, shove, grapple, improvise, and class features are verbs;
- reactions remain armed until spent or the turn ends; allow a clear reaction preview and optional automatic rules for common reactions;
- real-time enemy motion is visually fluid, but authoritative outcomes resolve on action boundaries so latency and animation do not change rules.

For players who want a more action-oriented mode, show a short planning pause at each turn and then animate the result. Do not silently turn D&D into an untelegraphed action game.

### Combat model

Use a hybrid gridless system with a hidden 0.5 m tactical lattice. Characters have capsules, reach arcs, facing-free attacks unless a feature says otherwise, and explicit elevation/cover queries. The simulation handles occupancy, opportunity attacks, line of effect, cover, difficult terrain, forced movement, concentration, and area shapes. Display a projected footprint before confirmation.

All attacks use the same pipeline: choose target, validate range/line of effect, roll attack or save, apply critical rules, roll and type-tag damage, apply resistances/vulnerabilities/immunities, then apply riders, concentration, conditions, push/pull, and death state. Keep damage types and conditions data-driven. Animation can show a miss, block, graze, or hit, but it cannot invent a mechanical outcome.

Enemy AI should know only what its senses and memory permit. Use sound propagation, last-known positions, light level, cover, morale, goals, and faction tactics. Bosses need authored phases and readable tells, not inflated hit points.

### Spellcasting

Create a spell schema with level, school, casting time, range, target/area, components, duration, concentration, attack/save, damage/healing, conditions, tags, and scriptable effects. The spell preview should show range, line of sight, area volume, affected allies/enemies, and environmental interactions. Resolve at cast confirmation; allow a short cancel window before commitment only for accessibility, not after dice are known.

Concentration is a persistent status with a visible focus link and a save prompt when damage is taken. Rituals, prepared spells, spell slots, cantrips, upcasting, reactions, counterplay, dispels, and rests are separate data paths. Environmental spell effects should be curated simulation affordances—burnable foliage, water, ice, darkness, wind, sound—not unconstrained physics that makes every quest brittle.

### Skills, tools, social play, and exploration

- Use backgrounds and proficiency to create authored opportunities without hard-locking progress behind a single check.
- Social encounters use disposition, leverage, faction, prior promises, evidence, fear, and time. Dialogue options show intent (threaten, bargain, empathize, deceive), not just flavor.
- Tools are physical verbs: thieves' tools expose a timing/feedback interaction while the rules resolver determines success; herbalism and crafting use ingredients, recipes, and proficiency.
- Stealth is a readable model of light, noise, cover, visibility, and enemy awareness. Avoid a binary crouch toggle.
- Search, examine, investigate, track, forage, listen, climb, swim, jump, and interact are registered world verbs. Give the player a plausible alternative when a roll fails: cost time, make noise, consume supplies, or reveal a clue.
- Inventory follows the licensed encumbrance rules but offers presets: strict, narrative, or accessibility. Equipment changes are visible on the character and cannot be swapped during a restricted action.

### Rest, resources, and travel

Short and long rests are camp activities with safety, time, food, spell recovery, hit dice, watch order, interruptions, and world-clock consequences. Travel uses route choice, pace, navigation, forage, encounter probability, weather, exhaustion, mounts, supplies, and landmarks. Do not reduce a long rest to a loading screen: show the camp, companions, firelight, conversations, and the possibility of a consequence.

Death should be legible and recoverable according to the licensed rules: downed state, death saves, stabilization, healing, revivification, and party defeat. Save before irreversible choices, and provide a recap rather than rewinding hours.

## 4. Systems architecture

Use a deterministic simulation core separate from Three.js:

- `rules/`: pure schemas and resolvers for checks, combat, spells, conditions, rests, inventory, and progression;
- `simulation/`: actors, navigation, perception, world clock, quests, dialogue state, and event log;
- `presentation/`: Three.js actors, animation state machines, audio, camera, VFX, and LOD;
- `ui/`: contextual verbs, combat timeline, character sheet, inventory, journal, map, settings, and accessibility;
- `content/`: versioned JSON or authoring-tool exports with validators for creatures, spells, items, quests, scenes, and dialogue;
- `save/`: versioned snapshots, migrations, checksums, replay seed, and recovery backups.

Emit immutable events such as `CheckResolved`, `DamageApplied`, `ConditionAdded`, `ContainerOpened`, `QuestAdvanced`, and `RestCompleted`. The event log makes replays, bug reports, autosaves, telemetry, and deterministic tests possible. Rendering subscribes to events; it never mutates rule state directly.

## 5. Production phases and acceptance gates

### Phase 0 — vertical-slice hardening (2–3 weeks)

Fix animal materials/rig quality, wagon/horse collision, driving corridor, save migration, camera collision, loading/error states, and browser smoke coverage. Gate: no animal clipping or NaN over a 30-minute soak; drive and walk the opening without dead ends; reload is lossless.

### Phase 1 — rules foundation (4–6 weeks)

Implement structured actors, d20 resolver, abilities/skills, conditions, action economy, equipment, rests, death, and deterministic event log. Gate: pure tests cover every PHB rule implemented so far; a debug rules panel can explain every result.

### Phase 2 — first combat vertical slice (6–8 weeks)

One player class, two companions, three enemy archetypes, weapons, a small spell set, stealth-to-combat transition, AI perception, terrain cover, and one boss. Gate: combat is readable at 60 fps on balanced hardware, every result is replayable from a seed, and encounters can be won through multiple approaches.

### Phase 3 — authored chapter and companion simulation (8–12 weeks)

Travel, camp, dialogue disposition, faction reputation, quests, crafting, shops, mounts, and a complete chapter from road to dungeon. Gate: at least three materially different solutions to each major objective and no single required skill check.

### Phase 4 — production art and world streaming (ongoing)

Photogrammetry-quality materials, hero character rigs, facial performance, modular architecture, distant landscapes, weather, day/night, soundscape, animation polish, and scalability tiers. Gate: asset provenance audit, consistent color pipeline, frame-time budgets, memory budget, and device test matrix.

## 6. Quality, test, and performance budgets

- 60 fps target on balanced hardware; 30 fps floor on the minimum supported GPU.
- Keep the main-thread simulation under 4 ms and rendering under 12 ms on the balanced target.
- High quality: measured shadow/LOD budgets, not unlimited transparency. Balanced: aggressive instancing and baked distant lighting. Performance: no expensive post effects, simplified hair, reduced vegetation.
- Unit-test pure rules, property-test inventory conservation and condition expiry, replay seeded combat, and fuzz save migrations.
- Browser tests cover loading failure, audio denial, input focus, mobile layouts, reload, photo mode, cargo, animal avoidance, combat, spell previews, and accessibility settings.
- Capture automated screenshots from fixed seeds and compare silhouettes, exposure, shadow acne, ground contact, and UI overflow. Track draw calls, triangles, texture memory, shader compile time, and frame-time percentiles.

## 7. Immediate backlog

1. Keep the new UV-driven animal coat material and add a visual regression scene for oxen and horses.
2. Add a dedicated `collision-corridor` and animal-avoidance soak test to browser CI.
3. Add an interaction registry so cargo, horses, belongings, signs, lanterns, and terrain all use the same verb contract.
4. Introduce the pure d20/check resolver before adding more bespoke interactions.
5. Replace the bean placeholder with a properly rigged player avatar and first-person hands that inherit equipment and lighting.
6. Build one complete combat encounter before expanding the map.
7. Audit every asset, rule excerpt, setting name, and audio clip for the project's intended commercial distribution.
