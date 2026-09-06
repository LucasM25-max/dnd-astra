# Astra — Start-of-Game Improvement Plan

**Scope:** the opening experience — the narrated wagon journey, the arrival at the ambush clearing, the oxen, the horses, the wagon/cargo interaction, and the surrounding forest.
**Status:** planning document. Findings below were verified against `54dab64` (current `main`) by reading every source file, parsing the bundled horse GLB, and driving the running build in a headless browser.

---

## 0. Current-state audit (what was found, with evidence)

### Animals
- `public/models/horse.glb` is the three.js-example reference horse: **~984 triangles, 1 node, morph-target animation, no usable skeleton**. (Verified by parsing the GLB.)
- `buildRestGeometry()` in `src/engine/actors/animals.ts` strips the morphs and "reposes" the mesh into a standing horse/ox with **hand-tuned per-vertex displacement math** (magic-number zones, x-stretch of 1.28 for oxen), then runs two passes of Loop subdivision and builds a **procedural 15-bone skeleton with position-based skin weights**.
- The gait in `LivingAnimal.update()` is a **single sine wave per leg** (`swing * 0.24 * walking`), lower leg only bends during lift. No gait coupling (diagonal/trot), no body pitch-roll coupled to the stride, no hindquarter drive, no foot-terrain contact. Result: a stiff robot walk that reads as "limbs barely move".
- The "fur" is a fragment-shader hack (three projection samples of one coat texture blended by normal direction) — produces the blotchy, speckled coat visible in screenshots.
- Head accessories (eyes, lids, ears, horns, muzzle, nostrils, halter) are crude primitive shapes fitted by scanning vertices for "best anchor" — ears are squashed spheres, horns are radius-tapered tubes.
- **Oxen are rigid children of the wagon root** (`SupplyWagon` constructor): they steer, roll and rotate with the wagon instantly, with no independent locomotion, and their ground follow is a one-frame lagged `heightAt` sample — legs visibly sink/float on the undulating road.
- **Horses wander on a fixed 34-second lerp cycle between two hard-coded points** (`Adventure.updateHorses()`), lowering their head on a fixed timer. No goals, no reactions to the player or wagon.

### Wagon & cargo interaction
- Flow today: **R to dismount** (one of 3 hard-coded points, which must be collision-clear) → **walk around the wagon** until within 2.6 m of a container centre (`canReach`) → **E opens a full-screen dialog that pauses the whole game** → take items → close → walk back → R to remount (must be within 3.4 m of the bench).
- **Crates cannot be closed.** `InventoryStore.open()` is one-way; `opened` is persisted in the save and the lid only animates to open. There is no verb, button, or key that closes a lid.
- Containers are arranged so the driver must physically walk around the bed (oil barrel at the rear corner, lantern case stacked high, tools on the starboard side) — the "walk around to open the crates" complaint is a direct consequence.
- **Verified driving bug:** after the arrival handoff, driving east along the road with W, the wagon **crawls ~25–75 cm and hard-stops ~4 m short of the horse clearing**. A swept probe of the real `canDriveAt()` (dev-only `__astra.getDebug()` hook added on this branch) shows the forward drive corridor is blocked at 4–6 m by roadside colliders (path-side rocks/trees placed ~3.1 m from the road centreline at `createRocks()`, plus the ox-probe points that sit 4.95 m ahead of the wagon centre). The repo's own smoke test only ever asserts **25 cm** of travel, so this went unnoticed. The road the journey just travelled is, in effect, not drivable.
- The "needs room" toast fires at most once per 7 s, so the player experiences a silent, stuck wagon.

### Forest / open-world feel
- Tree budget: **315 trees total** (`createForest`), ~145 "near" within ~73×75 m of the road, the rest within ~147×150 m; grass within a 93×86 m box, ferns 80×73 m, shrubs 100×94 m; **`WORLD_LIMIT = 47`** clamps the player well inside the 170 m terrain plane.
- `FogExp2` density 0.0125 makes everything beyond ~80–100 m a pale void; the `distantHills` term only begins rising beyond ~29 m from origin, so beyond the treeline the player sees **flat, empty, splotchy ground fading to white** (visible in captured screenshots).
- The ground shader blends three textures (forest-floor / road / stone) with per-vertex weights; captured frames show a **dark checkered blotch pattern** on the road and banks (tiling/blend artifact) that reads as broken rather than natural.
- All trees are the same four oak variants (leaf-card canopies); no conifers, no distant silhouettes, no treeline.

