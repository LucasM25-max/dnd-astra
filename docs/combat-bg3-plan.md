# Combat polish plan — toward a Baldur's Gate 3 feel

Status: proposal. Nothing in this document is implemented yet.

This plan covers three things the request asks for, in dependency order:

1. **Fully animated goblins** as isometric sprite cards (the art gap is the blocker).
2. **Full enemy AI driven by the D&D stat block** (Nimble Escape, Pack Tactics,
   Redirect Attack, cover, archer kiting).
3. **Holding the current balance exactly**, because 1 and 2 both make the
   goblins meaningfully stronger and would otherwise silently break the fight.

Everything below is grounded in the code as it stands today. Where I state a
current behaviour I have verified it in the source or by running it; the
measured numbers in §0 come from an actual 300-trial simulation run.

---

## 0. Where combat actually stands today

The bones are much better than a typical prototype. `src/game/encounter.ts`
(986 lines) is a genuine 5e engine: initiative, action/bonus/movement budgets,
advantage/disadvantage with named sources, cover, opportunity attacks, death
saves, concentration checks, spell slots. `CombatDirector` (903 lines) already
does staged presentation — dice tray, wind-up, impact-timed poses, tracers,
camera focus, screen shake. That is a real foundation, not scaffolding.

The gaps are concentrated in two places.

### 0.1 The goblin sprite is a three-pose stub

`public/sprites/manifest.json`, read directly:

| figure | rows | states present | states missing |
|---|---|---|---|
| player | 6 | idle, walk (2f), run (2f), attack | hurt, down |
| **goblin** | **3** | **idle, walk (1f), attack** | **hurt, down, run, shoot, cast** |
| horse | 5 | idle, walk (2f), graze, alert | — |
| ox | 3 | idle, walk (2f) | — |

Two consequences follow, and both are visible in play:

- **The goblin walk is a single frame.** `SHEETS_PER_STATE.walk` in
  `scripts/prepare-sprite-sheets.mjs` expects `walk-0…walk-3`; only
  `goblin-walk-0.png` exists. A one-frame "cycle" means a goblin crossing 30 ft
  is a static image sliding along the ground. This is the single most
  immersion-breaking thing in the fight.
- **Missing states silently fall back to `idle`.** `SpriteFigure.selectState`
  does `this.clipFor('down') ? 'down' : 'idle'`. So a goblin that is *killed*
  stands calmly upright. `reactToHit` dutifully calls `playPose(id, 'down', …)`
  and the sprite path discards it. The 3D `Humanoid` fallback collapses
  correctly — which is why this reads as a sprite-specific regression.

Also worth flagging: `encounter-view.ts` picks pose `'shoot'` for bow users, and
`selectState` maps `'shoot'` onto the `attack` clip. So the archers currently
*swing a scimitar* to fire a bow.

### 0.2 The AI is one greedy heuristic

`runEnemyTurn()` is ~70 lines. It scores targets as:

```
score = -hp*2 - ac - gap*0.4 + (canSee ? 20 : -40)
```

…then closes to melee reach and swings. What the stat blocks promise but the AI
never does:

| Stat block feature | Implemented? | Reality |
|---|---|---|
| Nimble Escape — Disengage | partial | only as a retreat below 34% HP |
| Nimble Escape — **Hide** | **no** | never hides, though `doHide` exists |
| Pack Tactics (wolf) | rules only | `attackContext` grants it; no AI *seeks* it |
| Redirect Attack (boss) | **no** | trait is text-only, never fires |
| Goblin archer prefers range | **no** | archers charge into melee |
| Cover | rules only | `coverBetween` is honoured; AI never moves to cover |
| Focus fire / target switching | crude | no coordination beyond `focusFireCap` |

The archer behaviour is the clearest tell. `goblinArcher` has a shortbow
(80/320 ft) and a dagger as an explicit *"last resort when something reaches the
treeline"* — but the AI closes to 5 ft and stabs, because melee is checked
first. The stat block's intent is inverted.

### 0.3 The balance invariant (measured, not assumed)

I ran the `solo-balance` harness at 300 trials/class:

| class | solo win rate | raw (no solo layer) | avg rounds |
|---|---|---|---|
| fighter | **89.0%** | 9.0% | 5.3 |
| wizard | **75.0%** | 0.0% | 4.8 |
| rogue | **71.0%** | 0.0% | 4.8 |
| cleric | **79.0%** | 2.0% | 5.6 |
| ranger | **80.0%** | 0.0% | 4.5 |

