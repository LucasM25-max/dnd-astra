import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const outDir = process.argv[2] ?? '/home/user/shots';
const only = process.argv[3]?.split(',') ?? null;
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
console.log('world ready');

await page.click('#journey-skip');
await page.waitForFunction(() => window.__astra.getState().story.phase === 'arrival');
for (let i = 0; i < 3; i++) {
  await page.click('#narrator-next').catch(() => {});
  await page.waitForTimeout(300);
}
await page.waitForTimeout(1200);
await page.keyboard.press('r');
await page.waitForFunction(() => !window.__astra.getState().mounted, { timeout: 30000 });
// Move the hero to clear ground inside the campsite circle (flat terrain).
await page.evaluate(() => window.__astra.teleport(12.6, 7.2));
await page.waitForTimeout(700);
console.log('on foot, teleported to clear ground');

const SHOTS = [
  { name: 'idle-front', clip: 'idle', t: 0.4, cam: [-1.7, 1.4, -2.6], look: [0, 1.0, 0] },
  { name: 'idle-side', clip: 'idle', t: 0.4, cam: [2.8, 1.3, -0.2], look: [0, 0.95, 0] },
  { name: 'idle-back', clip: 'idle', t: 0.4, cam: [-1.2, 1.6, 2.8], look: [0, 1.05, 0] },
  { name: 'walk-0', clip: 'walk', t: 0.0, cam: [2.2, 0.85, -1.6], look: [0, 0.75, 0] },
  { name: 'walk-1', clip: 'walk', t: 0.25, cam: [2.2, 0.85, -1.6], look: [0, 0.75, 0] },
  { name: 'walk-2', clip: 'walk', t: 0.5, cam: [2.2, 0.85, -1.6], look: [0, 0.75, 0] },
  { name: 'walk-3', clip: 'walk', t: 0.75, cam: [2.2, 0.85, -1.6], look: [0, 0.75, 0] },
  { name: 'walk-feet', clip: 'walk', t: 0.16, cam: [1.1, 0.55, -1.1], look: [0, 0.25, 0] },
  { name: 'walk-feet2', clip: 'walk', t: 0.55, cam: [1.1, 0.55, 1.1], look: [0, 0.25, 0] },
  { name: 'walk-front', clip: 'walk', t: 0.25, cam: [-2.3, 1.0, -2.0], look: [0, 0.8, 0] },
  { name: 'run-1', clip: 'run', t: 0.15, cam: [2.5, 1.0, -1.4], look: [0, 0.9, 0] },
  { name: 'run-2', clip: 'run', t: 0.5, cam: [2.5, 1.0, -1.4], look: [0, 0.9, 0] },
  { name: 'sit', clip: 'long_rest_sit', t: 0.8, cam: [2.0, 0.95, -1.6], look: [0, 0.55, 0] },
  { name: 'interact', clip: 'interact', t: 0.45, cam: [2.0, 0.95, -1.6], look: [0, 0.6, 0] },
  { name: 'chair', clip: 'sit_chair', t: 0.7, cam: [2.0, 0.95, -1.6], look: [0, 0.6, 0] },
];

for (const s of SHOTS) {
  if (only && !only.includes(s.name)) continue;
  await page.evaluate((spec) => {
    const world = window.__astra.getWorld();
    const { controller, camera } = world;
    world.pause('diag');
    controller.cameraOverride = true; // stop the follow-cam from overwriting our lens
    controller.avatar.rotation.y = 0; // deterministic: hero faces -Z
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
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  await fs.writeFile(path.join(outDir, `${s.name}.png`), buf);
  console.log('saved', s.name, buf.length);
}

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