### Collision / clipping
- Player collides with wagon and horses (circle colliders), but **nothing prevents the horses from walking through the wagon or the oxen** — their wander targets ignore the wagon entirely, and the wagon's `canDriveAt` ignores the horse group. If the player parks in the clearing, horses will visually clip through the yoke/oxen.
- Oxen clip the ground on slopes (single point follow, see above); ox head/bits are anchored to **wagon-local points** for the reins/traces, so when the ground follows lag, traces visibly detach or punch through the yoke.
- Wagon corner probes are only 4 points + 2 ox points, and the front wheel steer is purely visual.

### D&D feel / interactivity
- Interactions are hard-coded to four: open cargo (dismounted only), read manifest (mounted only), inspect the clearing (static text dialog), and the sign.
- Everything that happens is a **full-screen, game-pausing modal**. No verbs, no "search", no petting, no sounds from animals, no reaction to the player.
- The bean character is a documented placeholder and is the second most out-of-place element next to the animals.

---

## 1. Guiding principles

1. **The player should feel they can do anything** (D&D: any sensible verb is available). Make the *default* action one keystroke, and keep richer verbs one level away — never behind a modal maze.
2. **Never pause the world for bookkeeping.** Menus should be compact, anchored, non-blocking panels; the game and ambience keep running. (Narration is the only thing that legitimately pauses.)
3. **Animals are alive, not props.** They have goals, reactions, idle life, and voices — and they must never clip each other or the wagon.
4. **Photorealism, practically.** This is a browser prototype; the bar is *believable realism*: high-quality textured rigs, PBR, real gait, real forest depth — not a claim of photogrammetry. The README's "art scope" paragraph must be updated to match.
5. **Performance budget is non-negotiable** (see §7): the forest gets deeper, not heavier on the GPU.

---

## 2. Workstream A — Oxen & horses that feel alive

**Why it's the biggest visual problem:** the current animals are a 1k-triangle stylized mesh, vertex-morphed into pose, re-rigged, and animated with sine waves. No amount of tuning that pipeline reaches the target; the reference must change.

### A1. Replace the reference meshes (asset swap)
- Source two **rigged, animated, realistically proportioned** quadruped GLBs under permissive licenses (CC0/CC-BY, credited in `public/credits.txt`):
  - one **draft ox / beefy cattle** (broad chest, hump, horns, halter-ready) for the yoked pair,
  - one **horse** (riding/hackney type) for the wild pair.
- Curation pass: review 2–3 candidates per species (Sketchfab CC0/CC-BY, CC0 repos, community packs). Hard requirements: named skeleton (root, chest, head/neck split, 4 legs with knee *and* hock/ankle, tail), rest pose standing on flat ground, animations for **idle, walk, trot, and (nice-to-have) graze/head-down**; < ~1 MB GLB each; no skinned fur cards we can't afford.
- Re-texture with **CC0 PBR sets** (e.g. AmbientCG/Poly Haven hide, leather, hoof, iron) instead of the single `animal-coat` projection hack: base color + normal + roughness (+ AO baked into the GLB if provided). Per-animal tint variation.
- If no suitable GLB is found (risk, see §9), fallback: sculpt proper high-poly bodies procedurally (lathe/loft muscle massing, real ear/tail/muzzle geometry) and keep the existing rig pipeline — ~2× the effort of the GLB path.
- **Delete** `buildRestGeometry()`, the vertex-anchor accessory fitting, the Loop-subdivision step, and the `three-subdivide` dependency. Keep `LivingAnimal` as the animation/behaviour shell and extend it (or replace with a clean `QuadrupedActor` class).

