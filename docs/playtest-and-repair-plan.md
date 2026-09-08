# Astra — playtest, model repair and gameplay pass

Session branch: `arena/01a0806e-dnd-astra`.
Baseline: `45b3ea7` — 78 unit tests pass, `tsc --noEmit` clean, dev server boots, no page errors.

This document is the plan that drove the work. It records what was found by
playtesting, what will change, and how each change will be verified. Items are
marked **[found]**, **[planned]** and later **[done]** as the pass proceeds.

---

## 0. How the game will be playtested

The sandbox has no display, and screenshots cannot be inspected by eye here, so
the playtest uses two purpose-built harnesses instead of guesswork.

1. **A model lab** (`dev/lab.html`, dev-only, deleted before the final commit).
   It instantiates a single creature in an isolated scene, renders it from the
   front/side/back with a three-light rig, and prints the result as **ASCII
   luminance art** plus a geometry audit:
   - bounding box, so a 1.15 m goblin cannot silently be 3 m tall;
   - degenerate/NaN triangle counts;
   - **winding-vs-normal mismatch** — the number of triangles whose winding
     disagrees with the shaded normal. Under back-face culling every one of
     those is a hole.
   - a **back-face-only render**: any lit pixel there is inverted or missing
     geometry.
2. **The existing browser suites** — `scripts/ambush-smoke.mjs` (full fight to
   victory and defeat) and `scripts/visual-qa.mjs` — plus the vitest suite, run
   before and after every stage.

---

## 1. The dice are cooked — **[found]**

`src/engine/actors/dice.ts`, `DiceTray`.

| # | Bug | Effect |
| - | --- | ------ |
| 1.1 | `spawnDie()` builds a `TumblingDie`, adds its group to the scene, and returns it — **but never pushes it into `this.dice`**. | `update()` iterates an empty array, so no die ever falls, spins or settles. `get settled()` is `false` forever, so the `onSettled` callbacks that advance the strike animation **never fire**. Every attack stalls in the `dice` phase until the 3.8 s watchdog fires, and `clear()` removes nothing, so **every rolled die is leaked into the scene permanently** — a pile of frozen dice hanging in mid-air. |
| 1.2 | `numberedPolyhedron()` calls `source.dispose()` even when `g === source` (all non-indexed polyhedra). | Disposes the geometry it is about to return. |
| 1.3 | Rest height uses `radius * 0.7` for every shape. | A d20's true resting height is its *in*radius, not 70 % of its circumradius; dice sink into the ground. |
| 1.4 | Faces are numbered `faceIndex + 1` in cluster order. | Values are scattered randomly over the die. On a real d20 opposite faces sum to 21. |
| 1.5 | Face UVs are built from the first triangle's edge. | Numerals land at arbitrary rotations. |
| 1.6 | The damage roll re-spawns a d20 alongside the damage dice. | Two d20s tumble for one attack. |

**Plan:** register spawned dice; stop disposing a live geometry; store a true
per-shape inradius; renumber d20 faces so opposites sum to 21; orient every
numeral upright on its face; let a damage roll keep the already-settled d20 and
add only the damage dice.

**Verify:** a headless dice test that rolls every die type N times and asserts
(a) each die reaches `settled`, (b) the up-facing normal belongs to the face
whose value was requested, (c) the settled value always equals the requested
value, (d) the tray's scene-graph child count returns to zero after `clear()`.

---

## 2. Every humanoid is rigged to a single point at the feet — **[found]**

`src/engine/actors/humanoid.ts`. The 18-bone skeleton parents the bones
correctly but **only `pelvis` is ever given a position — and it is set to
`(0,0,0)`**. Every other bone is left at the origin, so hip, knee, foot,
shoulder, elbow, hand, neck and head all rotate about the model's feet.

Consequences: the *rest* pose is correct, so the model looks right standing
still; the instant anything rotates, the thigh swings away from the pelvis, the
forearm detaches at the elbow, and the head orbits the ankle. This affects the
player avatar, every goblin, and every pose — walk, run, attack, cast, hurt,
down, dead.

