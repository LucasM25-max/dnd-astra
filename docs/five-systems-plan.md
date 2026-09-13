# Astra — Five-Systems Architectural Plan (PLAN ONLY, no implementation)

> **SUPERSEDED (Sept 2026).** This plan targets the pre-Phase-B codebase
> (16-direction sprite billboards, no skeletal rig, no character-creation
> screen). The roadmap it planned has since been built: the five systems are
> implemented in `src/`, the hero is a skeletal rig
> (`src/character/skeletal/`), and character creation is a full three-part
> screen (`src/ui/creation/`). **README.md — "Roadmap: Completing Systems 1–5
> to Their Full Vision (Post–PR #37)" is the authoritative specification.**
> Keep this file only as historical context.

> **Status: PLAN — do not implement from the prompt verbatim.**
> This document is the file-by-file architectural plan for the five video-game systems
> (Dice, Character Creation, Player Character, Ransacked-Belongings Narration, Long Rest),
> grounded in the **actual** `dnd-astra` codebase as of `main @ a011e1a`
> (Three.js 0.180 + TypeScript strict + Vite 7, Node 22, no physics engine, no GLB pipeline,
> 2.5D canvas-sprite actors, single-`Audio`-element Narrator, `GameClock`, `InventoryStore v1`).
> All paths below are relative to the repo root. All new code is **TypeScript (`.ts`)**,
> not `.js` — matching `tsconfig.json` (`strict`, `noUnusedLocals`, `bundler` resolution).

---

## 0. Where the repo is today (what the plan builds on)

| Area | Current implementation | Relevance to plan |
|---|---|---|
| Entry | `src/main.ts` → `renderShell()` → `WoodlandWorld` + `WorldInterface`; `window.__astra` diagnostics in DEV | Insert `CHARACTER_CREATION` state before `beginAdventure()`; extend diagnostics |
| World loop | `src/engine/world.ts` `WoodlandWorld`: renderer + `EffectComposer` (Render/ Bloom/ Output/ film-grain `ShaderPass`), `Sky`, sun/hemi/fill, dust `Points`, light shafts, `WeatherEngine`, manual shadow updates, quality tiers | Dice overlay reuses renderer; rest cinematic drives `Sky`/fog/weather instead of HDR swap; quality tiers must cover new scenes |
| Player | `src/engine/controller.ts` `PlayerController` (foot/wagon/cinematic, first/third, `cameraOverride`, collision resolve) + `src/engine/actors/fighter.ts` `FighterActor` (procedural canvas sprite sheet: 16 dirs × idle/walk/sprint/seated + derived normal atlas, billboard `SpriteActor`) | **No skeletal rig exists.** System 3 must bridge sprites → future GLB; do not assume `base_male.glb` exists |
| Chapter | `src/engine/adventure.ts` `Adventure`: wagon cinematic tied to `narrator.journeyProgress`, handoff, drive/mount, cargo reach checks, horse wander, autosave | Campfire + ransacked interactions plug into `interaction()`/`AdventureState`; camp menu coexists with wagon/cargo |
| Narrator | `src/game/narrator.ts` `Narrator`: one `Audio` element owns timeline, `manifest.json` durations, timed-subtitle fallback, `pauseReasons`, phases `title/journey/arrival/exploration`, 6 MP3 clips | System 4 extends — does not replace — this; new clips reuse manifest + fallback + pause ownership |
| Clock | `src/game/time.ts` `GameClock`: Calendar of Harptos, Ches 15 14:30, 1 min / 5 s, `restUntilMorning()`, sun math, seasonal weather tables | Rest system adds `epochMinutes`-based 24 h cooldown, `advanceHours()`, debuff expiry |
| Save | `src/game/save.ts` `InventoryStore`, key `astra-journey-v1`, version 1, conservation validator, `recoveredInvalidSave` | Character + rest + inspected flags require **save v2 + migration** (see §6) |
| UI | `src/ui/shell.ts` static HUD, `src/ui/interface.ts` dialogs (settings/map/help/pause/inspect), `src/ui/adventure-interface.ts` inventory/cargo/journal + E/R/I/N/M/H/P bindings, `src/ui/cartography.ts` minimap | Dice overlay, char-creation screen, camp menu, cinematic subtitles are new UI roots; HUD gains HP/Inspiration/Second-Wind |
| Audio | `src/engine/audio.ts` `ForestAudio`, `src/game/music.ts` `DramaticScore`, `public/audio/narration/*.mp3` + `manifest.json` | New SFX/ambience/narration follow same `public/audio/` + manifest conventions |
| Assets | `assets-source/*.jpg` → `public/textures/*.webp` (+ `*-normal.webp`) via `scripts/prepare-*.mjs` (`sharp`); `public/environment/forest.hdr`; Fontsource Cormorant Garamond + Manrope; `lucide` icons | New textures author as PNG, **build to `.webp`** via extended scripts; keep photographic-grain sprite pipeline |
| Tests | `vitest run` (73 checks), `scripts/browser-smoke.mjs` (Playwright + `@sparticuz/chromium`) | Each phase adds deterministic unit tests + smoke assertions (see §8) |

**Key deltas vs. the raw prompt:** (1) prompt assumes `.js` + existing physics + GLB rig — none exist;
(2) prompt assumes pop-up-free greenfield UI — repo has dialogs + narrator panel to integrate with;
(3) prompt assumes HDR skybox swap — repo uses procedural `Sky` + `WeatherEngine`;
(4) prompt assumes dead horses — repo has **two living horses** sniffing ransacked belongings by design.

---

## 1. Global architecture (proposed)

### 1.1 State machine (new)

```
MAIN_MENU ── Begin/Continue ──▶ CHARACTER_CREATION (new players only)
     │                                  │ FORGE YOUR LEGEND (seal + save v2)
     │                                  ▼
     └──────────────▶ GAMEPLAY ◀──▶ CAMP (camp menu overlay)
                           │  ▲
                           ▼  │ dismiss
                        CINEMATIC (dice overlay | narration dolly | rest time-lapse)
```

- New: `src/game/state.ts` `GameStateManager` — single owner of the five states above.
  Replaces today's implicit state (`Narrator.phase` + `controller.started/paused/mounted`).
  Emits `onChange`; `WoodlandWorld.setPaused`, `Narrator.setPaused(reason)`, `GameClock` freeze,
  and UI roots all subscribe. States `CINEMATIC`/`CAMP`/`CHARACTER_CREATION` freeze player input
  (via `PlayerController.setControlMode('cinematic')` + `cameraOverride`) and pause autosave.
- `GAMEPLAY` subsumes today's journey/arrival/exploration; `Narrator.phase` remains the story
  cursor *inside* `GAMEPLAY`, untouched.

### 1.2 Proposed tree (new files marked `+`, modified `~`)

```text
src/
  main.ts                                        ~
  game/
    state.ts                     + GameStateManager (MAIN_MENU/CHARACTER_CREATION/GAMEPLAY/CAMP/CINEMATIC)
    time.ts                      ~ + advanceHours(), hoursSince(epoch), debuff helpers (no behaviour change otherwise)
    save.ts                      ~ save v2: character/rest/inspected/campfire + migrateV1toV2()
    narrator.ts                  ~ + queueClip() hook for one-shot VO (no timeline ownership change)
    character.ts                 + PlayerCharacter types, modifiers, proficiency, AC/HP derivations (pure, tested)
  systems/
    dice/
      DiceRoller.ts              + public API: roll()/rollHidden()
      DicePhysicsScene.ts        + isolated Scene + cannon-es world, rendered on demand
      DieMeshFactory.ts          + d20/d12/d10/d8/d6/d4 geometry + UV + face-up quaternions
      DiceResultResolver.ts      + crypto.getRandomValues + target-quaternion map
      DiceOverlayUI.ts           + backdrop, badge, total, banner, focus trap
      DiceAnimationController.ts + slam/pulse/banner tweens (prefers-reduced-motion aware)
      dice.css                   + Astra dice theme tokens
    narration/
      NarratorSystem.ts          + narrate(clipId, subtitle, cameraTarget?, duration?) — wraps Narrator
      NarratorSubtitles.ts       + cinematic bottom-centre subtitles (distinct from narrator-panel)
      NarratorCamera.ts          + dolly-to-target-and-back via cameraOverride
    rest/
      RestSystem.ts              + initiateRest('short'|'long')
      CampfireInteraction.ts     + world object: prompt, radius, inspected/first-time flags
      CampMenu.ts                + MAKE CAMP overlay (long/short/inventory/sheet/break)
      RestCinematic.ts           + sit + orbit + Sky time-lapse + fade
      RestResolver.ts            + healing/resets/cooldown/ambush/debuff (pure, tested)
      ShortRestUI.ts             + Hit-Die spend row + dice integration
      rest-config.json           + ambush %, cooldown h, cinematic timings, formulas
    interaction/
      InteractionManager.ts      + proximity + E-key registry (extracted from Adventure.interaction())
      interactions/
        RansackedBelongingsInteraction.ts + (System 4, replaces inspect-dialog path)
        CampfireInteraction.ts            + re-export from rest/ (single owner stays in rest/)
  character/
    PlayerCharacterController.ts + input→velocity→animation-state; owns FighterActor|GLBModel via interface
    CharacterModel.ts            + interface: setPortrait(), setEquipment(), playAnimation(), anchors
    SpriteCharacterModel.ts      + v1 adapter: FighterActor + equipment-variant repaint + anchors
    GlbCharacterModel.ts         + v2 stub: GLB + sockets (loads only when assets ship; see §4)
    CharacterModelLoader.ts      + portrait/face/hair application, cache
    EquipmentManager.ts          + equipped items, swap logic, socket/anchor attach, stats sync
    AnimationStateMachine.ts     + locomotion blend + interact/second_wind/long_rest_sit + weapon-set sub-graphs
    SocketManager.ts             + bone sockets (v2) + sprite anchors (v1) with per-item offsets
  ui/
    character-creation/
      CharacterCreationScreen.ts + master flow controller + validation gate
      ClassPanel.ts              + Fighter drawer
      SpeciesPanel.ts            + Human drawer + point-buy host
      BackgroundPanel.ts         + Soldier drawer
      AbilityScoreAllocator.ts   + 27-pt buy, rank names, modifier explainers
      SkillPicker.ts             + reusable card grid (max-N enforcement)
      FeatPicker.ts              + Origin feat cards
      FightingStylePicker.ts     + style cards + 3D/sprite preview trigger
      EquipmentLoadout.ts        + paper-doll + weapon selector + live preview
      PersonalityPicker.ts       + trait/ideal/bond/flaw randomiser (crypto-backed)
      PortraitSelector.ts        + 6 presets (sprite repaint params in v1; head-mesh swap in v2)
      CharacterSummary.ts        + parchment review + seal VFX trigger
      CharCreationBackground.ts  + lightweight dusk-pan scene (NOT full WoodlandWorld)
      character-creation.css     + Astra gold/iron/parchment theme
    camp/                        + (re-export CampMenu/ShortRestUI roots; styles live in systems/rest/*.css)
    HUD.ts                       ~ extend: HP globe, Inspiration star, Second Wind pip, Poorly-Rested icon
  world/
    SkyboxManager.ts             + thin wrapper over Sky+fog+WeatherEngine for time-lapse blending
    ParticleEffects.ts           + dustBurst(), emberLoop(), healingSparkles() (instanced Points pools)
  data/
    classes/fighter.json         + L1 HP/profs/features/styles/equipment options
    species/human.json           + traits/speed/size/feat options/languages
    backgrounds/soldier.json     + ASI/skills/tools/gold/feat/personality tables
    feats/origin-feats.json      + Alert/Tough/Savage Attacker
    equipment/weapons.json       + damage/properties/model+texture refs/socket+offsets/animSet
    equipment/armour.json        + AC/stealth/weight/texture refs
    equipment/packs.json         + Explorer's Pack contents
    rest/rest-config.json        + (same file as systems/rest/rest-config.json — single copy in data/)
  engine/
    world.ts                     ~ pause/dim hooks, cinematic camera handoff, particle pools
    adventure.ts                 ~ delegate E to InteractionManager; add campfire prop + colliders
    controller.ts                ~ + playOneShot() for interact/sit; expose seat/focus anchors
    props.ts                     ~ + campfire prop builder (stone ring + logs + fire light)
    landscape.ts                 ~ + campfire clearing flatten spot (query terrainHeight; no map redraw)
public/
  audio/
    sfx/dice/*.ogg               + throw/bounce×4/land/slam/success/failure
    sfx/ui/*.ogg                 + seal-hammer, card-select, rest-chime
    narration/*.mp3              + ransacked_belongings, nothing_of_interest, rest_while_you_can,
                                   dawn_breaks, something_stirs, well_rested_already, retreated_for_now
    ambient/*.ogg                + campfire_crackle (loop), night_crickets (loop), dawn_birds (loop)
  textures/
    dice/*.{webp}                + built from authored PNGs (albedo/normal/roughness per die)
    character/*.{webp}           + body/chainmail/faces/hair (v1 sprite palettes + v2 PBR sets)
    weapons/*.{webp}             + per-weapon PBR sets
    campfire_ember.webp, dust_mote.webp, campfire_smoke.webp, healing_sparkle.webp
  models/                        + RESERVED for v2 GLBs (not shipped in Phase 1–5; see §4.6)
assets-source/dice|character|weapons/*.png  + authored sources (built via scripts/)
scripts/prepare-dice-assets.mjs  + dice/character/weapon texture build (sharp → webp + normals)
docs/five-systems-plan.md        + this file
tests/
  dice.test.ts, character.test.ts, rest.test.ts, narration-cinematic.test.ts + deterministic checks
```

**Modified-file discipline:** `world.ts`/`adventure.ts`/`controller.ts`/`narrator.ts`/`time.ts`/
`save.ts`/`interface.ts` gain narrow hooks only; no rewrites. New logic lives in new files.

---

## 2. SYSTEM 1 — 3D dice rolls (BG3-style)

**Depends on:** nothing. **Blocks:** Systems 2 (Hit-Die rerolls rearranged — actually point-buy, no rolls;
still blocks rest healing + future skill checks + ambush perception).

### 2.1 Decisions (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Physics | **`cannon-es`** (new dep, ~100 kB, pure TS, no WASM) | Repo has **no** physics. `cannon-es` is the lightest Three-friendly option; `rapier` adds WASM + async init; `ammo.js` is deprecated/heavy. ≤3 bodies (die + glass plane + 1–2 walls) is trivial for it |
| Randomness | **`crypto.getRandomValues`** only; `Math.random` banned in dice paths (lint + test) | Spec requirement; `time.ts pickWeather` keeps `Math.random` default — dice never touches it |
| Render strategy | **Same renderer, second `Scene`**, rendered after main with `autoClear:false` + CSS dim backdrop; created per-roll, disposed after | Avoids second WebGL context (context-loss risk) and offscreen-target VRAM; works with existing `EffectComposer` (dice pass renders outside composer, then composer state restored) |
| Guidance | Pre-determined face → target quaternion; gentle `slerp` blend in last ~0.3 s while physics continues | Looks physical, guarantees fairness; snap hidden by motion blur of tumble + bounce SFX |
| Motion safety | `prefers-reduced-motion` → skip tumble, crossfade to result | Matches existing film-grain reduced-motion check in `world.ts` |

### 2.2 Files & responsibilities

- `src/systems/dice/DiceRoller.ts` — **single entry point.** `roll(die, modifier, label, dc?)`,
  `rollHidden(sides)` (no overlay, for ambush %). Owns overlay lifecycle + pause/dim + return promise.
- `src/systems/dice/DicePhysicsScene.ts` — builds/disposes `cannon-es` world (`gravity −9.82`,
  glass plane + 2 walls, die sphere-or-convex body), steps at fixed 1/120 s, syncs mesh.
- `src/systems/dice/DieMeshFactory.ts` — `create(dieType)`, `getFaceUpQuaternion(die, value)`.
  Geometries: `IcosahedronGeometry` (d20), `DodecahedronGeometry` (d12), custom pentagonal
  trapezohedron (d10 — build via `BufferGeometry`, computed normals), `OctahedronGeometry` (d8),
  `BoxGeometry` (d6), `TetrahedronGeometry` (d4). UVs map per-face numbers from the atlas;
  d4 reads the **bottom-adjacent** convention (document in factory; resolver handles).
- `src/systems/dice/DiceResultResolver.ts` — `cryptoRandomInt(min,max)` via
  `crypto.getRandomValues(new Uint32Array(1))` with rejection sampling (no modulo bias);
  `targetQuaternionFor(die, value)` table (precomputed at build/test time, verified by test).
- `src/systems/dice/DiceOverlayUI.ts` — DOM: `#dice-overlay` backdrop (dim + blur),
  canvas host, label/DC line, natural number, modifier badge, total, SUCCESS/FAILURE banner,
  dismiss affordance. Focus trap + `role="alertdialog"` + live region for SR.
- `src/systems/dice/DiceAnimationController.ts` — WAAPI/CSS tweens: badge slam (translate+scale+thud),
  total pulse, banner entrance (green glow / red crack via CSS filter + SVG overlay). All timings
  centralised for reduced-motion override.
- `src/systems/dice/dice.css` — Astra tokens (see §7).

### 2.3 Data structures

```ts
// DiceRoller.ts
export type DieType = 20 | 12 | 10 | 8 | 6 | 4;
export interface DiceRollRequest { die: DieType; modifier: number; label: string; dc?: number | null; advantage?: 'adv'|'dis'|null }
export interface DiceRollResult { natural: number; modifier: number; total: number; success: boolean | null; label: string; dc: number | null }
// DicePhysicsScene.ts
export interface TossParams { impulse: THREE.Vector3; torque: THREE.Vector3; origin: THREE.Vector3 }
// DieMeshFactory.ts
export interface DieMesh { group: THREE.Group; bodyRadius: number; faceUp: Map<number, THREE.Quaternion> }
```

`advantage` is accepted but **unused until combat** — resolver implements it now (roll twice, take
higher/lower, show both dice) so future callers need no changes. Keep scope: single-die overlay in
Phase 1; dual-die layout ships only when a caller passes `advantage`.

### 2.4 Pseudocode (public flow)

```ts
// DiceRoller.ts
export async function roll(req: DiceRollRequest): Promise<DiceRollResult> {
  const natural = DiceResultResolver.cryptoRandomInt(1, req.die);   // 1. true random FIRST
  const total = natural + req.modifier;
  const success = req.dc == null ? null : total >= req.dc;
  const targetQuat = DieMeshFactory.getFaceUpQuaternion(req.die, natural); // 2.

  GameStateManager.enter('CINEMATIC', 'dice');                       // 3. pause world+clock+audio-duck
  DiceOverlayUI.show({ label: req.label, dc: req.dc ?? null });      //    dim via CSS class on #experience

  const scene = new DicePhysicsScene(renderer);                      // 4.
  const die = DieMeshFactory.create(req.die);
  scene.spawn(die, randomToss());                                    // crypto-backed toss params
  scene.guideTo(targetQuat, { beginAt: 1.2, strength: 0.0 → 1.0 }); // 5. last-0.3 s slerp blend
  await scene.untilSettled({ timeoutMs: 2600 });                     // settle = low lin/ang velocity × 200 ms

  DiceOverlayUI.showResult({ natural, modifier: req.modifier, total, success }); // 6. number→badge→total→banner
  await DiceOverlayUI.waitForDismiss({ timeoutMs: 2500 });           // 7. click/key/Esc/timeout

  scene.dispose(); DiceOverlayUI.hide();
  GameStateManager.exit('CINEMATIC', 'dice');
  return { natural, modifier: req.modifier, total, success, label: req.label, dc: req.dc ?? null };
}
export function rollHidden(sides: DieType): number {
  return DiceResultResolver.cryptoRandomInt(1, sides);               // no overlay, no state change
}
```

Pause/dim detail: `GameStateManager.enter('CINEMATIC')` calls existing
`world.setPaused(true)` (which already pauses controller + narrator + autosave) **plus**
`music.setPaused(true)` duck and a `#experience[data-cinematic="dice"]` CSS hook that dims
`#world` and blurs HUD. Dice canvas is a **separate absolutely-positioned `<canvas>`** sharing the
same `WebGLRenderer`? No — same renderer cannot target two canvases. Correct approach: render dice
`Scene` into the **same canvas** after the main composer pass, with `renderer.autoClear=false` +
`renderer.clearDepth()` + dice camera, while the CSS backdrop dims the already-presented frame
*behind* a transparent clear? That double-exposes. **Chosen approach:** dice overlay uses its own
**second `WebGLRenderer` on its own canvas** (small viewport, 1 draw call, created per-roll and
disposed). Context-loss risk is negligible for a transient 4 s context; main context is untouched.
Document this explicitly; do NOT attempt single-canvas compositing.

Settle detection: poll `body.velocity.length() < 0.08 && body.angularVelocity.length() < 0.5`
for 200 ms; hard timeout 2.6 s → snap to target quaternion with a 120 ms ease (masked by land SFX).

### 2.5 Assets

| Asset | Spec | Notes |
|---|---|---|
| `assets-source/dice/d20_albedo.png` 1024² | ivory faces, gold-engraved 1–20, Astra dragon watermark on 20 | Built → `public/textures/dice/d20_albedo.webp` + derived `_normal/_roughness` via `prepare-dice-assets.mjs` |
| `d12/d10/d8/d6/d4 _albedo.png` 512² (d12 1024²) | same style; d6 uses numerals (not pips) for readability at distance | Same build |
| SFX `dice_throw/bounce_01–04/land/slam/success/failure.ogg` | 44.1 kHz, <150 KB each, normalised −14 LUFS | `public/audio/sfx/dice/`; no manifest needed (direct URLs) |

### 2.6 Tests & perf

- `tests/dice.test.ts`: crypto distribution sanity (χ² loose bound, 20 k samples, seeded mock of
  `getRandomValues` rejected — test the rejection sampler with a stubbed entropy source, never
  `Math.random`); face-up quaternion table: for each die × value, top-face normal ≈ +Y within 2°;
  `rollHidden` range check; advantage/disadvantage pure-logic check.
- Perf: ≤3 bodies, 1 dir light + 1 hemi in dice scene, 1 k triangles; renderer + geometry + textures
  disposed in `finally`; VRAM delta 0 after dismiss (assert via `renderer.info.memory` in DEV smoke).

---

## 3. SYSTEM 2 — Character creation (D&D Beyond layout × Astra theme)

**Depends on:** System 1 (Second-Wind preview text only — no rolls needed at creation; point-buy is
deterministic), `GameStateManager`, save v2. **Blocks:** first gameplay (creation gates `GAMEPLAY`
for new players).

### 3.1 Flow & gating

- `#enter-world` ("Begin your journey") today calls `world.beginAdventure()` directly.
  New: if `InventoryStore` has **no v2 character record** → `GameStateManager.enter('CHARACTER_CREATION')`,
  which hides `#world` + HUD (`#experience[data-state="character-creation"]`) and mounts
  `CharacterCreationScreen` into a new `#char-creation` root. Full `WoodlandWorld` stays
  **uninitialised** (or initialised lazily after creation) — creation background is the lightweight
  scene in §3.4. "Continue your journey" (v2 save present) skips creation entirely.
- `FORGE YOUR LEGEND` disabled until: class configured (2 skills + fighting style + loadout) +
  species configured (27-pt buy spent exactly? — see §3.3 — + language + `Skillful` skill + origin feat) +
  background configured (★/★★ allocated + personality optional-but-defaulted) + name non-empty
  (trimmed, 2–24 chars, profanity pass = trim-only; no blocklist in Phase 1).
- On forge: hammer-strike VFX/SFX → wax seal → `save.ts` writes v2 character → transition to
  `GAMEPLAY` (existing wagon opening plays unchanged).

### 3.2 Layout (65/35 + drawer), component hierarchy

```
CharacterCreationScreen (#char-creation)
├─ CharCreationBackground (canvas, dusk pan, aria-hidden)
├─ .cc-left (65%)
│  ├─ ClassCard     [banner fighter, CHOOSE, flavour, SEE OPTIONS] → ClassPanel (drawer)
│  ├─ SpeciesCard   [banner human,  CHOOSE, flavour, SEE OPTIONS] → SpeciesPanel (drawer)
│  └─ BackgroundCard[ banner soldier … ]                            → BackgroundPanel (drawer)
│  Drawer (right slide-over, focus-trapped, Esc closes, progress ticks on cards)
├─ .cc-right (35%)
│  ├─ PortraitArch (live preview canvas/img + CHOOSE PORTRAIT → PortraitSelector grid)
│  ├─ NameInput + SuggestedNames (Aldric/Maren/Theron/Sylva/Kael)
│  └─ ForgeButton (FORGE YOUR LEGEND; disabled-reason tooltip)
└─ CharacterSummary (parchment overlay; opened from ForgeButton pre-confirm; final confirm forges)
```

Only one option per category exists (Fighter/Human/Soldier) — drawers **auto-select** on open and
focus on *configuration within* the option, per spec. Cards show ✓ + summary line once configured.

### 3.3 Sub-panel specifications

**A. `ClassPanel.ts` (Fighter L1, XPHB video-game-ified)**

1. HP row: `10 + CON mod` live from allocator; Diablo-style globe (SVG) + "Rest at campfires to restore it."
2. Proficiencies (display): armour/weapon/save icons with ✓; **skill grid** (`SkillPicker`, max 2 of
   Acrobatics/Animal Handling/Athletics/History/Insight/Intimidation/Perception/Survival), each card:
   icon (lucide), name, governing ability, one-line "in-game this means…" string from `fighter.json`.
   Tap toggles; at max, unselected grey out with tooltip.
3. `FightingStylePicker` (choose 1 of Defense/Dueling/Great Weapon Fighting/Two-Weapon Fighting):
   horizontal cards + floating preview glyph; selection triggers preview flourish on the portrait model
   (v1: sprite pose variant; v2: 0.8 s GLB clip) + gold pulse.
4. Second Wind display card: MMO-style circular cooldown icon, "1d10+1, recharges at campfire".
5. `EquipmentLoadout.ts` paper-doll: Primary (Longsword/Battleaxe/Warhammer — 2D turntable in v1
   via pre-rendered sprite angles? **No** — v1 shows large icon + stat block; 3D rotate ships with v2
   GLBs; do not fake 3D), Off-hand (Shield +2 AC default; dual shortswords auto-suggested iff
   Two-Weapon Fighting), Ranged (Longbow + 20 auto), Armour (Chain Mail AC 16 + Stealth-disadvantage
   callout), Explorer's Pack (hoverable contents from `packs.json`). Every change repaints preview.

**B. `SpeciesPanel.ts` (Human, XPHB 2024)**

1. `AbilityScoreAllocator`: base 8 all; **27-pt buy** (8→14 @1/pt, 14→15 @2; max 15 pre-modifier);
   +/− buttons, live points-remaining, rank names (8 Feeble / 9–10 Average-ish scale — full table in
   `human.json`: 8 Feeble, 9 Frail, 10 Average, 11 Steady, 12 Capable, 13 Sharp, 14 Exceptional,
   15 Heroic), big modifier (`⌊(total−10)/2⌋`), gameplay explainer per stat, **Recommended Build**
   (STR 15 / DEX 12 / CON 14 / INT 8 / WIS 13 / CHA 10) with rationale line. Points must equal 0
   remaining to confirm? **No** — allow unspent (confirm warns "3 points unspent — Forge anyway?").
   Min 8 / max 15 enforced per stat.
2. Size Medium (display). 3. Speed 30 ft → "Sprint with Shift 1.5× for 6 s (30 s cooldown)" —
   **flag:** current sprint has no cooldown; cooldown ships with System 3 controller work or the
   text is cut to "Sprint with Shift" (decide in implementation plan review; default: cut cooldown
   claim, file follow-up).
4. Language dropdown (Common fixed + 1 of Dwarvish/Elvish/Goblin/Orc/Halfling; recommend Goblin with reason).
5. Traits: Resourceful (Inspiration charge — HUD star), Skillful (`SkillPicker` max 1, excluding the
   2 class picks), Versatile (→ `FeatPicker`).
6. `FeatPicker` (choose 1 Origin feat: Alert/Tough/Savage Attacker; recommend Tough new / Alert
   experienced; **duplicate guard** vs Soldier's auto-granted Savage Attacker — see C.5).

**C. `BackgroundPanel.ts` (Soldier, XPHB 2024)**

1. ASI: ★★ + ★ drag (with click-click fallback + keyboard: focus token, Enter, focus stat, Enter)
   onto STR/DEX/CON; recommended +2 STR/+1 CON. Totals flow into allocator display + `character.ts`
   derivations. 2. Athletics + Intimidation auto ✓. 3. Vehicles (land) flavour line. 4. 18 gp pouch.
   5. Background feat Savage Attacker auto; if origin feat == Savage Attacker → inline prompt to pick
   a different origin feat (FeatPicker reopens; confirm blocked until distinct).
   6. `PersonalityPicker`: trait/ideal/bond/flaw — 6 options each from `soldier.json`, pick or
   crypto-`Randomise`; surfaced later in dialogue tooltips (consumers: future; storage: v2 save).

### 3.4 `CharCreationBackground.ts`

Lightweight standalone `Scene`: gradient dusk sky (reuse `Sky` with fixed sun azimuth/elevation —
no `WeatherEngine`, no forest instancing), fog, 2–3 silhouette billboard planes (treeline alpha
textures, cheap), slow orbital camera (12 s loop, `prefers-reduced-motion` → static frame).
Budget: <5 k tris, no shadows, no composer. Disposed on transition to gameplay.

### 3.5 Data files (JSON + TS types + validation)

```ts
// src/game/character.ts (new) — single source of TS types for all three JSONs + derivations
export interface AbilityScores { STR: AbilityScore; DEX: AbilityScore; INT: AbilityScore; WIS: AbilityScore; CHA: AbilityScore; CON: AbilityScore }
export interface AbilityScore { base: number; backgroundBonus: 0|1|2; total: number; modifier: number } // racialBonus: none in XPHB'24 human — OMIT field (prompt's racialBonus is wrong for 2024 rules)
export interface PlayerCharacter { name: string; species: 'Human'; class: 'Fighter'; level: 1; background: 'Soldier';
  abilityScores: AbilityScores; hp: { max: number; current: number }; hitDice: { max: 1; current: 1; die: 10 };
  ac: number; speed: 30; proficiencyBonus: 2;
  proficiencies: { armour: string[]; weapons: string[]; savingThrows: ('STR'|'CON')[]; skills: string[]; tools: string[]; languages: string[] };
  fightingStyle: 'Defense'|'Dueling'|'Great Weapon Fighting'|'Two-Weapon Fighting';
  features: { secondWind: { usesMax: 1; usesCurrent: 1; healDie: 10; healBonus: 1 }; heroicInspiration: { available: boolean } };
  originFeat: 'Alert'|'Tough'|'Savage Attacker'; backgroundFeat: 'Savage Attacker';
  equipment: { mainHand: string; offHand: string|null; ranged: 'longbow'; ammo: { arrows: number }; armour: 'chain_mail'; pack: 'explorer'; gold: number };
  personality: { trait: string; ideal: string; bond: string; flaw: string };
  portrait: { preset: 'male_01'|'male_02'|'male_03'|'female_01'|'female_02'|'female_03' } }
export const abilityModifier = (total: number) => Math.floor((total - 10) / 2);
export const maxHP_L1 = (c: Pick<PlayerCharacter,'abilityScores'|'originFeat'>) =>
  10 + abilityModifier(c.abilityScores.CON.total) + (c.originFeat === 'Tough' ? 2 : 0);
export const armourClass = (c: Pick<PlayerCharacter,'equipment'|'fightingStyle'>) =>
  16 + (c.equipment.offHand === 'shield' ? 2 : 0) + (c.fightingStyle === 'Defense' ? 1 : 0);
```

- `fighter.json` / `human.json` / `soldier.json` / `origin-feats.json` / `weapons.json` /
  `armour.json` / `packs.json`: author in `src/data/`, imported as JSON modules (repo already uses
  `resolveJsonModule`), validated at load by `character.ts` guards (same style as `save.ts`
  `validateSave`), unit-tested (point-buy table, recommended build legality, feat uniqueness,
  equipment IDs resolve).
- Prompt's example `hp.max 12 / ac 18` is correct **only** for CON mod +2, shield, non-Defense —
  derivations above replace hard-coded numbers everywhere.

### 3.6 Portrait presets (v1 vs v2)

- v1 (ships): 6 presets = **parameter sets** for the procedural `FighterActor` painter
  (`skinTone`, `hairStyle/colour`, `jawWidth`, `helmOn/Off`) + `face_*` mini-textures only for the
  arch frame thumbnail. No new meshes. `PortraitSelector` grid shows thumbnails; selection repaints
  the arch preview sprite (debounced 60 ms) and stores `portrait.preset`.
- v2 (GLB era): presets map to head-mesh + `face_*.png` + hair-GLB swaps (see §4.6).

### 3.7 Summary & forge

`CharacterSummary.ts`: parchment overlay, full sheet (stats/skills/equipment/features/personality),
model flourish (v1: 1.2 s sprite zoom + sheen sweep; v2: weapon flourish clip), **FORGE YOUR LEGEND**
confirm → `RestResolver`-independent `sealCharacter()` (hammer SFX + wax-stamp scale-in + screen
punch) → save v2 → `GameStateManager.enter('GAMEPLAY')` → existing opening plays.

---

## 4. SYSTEM 3 — Animated player character with equipment-dependent visuals

**Depends on:** System 2 (equipment + portrait data). **Blocks:** System 4 (interact anim) + System 5
(sit/stand anims) — at minimum the one-shot pose hooks.

### 4.1 The core constraint (read first)

The repo's fighter is a **procedurally painted 2.5D billboard** (`FighterActor` + `SpriteActor` +
derived normal atlas), deliberately chosen for the "no external meshes or rigs" art scope
(see README "Art scope"). The prompt assumes a Mixamo-rigged GLB with bone sockets. Two-phase plan:

- **Phase A (ships with Systems 1–5): `SpriteCharacterModel`** — extend the painter with
  equipment variants + anchor points (the sprite analogue of sockets). Zero new model pipeline,
  consistent art, all 22 listed animations expressed as **painted pose/variant sets** where they are
  locomotion/interact/rest, with attack/dodge/death **painted now, unwired** (frames exist in the
  sheet builder behind a flag; no combat wiring — per NO-COMBAT constraint).
- **Phase B (future, planned here): `GlbCharacterModel`** — real rig + sockets + `.glb` clips.
  Ships only when GLB assets + loader + LOD + perf validation land. `CharacterModel` interface
  keeps the swap mechanical.

`PlayerCharacterController` (new) owns a `CharacterModel` and never knows which phase it holds.

### 4.2 `CharacterModel` interface (stable across phases)

```ts
// src/character/CharacterModel.ts
export type WeaponSet = 'sword_shield' | 'two_hand' | 'dual' | 'bow' | 'unarmed';
export type AnimName = 'idle'|'walk'|'run'|'interact'|'second_wind'|'long_rest_sit'|'stand_up'
  | 'attack_slash_1h'|'attack_thrust_1h'|'attack_slash_2h'|'attack_dual_L'|'attack_dual_R'
  | 'attack_bow_draw'|'attack_bow_release'|'hit_react'|'dodge_roll'|'death';
export interface CharacterModel {
  readonly root: THREE.Object3D;
  setPortrait(preset: PortraitPreset): void;
  setEquipment(equip: PlayerCharacter['equipment']): void;   // syncs visuals + WeaponSet
  readonly weaponSet: WeaponSet;
  playLocomotion(speed: number, moveAngle: number, dt: number): void;
  playOneShot(name: AnimName): Promise<void>;                // interact/sit/etc.; resolves on completion
  anchorPosition(name: 'handL'|'handR'|'quiver'|'hipL'|'back', target: THREE.Vector3): THREE.Vector3;
  update(dt: number, paused: boolean): void;
  dispose(): void;
}
```

### 4.3 Phase A — sprite equipment variants + anchors

- `SocketManager.ts` (v1 mode): named **anchors** (`mainhand/offhand/back/hip/quiver`) as
  `Object3D` children of the billboard root, positioned from the same pure pose math as
  `fighterPose()` (extend `fighter.ts` with `equipmentPose(weaponSet, phase, t)` returning anchor
  V3s). Painter draws the equipped weapon(s)/shield/quiver **into the sprite** per variant —
  no runtime mesh parenting in v1 (billboard + child meshes fight the normal-atlas lighting).
- `EquipmentManager.ts`: `onEquipmentChanged(slot, itemId)` → validate against `weapons.json` →
  set `SpriteCharacterModel` variant → rebuild affected sheet rows (debounced; sheets cached per
  `weaponSet+portrait` key, LRU 4) → `AnimationStateMachine` sub-graph switch → `character.ts`
  stat sync (AC/damage die) → save v2 patch. Stow/draw (sword↔bow) = 0.5 s crossfade between
  variants + sheathe SFX (no per-frame parenting).
- `AnimationStateMachine.ts`: locomotion blend (idle↔walk↔run by `velocity.length()`, directional
  variants by move-angle — sprite builder already does 16 dirs; run adds lean + faster gait via
  existing `gaitHz/sprintHz`), one-shot overlay track (`interact` 24 f, `second_wind` 36 f,
  `long_rest_sit` loop + `stand_up`), 0.2 s crossfades via neighbour-frame crossfade (existing
  sprite crossfade, extended to variant crossfade). Attack/dodge/death poses painted + exposed as
  `playOneShot` names but **never called** outside the creation preview flourish (assert in smoke:
  no combat caller exists).

### 4.4 Animation list mapping (spec §3 → Phase A expression)

| Spec animation | Phase A (sprite) | Phase B (GLB) |
|---|---|---|
| `idle_*` ×4 weapon sets | 4 painted idle row-sets (sword+shield default; 2H on shoulder; dual loose; unarmed relaxed) | 4 × 90 f clips |
| `walk_*` / `run_forward` | existing 16-dir walk/sprint rows × weapon-set arm variants | directional blend clips |
| `attack_*` ×7, `hit_react`, `dodge_roll`, `death` | **paint-only** rows behind `PAINT_COMBAT_POSES` flag; unwired | `.glb` clips, unwired |
| `second_wind` / `long_rest_sit` / `interact` | painted one-shots; `long_rest_sit` = seated variant + campfire gaze | clips wired to Systems 4–5 |

### 4.5 `PlayerCharacterController.ts` vs existing `PlayerController`

- Does **not** replace `controller.ts` in Phase A. It **wraps/delegates**: movement physics,
  collision, camera stay in `PlayerController`; the new controller owns the `CharacterModel`,
  `EquipmentManager`, and `AnimationStateMachine`, and feeds them `velocity`/`grounded`/`keys`
  each frame. `controller.ts` gains only `playOneShot`-adjacent hooks if needed
  (prefer keeping all anim state in the new controller; `FighterActor` moves under
  `SpriteCharacterModel` ownership).
- Sprint cooldown (spec §2-B.3): **not implemented**; flips to a follow-up or spec text cut.

### 4.6 Phase B — GLB plan (reserved, not built)

- `GlbCharacterModel.ts` + `CharacterModelLoader.ts` (GLB path): `base_male.glb`/`base_female.glb`
  (~5 k tris, Mixamo bone names), hair GLBs, weapon/shield GLBs per §4.7, `SocketManager` (bone mode)
  parenting with per-item `localOffset` from `weapons.json`, `AnimationStateMachine` retargeted to
  `THREE.AnimationMixer` crossfades. Loader uses `GLTFLoader` + `DRACOLoader` (decide at build time;
  adds ~300 kB — measure against chunk-size warning already present for Three).
- Cutover criteria: all Phase A smoke tests pass against GLB backend via the same interface;
  LOD + 500 k-tri scene budget + ≤128 MB VRAM verified on Balanced.

### 4.7 Models & textures (author list; Phase A paints, Phase B models)

| Item | Phase A | Phase B GLB (~tris) + PBR 512² |
|---|---|---|
| Longsword / Battleaxe / Warhammer | painted variants + arch thumbnails | `longsword.glb` 800 / `battleaxe.glb` 600 / `warhammer.glb` 500 |
| Shield (round, Astra sigil) | painted | `shield_round.glb` 400 |
| Longbow + quiver + arrows | painted | `longbow.glb` 300 + `arrow_quiver.glb` 200 |
| Shortsword ×2 | painted (dual set) | `shortsword.glb` 600 ea. |
| Chain mail | painter palette + mail pattern (exists) | `armour_chainmail_{albedo,normal,roughness}` 1024² + Astra chest emblem |
| Body/faces/hair | painter params + 6 `face_*.png` 512² thumbnails | `body_{albedo,normal}` 1024² + head-mesh + hair GLBs + `hair_*_albedo` 256² |

Texture style: photorealistic medieval, worn, warm palette (iron grey, leather brown, gold,
Astra deep blue); author PNG → build `.webp` (+ derived normals where painted, same as today).

---

## 5. SYSTEM 4 — Ransacked belongings: narrator voice-over (replaces pop-up)

**Depends on:** `NarratorSystem` (new) + `PlayerCharacterController.playOneShot('interact')` +
`InteractionManager`. **Blocks:** nothing.

### 5.1 Current behaviour → new behaviour

- Today: `Adventure.interaction()` returns `{ kind:'horses', id:'clearing' }` within 4 m of
  `(9.7, 2)` → `AdventureInterface.interact()` dispatches `inspect-horses` → `WorldInterface`
  opens the **`inspect` dialog** (static two-paragraph pop-up). Horses are living and stay living.
- New: same radius (tune to **2.5 m** per spec; keep 4 m fallback if playtest finds the 2.5 m
  circle awkward against horse colliders) → `RansackedBelongingsInteraction.onInteract()`:
  1. `playerController.playOneShot('interact')` (kneel + reach; movement locked via `CINEMATIC`).
  2. `NarratorCamera.dollyTo(saddlebagFocus, 0.8 s ease-in-out, slightly low angle)` using
     `controller.cameraOverride` + saved/restored camera transform (same pattern as wagon handoff).
  3. `NarratorSystem.narrate('ransacked_belongings', 'The horses\' saddlebags have been looted. An empty leather map case lies nearby.', focus, 4.0)` — voice + cinematic subtitles + dust-mote burst over saddlebags.
  4. No dialog, no panel. On end: camera eases back, control restores, `inspected=true` persisted (v2).
  5. Re-press E: faint shimmer on the site (emissive pulse on the map-case prop) + short line
     `'Nothing more of interest here.'` (2.0 s, no camera move).

### 5.2 Files

- `src/systems/narration/NarratorSystem.ts` — `narrate(clipId, subtitleText, cameraTarget?, duration?)`.
  Wrapper, not replacement: looks up clip URL from the **same manifest** (`clips[clipId].file`),
  plays through a **second `Audio` element** (never hijacks the chapter timeline's element),
  falls back to timed subtitles (same 8 s stall rule as `Narrator`), honours narrator mute +
  `pauseReasons`, resolves when audio ends or `duration` elapses. Queues (no overlap): concurrent
  `narrate()` calls await the active one.
- `src/systems/narration/NarratorSubtitles.ts` — `#cinematic-subtitles` bottom-centre, BG3 style:
  `NARRATOR: "…"` white + dark shadow, **no box**, typewriter fade-in (40 ms/char cap 1.2 s),
  auto-dismiss, `aria-live="polite"`, reduced-motion → instant. Visually distinct from
  `#narrator-panel` (which keeps chapter progress UI).
- `src/systems/narration/NarratorCamera.ts` — `dollyTo(target, opts)` / `restore()`: 0.8 s
  ease-in-out position + look-at slerp, collision-safe (reuse `cameraBlocked` lift), FOV hold.
- `src/systems/interaction/InteractionManager.ts` — registry: `register({ id, position, radius,
  key: 'KeyE', prompt, enabledWhen, onInteract })`; per-frame nearest-in-radius; single E handler
  (replaces the E branch in `adventure-interface.ts`; cargo migrates to registrations, horses
  interaction becomes `RansackedBelongingsInteraction`).
- `src/systems/interaction/interactions/RansackedBelongingsInteraction.ts` — the data + flow above.

### 5.3 Interaction record (TS)

```ts
export interface InteractionDef {
  id: 'ransacked_belongings';
  position: THREE.Vector3;            // saddlebags anchor (from props.ts ambush group)
  radius: 2.5; interactKey: 'KeyE';
  inspected: boolean;                 // persisted in save v2 (world.flags)
  cameraTarget: { position: THREE.Vector3; lookAt: THREE.Vector3 };
  onInteract(ctx: InteractCtx): Promise<void>;
}
// InteractCtx = { player: PlayerCharacterController; narrator: NarratorSystem; camera: NarratorCamera; fx: ParticleEffects }
```

### 5.4 Audio & VFX assets

- VO (MP3 to match existing pipeline; direction + verbatim script in `narration-script.json` new
  `oneShots` section; regeneration via existing `narration:gemini` script extended with the new IDs):
  `ransacked_belongings.mp3` (~4 s): *"The horses' saddlebags have been looted. An empty leather map
  case lies nearby."* / `nothing_of_interest.mp3` (~2 s): *"Nothing more of interest here."*
  Voice: warm-but-ominous mature British storyteller, matching existing `direction` block.
- `dust_mote.webp` 64² soft alpha circle; burst = 40 particles, 3 s, sunbeam-tinted
  (`#e4d9a9`, additive, existing dust shader reused via `ParticleEffects.dustBurst()`).

---

## 6. SYSTEM 5 — Long rest (video-game-ified)

**Depends on:** Systems 1 (Hit-Die d10 + perception check), 4 (`NarratorSystem`, subtitles),
3 (`long_rest_sit`/`stand_up`), `GameClock` + save v2. **Blocks:** nothing (loop closer).

### 6.1 Rules → game mapping (XPHB base, BG3 feel)

| XPHB rule | Game implementation |
|---|---|
| 8 h, regain all HP + ½ Hit Dice (min 1), reset long-rest features, 1/day, need ≥1 HP | Campfire-only; full HP; L1: 1d10 Hit Die always recovered (½ of 1, min 1); Second Wind + Human Inspiration reset; 24 h `epochMinutes` cooldown; 0 HP path is future (no combat → HP ≥1 always; still guard) |
| Short rest 1 h, spend Hit Dice | No cinematic; breathing one-shot + visible d10 roll + CON; Second Wind also refreshes; no cooldown |

### 6.2 Campfire site (opening scene)

- Location: **off-road, treeline edge near ambush clearing** — exact coords chosen at implementation
  by querying `terrainHeight` + `pathDistance` for a flat spot 6–10 m from the road with no tree
  colliders (do not hand-place blind; add a DEV log + smoke assertion that the spot is reachable on
  foot and unwalkable-by-wagon is fine). `props.ts` `+createCampfire()` builds stone ring + logs +
  unlit bundle; lit state = point light (warm, flicker via `WeatherEngine`-independent timer) +
  ember/smoke loops from `ParticleEffects`.
- Approach: `CampfireInteraction` (radius 3 m) → HUD prompt `[E] Set Up Camp` + moon icon (lucide
  `moon`, already imported). First-time E: VO *"The road ahead is long, and the shadows grow deeper.
  Best to rest while you can."* → camera wide pull-up → `CampMenu` opens (`CAMP` state; 3D visible
  behind, pointer unlocked).

### 6.3 `CampMenu.ts` (overlay, not full-screen)

Sections: **LONG REST** card (HP `7/12 → 12/12` live, Second Wind `0/1 → 1/1`, Inspiration `✗ → ★`,
primary `[ REST UNTIL DAWN ]`, greyed with tooltip inside 24 h cooldown, "well-rested already" quip
path still allows rest for story-time advancement), **SHORT REST** card (`1d10 [SPEND]`, potential
`1d10 + CON`, Second Wind refresh line, disabled at 0 Hit Dice or full HP+charged with explainer),
**COOK (locked, Coming soon)** greyed, **MANAGE INVENTORY** + **CHARACTER SHEET** (open existing
dialogs stacked above camp; closing returns to camp), **[ BREAK CAMP ]** (close, restore control).
All buttons keyboard-focusable; Esc = Break Camp.

### 6.4 `initiateRest` flow (TS pseudocode)

```ts
// RestSystem.ts
export async function initiateRest(type: 'short' | 'long'): Promise<void> {
  const c = getCharacter();                       // v2 save
  if (type === 'long') {
    if (hoursSinceLastLongRest() < 24) {          // RestResolver.cooldownRemaining()
      CampMenu.showCooldownTooltip();             // grey + "adventure more before sleeping again"
      return;                                     // (quib path: HP-full still allowed — tooltip differs, button stays enabled)
    }
    CampMenu.hide(); GameStateManager.enter('CINEMATIC', 'rest');
    player.playOneShot('long_rest_sit');          // seated by fire (holds pose until stand_up)
    RestCinematic.play();                         // orbit + Sky time-lapse + clock/moon overlay + fade
    const ambush = DiceRoller.rollHidden(20);     // hidden; ≤2 → interrupted (10 %)
    if (ambush <= 2) {
      await RestCinematic.interruptAtMidpoint();
      await NarratorSystem.narrate('something_stirs', 'Something stirs in the darkness…', null, 2.5);
      const percMod = wisMod(c) + (c.proficiencies.skills.includes('Perception') ? c.proficiencyBonus : 0)
        + debuffMod(c, 'perception');
      await DiceRoller.roll({ die: 20, modifier: percMod, label: 'Perception Check', dc: 12 }); // visible, sets alert flag
      c.hp.current += floor((c.hp.max - c.hp.current) * 0.5);   // partial, capped
      await NarratorSystem.narrate('retreated_for_now',
        'Whatever lurked in the shadows has retreated… for now. You sleep uneasily.', null, 4);
      await RestCinematic.resume();
      RestResolver.applyLongRest(c);              // full benefits…
      c.conditions.push({ name: 'Poorly Rested', effect: 'perception_penalty', value: -1, expiresEpochMin: now() + 60 });
    } else {
      await RestCinematic.complete();
      RestResolver.applyLongRest(c);
    }
    advanceClockHours(8); setLastLongRest(now());
    player.playOneShot('stand_up');
    floatingText(`+${restored} HP`, 'green', playerPos); inspireStarLightUp();
    GameStateManager.exit('CINEMATIC', 'rest');
    await NarratorSystem.narrate('dawn_breaks', 'Dawn breaks. You feel renewed.', null, 2);
  } else {
    // short: breathing one-shot + visible d10 + CON
    player.playOneShot('second_wind');            // reuse breathing beat
    const r = await DiceRoller.roll({ die: 10, modifier: conMod(c), label: 'Hit Die — Healing' });
    c.hp.current = min(c.hp.max, c.hp.current + r.total);
    c.hitDice.current -= 1;
    c.features.secondWind.usesCurrent = c.features.secondWind.usesMax;
    advanceClockHours(1); floatingText(`+${r.total} HP`, 'green', playerPos);
  }
  saveCharacter(c);
}
// RestResolver.applyLongRest(c): hp=max; hitDice=min(max, current+max(1,floor(max/2)));
//   secondWind=full; human inspiration=true; conditions=keep(persistsThroughRest)
```

Notes: `RestCinematic` drives the **procedural `Sky`** (sun azimuth/elevation sweep night→dawn via
`SkyboxManager`), fog density, `WeatherEngine` night override, fire-light intensity, and a moon-phase
clock overlay — **no HDR skybox files** (`sky_night.hdr`/`sky_dawn.hdr` from the prompt are cut;
`forest.hdr` stays the sole IBL source). Time-lapse 3–5 s, skippable (hold Esc), reduced-motion →
fade-only. Ambush flag (`alertForFutureCombat`) stored in v2 even though combat is unwired.

### 6.5 Save v2 additions (rest-relevant)

```ts
interface SaveV2rest { hp: {max:number;current:number}; hitDice:{max:number;current:number};
  features:{secondWind:{usesCurrent:number}; heroicInspiration:{available:boolean}};
  conditions: {name:string;effect:string;value:number;expiresEpochMin:number;persistsThroughRest?:boolean}[];
  lastLongRestEpochMin: number|null; campfireSeen: boolean; alertForFutureCombat: boolean|null; }
```

Migration `migrateV1toV2`: v1 saves (no character) → prompt creation on next Continue? **No** —
auto-generate default character (Recommended Build + Defense + Tough + Goblin + dual-choice
Perception/Survival… wait, class picks 2 + Skillful 1: default Perception + Survival + Insight?
Decide: **Perception + Survival**, Skillful **Insight**) so existing testers' cargo/inventory persist
without a forced creation wall; toast "Your Wanderer has been given a default Fighter record —
visit creation on a new journey to forge your own." New journeys always go through creation.

---

## 7. Shared systems, theme, a11y, perf

### 7.1 `GameTime` / `SaveSystem` mapping

- `GameTime` = existing `GameClock` + `RestSystem` helpers (`advanceHours`, `hoursSince`,
  `restUntilMorning` kept for pause-menu parity but routed through `RestSystem` long-rest-lite when
  no campfire is near? **Decision:** pause-menu Long Rest stays a clock-only convenience (documented
  as *not* granting recovery) until campfires exist in all scenes; campfire rest is the true rest.
  Revisit before shipping to avoid two competing rests.)
- `SaveSystem` = `InventoryStore` extended to v2 (`astra-journey-v2`, keep v1 reader + recovery-key
  discipline). Version + revision + validation in the same file; character/rest/world-flags sections
  each get a `validate*` guard.

### 7.2 HUD additions (`HUD.ts` changes inside `interface.ts`/`shell.ts`)

- HP globe (SVG arc + number; Diablo-esque but Astra-styled), Inspiration star (lit/unlit + spend
  affordance later), Second Wind pip (cooldown sweep), Poorly-Rested eye-icon with 1 h countdown
  tooltip. All `aria-live` polite on change; numbers always textual (never colour-only).

### 7.3 Astra theme tokens (new CSS variables, both stylesheets)

```css
:root {
  --astra-bg: #1a1a2e; --astra-panel: #23233a; --astra-ink: #e8e0d0;
  --astra-gold: #c9a84c; --astra-gold-hi: #e8c96a; --astra-iron: #3a3a4e;
  --astra-success: #7ee787; --astra-failure: #ff7b72;
  --font-display: 'Cormorant Garamond', serif; --font-body: 'Manrope', sans-serif;
}
```

Headers medieval serif, body sans; buttons hover-glow + active-depress; contrast ≥ 4.5:1 for body,
≥ 3:1 for display. Existing `#151d17` HUD theme stays for world chrome; new overlays use the tokens
above (slate/gold), converging over time.

### 7.4 Accessibility (all five systems)

- Every VO line ships subtitle text + journal/log entry; dice results numeric + announced via live
  region; all overlays focus-trapped with Esc; no input requires drag (click-click + keyboard paths
  for ASI/stow/draw); `prefers-reduced-motion` respected in dice/creation-bg/cinematic/shimmer.

### 7.5 Performance budgets (per prompt, mapped to repo)

- 60 fps mid-range; scene < 500 k tris (assert in DEV via `renderer.info`); textures ≤ 128 MB VRAM;
  dice scene ≤ 3 bodies, disposed per roll; creation background < 5 k tris; campfire light = 1 point
  light, no shadow; particle pools preallocated (`ParticleEffects`), no per-frame allocation;
  `setQuality('performance')` disables dice-scene shadows + bloom + ember count ÷ 4.

---

## 8. Implementation phases (suggested order — unchanged from prompt)

| Phase | System | Builds | Tests added |
|---|---|---|---|
| 1 | Dice | `cannon-es` dep, `systems/dice/*`, `GameStateManager` (CINEMATIC slice), theme tokens | `dice.test.ts` (sampler, quaternions, settle-timeout), smoke: hidden roll purity (no overlay), overlay dismiss paths |
| 2 | Character creation | `game/character.ts`, `data/*`, `ui/character-creation/*`, save v2 character slice, creation→gameplay gate | `character.test.ts` (point-buy, derivations, feat guard, JSON validation), smoke: forge-default + blockers |
| 3 | Player character A | `character/*` (sprite backend), `EquipmentManager`, `AnimationStateMachine`, one-shot hooks, portrait params | sprite-variant cache test, `playOneShot` resolve test, smoke: loadout repaint, no-combat-caller assertion |
| 4 | Narration + ransacked | `systems/narration/*`, `InteractionManager`, `RansackedBelongingsInteraction`, 2 VO clips, dust FX, save `inspected` | `narration-cinematic.test.ts` (queue, fallback, subtitle timing), smoke: E-flow camera restore, re-press short line, cargo path unbroken |
| 5 | Rest/camp | `systems/rest/*`, campfire prop + light + loops, `CampMenu`, `RestCinematic`, `SkyboxManager`, 5 VO clips, HUD rest icons, save rest slice | `rest.test.ts` (cooldown, Hit-Die math, ambush branch via stubbed `rollHidden`, debuff expiry), smoke: full-night + interrupted-night + short-rest spend |

Phase 3B (GLB) is explicitly out of scope for these five phases; its interface + asset list above is
the handoff.

---

## 9. Consolidated asset-generation list (author PNG → build WebP; audio OGG/MP3)

**Dice:** `d20/d12/d10/d8/d6/d4 _albedo` (d20+d12 @1024², rest @512²; ivory + gold numerals + dragon
watermark on d20-20) + derived `_normal/_roughness`; SFX `throw/bounce×4/land/slam/success/failure`.

**Creation:** `class_banner_fighter / species_banner_human / background_banner_soldier` (800×400
silhouettes), `arch_frame` (gothic iron+gold), `parchment_bg`, `wax_seal`, rank/stat/feat/style/skill
icons (prefer `lucide` + CSS before commissioning raster).

**Character (A):** 6 `face_*` thumbnails 512², painter palettes (no raster body/armour in v1).
**Character (B, reserved):** `body/chainmail/weapon/shield/hair` PBR sets per §4.7 + 10 GLBs.

**Narration:** 2 MP3 one-shots (§5.4). **Rest:** 5 MP3 one-shots (`rest_while_you_can`,
`dawn_breaks`, `something_stirs`, `well_rested_already`, `retreated_for_now`), 3 ambient OGG loops
(`campfire_crackle`, `night_crickets`, `dawn_birds`), `campfire_ember/smoke`, `healing_sparkle` 64²,
moon-phase clock overlay (SVG, no raster).

**Cut from prompt:** `sky_night.hdr`/`sky_dawn.hdr` (procedural `Sky` instead), `astra_medieval.woff2`
(Cormorant Garamond already licensed), d6 pips (numerals instead).

---

## 10. Constraints & reminders (binding)

- **NO COMBAT:** attack/dodge/death/hit anims may be *painted/modelled* but never *wired* —
  no hit detection, damage calc, enemy AI, or turn/RT systems. Smoke test asserts zero combat callers.
- **VIDEO GAME, NOT TABLETOP:** no manual math, no rule look-ups; every calc surfaces as
  dice/floating numbers/status icons with plain-language tooltips.
- **RANDOMNESS:** `crypto.getRandomValues` for dice + personality randomiser + ambush; never
  `Math.random` in those paths.
- **PERF:** §7.5 budgets; dispose dice/creation/cinematic scenes; LOD + quality-tier behaviour.
- **A11Y:** §7.4; subtitles always; numeric results; contrast; visible keybinds.
- **CONSISTENCY:** §7.3 tokens; dark slate + gold; serif headers / sans body.

---

## 11. Open decisions for implementation-plan review (do not guess during build)

1. Sprint cooldown text (§3.3-B.3): cut claim vs implement cooldown in System 3.
2. Ransacked radius 2.5 m vs 4 m (playtest against horse colliders).
3. Pause-menu clock-only rest vs campfire-only true rest coexistence (§7.1).
4. Default character for v1-save migration (§6.5 skill picks).
5. `GLTFLoader`+`DRACO` timing for Phase 3B (bundle-size measurement).
6. d10 geometry: custom trapezohedron vs kit-bashed pentagonal bipyramid (face-numbering readability test).
7. Dual-die advantage layout in Phase 1 vs deferred (recommend deferred unless a Phase-5 caller needs it — none does; Perception is flat).

---

*End of plan. No code, assets, or dependencies were changed by this document.*