### A2. Rig, gait and "life" (animation layer)
- **Gait system** (procedural on top of the GLB skeleton, so speed/terrain are continuous, not baked clips):
  - Horse **trot** (diagonal-couple) for the wild pair, **walk/pace** for the oxen, with proper phase offsets, lift-stance-swing-pass foot timing, and body vertical oscillation + roll/pitch coupled to the stride (hip drop on reach, shoulder lift).
  - Velocity-driven blend: stand → walk → trot, with ~0.4 s crossfades; head nod synced to gait; tail counter-swing.
  - **Per-foot terrain IK:** each foot samples `terrainHeight` at its target and adjusts lower-leg/foot bones so hooves contact the ground (kills the sinking/floating on the road's undulation and on the banks).
- **Idle life** (always running, layered): breathing (ribcage scale), ear flicks, head scans (slow yaw drift with saccades), blink, jaw chew for oxen, nostril flare, tail swish with occasional fly-off flick, weight shifts.
- **Head/neck as one articulated unit** (GLB neck bone + head bone) so "lowering to sniff" is a natural nod, not the current single-bone pitch.

### A3. Behaviour (AI layer)
- **Horses — goal-driven wander in the clearing** replacing the 34 s lerp cycle:
  - State machine: `idle → walk-to-target → sniff → graze → look → startle`.
  - Targets: weighted sample from a clearing waypoint set (around the ransacked belongings, the arrows, the road edge), minimum distance 3 m from the wagon footprint, 2 m from each other.
  - **Reactions:** player within ~2.5 m → head up, ear forward, small step back (never flees — they're startled-wild, not tame); wagon within ~6 m → one startle (trot to a new target); `Call` verb → nearest horse trots over and noshs for a moment.
  - Despawn-safe: horses never leave the clearing radius (keeps the authored scene intact).
- **Oxen — yoke-attached, but alive:**
  - Stop parenting ox roots to the wagon. Drive each ox as a **soft-spring follower of its yoke anchor** (position + yaw lag with a spring-damper), so the pair settles into turn, rolls with terrain, and the traces/reins follow the *ox's actual bit position* (fixes detachment).
  - While stopped: full idle life (see A2) + occasional groan/moan when the player brakes or yanks the reins.
  - While starting/stopping: head dip + harnessed strain pose (chest forward) so acceleration reads as the animals pulling.
- All behaviour lives in one small module (`src/engine/actors/behaviour.ts`) driven by the existing clock; no new systems.

### A4. Animal audio (ties into §7)
- Hoof strikes scaled by gait and speed (dusty on the road), snorts, occasional whinny (on startle), lowing (oxen, on strain or `Call`), breath. Generated with the existing Web Audio synth (no recordings) or short local CC0 samples.

### A5. Acceptance (animals)
- [ ] Oxen walk with coupled, terrain-contacting gait; no leg sink/float on the road or when parked on a bank.
- [ ] Steer the wagon in a full circle: oxen lag ≤ ~15° behind the wagon, traces stay attached, no ox–yoke or ox–wagon clip at any speed.
- [ ] Park the wagon inside the clearing: horses retarget and never pass through wagon/oxen; player can stand between horse and wagon without the horse walking through the player's head.
- [ ] Idle for 60 s with no input: at least 5 distinct idle behaviours visible per animal (breathe, ear, blink, head, tail).
- [ ] `Call` a horse: it arrives and reacts within 4 s, with sound.
- [ ] Triangle budget: ≤ 120 k tris across all four animals (high quality), ≤ 40 k (performance).
- [ ] Unit test updated (current `tests/animation.test.ts` assumes the 15-bone rig) — new rig, weights normalized, no NaN over 5 min simulated time.

---

## 3. Workstream B — Wagon & cargo interaction (smooth, unobtrusive)

### B1. Make the wagon actually drive (verified bug — fix first)
- Clear a **drivable corridor** along `ROAD` for the first ~30 m past the arrival pose:
  - `createRocks()`: path-side rocks are placed at `w = 3.1 + rng*0.5` from the road centre — pull roadside rocks to `w ≥ 4.2` (and shrink their collider radii for rocks under 0.5 scale), or exclude colliders for rocks within 3.5 m of the road.
  - Same rule for trees: `createForest` currently only checks `pathDistance < 1.8`; raise the no-tree corridor to ~3 m from centre for the arrival stretch.
- Verify with the dev-only `__astra.getDebug()` probe (added on this branch): the wagon must drive **≥ 25 m straight from the arrival pose** without a block, and the block-reason logging must be added to `canDriveAt` (which probe, which collider) so regressions are obvious.
- Soften hard stops: on block, ease speed to 0 over ~0.3 s and nudge the toast text ("The oxen don't like that bank") — never an instant freeze.
- Extend the browser smoke test: drive from arrival to x ≈ +8 (the clearing) as an assertion, not just 25 cm.

### B2. Rebuild the cargo loop (the core ask)
- **Reach from the bench:** cargo interaction is allowed **while mounted** (the driver is standing right there — no reason to dismount to look at the load). On foot, keep the 2.6 m reach but widen to a 3.2 m *ellipse* around the container, so walking behind a wheel still counts.
- **E is a toggle:** nearest container within reach → `E` opens it; if already open, `E` **closes it** (lid animates shut, state persisted — extend `InventoryStore` with `close(id)`, save schema keeps `opened` but it's no longer one-way; validator unchanged since it only checks the list).
- **Compact side panel instead of the pause-everything dialog:**
  - Slides in from the right (~380 px), world keeps running, ambience keeps playing, pointer not captured, camera free.
  - Shows: container name + contents + per-row **Take 1 / stepper / Take all**, a footer **Close container** button and an **X** that closes the panel *without* closing the lid (panel ≠ lid).
  - Auto-hides (fades) when the player moves > 5 m from the container or presses E elsewhere.
  - Keyboard stays available while open (WASD moves; the panel is not modal) — this is what makes looting feel like *being there*, not a shop screen.
  - Full-screen dialogs remain for Inventory/Manifest/Journal (they're reference UI), but cargo — the frequent interaction — stops being one.
- **Targeting feedback:** the in-reach container gets a subtle emissive lift + its name appears in the existing bottom prompt (`#inspect-prompt`), replacing the "inspect the cargo manifest" text when on foot near cargo. Nothing shows when nothing is in reach.
- **Remount anywhere near the wagon:** raise `canMount` to 4.5 m and snap the player to the bench with a short 0.4 s seat animation (rig scale is already there) instead of an instant teleport.

### B3. Feedback & feel
- Lid open/close and crate creak sounds; a "thunk" + dust puff on close; item-take keeps the physical stack shrinking (already there) + the existing toast, shortened to `+3 sacks of flour`.
- While mounted, the manifest verb stays (`E` at the bench shows the manifest panel when nothing else is in reach — mounted + nothing near = manifest, which is what a driver would do).

### B4. Acceptance (wagon)
- [ ] From arrival: W for 5 s drives the wagon ≥ 10 m with no stops; no "needs room" toast on the straight road.
- [ ] Mounted, press E at the bench → any container panel opens; take 3 flour → stacks shrink; close panel → lid state unchanged; press E again → lid closes.
- [ ] Dismissing the panel (X, Esc, or walking 5 m) does not pause the game and does not change lid state.
- [ ] Full loot a container mounted, no dismount ever required; save/reload preserves open *and* closed states.

---

## 4. Workstream C — Deeper, more open forest

### C1. Ring-based forest to the horizon
- **Ring 0 (0–40 m):** current high-detail instanced trees, density as today.
- **Ring 1 (40–90 m):** mid-detail trees (same 4 variants at 1-subdivision level, no shadow-casting), ~2× the count of ring 0's far band.
- **Ring 2 (90–160 m):** **distant treeline** — one or two merged meshes / billboards of low-poly conifer-oak silhouettes with soft alpha or simple dark green material, no shadows, no wind, culled by the existing spatial buckets. Fog (0.0125) hides the 170 m edge, so the treeline reads as endless forest, not "end of the plane".
- Add a **conifer variant** (1–2 new cheap trees) to break the all-oak monotony, and scatter ring 1/2 as a believable mixed woodland.

### C2. Playable area & depth cues
- Raise `WORLD_LIMIT` 47 → **70** (terrain plane already 170 m; shadow camera and collision field already scale). The Cragmaw trail already runs to z −78 — the player can now actually walk *a while* up it.
- Add **depth props** between 40–70 m: boulder outcrops (reuse `rockGeometry` at 2–4× scale, mossy), fallen-log pairs, root mounds at big tree bases, a short dry creek bed crossing the east side of the road (no water sim — wet-dark texture strip + stones), mushroom clusters near deadwood, stump-and-axe? (no axe; just stumps).
- The ambush clearing itself gets a light touch: a few more rocks, a bent sapling, disturbed-dirt patch (cheap decal texture) — "scene of a fight" sells the story.

### C3. Ground fix (the splotchy road)
- Diagnose the dark checker: likely the road/stone blend UV tiling (`vMapUv * 1.25 / .84`) fighting the vertex-blend noise at `terrain` resolution; fix by (a) sampling the blend from a world-space noise instead of the 252² vertex grid at road edges, and (b) adding a 4th detail layer (worn-dust ring) around path edges with a soft falloff. Add a couple of large-scale colour patches (leaf litter) via the existing `fbm` variation channel.

### C4. Life in the woods (cheap, sells "alive")
- 3–5 **birds** as distant looping billboards + occasional calls (Web Audio chirps), 6–10 **butterflies** near the existing flower patches (sprite quads on noise paths), and a **dust/pollen** particle set already present. Fireflies at blue hour (reuse particle system with different tint/distribution).
- Wind: extend the existing leaf/grass sway to ring 1 (ring 2 static).

### C5. Performance budget (must hold for all three quality tiers)
| Tier | New forest tris | Draw calls (forest) | Shadows |
|---|---|---|---|
| High | +~1.5 M (mostly culled) | < 60 | rings 0–1 near only |
| Balanced | +~0.8 M | < 45 | ring 0 + near ring 1 |
| Performance | +~0.2 M (treeline only) | < 25 | none beyond ring 0 |
- Reuse the existing `userData.density` scaling pattern for the new rings; measure with `__astra.getDiagnostics()` (draw calls, triangles) before/after and keep total scene ≤ ~3 M tris on High.

### C6. Acceptance (forest)
**Implementation status (branch `arena/01a0771d`):** C1–C5 implemented. Rings 0/1/2 with conifer mix, per-tier density via `userData.density`; `WORLD_LIMIT = 70`; outcrops, creek, stumps, logs, mushrooms, bent sapling; ground blend dithered at fragment scale (checker removed) with world-space `pathAmount` + leaf-litter variation; birds (5, one instanced draw call) and butterflies (10, one instanced draw call) in `createForestLife`, firefly blink reuses the dust particles at blue hour; bird calls already in `ForestAudio`. Unit-verified: `tests/forest-life.test.ts` (altitude/ground-contact bounds, no drift). Browser-side visual/diagnostics pass (the five items below) still to be confirmed in-session.

---

## 5. Workstream D — No clipping: animals ↔ wagon ↔ player

Consolidates the scattered fixes above into one collision contract:

1. **Wagon & oxen** — oxen are spring-attached followers (A3); their colliders (two circles each, group `wagon`) stay where the bodies are; the yoke/drawbar is excluded from the player via the existing group skip.
2. **Horses** — wander retargets away from the wagon footprint + 1.5 m margin; if a horse ends up within `r + 0.3` of any wagon/ox collider (wagon moved under it), it gets a `startle` and a push-out velocity; **the player pushing against a horse now nudges the horse** (small 0.2 m slide, it turns its head) instead of the player rubber-band-stuck — feels like a living animal, costs ~10 lines (reusable in `CollisionField` as an optional `soft` group).
3. **Terrain contact** — per-foot IK (A2) for all four animals; wagon keeps its 6-point probe but with corridor fixes (B1) and the added block-reason logging.
4. **Camera** — the cinematic's `desired.y += 2` trunk-avoid pop becomes a smooth 0.5 s lift (visible in the journey footage as a hitch).

Acceptance: scripted 10-minute soak (drive in circles, park in the clearing, walk between every pair of actors) with a `__astra`-driven overlap check (sphere test between every actor collider pair every frame, fail on > 2 frames of overlap > 0.1 m) — added to the browser smoke test.

---

## 6. Workstream E — D&D: "you can do anything"

### E1. A verb system (one small module)
- `InteractableRegistry`: anything in the world registers `{ position, radius, verbs: [{ id, label, icon, action, condition? }] }`.
- Proximity pick (nearest, line-of-sight optional) drives the existing bottom prompt; **E runs the default verb**; a **1–3 s hover of E (or number keys / a tiny 2–4 chip row above the prompt)** runs alternate verbs. Chips never pause the game, never open a modal — verbs are either direct actions (pet, call, light) or open the *compact* panels from §3.
- This turns the four hard-coded interactions into data, and makes every future interaction a 20-line addition.

### E2. Verbs to ship in this phase (in reach of the start scene)
| Target | Verbs | Scope |
|---|---|---|
| Horses | Examine (flavour), **Pet** (nuzzle + sound), **Call** | small |
| Oxen | Examine, **Gentle nudge** (head up, lowing) | small |
| Ransacked belongings | Examine, **Search** — *actual loot*: a coin purse (2 cp, 5 sp), a torn map fragment, 3 arrowheads (black fletching), a broken quiver → new items, new save-schema entries, journal note added | medium (core D&D verb) |
| Scattered arrows | Pick up (goes to inventory as "tipped arrows", 3) | small |
| Phandalin sign | Read (flavour) | small |
| Wagon (mounted) | Manifest (existing), Inspect wheels (creak + flavour) | small |
| Lanterns in inventory | **Light / extinguish** — a real point light + warm glow at the player, most felt in Blue Hour | medium (big D&D payoff for a small system) |
| Anywhere | **Rest** — 5 s cutscene (camera settle, birdsong, "The forest settles. You feel rested."), journal line | small, stretch: actually flag a "rested" buff for a future combat chapter |
| Trees/rocks (any) | Examine — 20 authored one-liners chosen by hash (never the same twice in a row) | small, huge flavour return |

- Search loot extends `src/game/items.ts` with 4 new items (kept out of the 100 gp consignment; `validateSave` extended for v2 with the same conservation proof, `astra-journey-v1` → `v2` with migration).
- The bean character: out of scope for this plan's animal work, but the same asset pipeline from A1 should be pointed at a **hooded wanderer rig** next (Phase 5) — it's the last remaining "out of place" hero prop. Flagged here, not estimated here.

### E3. Acceptance (verbs)
- [ ] Every E-prompt target supports ≥ 2 verbs without a modal; chips render in < 100 ms.
- [ ] Searching the belongings yields loot exactly once (idempotent, persisted, journal note), and the physical props change (purse leaves the bag, arrows picked up disappear).
- [ ] Lighting a lantern in Blue Hour produces a visible radius of warmth; toggle persists per session, resets on new game.

---

## 7. Cross-cutting work

- **Audio:** hoof/hoof-strike, lid creak, moos/whinnies, bird calls, search "clink". All via the existing `ForestAudio` Web Audio synth (no new downloads) — one `AnimalAudio` module.
- **Tests:**
  - Update `tests/animation.test.ts` to the new rig (weights, no-NaN soak).
  - New `tests/collision-corridor.test.ts`: `canDriveAt` true along ROAD for 30 m from the arrival pose (pure function test, no browser).
  - New `tests/horse-avoidance.test.ts`: retarget/push-out invariants.
  - Extend `scripts/browser-smoke.mjs`: drive 25 m, open *and close* a lid, pet a horse, overlap-soak check.
- **README:** update the "Art scope" and controls sections once shipped; keep the honest "not photoreal" wording but retarget it ("believable-realism").
- **Diagnostics:** keep the dev-only `__astra.getDebug()` (block-reason logging) — it's what caught the corridor bug and is the acceptance tool for B1/D.

---

## 8. Phases, order, estimates

Order chosen so the **start-of-game jank disappears first**, then the visual, then the depth:

| Phase | Work | Est. | Why this order |
|---|---|---|---|
| **1. Driveable & lootable** | B1 corridor fix + soft stops, B2 cargo loop (mounted reach, E toggle, side panel, close), B3 feel, D.2 player-nudge | **3 d** | Fixes the two "janky" complaints in the first minutes of play; smallest surface area, highest felt quality |
| **2. Living animals** | A1 asset swap, A2 rig/gait/IK, A3 behaviour, A4 audio, D.1/D.4 oxen spring + camera lift | **5 d** | The user's #1 issue; depends on nothing in Phase 1 |
| **3. Open forest** | C1 rings, C2 area/props, C3 ground fix, C4 life, C5 budget | **4 d** | Pure scene work, isolated to `nature.ts`/`landscape.ts` |
| **4. D&D verbs** | E1 registry, E2 verbs (search loot, lantern, rest, examines), E3, save v2 | **4 d** | Builds on Phase 1's panel system; needs the animals alive to pet/call |
| **5. Polish** | Full test suite + smoke extensions, README, perf pass on low-end, avatar rig scoping doc | **2 d** | |

**Total ≈ 18 engineer-days** on one person. Phases 1 and 2 are independently shippable.

---

## 9. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| No suitable CC0/CC-BY rigged ox/horse with needed bones+animations | Medium | Curation allows 3 candidates/species; fallback = procedural high-poly sculpt (A1 fallback, +2 d); license terms checked *before* integration (the current horse's provenance note in `credits.txt` shows why this matters) |
| 4 skinned animals + new rig break the 60 fps laptop target | Medium | A5 triangle budget, per-foot IK instead of physics, quality tiers reuse existing density scaling; measure with `getDiagnostics` in CI smoke |
| Extending the world (limit 70) exposes unauthored terrain edges | Medium | Fog already hides 170 m edge; ring treeline closes the silhouette; C6 acceptance includes the full walk |
| Save-schema change (v2) breaks existing saves | Low | Migration path + the existing invalid-save recovery key pattern; `validateSave` stays conservation-proven |
| Non-modal cargo panel conflicts with the pointer/camera code paths (written around pause-on-menu) | Medium | Panel is plain DOM like the HUD (no `setPaused`), input stays with the controller; regression covered by smoke test (move while panel open) |
| Sound scope creeps (animal audio is a rabbit hole) | Low | Hard cap: 8 one-shots + 2 loops, synth-first, no downloads |
