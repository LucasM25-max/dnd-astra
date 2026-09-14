import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const outDir = process.argv[2] ?? '/home/user/shots';
await fs.mkdir(outDir, { recursive: true });
const libs = path.join(os.tmpdir(), 'astra-browser-libs');
await fs.mkdir(libs, { recursive: true });
const tar = path.join(libs, 'libraries.tar');
await fs.writeFile(tar, brotliDecompressSync(await fs.readFile('/home/user/dnd-astra/node_modules/@sparticuz/chromium/bin/al2023.tar.br')));
execFileSync('tar', ['-xf', tar, '-C', libs]);
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(a => !['--single-process', '--in-process-gpu'].includes(a)),
  env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().toLowerCase().includes('pointer lock')) errors.push(m.text()); });

await page.addInitScript(() => localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality: 'performance', atmosphere: 'golden', volume: .35, sensitivity: 1, invertY: false })));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#enter-world:visible');
await page.click('#enter-world');
await page.waitForSelector('#char-creation:visible');
await page.click('[data-recommended]');
await page.click('[data-review]');
await page.waitForSelector('[data-forge]:visible');
await page.click('[data-forge]');
await page.waitForSelector('[data-ready="true"]', { timeout: 240000 });
await page.waitForSelector('#loading', { state: 'detached' });
await page.click('#journey-skip');
await page.waitForFunction(() => window.__astra.getState().story.phase === 'arrival');
for (let i = 0; i < 3; i++) { await page.click('#narrator-next').catch(() => {}); await page.waitForTimeout(300); }
await page.waitForTimeout(1000);
await page.keyboard.press('r');
await page.waitForFunction(() => !window.__astra.getState().mounted, { timeout: 30000 });
await page.evaluate(() => window.__astra.teleport(12.6, 7.2));
await page.waitForTimeout(700);
console.log('ready');

const SHOTS = [
  { name: 'close-feet-front', clip: 'idle', t: 0.4, cam: [0.55, 0.42, -0.85], look: [0, 0.18, 0] },
  { name: 'close-feet-side', clip: 'idle', t: 0.4, cam: [0.85, 0.42, 0.15], look: [0, 0.2, 0] },
  { name: 'close-legs-side', clip: 'idle', t: 0.4, cam: [0.95, 0.62, -0.1], look: [0, 0.55, 0] },
  { name: 'close-legs-walk', clip: 'walk', t: 0.3, cam: [0.95, 0.62, -0.1], look: [0, 0.55, 0] },
  { name: 'close-legs-walk2', clip: 'walk', t: 0.62, cam: [0.95, 0.62, -0.1], look: [0, 0.55, 0] },
  { name: 'close-torso-front', clip: 'idle', t: 0.4, cam: [-0.35, 1.15, -1.0], look: [0, 1.1, 0] },
  { name: 'close-back', clip: 'idle', t: 0.4, cam: [0.05, 1.25, 1.05], look: [0, 1.15, 0] },
  { name: 'close-head', clip: 'idle', t: 0.4, cam: [-0.4, 1.72, -0.75], look: [0, 1.62, 0] },
];

for (const s of SHOTS) {
  await page.evaluate((spec) => {
    const world = window.__astra.getWorld();
    const { controller, camera } = world;
    world.pause('diag');
    controller.cameraOverride = true;
    controller.avatar.rotation.y = 0;
    const hero = controller.actor.hero;
    hero.update(0);
    hero.freezeAt(spec.clip, spec.t);
    const p = controller.position;
    camera.position.set(p.x + spec.cam[0], p.y + spec.cam[1], p.z + spec.cam[2]);
    camera.lookAt(p.x + spec.look[0], p.y + spec.look[1], p.z + spec.look[2]);
    camera.updateProjectionMatrix();
    world.renderer.info.reset();
    world.composer.render();
  }, s);
  const dataUrl = await page.evaluate(() => document.getElementById('world-canvas').toDataURL('image/png'));
  await fs.writeFile(path.join(outDir, `${s.name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('saved', s.name);
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
