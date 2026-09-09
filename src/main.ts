import './styles.css';
import './adventure.css';
import { WoodlandWorld } from './engine/world';
import { WorldInterface, refreshIcons } from './ui/interface';
import { renderShell } from './ui/shell';

renderShell(document.getElementById('app')!);
refreshIcons();
document.body.dataset.view = 'third';
document.body.dataset.playing = 'false';
document.body.dataset.photo = 'false';
document.body.dataset.locked = 'false';
document.body.dataset.story = 'title';
document.body.dataset.mounted = 'true';
document.body.dataset.narrating = 'false';
let world: WoodlandWorld | undefined;
let ui: WorldInterface | undefined;
function showError(contextLost = false, loadingFailed = false) {
  let screen = document.getElementById('loading');
  if (!screen) { screen = document.createElement('div'); screen.id = 'loading'; screen.className = 'loading-screen'; document.getElementById('experience')!.append(screen); }
  screen.classList.remove('finished');
  screen.innerHTML = `<div class="error-panel"><h1>The woodland couldn’t open.</h1><p>${contextLost ? 'Your browser paused the 3D renderer. Reload to reopen the trail, and try Performance mode in settings.' : loadingFailed ? 'A world asset or graphics resource could not be loaded. Check your connection and reload to try again.' : 'This world needs a browser with WebGL 2 and hardware acceleration. Check that graphics acceleration is enabled, then try again.'}</p><button class="enter-button" id="retry-world">Try again <span>↗</span></button><small>Chrome, Edge, Firefox, and Safari with WebGL 2 are supported.<br>No installation or account is needed.</small></div>`;
  document.getElementById('retry-world')!.addEventListener('click', () => location.reload());
}
async function boot() {
  try {
    world = new WoodlandWorld(document.getElementById('world')!);
    world.onContextLost = () => showError(true);
    await world.initialize((amount, label) => {
      document.getElementById('loading-progress')!.style.width = `${amount}%`;
      document.getElementById('loading-label')!.textContent = label;
    });
    ui = new WorldInterface(world);
    document.getElementById('experience')!.dataset.ready = 'true';
    const loading = document.getElementById('loading')!;
    loading.classList.add('finished');
    setTimeout(() => loading.remove(), 900);
    if (import.meta.env.DEV) {
      // Read-only diagnostics for local browser smoke tests; omitted from production.
      Object.defineProperty(window, '__astra', { configurable: true, value: { getState: () => world!.getState(), getDiagnostics: () => world!.diagnostics, getInventory: () => world!.adventure.inventory.snapshot() } });
    }
  } catch (error) {
    console.error('The woodland could not initialize:', error);
    world?.stop(); showError(false, !!world);
  }
}
void boot();
if (import.meta.hot) import.meta.hot.dispose(() => { ui?.dispose(); world?.dispose(); });
