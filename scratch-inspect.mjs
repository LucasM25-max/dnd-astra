import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

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
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.setDefaultTimeout(120000);
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
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
for (let i = 0; i < 3; i++) { await page.click('#narrator-next').catch(() => {}); await page.waitForTimeout(250); }
await page.waitForTimeout(800);

const report = await page.evaluate(() => {
  const world = window.__astra.getWorld();
  const hero = world.controller.actor.hero;
  world.pause('diag');
  hero.update(0);
  hero.freezeAt('idle', 0.4);
  const root = hero.root;
  root.updateMatrixWorld(true);
  const out = [];
  const v = (o) => {
    const p = o.getWorldPosition(new world.camera.position.constructor(0, 0, 0));
    const r = o.getWorldRotation ? o.getWorldRotation(new world.camera.position.constructor(0, 0, 0)) : null;
    return p;
  };
  const V3 = world.camera.position.constructor;
  const tmp = new V3();
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      const p = o.getWorldPosition(new V3());
      const rel = root.worldToLocal(p.clone()); // position in hero-local (avatar) space
      out.push({ name: o.name || o.type, pos: [rel.x.toFixed(3), rel.y.toFixed(3), rel.z.toFixed(3)] });
    }
  });
  // bones too
  const bones = {};
  Object.entries(hero.rig.bones).forEach(([k, b]) => {
    const p = b.getWorldPosition(new V3());
    const rel = root.worldToLocal(p.clone());
    bones[k] = [rel.x.toFixed(3), rel.y.toFixed(3), rel.z.toFixed(3)];
  });
  world.resume('diag');
  return { meshes: out, bones };
});
console.log(JSON.stringify(report, null, 1));
await browser.close();