`tests/solo-balance.test.ts` pins these: every class in **60–95%**, spread
**< 30 pts**. The ambush is 400 adjusted XP against a solo-deadly threshold of
100 — 4× deadly — and `solo-balance.ts` is the declared, inspectable layer that
makes it winnable.

**This is the constraint that shapes the whole plan.** Every AI improvement in
§2 is a straight buff to the goblins. Smart archers kiting at 80 ft, goblins
hiding for advantage, and a boss redirecting hits would, unchecked, push the
wizard and rogue well below 60% and break the fight *and* the test suite. §3
exists to pay that back deliberately.

---

## 1. Fully animated goblins

### 1.1 The art is the blocker, and it needs your call

The pipeline is already good: `prepare-sprite-sheets.mjs` takes a 4×4 magenta-
keyed turn-around sheet per state, finds 16 blobs, keys and despills, normalises
to one bottom-anchored scale, and packs an atlas + manifest. Adding a state is
genuinely just "drop `goblin-<state>.png` in and re-run".

So the work is **generating seven new 4×4 goblin sheets**, consistent with the
existing character across all 16 angles:

| sheet | purpose | priority |
|---|---|---|
| `goblin-walk-1/2/3.png` | real 4-frame walk cycle | **P0** |
| `goblin-down.png` | death collapse | **P0** |
| `goblin-hurt.png` | flinch on damage | **P0** |
| `goblin-shoot.png` | bow draw/loose (archers) | P1 |
| `goblin-run-0/1.png` | Dash / charge | P2 |

> **Decision needed.** These must match the existing goblin's silhouette,
> palette and lighting across 16 angles, or the atlas will visibly jitter
> between states. Three routes: (a) generate with the image tool and iterate
> against the existing sheets, (b) you supply sheets from the original source,
> (c) derive `hurt`/`down` procedurally from `idle` (see 1.3) and generate only
> walk + shoot. I'd start with (c) for a fast correct-looking result, then
> upgrade to real art. **I'd like your steer before I spend generation effort.**

### 1.2 Engine work (small, and independent of the art)

- **`SHEETS_PER_STATE`** already lists `walk-0…3`; add `run-0/1`, `shoot`,
  `cast`. Extend `KINDS.goblin.states` with fps values — walk ≈ 3.4 (already
  set), run ≈ 5.6, hurt/down 0.
- **Non-looping clips.** `down` must play once and *hold the last frame*;
  today `setRow` cycles `Math.floor(animTime) % rows.length`, which would loop a
  death animation forever. Add `loop: boolean` to `StateClip` and clamp when
  false. **This is a real bug that only appears once `down` art exists** — worth
  fixing in the same change so it never ships broken.
- **`shoot` as a first-class state.** Add to `SpriteAnimState`; in
  `selectState`, map `pose === 'shoot'` to `clipFor('shoot') ?? clipFor('attack')`.
- **Directional mirroring (optional, halves the art).** Columns 1–7 and 9–15 are
  mirror pairs. Sampling 16–col with a negated u for the back half would let a
  sheet ship 9 angles instead of 16. Worth it only if art generation proves slow.

### 1.3 Procedural fallbacks — the pragmatic first step

`SpriteFigure` *already* has card-level motion: `lunge`, `mesh.rotation.z`,
`bobT/bobAmp`, and a `dying` branch. Before any new art we can get a large
fraction of the perceived quality from:

- **hurt** — sharp lunge back + ~14° card tilt + a brief red tint on `uTint`,
  decaying over ~0.4 s (the hooks exist; they are simply not driven for goblins).
- **down** — rotate the card to ground plane over ~0.9 s with a slight scale
  squash and fade `uOpacity` to ~0.85, leaving a corpse card.
- **walk bob** — vertical bob + subtle counter-rotation scaled by ground speed,
  which disguises a low frame count considerably.

This is maybe half a day, needs no art, and makes death and damage *read*
immediately. Recommend doing this first regardless of the art decision.

### 1.4 Verification

Extend `scripts/dev/shots.mjs` (already in the repo from the texture work) with
a combat pass: spring the ambush, force each state via `playPose`, capture per
state × 4 angles into a contact sheet. Add unit tests to
`tests/sprite-figure.test.ts`: `down` holds its final frame and does not loop;
`shoot` resolves to the shoot row when present and falls back to attack when
absent; every manifest state has ≥1 row.

