# Phase B — Skeletal Hero Models (deferred)

> **SUPERSEDED (Sept 2026).** Phase B is no longer deferred: the hero is a
> full skeletal rig (`src/character/skeletal/`) with procedural geometry,
> canvas-painted materials, and an animation state machine
> (`src/character/AnimationStateMachine.ts`), and every weapon/behaviour seam
> this document describes is wired up. The PNG paths referenced below no
> longer exist — character art is WebP under `/textures/character/` and
> `/textures/weapons/` (see `public/credits.txt`). **README.md's roadmap is
> the authoritative specification.** Keep this file only as historical
> context for the Phase A → B handoff.

Phase A (current) renders the hero as a painted 16-direction sprite billboard
with paint-only `attack` / `hit` / `down` flourish frames used by character
creation. A full skeletal GLB model with real animation clips cannot be
produced with the asset tools available in this environment, so it is
deferred to Phase B. Everything Phase B needs to plug in is already referenced:

## Ready now

- `src/data/equipment/weapons.json` — every weapon carries `texture`
  (albedo under `/textures/weapons/`) and `socketOffset` (metres, hand-local).
  The quiver entry reserves the `back_hip` socket.
- `src/data/equipment/armour.json` — chain mail reserves
  `texture: /textures/character/armour_chainmail_albedo.png` and
  `modelPath: /models/armour/chainmail.glb`.
- `src/game/character.ts` — saves store `portrait.faceTexture` (one of six
  `/textures/character/face_*.png`) and `hairMesh` (`short` | `long` | `braid`);
  ability scores carry an explicit `racialBonus` slot.
- `src/engine/actors/fighter.ts` — `attackPose` / `hitPose` / `downPose` encode
  the exact keyframe targets (windup → slash → follow-through → guard, hit
  stagger, grounded-knee defeat) for the animator to match.
- `SpriteActor.previewAction()` / `clearPreview()` — the creation-preview hook;
  Phase B keeps the same call sites and swaps the painter for a GLB player.

## Phase B scope

1. Author `hero_base.glb` (humanoid rig, ~8k tris) plus `chainmail.glb`,
   per-weapon GLBs, and three hair meshes; keep total hero draw under budget.
2. Author clips: `attack_slash` (1.2 s), `hit_react` (0.6 s), `down` (loopable
   kneel), matching the Phase A keyframes above.
3. Add a `SkeletalActor` implementing the `SpriteActor` scene contract
   (`root`, `update(state)`, `dispose()`), driven by the same `FighterLook`.
4. Swap `CreationPreview` and the world hero to `SkeletalActor` behind a
   quality flag; keep the painted billboard as the Performance-mode fallback.
5. Re-run `npm test` and `npm run test:browser` (creation flourish buttons
   cover the new clips).
