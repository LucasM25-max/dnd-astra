import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

/**
 * Flexible diagnostic shooter. Usage:
 *   node scratch-diag.mjs <outDir> <shots.json>
 * shots.json: [{ name, clip, t, cam:[x,y,z], look:[x,y,z], fov?, hide?:string[], yaw?, animal?:{species,action,phase} , plain?:bool }]
 * cam/look are offsets from the hero position (or absolute when absolute:true).
 */
const outDir = process.argv[2] ?? '/home/user/diag';
const specFile = process.argv[3];
const SHOTS = JSON.parse(await fs.readFile(specFile, 'utf8'));
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
const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().toLowerCase().includes('pointer lock')) errors.push(m.text()); });

const QUALITY = process.env.ASTRA_QUALITY ?? 'performance';
await page.addInitScript(q => localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality: q, atmosphere: 'golden', volume: .35, sensitivity: 1, invertY: false })), QUALITY);
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
await page.waitForTimeout(800);
await page.keyboard.press('r');
await page.waitForFunction(() => !window.__astra.getState().mounted, { timeout: 30000 });
await page.evaluate(() => window.__astra.teleport(12.6, 7.2));
await page.waitForTimeout(700);
console.log('on foot');

for (const s of SHOTS) {
  await page.evaluate((spec) => {
    const world = window.__astra.getWorld();
    const { controller, camera } = world;
    world.pause('diag');
    controller.cameraOverride = true;
    controller.avatar.rotation.y = spec.yaw ?? 0;
    const hero = controller.actor.hero;
    hero.update(0);
    if (spec.clip) hero.freezeAt(spec.clip, spec.t ?? 0);
    if (spec.hide) {
      for (const name of spec.hide) {
        hero.root.traverse(o => { if (o.name === name || o.name.startsWith(name)) o.visible = false; });
      }
    }
    if (spec.showAll) hero.root.traverse(o => { o.visible = true; });
    if (spec.pre === 'restoreTied') world.adventure.restoreTied();
    let animalRoot = null;
    if (spec.animal) {
      const a = spec.animal;
      const list = a.kind === 'ox' ? world.adventure.wagon.oxen : world.adventure.horses;
      const animal = list[a.index ?? 0];
      animalRoot = animal.root;
      if (a.yaw !== undefined) animal.root.rotation.y = a.yaw;
      if (a.worldYaw !== undefined) animal.root.rotation.y = a.worldYaw - (a.kind === 'ox' ? world.adventure.wagon.root.rotation.y : 0);
      if (a.gait) animal.actor.freezeAt(a.gait, a.t ?? 0);
    }
    let camBase = null;
    if (spec.clear) {
      const terrainHeight = (x, z) => window.__astra.terrainAt(x, z);
      outer: for (let r = 0; r <= 4.01; r += .5) {
        for (let a = 0; a < 12; a++) {
          const x = spec.clear[0] + Math.cos(a / 12 * 6.283) * r, z = spec.clear[1] + Math.sin(a / 12 * 6.283) * r;
          if (world.collision.query(x, z, .45).size === 0) { camBase = { x, y: terrainHeight(x, z) + 1.62, z }; break outer; }
        }
      }
      if (!camBase) camBase = { x: spec.clear[0], y: terrainHeight(spec.clear[0], spec.clear[1]) + 1.62, z: spec.clear[1] };
    }
    const p = controller.position;
    if (spec.clear && camBase) { camera.position.set(camBase.x, camBase.y, camBase.z); }
    else if (spec.animalCam && animalRoot) {
      const aw = animalRoot.getWorldPosition(new (camera.position.constructor)());
      camera.position.set(aw.x + spec.cam[0], aw.y + spec.cam[1], aw.z + spec.cam[2]);
    }
    else if (spec.absolute) camera.position.set(...spec.cam);
    else camera.position.set(p.x + spec.cam[0], p.y + spec.cam[1], p.z + spec.cam[2]);
    if (spec.clear && camBase) { camera.lookAt(...spec.look); }
    else if (spec.animalCam && animalRoot) {
      const aw = animalRoot.getWorldPosition(new (camera.position.constructor)());
      camera.lookAt(aw.x + spec.look[0], aw.y + spec.look[1], aw.z + spec.look[2]);
    }
    else if (spec.absoluteLook) camera.lookAt(...spec.look);
    else camera.lookAt(p.x + spec.look[0], p.y + spec.look[1], p.z + spec.look[2]);
    if (spec.fov) { camera.fov = spec.fov; }
    camera.updateProjectionMatrix();
    world.renderer.info.reset();
    world.composer.render();
  }, s);
  const dataUrl = await page.evaluate(() => document.getElementById('world-canvas').toDataURL('image/png'));
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  await fs.writeFile(path.join(outDir, `${s.name}.png`), buf);
  console.log('saved', s.name);
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
