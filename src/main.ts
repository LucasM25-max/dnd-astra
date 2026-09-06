import './styles.css';
import './adventure.css';
import { WoodlandWorld } from './engine/world';
import { terrainHeight } from './engine/landscape';
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
      Object.defineProperty(window, '__astra', { configurable: true, value: { getState: () => world!.getState(), getDiagnostics: () => world!.diagnostics, getInventory: () => world!.adventure.inventory.snapshot(),
        getAdventure: () => world!.adventure as unknown as { canDriveAt: (x:number,z:number,yaw:number)=>boolean },
        getDebug: (forwardMeters = 0) => {
          const w = world!, st = w.getState();
          const c = w.collision;
          const near = [...c.query(st.wagon.x, st.wagon.z, 2.5)].map(o => ({ x: +o.x.toFixed(2), z: +o.z.toFixed(2), r: +o.radius.toFixed(2), bottom: +o.bottom.toFixed(2), top: +o.top.toFixed(2), group: o.group ?? 'static' }));
          const yaw = st.wagon.yaw;
          const x = st.wagon.x - Math.sin(yaw) * forwardMeters, z = st.wagon.z - Math.cos(yaw) * forwardMeters;
          const centerY = terrainHeight(x, z);
          const probes = [[-0.98, -1.2], [0.98, -1.2], [-0.98, 1.2], [0.98, 1.2], [-0.72, -4.95], [0.72, -4.95]].map(([px, pz]) => {
            const wx = x + px * Math.cos(yaw) + pz * Math.sin(yaw), wz = z - px * Math.sin(yaw) + pz * Math.cos(yaw);
            const hits = [...c.query(wx, wz, 0.2)].filter(cc => cc.group !== 'wagon' && Math.hypot(wx - cc.x, wz - cc.z) < cc.radius + 0.17 && cc.top > centerY + 0.3).map(cc => ({ x: +cc.x.toFixed(2), z: +cc.z.toFixed(2), r: +cc.radius.toFixed(2), top: +cc.top.toFixed(2), group: cc.group ?? 'static' }));
            const terrainBlock = terrainHeight(wx, wz) - centerY > 0.44;
            return { px, pz, terrainBlock, terrainDelta: +(terrainHeight(wx, wz) - centerY).toFixed(3), hits };
          });
          return { keys: [...w.controller.keys], controlMode: w.controller.controlMode, paused: w.controller.paused, mounted: w.adventure.mounted, wagon: { x: +st.wagon.x.toFixed(3), z: +st.wagon.z.toFixed(3), yaw: +st.wagon.yaw.toFixed(3) }, collidersNearWagon: near, driveProbes: probes, canDrive: (d: number) => { const wx = x - Math.sin(yaw) * d, wz = z - Math.cos(yaw) * d; return (w.adventure as unknown as { canDriveAt: (x: number, z: number, yaw: number) => boolean }).canDriveAt(wx, wz, yaw); } };
        } } });
    }
  } catch (error) {
    console.error('The woodland could not initialize:', error);
    world?.stop(); showError(false, !!world);
  }
}
void boot();
if (import.meta.hot) import.meta.hot.dispose(() => { ui?.dispose(); world?.dispose(); });