Because the attachments (eyes, teeth, tusks, hair, garments, pauldrons,
bracers, the controller's class equipment) were authored in **model space** and
parented to bones that were assumed to be at the origin, moving the bones
requires converting those offsets to bone-local space too.

**Plan:**
- Give every bone an anatomically correct position derived from `anatomyOf()`:
  pelvis at `hipY`, spine at the waist, chest at `chestY`, neck at `neckY`,
  head at the base of the skull, shoulders at `±shoulderX / shoulderY`, elbows
  one upper-arm below, hands one forearm below, hips at `±hipX`, knees one
  thigh below, feet one shin below.
- Convert `addFace()`, `addOutfit()` and `PlayerController.setEquipment()` from
  model-space to bone-local placement via `bone.worldToLocal(...)`, so nothing
  shifts when the bones move.
- Re-tune the poses that were compensating for the broken pivots: the death
  fall (currently pivots at the feet *and* drops 0.4 h through the floor), the
  lunge, and the crouch.

**Verify:** the lab's front/side/back ASCII for `hero` and `goblin` at `idle`,
`walk` and `attack`; plus a new vitest rig test asserting (a) each joint bone's
rest position lies within a tolerance of its anatomical landmark, (b) rotating
a hip bone by 1 radian moves the foot but not the pelvis, (c) no bone-to-bone
distance changes by more than a few centimetres across a full gait cycle.

---

## 3. The horses and oxen are lofted inside-out — **[found]**

`src/engine/actors/animals.ts`. Both loft helpers emit quads as
`quad(a,b,c,d) → (a,b,c) (c,b,d)`. For a convex quad whose vertices are listed
around the perimeter, the second triangle must be `(a,c,d)`; `(c,b,d)` is the
reversed winding.

| # | Bug | Effect |
| - | --- | ------ |
| 3.1 | `loftSections()` and `loftColumn()` reverse the second triangle of every quad. | Roughly half of every torso, neck, head, leg and hoof is back-facing. Under back-face culling the animal is full of holes; `smoothNormals()` averages opposing normals, so the shading is wrong everywhere too. Lab audit on the horse: **613 of 2284 triangles disagree with their shaded normal.** |
| 3.2 | `loftSections()` end-cap: the `poles[1]` triangle uses `endOffset + 1` as the apex and `endOffset + j` as the base. | Both indices are **out of range** — the vertex array ends at `endOffset`. Torso and head emit garbage triangles. |
| 3.3 | `loftSections()` start-cap winding is reversed. | The chest/nose cap faces inward. |
| 3.4 | `loftColumn()` top cap winding is reversed (bottom cap is correct). | The tops of legs, tail and hooves are open. |
| 3.5 | The mane cards are positioned with **model-space** crest coordinates but parented to the `neck` **bone**, which already sits at `neckBase` (0, 1.02, −0.64). | The mane floats about a metre above the horse's neck. This is why the horse's bounding box is **3.0 m tall and 3.5 m long** instead of ~1.5 m × 2.4 m. |
| 3.6 | The `body` bone sits at the origin, so body pitch/roll rotates the torso about the ground rather than the shoulder line. | Visible torso translation during every gait cycle. |
| 3.7 | `loftSections()` allocates a zero-filled `normal` attribute, and `loftColumn()` leaves a dead `offset` variable. | Dead weight / misleading code. |

**Plan:** fix all four winding sites; correct the cap indices; move the mane
into neck-bone-local space; raise the `body` bone to the torso centroid;
remove the dead normal attribute and variable.

**Verify:** the lab audit should report `windingVsNormalMismatch=0` and an
empty back-face render for `horse` and `ox`; the bounding box should land at
roughly horse 1.5 m tall / 2.4 m long and ox 1.3 m / 2.4 m. Add a vitest that
builds both species and asserts zero mismatches and sane bounding boxes, so
this cannot regress.

---

## 4. Gameplay improvements — **[planned]**

Ordered by how much they change the feel of the chapter.

4.1. **Strike presentation.** With the dice fixed, the hero's d20 and damage
     dice actually tumble and the `onSettled` chain fires, so the wind-up
     follows the roll instead of a watchdog. Re-time the cluster phases now
     that the real durations are known (`dice` → `windup` → `flight` →
     `linger`) and remove the 3.8 s/3.2 s escape hatches, keeping a single
     generous safety cap.

4.2. **Enemy turns read as movement.** `visual-qa.mjs` reported
     `goblin position samples during enemy turn: 0` — the sampler never
     captured a moving root. Investigate and confirm enemies interpolate to
     their new position rather than teleporting; fix if they do.

4.3. **Hero readability in combat.** The player's own body is the controller
     avatar; confirm it carries a weapon in hand for the strike animation and
     that the first-person arms still line up with the new skeleton.

4.4. **Death and dying.** Rework the `down`/`dead` poses for the corrected
     skeleton so a fallen goblin lies on the ground instead of pivoting through
     it, and make sure the survivor's flight to the trail animates.

4.5. **Combat HUD/log.** After the dice fix, assert in the browser suite that
     attack log entries carry their presentation payload and that the dice
     results shown match the numbers the engine kept.

4.6. **Documentation.** `README.md` still says "combat is not yet enabled" and
     describes a 31-test suite that now has 78; bring it in line with the
     build.

4.7. **Save/load.** Confirm a save written mid-combat or after the fight
     restores correctly, and that the solo hit-point loan never leaks onto the
     saved sheet (already covered by `ambush-smoke.mjs` — keep it green).

---

## 5. Order of work

1. Model lab + harness (so every later change is measured, not guessed).
2. Dice (§1) — smallest, most visible, self-contained.
3. Humanoid skeleton (§2) — the largest single visual fix.
4. Animals (§3) — winding, caps, mane, body pivot.
5. Gameplay (§4) — retime, verify, document.
6. Full re-run: `tsc`, `vitest`, `ambush-smoke`, `visual-qa`; remove `dev/`.

## 6. Definition of done

- `tsc --noEmit` clean; `vitest run` green with new rig/dice/winding tests.
- Model lab: zero winding mismatches, empty back-face renders, sane bounding
  boxes for goblin, hero, horse and ox; idle/walk/attack poses anatomically
  plausible in the ASCII renders.
- `ambush-smoke.mjs` passes end to end (defeat branch + victory branch, XP
  awarded, no stat leakage, zero page errors).
- `visual-qa.mjs` reports no UI overlaps, no page errors, and captures the
  dice mid-tumble.
- `README.md` matches the shipped build.
