# Astra — Chapter I: A delivery for Gundren

A playable **Three.js + TypeScript + Vite** fantasy RPG prototype, beginning with a narrated wagon journey on the Triboar Trail. The original, non-grid Goblin Ambush woodland remains the setting. There is no login or game backend; everything needed to play, including the Narrator’s voice, is served locally by the app.

## Play the chapter

Click **Begin your journey**. Your bean character begins on the wagon’s driving bench, holding the reins of two yoked oxen. A roughly one-minute opening follows the wagon down the road while the Narrator reads the supplied Neverwinter/Gundren introduction verbatim, in four readable pages.

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

The oxen and horses have skinned bodies with articulated legs, neck/head motion, breathing, and tail movement. The horses alternate between short walks and investigating the belongings. Moving actors and the wagon have collision volumes. Driving is constrained by terrain, obstacles, and space: the full wagon cannot simply cross steep banks or squeeze along the narrow Cragmaw trail.

**Art scope:** this remains a realism-focused browser prototype. The detailed wagon/cargo geometry is procedural; the animal surfaces are reshaped, subdivided derivatives of the credited reference mesh, with new skeletal rigs. Textures are image-based with derived normal maps, not a production photogrammetry set. A finished AAA-photorealistic art pass and broader hardware profiling remain future work.

## Inventory and gold pieces

Press **R** to dismount, walk beside a container, and press **E** to open it. Take a chosen quantity or everything in that container. **I** opens the inventory; it includes currency at the top, categories, search, quantities, per-item values, stack values, and item descriptions. The cargo manifest shows what is still on the wagon and which containers are open, sealed, or empty.

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
| E | Open nearby cargo / inspect belongings | Read the cargo manifest |
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
npm test                  # 31 deterministic map, economy, story, transport, and rig checks
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
src/game/road.ts                  Continuous wagon route and heading
src/engine/adventure.ts           Chapter orchestration, driving, boarding, interactions, saves
src/engine/actors/                Wagon/cargo construction, materials, and animal rigs
src/engine/landscape.ts           Original map curves, height field, static/dynamic collisions
src/engine/nature.ts              Spatially instanced trees, grass, ferns, rocks, and deadwood
src/engine/controller.ts          Foot movement, seated bean/hands, camera and input handling
src/engine/world.ts               Renderer, atmosphere, quality, world update, capture
src/ui/                          HUD, Narrator panel, inventory/cargo, dialogs, cartography
assets-source/                   Original generated texture sources (not served in production)
public/audio/narration/           Bundled voice clips and duration/source manifest
public/credits.txt               Asset/library provenance and license references
```

The supplied reference map’s image is not redistributed, and no grid is drawn in the world or maps. Cragmaw Hideout and Phandalin remain destinations beyond this scene, not built settlements. This is an unofficial D&D-inspired prototype. Review setting and asset rights before a public commercial release.
