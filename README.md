# Astra — The Triboar Trail

A playable, real-time 3D woodland exploration prototype built with **Three.js, TypeScript, and Vite**. There is no backend, login, API key, or runtime asset CDN. The production build is a static site ready for Vercel.

## The environment

The layout follows the supplied **Goblin Ambush** map:

- A broad, curved east–west road through the lower part of the reference area.
- A narrower trail branching north toward Cragmaw Hideout.
- Raised, overgrown forest banks on either side of the paths.
- Two fallen horses, emptied packs, and scattered arrows near the ambush junction. No graphic effects or combat.
- Woodland extending beyond the reference image to make the area explorable.

The map's five-foot squares informed the approximate dimensions, but **neither the world nor the in-game cartography displays a grid**. Terrain and movement are continuous. The reference image itself is not redistributed. Cragmaw Hideout and Phandalin are directions, not additional built locations.

### Included

- A deliberately simple bean/capsule character, with walking, sprinting, jumping, gravity, and terrain/tree/rock collisions.
- First-person and orbiting third-person cameras, camera-obstacle avoidance, and mouse-wheel distance adjustment.
- Pointer lock where allowed; click-and-drag look when an embedded preview denies it.
- Image-based terrain, bark, stone, and leaf materials; derived normal maps; HDR environment lighting; shadows; fog; subtle light shafts; wind-driven foliage and airborne particles.
- Spatially batched, instanced vegetation and three working performance presets.
- A live local map, expanded area map, compass, contextual location discovery, and an inspectable ambush scene.
- Golden-hour, overcast, and blue-hour lighting presets.
- Opt-in synthesized forest ambience and footsteps, with a volume control.
- Photo mode and actual PNG capture/download.
- Pause and controls dialogs, keyboard focus management, mobile layouts, and touch movement/look/jump controls.
- Device-local graphics and input preferences. Player progress is **not** saved.

**Visual scope:** this is a browser-rendered environment foundation, not a finished AAA-photorealistic RPG. Terrain, vegetation, and rock geometry are procedural; the materials are image-based, not a complete photogrammetry asset set. Production photorealism will need a dedicated asset/art pass, more advanced lighting, and further profiling on target hardware. There are no enemies, quests, inventory, or combat systems yet.

## Run locally

Use **Node.js 22**.

```bash
npm ci
npm run dev
```

Open the Vite URL (port **5173**). The server binds to `0.0.0.0`; Arena's `.e2b.app` preview hosts are allowed. Assets and application requests use relative same-origin URLs, not browser-facing localhost API calls.

```bash
npm run build       # Type-check and create dist/
npm run preview     # Serve the production build on port 4173
```

A WebGL 2-capable browser and hardware acceleration are recommended. Start with **Performance** on low-powered or software-rendered devices. It reduces vegetation density and render resolution, uses cheaper shadows, and disables HDR environment sampling and bloom. **Balanced** and **High fidelity** retain the fuller lighting pipeline. Paused dialogs do not continuously redraw the 3D scene; changing a setting still updates it.

## Controls

| Input | Action |
| --- | --- |
| W A S D / arrow keys | Walk |
| Shift | Sprint while moving |
| Space | Jump |
| Mouse | Look (click to capture, or click and drag) |
| Mouse wheel | Third-person camera distance |
| V | First / third person |
| M | Open / close the map |
| H | Controls guide |
| P | Photo mode |
| E | Inspect the ambush clearing when nearby |
| Escape | Release the mouse, pause, or close a dialog |

On touch devices, use the left movement pad, drag the world to look, and tap the jump button. Sound is off until explicitly enabled. If fullscreen is blocked by an embed, use the host preview's expand control.

## Later deployment to Vercel

Nothing has been deployed automatically. When ready, publish the branch to GitHub and import the project into Vercel:

- **Framework:** Vite
- **Node:** 22.x
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Environment variables:** none

`vercel.json` supplies the build settings and cache headers. All runtime assets are local, approximately **6.4 MB** before the application bundles/fonts. Keep `node_modules`, `dist`, and browser screenshots out of Git; `.gitignore` already excludes them.

Review the D&D setting/reference and third-party asset rights before a public commercial release. This is an unofficial environment prototype, not an official Wizards of the Coast product.

## Checks

```bash
npm test             # Deterministic map, terrain, and collision tests
npm run build        # Strict TypeScript + production bundling
npm run test:browser # Real-browser integration checks (start the dev server first)
```

The browser smoke suite is intended for a **Linux sandbox**. It uses the development-only `@sparticuz/chromium` package, extracts its supporting libraries into the system temp directory, and drives it with Playwright; no browser-CDN download is required. It checks loading, movement, jump/landing, camera modes, map/pause behaviour, atmosphere and input settings, audio switching, PNG download, drag-look fallback, and the small-screen layout. Override the target with `BASE_URL` if needed. Screenshots go to ignored `.artifacts/`.

Actual integration validation is in Chromium; Firefox/Safari compatibility uses standard WebGL 2 and browser APIs but has not been independently verified here. Software GPU smoke-test speed is not a claim about native-GPU frame rate.

## Project structure

```text
src/engine/landscape.ts   Map curves, continuous height field, deterministic noise, spatial collisions
src/engine/nature.ts      Terrain and spatially instanced trees, rocks, grass, ferns, shrubs, deadwood
src/engine/materials.ts   Local PBR material loading, blending, and foliage shaders
src/engine/props.ts       Environmental ambush props
src/engine/controller.ts  Capsule movement, gravity, camera modes, collision, pointer/touch input
src/engine/world.ts       Renderer, lighting, atmosphere, quality budgets, postprocessing, capture
src/engine/audio.ts       Opt-in local wind, birds, and footsteps
src/ui/                  HUD, interactive dialogs, map drawing, settings
src/styles.css           Responsive cinematic interface
assets-source/           Original generated texture sources; not served in production
public/                  Optimized runtime assets and third-party license notices
```

Edit the control points and landmarks in `landscape.ts` to refine the reference-map trace. Edit `SPAWN` there to change the initial location and heading. The explorable boundary is ±47 metres; surrounding terrain and trees provide a larger visual backdrop.

To regenerate the optimized texture assets and derived normal maps from the included source images:

```bash
npm run assets:prepare
```

See [`public/credits.txt`](public/credits.txt) for asset and library provenance.