---

## 2. Enemy AI matching the stat block

### 2.1 Architecture: extract a tactics module

Rather than growing `runEnemyTurn`, add **`src/game/tactics.ts`** — a pure
function from an immutable read-only view of the encounter to a scored plan:

```ts
export interface TacticalPlan {
  intent: 'attack' | 'kite' | 'hide' | 'reposition' | 'flee' | 'redirect';
  targetId?: string;
  moveTo?: Vec2;
  actionId?: string;
  bonusAction?: 'hide' | 'disengage';
  reason: string;   // surfaced in the combat log — BG3 shows its reasoning
}

export function planTurn(view: TacticalView, rng: () => number): TacticalPlan;
```

Pure and deterministic-under-seed means it is **directly unit-testable without a
renderer**, which is how the repo already tests `placeRocks` and the corridor
guarantee. `runEnemyTurn` becomes a thin executor: call `planTurn`, apply.

### 2.2 Behaviours, mapped to the stat block

**Nimble Escape (all goblins).** Bonus action Hide *or* Disengage every turn:

- Hide when in cover, unseen, or after a ranged attack from concealment — it
  grants advantage on the next attack, which is the trait's actual value.
- Disengage when in melee reach and wanting to withdraw (current low-HP retreat
  becomes one case of a general rule).

**Archer kiting (`goblinArcher`).** Invert the current preference: prefer the
shortbow, maintain 30–60 ft, retreat-and-shoot when a melee threat closes,
switch to dagger only when cornered (no escape route, or already engaged with
no movement left). This alone makes the ambush *feel* like an ambush.

**Cover seeking.** `coverBetween` already exists and `coverAcBonus` is already
applied. Add a light scoring pass: sample candidate destinations within the
movement budget, score `cover_gained − exposure − distance_cost`. The ambush
site has real props (`ambush-props.ts`) to hide behind, so this pays off
visually as well as mechanically.

**Pack Tactics (wolf).** The rules layer grants advantage when an ally is within
5 ft of the target; the AI should *seek* it — prefer destinations that put an
ally adjacent, so wolves visibly flank.

**Redirect Attack (`goblinBoss`).** Currently pure flavour text. Needs a real
reaction hook: on being targeted, swap places with an adjacent goblin and
retarget. This requires a **reaction system** the engine does not yet have —
see §5, it's the largest single piece of new machinery here.

**Morale.** Generalise the hardcoded `checkFleeCondition` (last goblin flees) into
a morale score from HP, allies lost, and whether the boss lives. Goblins are
written to *"scatter the moment a fight turns"*.

### 2.3 Difficulty as an explicit dial

Add `tacticalSkill: 0..1` to `SoloProfile`, threaded into `planTurn`:

- `0.0` — today's greedy behaviour.
- `0.5` — kiting + cover, no coordination.
- `1.0` — full focus-fire coordination, optimal Hide timing.

This makes the AI upgrade **tunable rather than a cliff**, and it is the primary
lever for §3. It also gives a future difficulty setting somewhere real to land.

---

## 3. Holding the balance (the part that must not be hand-waved)

The AI in §2 is a substantial goblin buff. The plan is explicitly to **re-tune
the solo layer to absorb it**, not to hope it lands.

### 3.1 Measure first

`tests/solo-balance.test.ts` already has the harness. Before touching AI:

1. Raise the trial count in a throwaway run (300+) for tighter confidence — at
   120 trials the ±1σ band is ~4 pts, which is too loose to tune against.
2. Record per-class baselines (§0.3) as the reference table.
3. Add avg rounds and avg hero HP-remaining as secondary signals — win rate
   alone hides "won with 1 HP every time", which feels very different to play.

### 3.2 Tune against the invariant

Bring up AI features **one at a time**, each behind a `tacticalSkill` threshold,
re-running the harness after each. When a feature pushes any class out of band,
pay it back with the existing declared levers in `soloProfile`:

| lever | current (level 1, 4× deadly) | direction if AI gets stronger |
|---|---|---|
| `enemyHpScale` | ~0.78 | ↓ toward 0.70 |
| `focusFireCap` | 3 | keep at 3 |
| `bonusHp` | closes to ~25 effective | ↑ modestly |
| `luck` | 1–2 rerolls | ↑ for squishy classes |
| `tacticalSkill` | *new* | ↓ if other levers run out |

