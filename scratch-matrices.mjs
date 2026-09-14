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

const report = await page.evaluate(() => {
  const world = window.__astra.getWorld();
  const hero = world.controller.actor.hero;
  world.pause('diag');
  hero.update(0);
  hero.freezeAt('idle', 0.0);
  const V3 = world.camera.position.constructor;
  const out = [];
  hero.root.updateMatrixWorld(true);
  hero.root.traverse((o) => {
    if (!o.name) return;
    const p = new V3(); o.getWorldPosition(p);
    const root = hero.root;
    const rel = root.worldToLocal(p.clone());
    const m = o.matrix.clone();
    const e = m.elements;
    out.push({
      name: o.name,
      parent: o.parent?.name || o.parent?.type || 'root',
      localPos: [m.elements[12].toFixed(4), m.elements[13].toFixed(4), m.elements[14].toFixed(4)],
      localScale: [m.elements[0].toFixed(3), m.elements[5].toFixed(3), m.elements[10].toFixed(3)],
      localRotYdeg: (Math.atan2(m.elements[8], m.elements[10]) * 180 / Math.PI).toFixed(1),
      worldLocal: [rel.x.toFixed(3), rel.y.toFixed(3), rel.z.toFixed(3)],
    });
  });
  world.resume('diag');
  return out;
});
for (const r of report) {
  console.log(`${r.name.padEnd(22)} parent=${r.parent.padEnd(16)} local=(${r.localPos.join(', ')}) scale=(${r.localScale.join(',')}) rotY=${r.localRotYdeg}° world=(${r.worldLocal.join(', ')})`);
}
await browser.close();
