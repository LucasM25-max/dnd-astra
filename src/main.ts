import './styles.css';
import './adventure.css';
import './systems/dice/dice.css';
import './ui/creation/creation.css';
import './ui/systems.css';
import { WoodlandWorld } from './engine/world';
import { WorldInterface, refreshIcons } from './ui/interface';
import { renderShell } from './ui/shell';
import { CharacterCreationScreen } from './ui/creation/CharacterCreationScreen';
import { InventoryStore } from './game/save';
import type { PlayerCharacter } from './game/character';

renderShell(document.getElementById('app')!);
refreshIcons();
document.body.dataset.view = 'third';
document.body.dataset.playing = 'false';
document.body.dataset.photo = 'false';
document.body.dataset.locked = 'false';
document.body.dataset.story = 'title';
document.body.dataset.mounted = 'true';
document.body.dataset.narrating = 'false';
document.body.dataset.modal = 'false';

// Boot opens on the title: the loading veil stays parked until the world is
// actually needed (returning hero entering, or a fresh hero finishing the forge).
const loadingEl = document.getElementById('loading');
if (loadingEl) loadingEl.style.display = 'none';

// Returning travellers see their continuation promise on the title itself.
try {
  const preboot = new InventoryStore(window.localStorage);
  if (preboot.arrived) {
    document.querySelector('#enter-world span')!.textContent = 'Continue your journey';
    document.getElementById('welcome-save-note')!.textContent = 'YOUR CARGO & INVENTORY ARE SAVED ON THIS DEVICE';
  }
} catch { /* Title defaults stand. */ }

let world: WoodlandWorld | undefined;
let ui: WorldInterface | undefined;
let creation: CharacterCreationScreen | null = null;
let initPromise: Promise<void> | null = null;
let initDone = false;

function showError(contextLost = false, loadingFailed = false) {
  let screen = document.getElementById('loading');
  if (!screen) { screen = document.createElement('div'); screen.id = 'loading'; screen.className = 'loading-screen'; document.getElementById('experience')!.append(screen); }
  screen.style.display = '';
  screen.classList.remove('finished');
  screen.innerHTML = `<div class="error-panel"><h1>The woodland couldn’t open.</h1><p>${contextLost ? 'Your browser paused the 3D renderer. Reload to reopen the trail, and try Performance mode in settings.' : loadingFailed ? 'A world asset or graphics resource could not be loaded. Check your connection and reload to try again.' : 'This world needs a browser with WebGL 2 and hardware acceleration. Check that graphics acceleration is enabled, then try again.'}</p><button class="enter-button" id="retry-world">Try again <span>↗</span></button><small>Chrome, Edge, Firefox, and Safari with WebGL 2 are supported.<br>No installation or account is needed.</small></div>`;
  document.getElementById('retry-world')!.addEventListener('click', () => location.reload());
}

function showVeil(): void {
  const screen = document.getElementById('loading');
  if (!screen || initDone) return;
  screen.style.display = '';
  screen.classList.remove('finished');
}

function hideVeil(): void {
  const screen = document.getElementById('loading');
  if (!screen) return;
  screen.classList.add('finished');
  setTimeout(() => screen.remove(), 900);
}

/** Hero record forged in a previous session (read before the world exists). */
function prebootCharacter(): PlayerCharacter | null {
  try {
    return new InventoryStore(window.localStorage).getCharacter();
  } catch {
    return null;
  }
}

/**
 * Build the world at most once. `foreground` decides whether the loading veil
 * covers the screen — background initialisation (behind creation) stays silent
 * and only shows the veil if the player forges before it finishes.
 */
function ensureWorld(foreground: boolean): Promise<void> {
  if (initDone) return Promise.resolve();
  if (foreground) showVeil();
  if (!initPromise) {
    initPromise = (async () => {
      try {
        world = new WoodlandWorld(document.getElementById('world')!);
        world.onContextLost = () => showError(true);
        await world.initialize((amount, label) => {
          document.getElementById('loading-progress')!.style.width = `${amount}%`;
          document.getElementById('loading-label')!.textContent = label;
        });
        ui = new WorldInterface(world);
        document.getElementById('experience')!.dataset.ready = 'true';
        initDone = true;
        hideVeil();
        if (import.meta.env.DEV) {
          // Read-only diagnostics for local browser smoke tests; omitted from production.
          Object.defineProperty(window, '__astra', {
            configurable: true,
            value: {
              getState: () => world!.getState(), getDiagnostics: () => world!.diagnostics, getInventory: () => world!.adventure.inventory.snapshot(), getWorld: () => world!,
              getCharacter: () => world!.adventure.inventory.getCharacter(),
              setTime: (minuteOfDay: number) => world!.setTimeOfDay(minuteOfDay),
              setWeather: (override: 'auto' | 'sun' | 'overcast' | 'rain' | 'storm' | 'snow' | 'wind') => world!.setWeatherOverride(override),
              openCamp: () => world!.openCamp(),
              previewRoll: (die: 4 | 6 | 8 | 10 | 12 | 20 = 20, modifier = 0, label = 'Preview Roll', dc?: number) =>
                import('./systems/dice/DiceRoller').then(({ roll }) => roll({ die, modifier, label, dc })),
            },
          });
        }
      } catch (error) {
        console.error('The woodland could not initialize:', error);
        world?.stop();
        world = undefined;
        ui = undefined;
        initPromise = null;
        showError(false, true);
        throw error;
      }
    })();
  }
  return initPromise;
}

/** FORGE YOUR LEGEND gates entry: no hero record, no journey. */
async function onBegin(): Promise<void> {
  // Fade the welcome; the creation screen (or loading veil) covers the HUD meanwhile.
  document.body.dataset.playing = 'true';
  if (prebootCharacter()) {
    // Returning hero: load the world, then enter it.
    try {
      await ensureWorld(true);
    } catch {
      return; // Error screen is already showing.
    }
    ui?.start();
    return;
  }
  // New hero: forge first while the world loads silently behind creation.
  const screen = new CharacterCreationScreen({
    onComplete: async character => {
      creation = null;
      try {
        await ensureWorld(true);
      } catch {
        return; // Error screen is already showing.
      }
      world!.adventure.inventory.saveCharacter(character);
      world!.syncHeroFromSave();
      ui?.start();
    },
  });
  creation = screen;
  screen.open();
  try {
    await ensureWorld(false);
  } catch {
    screen.close();
    creation = null;
  }
}

document.getElementById('enter-world')!.addEventListener('click', () => void onBegin(), { once: true });
if (import.meta.hot) import.meta.hot.dispose(() => { creation?.close(); ui?.dispose(); world?.dispose(); });