The honesty constraint from `solo-balance.ts` holds: every adjustment stays a
*declared, inspectable modifier* over the printed numbers, surfaced in the
"Solo adventurer" UI. Smarter goblins with fewer HP is a legitimate trade and
we should say so in the notes; silently nerfing to-hit would not be.

### 3.3 The gate

The existing tests are the acceptance criteria and **must not be relaxed**:

- every class **60–95%**
- spread **< 30 pts**
- always terminates, < 40 rounds
- raw (no-solo) rates stay < 20%, proving the layer still does the work

I'd add: no class may move more than **±8 pts** from its §0.3 baseline. That is
stricter than the test band and is what actually enforces *"balanced as they
currently are"* rather than merely "still inside the legal range".

---

## 4. BG3-flavoured presentation polish

Ranked by impact-per-effort. Much of the hard work (dice tray, impact timing,
tracers, floaters) already exists.

**High impact, low effort**

- **Reaction//opportunity-attack callouts.** BG3 announces reactions loudly.
  `combat-fx.ts` floaters already exist; wire them to OA and reaction events.
- **Show the AI's reasoning.** `TacticalPlan.reason` into the combat log
  ("The archer falls back to the treeline"). Cheap, and it makes the AI *legible*
  — a large part of why BG3's combat feels intelligent rather than arbitrary.
- **Advantage/disadvantage in the roll.** The engine tracks named sources
  already; show both d20s with the discarded one struck through.
- **Kill cam.** Brief slow-motion + camera push on the killing blow. The
  director already has `addShake` and camera focus.

**Medium**

- **Turn-order portraits** with HP pips and status icons, not just names.
- **Threat-range preview** on hover — `threatOverlay` exists and is underused.
- **Cover indicators** on the target when cover applies to the shot.

**Larger**

- **Cinematic camera per turn** — frame the acting goblin, ease between actors.
- **Verticality / height advantage** — the terrain has real slope
  (`terrainHeight`), so a height bonus is mechanically available and unused.

---

## 5. Risks and unknowns

- **Reaction system (Redirect Attack) is the biggest unknown.** The engine
  resolves attacks synchronously in `resolveWeaponAttack`; interrupting mid-
  resolution to let a boss swap places needs a genuine reaction hook. It touches
  the most load-bearing code path in the engine. I'd sequence it **last** and
  ship the boss without Redirect if it looks like destabilising attack
  resolution.
- **Art consistency across 16 angles** is the main quality risk for §1 — hence
  the recommendation to land procedural hurt/down first (1.3) so there is a
  correct-looking fallback that does not depend on generation quality.
- **Balance tuning is empirical and may take several passes.** The harness makes
  it tractable but not instant; expect iteration.
- **AI cost.** Cover sampling per enemy turn is more work than today's scoring.
  Should be negligible at 4 enemies, but the ambush is the *small* case — worth
  a budget check before larger encounters.

---

## 6. Suggested sequencing

Each phase is independently shippable and leaves the game in a working state.

| phase | contents | balance risk |
|---|---|---|
| **1** | Procedural hurt/down/bob (1.3); `loop` flag fix; `shoot` state plumbing | none |
| **2** | Goblin walk cycle + down/hurt art; contact-sheet verification | none |
| **3** | Extract `tactics.ts`; port current behaviour **unchanged**; add tests | **none — pure refactor, rates must not move** |
| **4** | Archer kiting + Nimble Escape Hide, behind `tacticalSkill` | **high — tune here** |
| **5** | Cover seeking, Pack Tactics, morale | **high — tune here** |
| **6** | Presentation polish (§4) | none |
| **7** | Reaction system + Redirect Attack | medium |

Phase 3 is the one to insist on: porting the existing AI verbatim into the new
module, with the win-rate table unchanged, proves the refactor is sound *before*
any behaviour change makes movement in the numbers ambiguous.

---

## Open questions

1. **Goblin art** — generate, supply, or procedural-first? (1.1)
2. **Scope** — everything through phase 7, or stop after phase 5 (fully animated
   + smart AI, skipping reactions)?
3. **`tacticalSkill` as a player-facing difficulty setting**, or purely an
   internal balance lever?
4. **Balance target** — hold the §0.3 baselines within ±8 pts (my
   recommendation), or accept a deliberate shift, e.g. fighter down toward 80%
   to tighten the class spread?
