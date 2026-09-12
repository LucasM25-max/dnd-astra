# Astra — Chapter I: A delivery for Gundren

A playable **Three.js + TypeScript + Vite** fantasy RPG prototype, beginning with a narrated wagon journey on the Triboar Trail. The original, non-grid Goblin Ambush woodland remains the setting. There is no login or game backend; everything needed to play, including the Narrator’s voice, is served locally by the app.

## Play the chapter

Click **Begin your journey**. You begin on the wagon’s driving bench as a chain-mail fighter, holding the reins of two yoked oxen. A roughly one-minute opening follows the wagon down the road while the Narrator reads the supplied Neverwinter/Gundren introduction verbatim, in four readable pages.

At the clearing, the wagon stops and **control is handed back before the arrival narration begins**. That second passage describes the recent battle and the **two living horses** wandering and sniffing around ransacked belongings. The chapter stops there narratively; you can still drive, dismount, inspect the scene, and explore.

- **Skip opening** immediately reaches the same handoff without duplicating cargo or progress.
- Narration has pause/resume, repeat-passage, voice mute, and next-passage controls.
- **N** opens the complete story journal. Delivery tags never appear in the visible prose.
- Opening a menu pauses the game and voice; a deliberate Narrator pause remains paused after closing a menu.
- Audio requires the initial user interaction. If playback is blocked or unavailable, timed subtitles keep the journey usable.
- Reloading after reaching the clearing offers **Continue your journey**, restoring your wagon, character, open containers, and inventory. It does not respawn collected goods or replay the introduction. The full arrival text is always in the journal.

The Narrator currently delivers this **authored chapter**. It is not yet a free-form AI Dungeon Master or a rules adjudicator.

## The wagon, animals, and cargo

The wagon includes individual weathered timber boards, iron fittings, twelve-spoke rotating wheels, a driving bench, a drawbar, a double yoke, flexible traces/reins, and six separately inspectable cargo containers. Crate/case lids open on hinges; looted supplies disappear from their physical stacks. The small oil barrel contains approximately fifty flask measures, not fifty separate bottles.

The Wanderer, the two yoked oxen, and the two horses are 2.5D actors: 2D animation frames playing inside the 3D world. Each is procedurally painted onto a canvas sprite sheet as sixteen direction variants (plus idle, walk, sprint, seated, or head-down poses) and shown on an upright billboard that always faces the camera, so the side closest to the viewer is visible at any moment and neighbours crossfade instead of popping as you orbit. They read as turning, breathing, tail-wagging figures from any angle. Each sheet also derives a half-resolution normal atlas from its painted luminance, so the billboards catch the same directional sun/moonlight and hemisphere ambience as the 3D props: figures shade on their unlit side and dim naturally at night instead of glowing. The horses alternate between short walks and investigating the belongings. Moving actors and the wagon have collision volumes. Driving is constrained by terrain, obstacles, and space: the full wagon cannot simply cross steep banks or squeeze along the narrow Cragmaw trail.

**Art scope:** this remains a realism-focused browser prototype. The wagon/cargo geometry is procedural; the characters and animals are procedurally painted canvas sprite sheets (no image-generated sprites, no external meshes or rigs), supersampled with photographic grain so they sit next to the image-based terrain/plant textures and their derived normal maps. The forest floor is bare soil; the trail and stony banks blend over it. This is not a production photogrammetry set: a finished AAA-photorealistic art pass and broader hardware profiling remain future work.

## Inventory and gold pieces

Press **R** to dismount, walk beside a container, and press **E** to open it (press **E** again, or use the dialog's close control, to close it). Take a chosen quantity or everything in that container. **I** opens the inventory; it includes currency at the top, categories, search, quantities, per-item values, stack values, and item descriptions.

The consignment’s fixed sale appraisals total **exactly 100 gp**:

| Item | Quantity | Each | Total |
| --- | ---: | ---: | ---: |
| Sack of flour | 12 | 0.50 gp | 6 gp |
| Cask of salted pork | 4 | 2 gp | 8 gp |
| Keg of strong ale | 2 | 3 gp | 6 gp |
| Shovel | 12 | 2 gp | 24 gp |
| Mining pick | 12 | 2 gp | 24 gp |
| Crowbar | 12 | 2 gp | 24 gp |
| Field lantern | 5 | 0.60 gp | 3 gp |
| Lantern oil, one flask measure | 50 | 0.10 gp | 5 gp |
| **Total** | | | **100 gp** |

These are this shipment’s **sale appraisals**, not claims about official D&D retail prices. The wagon, oxen, and empty transport containers are not priced as saleable inventory in this chapter.

Your purse begins at **0 gp**. Carrying 100 gp worth of supplies is not the same as receiving 100 gold pieces. Gundren’s promised 10 gp is not credited before delivery. Shops, selling, earning/spending currency, encumbrance, combat, and quests are not implemented yet.

### Save/economy implementation

- Prices are integer **hundredths of a gp**, avoiding floating-point money drift.
- Transfers are quantity-checked and conserve every unit across container stock and player inventory.
- Taking an empty container again cannot duplicate items.
- One versioned `localStorage` record (`astra-journey-v1`) stores the inventory, remaining cargo, open lids, arrival flag, mount state, and positions together.
- Invalid saves are backed up under a recovery key instead of silently discarding the original string. If storage is unavailable, the inventory works in memory and the UI reports that it is session-only.
- This is a single-player, device-local save, not an authoritative multiplayer economy. When adding shops, extend the save schema and conservation rules to record sold goods and earned currency; the current validator deliberately assumes no goods have been sold and no coins have been earned.

## Time, weather, and music

The chapter opens on the **afternoon of 15 Ches** in the Calendar of Harptos — twelve 30-day months with the four Sword Coast seasons (winter: Hammer, Alturiak, Ches; spring: Tarsakh, Mirtul, Kythorn; summer: Flamerule, Eleasias, Eleint; autumn: Marpenoth, Uktar, Nightal). The named days (Midwinter, Day of New Leaves, Highharvestide, Feast of the Long Night) are part of the calendar data and surface in the world map's calendar strip.

- **The day turns in real time**: one in-game minute passes every five real seconds, so two real hours cover one full game day. Day length follows the season (eight winter hours, fourteen under highsun), with smooth dawn/dusk and a moonlit, star-filled night.
- **Long rests are optional**: the pause screen offers *Long rest — sleep until morning*, which simply advances the clock to 6:00 am. Rests are never forced, and recovery effects are a later chapter.
- **Weather follows the season**: clear, overcast, rain, storm, snow (winter only), and wind, each with its own lighting, fog, sky, and particle treatment. Conditions crossfade over about a minute of real time; storms bring lightning, distant thunder, and rain.
- **Music and ambience follow the scene**: a low D-Dorian score with a drone, pads, and sparse bells that respond to weather (a pulse in storms, a wind bed that swells with the gusts), plus rain, gusts, and thunder layered into the forest ambience. Both have separate toggles and volume sliders in **World settings**, alongside a time-of-day slider and a weather override (seasonal by default).

The small chip above the minimap shows the current date, time, and weather; clicking it opens World settings. The world map includes the Calendar of Harptos for the current month.

## Controls

| Input | On foot / general | At the reins / opening |
| --- | --- | --- |
| W A S D / arrows | Walk | W/S guide forward/back; A/D steer |
| Shift | Sprint | Normal ox-paced travel |
| Space | Jump | Brake; pause narration during the opening |
| Mouse | Click to capture, or click-and-drag to look | Free look after the cutscene |
| Mouse wheel | Third-person camera distance | Third-person camera distance |
| V | First / third person | First / third person after handoff |
| R | Board when near the bench | Dismount |
| E | Open/close nearby cargo, inspect belongings | Open/close nearby cargo |
| I | Inventory | Inventory |
| N | Complete story journal | Complete story journal |
| M | Area map | Area map |
| H | Controls guide | Controls guide |
| P | Photo mode and PNG capture | Photo mode |
| Escape | Release mouse / pause / close a dialog | Pause / close a dialog |
| Enter | Activate a focused button | Advance the current opening passage |

Touch devices get a movement pad, drag-to-look, and a context-sensitive jump/dismount button. Pointer lock has a drag-look fallback for embedded previews. Narrator voice and forest ambience have separate controls. If an iframe blocks fullscreen, use the host preview’s expand control.

## Run and deploy later

Use **Node.js 22**:

```bash
npm ci
npm run dev       # 0.0.0.0:5173, including Arena .e2b.app preview hosts
npm run build     # strict TypeScript + static production build in dist/
npm run preview   # serve the production build on port 4173
```

Use a WebGL 2-capable browser with hardware acceleration. **Performance** reduces vegetation and render resolution, uses cheaper shadows, and disables HDR environment sampling/bloom. **Balanced** and **High fidelity** retain the fuller lighting pipeline. Software-GPU smoke-test speed is not a native-GPU frame-rate claim.

For Vercel, import the project when ready and choose **Vite**, **Node 22.x**, build command `npm run build`, and output directory `dist`. `vercel.json` supplies these settings and cache headers. **No environment variables or external API are required to play.** No deployment command is run automatically.

## Optional Gemini Narrator regeneration

The bundled MP3s use the Narrator voice auditioned and selected for this session. You do **not** need an API key for them.

An optional **offline** script can regenerate all six passages using `gemini-3.1-flash-tts-preview`, natural-language voice direction, and inline delivery tags such as `[storytelling]` and `[whispers]`. The request format follows Google’s official speech-generation documentation. [3](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation)

```bash
# Inspect all directed prompts without making requests or needing a key:
npm run narration:gemini -- --dry-run

# Optional: configure GEMINI_API_KEY privately in your environment or .env.local.
# .env.example lists the available names; .env.local is ignored by Git.
# Then explicitly run the six generation requests:
npm run narration:gemini
```

- **Never paste the key into chat, commit it, or give it a `VITE_` prefix.**
- Defaults: `GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview`, `GEMINI_NARRATOR_VOICE=Charon`.
- This script is never invoked by the browser, dev server, or production build; there is no publicly exposed paid-generation endpoint.
- It writes WAV clips and publishes a new audio manifest only after all six requests succeed. The original auditioned MP3s are retained.
- Review every generated passage before publishing. Gemini is a separate voice provider and will not reproduce the exact auditioned voice.
- The script has been **dry-run validated**; actual Gemini API generation has not been exercised because no key was supplied.

## Validation and asset preparation

```bash
npm test                  # 73 deterministic map, economy, story, transport, and sprite checks
npm run build             # type-check and production bundle
npm run test:browser      # real-browser integration suite; dev server must already be running
npm run assets:prepare    # original forest textures from included sources
npm run assets:adventure  # wagon wood, sackcloth, and animal coat textures
```

The integration suite is for a **Linux sandbox**. It uses development-only `@sparticuz/chromium` and Playwright, extracting browser libraries into the system temp directory. It checks voiced opening/pause, handoff, driving, dismounting, actual walking to cargo, partial/all transfers, no duplication or coin minting, decimal values, search, jump/cameras, maps/journal, settings, audio controls, photo download, reload persistence, pointer-lock fallback, and the small-screen inventory. Set `BASE_URL` to override the default dev-server address.

Chromium is exercised directly. Firefox/Safari use standard WebGL 2/media APIs but have not been independently validated here. Vite currently reports a non-blocking vendor-chunk size warning for Three.js.

## Code layout

```text
src/game/items.ts                 Item registry, fixed appraisals, initial consignment
src/game/save.ts                  Atomic local save, validation, conservative transfers
src/game/narration-script.json    Exact visible/spoken passages and optional Gemini directions
src/game/narrator.ts              Audio-clock timeline, pause ownership, fallback, handoff
src/game/time.ts                  Calendar of Harptos, game clock, sun geometry, seasonal weather tables
src/game/music.ts                 Dramatic score: drone, Dorian pads/bells, storm pulse, wind bed
src/game/road.ts                  Continuous wagon route and heading
src/engine/adventure.ts           Chapter orchestration, driving, boarding, interactions, saves
src/engine/actors/                Wagon/cargo construction, materials, and painted sprite actors
src/engine/landscape.ts           Original map curves, height field, static/dynamic collisions
src/engine/nature.ts              Spatially instanced trees, grass, ferns, rocks, and deadwood
src/engine/controller.ts          Foot movement, seated fighter/hands, camera and input handling
src/engine/weather.ts             Weather engine: seasonal palettes, rain/snow/wind particles, lightning
src/engine/audio.ts               Forest ambience plus rain, gusts, and thunder weather beds
src/engine/world.ts               Renderer, clock-driven atmosphere, quality, world update, capture
src/ui/                           HUD, Narrator panel, inventory/cargo, dialogs, cartography, calendar
assets-source/                   Original generated texture sources (not served in production)
public/audio/narration/           Bundled voice clips and duration/source manifest
public/credits.txt               Asset/library provenance and license references
```

The supplied reference map’s image is not redistributed, and no grid is drawn in the world or maps. Cragmaw Hideout and Phandalin remain destinations beyond this scene, not built settlements. This is an unofficial D&D-inspired prototype. Review setting and asset rights before a public commercial release.

## Roadmap — Completing Systems 1–5 to Their Full Vision (Post–PR #37)

PR #37 attempted five systems — 3D dice, character creation, a skeletal player
character, narrator-driven interactions, and long/short rest — but shipped an
incomplete, visually mismatched version of the original design. This section
is the authoritative, maximum-detail specification for finishing all five
systems properly. It supersedes PR #37's implementation wherever the two
disagree, and it folds in every point from the original design brief that PR
#37 either skipped or only partially built. Nothing here activates combat;
attack, hit, dodge, and death animations remain preview-only until a future
chapter.

### Style Law — non-negotiable for every system below

**The pre-PR-37 woodland aesthetic is the only aesthetic.** PR #37 introduced
a second, clashing dark-slate/purple theme (`#1a1a2e` background, `#c9a84c`/
`#e8c96a` gold, `Cinzel` headers, `Segoe UI` body text) across
`src/systems/dice/dice.css`, `src/ui/creation/creation.css`, and
`src/ui/systems.css`. That theme is retired. Every new or rebuilt screen —
dice overlay, character creation, camp menu, subtitles, HUD — must instead
use the game's existing woodland language:

- **Colour**: background `#17231b`, gold accent `--gold: #d0b781`, warm
  parchment text, soft green-tinted HUD glass.
- **Type**: headers in `Cormorant Garamond`, body in `Manrope`. No `Cinzel`,
  no `Segoe UI`, anywhere.
- **Components**: reuse the established `.dialog`, `.enter-button`,
  `.setting-segment`, `.toast`, and `.inspect-prompt` patterns rather than
  inventing new chrome. New screens should feel like they always belonged
  next to the minimap, compass, and region label.
- **Art direction**: every new or regenerated texture (banners, arch frame,
  parchment, wax seal, faces, chainmail, weapons, dice sets, skies,
  particles) is graded toward the same warm woodland palette as the existing
  wagon/forest art — no cool purple-leaning or desaturated slabs.
- **Z-order**: HUD (base) → camp overlay (110) → subtitles (115) → dice
  overlay (120), all sharing the same backdrop-blur/border/shadow language
  already used elsewhere in the game.
- **Asset economy**: PR #37 shipped ~15 PNGs at 1.7–3 MB each. Every new
  texture ships as compressed `.webp` (+ derived `-normal.webp` where
  needed), matching the project's existing convention. Target ≤300 KB per
  large texture and true 64–128 px dimensions for particle sprites (dust
  motes, embers, smoke) rather than oversized multi-megabyte source art
  scaled down at runtime.
- **Quality bar**: "maximum potential" means no placeholder geometry, no
  stretched or tiling-seamed textures, no clipping between equipment and
  body meshes, no UI element that looks unfinished next to the rest of the
  game. Every system below should read as a natural, polished extension of
  the existing Chapter I presentation — not a bolt-on tech demo.

Everything that follows is written against this style law, even where the
original technical brief's own "Consistency" notes describe the retired
dark-slate theme — that section is superseded here.

---

### System 1 — 3D Dice Rolls

**Keep, because it already works:** `crypto.getRandomValues()` for true
randomness (never `Math.random`), the result-first/physics-cosmetic
approach (`DiceResultResolver` determines the outcome, then the throw is
guided to it), roll serialisation and world-pause via game state during a
`CINEMATIC`-style hold, and the lightweight custom physics sim capped at
three bodies (die, glass plane, walls) with per-roll create/dispose and no
persistent physics world. This already satisfies "lightest engine to add" —
no need to pull in Cannon/Ammo/Rapier.

**Fix, to reach spec:**

- **Materials.** Replace the current flat `MeshStandardMaterial` ivory +
  floating canvas-texture numerals + `LineBasicMaterial` edges with real PBR
  sets built from the generated `dice_body_albedo/normal/roughness` and
  `dice_tray` textures: bone-ivory faces, gold-inlaid engraved numbering,
  subtle metallic edge wear via roughness variation and rim lighting. Keep
  floating numeral planes only as a graceful fallback path, not the primary
  look.
- **Tray.** Add a tray mesh under the glass plane using `dice_tray`, with
  correct shadow/contact-shadow tuning so the die visibly rests in it rather
  than floating on a bare invisible plane.
- **Die correctness.** Fix the d10's `0` face and ensure `6`/`9` carry the
  distinguishing underline, per the original texture spec.
- **UI reskin.** `DiceOverlayUI` and `dice.css` move fully onto the woodland
  dialog language (see Style Law). Preserve the existing result beat: die
  settles (~1.5 s) → number zooms → modifier badge slides/slams in from the
  side with a thud → total pulses beneath → SUCCESS (green glow) / FAILURE
  (red crack) banner. Auto-dismiss after 2.5 s or on click/keypress, exactly
  as specified. Keep the reduced-motion path.
- **Audio.** Verify and wire the full SFX chain — throw, 2–4 bounce
  variants, land, modifier slam, success chime, failure crack — using the
  project's existing `.wav` convention; don't switch formats without cause.
- **Single entry point.** `DiceRoller.roll()` remains the one API every
  other system uses: character-creation stat rolls, skill/ability checks,
  rest healing (Hit Die spends), and the hidden ambush/perception rolls in
  System 5. `DiceRoller` also needs a hidden-roll mode (no overlay shown) for
  the camp-ambush check described below.

---

### System 2 — Character Creation

**Rebuild the layout to spec**, replacing PR #37's cramped three-column grid
(300 px cards + 400 px preview + drawer) and thumbnail-sized cards:

- **Left panel (~65% width):** three stacked cards — Class, Species,
  Background — each a full moody silhouette banner (not an 86 px thumbnail)
  with a "CHOOSE" label, category title, flavour text, and a gold-bordered
  "SEE OPTIONS" button. Because there's exactly one option per category
  (Fighter / Human / Soldier), "SEE OPTIONS" opens a **drawer sliding in
  from the right over the cards**, auto-selects that option, and surfaces
  its full mechanical configuration.
- **Right panel (~35% width):** a gothic-arch portrait frame (dark iron +
  gold filigree, matching the existing `arch_frame` art direction but
  woodland-graded) containing a **live real-time 3D render** of the player
  model — not the current 2D canvas turntable — that updates immediately as
  equipment and portrait choices change. Below it: a name field with a
  gold-underline focus state, a row of suggested-name pills (Aldric, Maren,
  Theron, Sylva, Kael) that auto-fill the field on click, and a pulsing gold
  **"FORGE YOUR LEGEND"** button, disabled until every section is confirmed.
  This replaces PR #37's plain footer button.

**Fighter class drawer** — build out in full, not just mechanically but with
the video-game framing from the brief:

- HP shown as a red health-globe readout ("10 + Constitution modifier"),
  with the plain-language explainer about resting at campfires.
- Proficiencies displayed (armour/shield icons lit, weapon rack fully lit,
  STR/CON saving-throw icons highlighted) — no choice needed, Fighter gets
  everything.
- Skill picker: choose 2 of Acrobatics, Animal Handling, Athletics, History,
  Insight, Intimidation, Perception, Survival, as an interactive card grid
  with icon, name, governing ability, and an "in-game this means…" one-liner
  per card (e.g. Perception's ambush/secret-spotting framing). Gold border
  on selection; remaining cards grey out once 2 are picked.
- Fighting Style, one of four, each a large horizontal card with an
  animated weapon-preview icon and plain-language effect text (Defense,
  Dueling, Great Weapon Fighting, Two-Weapon Fighting exactly as specced).
  Selecting one plays a short looping skeletal-preview animation of the
  matching stance on the 3D model — this is the fighting-style anim PR #37
  never wired past a 2D flourish.
- Second Wind shown as an MMO-style cooldown-circle ability card ("1d10 + 1
  HP, once per rest"), with the campfire-recharge explainer.
- Equipment Loadout: a genuine paper-doll interface, not static 2D cards —
  primary weapon choice (Longsword / Battleaxe / Warhammer) as rotatable 3D
  models, off-hand choice (Shield, or a matching second weapon when
  Two-Weapon Fighting is selected — auto-suggest dual shortswords),
  auto-equipped Longbow + 20 arrows, fixed Chain Mail with its AC 16 /
  Stealth-disadvantage trade-off shown plainly, and an Explorer's Pack with
  hoverable inventory icons (bedroll, mess kit, tinderbox, 10 torches, 10
  rations, waterskin, 50 ft rope). Every pick live-updates the arch
  viewport and derived stats immediately.

**Human species drawer:**

- Ability scores via point-buy: base 8, 27 points, standard XPHB costs up to
  15 pre-modifier, presented as interactive stat cards with +/− controls.
  Show D&D Beyond–style **rank names** alongside the raw number (Feeble 8 /
  Average 10 / Capable 12 / Exceptional 14 / Heroic 15) and the derived
  modifier's actual gameplay effect in plain language (e.g. "Strength +2 →
  melee attacks hit harder, you can force open stuck doors"). Include a
  "Recommended Build" button that auto-distributes STR 15 / DEX 12 / CON 14
  / INT 8 / WIS 13 / CHA 10 with the balanced-frontline-warrior explanation.
- Size (Medium) and Speed (30 ft, with the sprint-key explainer: Shift for
  1.5× speed, 6 s duration, 30 s cooldown) as display fields.
- Languages: dropdown of Dwarvish / Elvish / Goblin / Orc / Halfling on top
  of Common, with Goblin recommended for understanding early enemies.
- Traits: Resourceful (Heroic Inspiration each long rest, shown as a glowing
  HUD star), Skillful (one more skill from the same card grid, excluding
  the two already picked), Versatile (grants the Origin Feat choice below).
- Origin Feat, one of Alert / Tough / Savage Attacker, as icon cards with
  plain-language effects and a recommendation note (Tough for new players,
  Alert for experienced ones).

**Soldier background drawer:**

- Ability score bumps (+2/+1 across STR/DEX/CON) via a drag-token
  interaction — a "★★" token and a "★" token dragged onto chosen stats —
  with a recommended +2 STR / +1 CON default.
- Athletics and Intimidation auto-granted and shown as confirmed cards.
- Vehicles (land) tool proficiency, with the "useful on the road to
  Phandalin" framing.
- Starting gold (18 gp) as a coin-pouch readout.
- Savage Attacker auto-granted as the Background Feat; if the player already
  took Savage Attacker as their Human Origin Feat, prompt them to pick a
  different Origin Feat instead — no duplicates allowed.
- Personality: pick or randomise 1 Soldier-flavoured Trait from a short
  list, plus 1 Ideal, 1 Bond, 1 Flaw. These flavour narrator lines and NPC
  reactions later — wire the data through even though nothing consumes it
  yet beyond storage on the character record.

**Summary screen:** a parchment-style overlay (restyled to the woodland
palette, not PR #37's purple gradient) showing the complete character sheet
— stats, skills, equipment, features — while the 3D model performs an idle
weapon-flourish animation. On "FORGE YOUR LEGEND": forge-hammer strike VFX
+ SFX, the parchment seals with a wax stamp, then transition into gameplay.

**Background scene:** replace the static purple gradient with a slow,
lightweight woodland scene/fog pan across the Triboar Trail at dusk, in
keeping with the rest of the game's environment art rather than a flat
colour field.

---

### System 3 — Skeletal Player Character (the core rebuild)

This is the system PR #37 got least right — it shipped 16-direction painted
2D sprite billboards (`paintFighter`/`FIGHTER_SHEET`) with a sprite wrapper
(`SpriteCharacterModel`), a state machine that only does a dip/glow overlay
rather than skeletal animation, an equipment manager that just repaints
sprite colours, and a 2D-canvas creation preview that explicitly avoids
WebGL. Generated PBR textures (body, chainmail, dice, weapons, faces) sit
mostly unused, applied only as flat 2D card/portrait icons rather than to
any 3D model. None of the required bone sockets exist. This is replaced
outright for the player path:

- **Rig.** A code-generated, rigged humanoid — `Bone` hierarchy
  (Hips → Spine → Spine2 → Neck → Head, and on each side
  Shoulder → Elbow → Hand, Hip → Knee → Ankle → Toe) with ~5K-triangle
  segmented meshes parented to bones, so every body part can carry its own
  material. Built procedurally (no external `.glb` dependency required to
  ship), but structured so real `.glb` bodies/weapons can be swapped in
  later without touching gameplay code.
- **Textures, per part, all applied to the actual 3D model (not just
  portrait cards):** skin (head/hands), linen underclothes (torso/limbs),
  chainmail torso/arms/legs with matching normal/roughness, leather
  boots/gauntlets/belt, the six face textures and hair meshes/textures used
  as portrait presets, and a helm variant. Reuse and re-tone the existing
  `body_albedo`, `armour_chainmail_albedo`, and `face_*` assets; generate
  any missing normal/roughness or hair maps procedurally so they match in
  style.
- **Real bone sockets**, replacing the current 2D `handL/handR` anchors:

  | Socket | Parent bone | Purpose |
  | --- | --- | --- |
  | `socket_mainhand` | RightHand | Primary weapon |
  | `socket_offhand` | LeftHand | Shield or secondary weapon |
  | `socket_back` | Spine2 | Stowed weapon (e.g. longbow while sword drawn) |
  | `socket_hip_left` | LeftUpLeg | Sheathed sword scabbard |
  | `socket_quiver` | RightShoulder | Arrow quiver |

  Per-item local position/rotation offsets live in `weapons.json` next to
  each item's socket assignment.
- **Armour and weapons as genuine separate 3D add-ons**, not palette swaps:
  chainmail as a material swap plus pauldron/helm meshes; Longsword,
  Battleaxe, Warhammer, Shield, Longbow, Quiver, and Shortsword (×2 for
  dual-wield) as individual low-poly textured meshes that attach and detach
  at the sockets above as equipment changes.
- **Animation set** (procedural keyframe clips, crossfaded through a real
  state machine, 0.2 s transitions):
  - Idle variants per weapon set: `idle_sword_shield`, `idle_two_hand`,
    `idle_dual_wield`, `idle_unarmed`.
  - Locomotion: `walk_forward`, `walk_backward`, `walk_strafe_L/R`,
    `run_forward` — blended by velocity magnitude and directional angle
    relative to facing, not swapped abruptly.
  - Preview/pose-only combat-flavoured clips (authored now, **never wired to
    hit detection, damage, AI, or encounters**): `attack_slash_1h`,
    `attack_thrust_1h`, `attack_slash_2h`, `attack_dual_L/R`,
    `attack_bow_draw`, `attack_bow_release`, `hit_react_front`,
    `dodge_roll`, `death`.
  - Gameplay-triggered clips: `second_wind` (knee-plant, fist to chest,
    golden glow, stand — replacing the current glow-only overlay),
    `long_rest_sit` (sit cross-legged, remove helmet, look at the fire),
    `interact` (kneel + reach, replacing the current 850 ms dip), and the
    creation-screen `flourish`.
  - The **weapon set currently equipped** selects which locomotion/idle
    sub-graph is active, exactly as in the state-machine diagram in the
    original brief; this is genuinely new — PR #37's state machine has no
    such branching today.
- **Rewire the supporting classes** — `PlayerCharacterController`,
  `SocketManager`, `EquipmentManager`, `CharacterModelLoader` — from sprite
  repaint logic to real socket attach/detach, animation-set switching, stat
  updates, and sheathe/draw transitions (0.5 s, moving items between
  `socket_mainhand`/`socket_back`/`socket_hip_left`/`socket_quiver` as the
  active weapon set changes).
- **Leave any non-player sprite/billboard actors untouched.** The existing
  procedurally painted sprite system (`FighterActor` and friends, plus the
  oxen/horse billboard actors described elsewhere in this README) is a
  legitimate, deliberate art choice for animals and any future NPCs — it is
  not being replaced. Only the **player** path moves to the skeletal rig.
- **Creation-screen preview** becomes a genuine real-time WebGL render of
  this rig inside the portrait arch (see System 2), not a 2D canvas
  turntable.

---

### System 4 — Ransacked Belongings / Narrator Interaction

Close to spec already; finish the remaining gaps:

- Swap the `interact` trigger from the current 2D dip to the real skeletal
  kneel-and-reach animation from System 3.
- Confirm and fully remove any remaining old pop-up/dialog inspect path for
  this interaction — pressing E must produce **only** narrator voice,
  bottom-centre cinematic subtitles, a camera move, and the particle
  accent below. No panel, no window.
- Camera: smooth 0.8 s ease-in-out dolly toward the saddlebags/map case at a
  slightly lower angle, then ease back to the standard follow-cam after
  narration ends (~4 s total), exactly as specced.
- Particle: a dust-motes-in-a-sunbeam effect over the saddlebags during the
  line. Resize the existing dust-mote/particle art down to true small
  sprite dimensions (the current 1 MB, ~64 px-intent PNGs are wildly
  oversized for what's actually rendered) and re-tune for the woodland
  sunbeam look.
- Preserve the "inspected" flag behaviour: re-approach after the first
  inspection gives the shorter "Nothing more of interest here" line with no
  camera move, never re-triggering the full sequence.
- `NarratorSystem`/`NarratorCamera`/`NarratorSubtitles` queueing and stall
  guards are solid — keep them, just reskin subtitles to the cinematic
  white-on-shadow treatment described in the Style Law rather than any
  boxed UI.

---

### System 5 — Camp and Rest

Logic (long/short rest math, cooldown, hidden ambush roll, perception
check, partial-rest healing, Poorly Rested debuff, floating text, dawn
toast) is already sound — the remaining work is cinematic and visual:

- **Skybox time-lapse.** `SkyboxManager` currently only fades and tweens a
  clock label. Build the actual spec'd night→dawn time-lapse using the
  existing `sky_dusk/night/dawn` textures (and `forest.hdr` if applicable):
  stars and dark blue at night, warm orange at dawn, with a translucent
  clock/moon-phase graphic sliding across the screen as time passes, and a
  brief soft-black fade at the transition point.
- **Camera.** Add a real slow orbit of the campfire during the rest
  cinematic rather than a static shot, resuming the standard follow-cam on
  wake.
- **Camp menu.** Rebuild `CampMenu`/`systems.css` as a woodland-styled
  overlay — the 3D campfire scene stays visible behind it, not a full-screen
  opaque takeover — containing:
  - **Long Rest** card: preview of HP change, Second Wind refresh, and
    Inspiration grant before committing, a **REST UNTIL DAWN** button, and
    the already-rested/cooldown state greyed out with an explanatory
    tooltip when a long rest was taken within the last 24 in-game hours.
  - **Short Rest** card: available Hit Dice, potential healing formula
    (1d10 + CON mod), a **SPEND** button that triggers the real 3D d10 roll
    via `DiceRoller`, and its own Second Wind refresh.
  - **COOK**, present but locked with a lock icon and a "Coming soon —
    combine rations and foraged ingredients for temporary buffs" tooltip.
  - Links through to inventory and the character sheet, plus **BREAK CAMP**.
- **First-visit narrator line** on approaching the campfire ("The road
  ahead is long, and the shadows grow deeper…"), then the `[E] Set Up Camp`
  moon-icon HUD prompt.
- **Ambush event**, using `DiceRoller`'s hidden-roll mode: 10% chance
  (natural 1–2 on a d20) to interrupt the long rest at its midpoint. On
  trigger — narrator line, player snaps awake, only 50% of missing HP is
  restored and abilities are **not** refreshed, a visible perception check
  is rolled through the normal dice overlay to flag surprise/alertness for
  future encounters, a retreat narrator line, then the rest resumes and
  full benefits apply on top of the partial heal, with a **Poorly Rested**
  debuff (−1 Perception for 1 in-game hour) applied as the video-game-y
  consequence. This does **not** initiate combat.
- **Wake sequence.** Floating green `+N HP` numbers, Hit Die recovery
  (minimum 1, i.e. always recovered at current character level), Second
  Wind reset, Heroic Inspiration re-grant with a HUD star chime, cleared
  temporary conditions, the "Dawn breaks" narrator line, and the player
  standing back up out of `long_rest_sit` into the idle state for their
  currently equipped weapon set.
- **Ambient audio.** Campfire crackle loop under the whole sequence,
  crickets/owl at night fading into dawn birds at the transition.
- **HUD integration.** Fold HP globe, Second Wind cooldown icon, and
  Inspiration star into the game's existing topbar/world-tools chrome —
  replacing PR #37's separate purple `hero-plate` pill — with plain-language
  tooltips on each.

---

### Cross-cutting requirements for all five systems

- **Performance.** Keep total scene triangle count under 500K, VRAM texture
  budget ≤128 MB, LOD/distance culling wherever it already exists elsewhere
  in the game, and dispose every physics/overlay scene when not in use — no
  persistent dice or rest physics world. Target 60 fps on mid-range
  hardware, matching the game's existing quality-tier system (Performance /
  Balanced / High fidelity).
- **Accessibility.** Every narrator voice line keeps subtitle text. Dice
  results are always shown numerically, not only physically. UI keeps
  sufficient contrast against the woodland palette. Keybinds stay visible.
  Reduced-motion paths are preserved for the dice overlay and any new
  camera moves.
- **No combat.** Attack, bow-draw/release, hit-react, dodge, and death
  animations are authored and previewable on the skeletal rig but are never
  wired to hit detection, damage calculation, enemy AI, or an encounter
  system. That remains explicitly future work.
- **Data model.** The player character record (species/class/background,
  ability scores with rank names, HP, AC, proficiencies, fighting style,
  features, origin/background feats, equipment, personality, portrait
  preset) is the single source of truth threaded from character creation
  through the skeletal model, the HUD, and the rest system — no duplicated
  or drifting copies of derived stats.
- **Tests.** Update `tests/dice.test.ts` and the character/animation/rest/
  save-character suites to the new skeletal-rig and state-machine
  expectations, and update `scripts/browser-smoke.mjs` to cover the rebuilt
  creation flow, camp menu, and narrator-only interaction path.

### Suggested build order

1. **Theme + asset reconciliation** — unify CSS variables, retire the
   dark-slate/Cinzel styling, re-grade and compress art, fix overlay
   z-order. Do this first so every later system lands on the right look
   immediately instead of needing a second pass.
2. **Dice** — re-skin and re-material, since every other system depends on
   `DiceRoller`.
3. **Character creation** — layout rebuild, sub-panel completion, live 3D
   preview wiring.
4. **Skeletal hero** — the rig, textures, sockets, and animation state
   machine; this unblocks the creation-screen live preview and every
   equipment-dependent visual.
5. **Narrator / ransacked belongings** — animation swap, camera polish,
   particle resize.
6. **Camp / rest** — cinematic skybox, camera orbit, menu reskin, ambush
   event, HUD integration.

No work should be considered "done" for a system until it matches this
section in full **and** reads, visually, as though it always belonged in
this game's original woodland presentation.
