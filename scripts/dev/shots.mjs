import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

/**
 * Ad-hoc visual capture used while iterating on world textures and sprites.
 * Usage: node scripts/dev/shots.mjs <outDir>
 */
const OUT = process.argv[2] ?? 'qa/shots';
const libs = path.join(os.tmpdir(), 'astra-browser-libs'); await fs.mkdir(libs, { recursive: true });
const tar = path.join(libs, 'libraries.tar');
await fs.writeFile(tar, brotliDecompressSync(await fs.readFile('node_modules/@sparticuz/chromium/bin/al2023.tar.br')));
execFileSync('tar', ['-xf', tar, '-C', libs]);
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(a => !['--single-process', '--in-process-gpu'].includes(a)),
  env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().toLowerCase().includes('pointer lock')) errors.push('CONSOLE: ' + m.text()); });
await page.addInitScript(() => localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality: 'performance', atmosphere: 'golden', volume: 0, sensitivity: 1, invertY: false })));
await fs.mkdir(OUT, { recursive: true });
const shot = async name => { try { await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 90000 }); console.log('shot', name); } catch (e) { console.log('shot FAILED', name, e.message); } };
const wait = (fn, t = 90000) => page.waitForFunction(fn, undefined, { timeout: t, polling: 100 });

setTimeout(() => { console.log('WATCHDOG: aborting'); process.exit(2); }, 600000).unref?.();

/** Put the free camera at (x,z) looking toward (tx,tz), then screenshot. */
async function look(name, x, z, tx, tz, pitch = -0.18, height = 1.7) {
  await page.evaluate(([x, z, tx, tz, pitch, height]) => {
    const a = window.__astra.getAdventure();
    window.__astra.teleport(x, z);
    const c = a.controller;
    c.yaw = Math.atan2(-(tx - x), -(tz - z));
    c.pitch = pitch;
    c.avatar.rotation.y = c.yaw;
    if (c.eyeHeight !== undefined) c.eyeHeight = height;
  }, [x, z, tx, tz, pitch, height]);
  await page.waitForTimeout(1100);
  await shot(name);
}

try {
  await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-ready="true"]', { timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'detached' });
  await page.waitForTimeout(1500);
  await shot('00-title');

  await page.click('#enter-world');
  await wait(() => window.__astra.getState().story.active);
  await page.waitForTimeout(1500);
  await shot('01-journey');
  await page.click('#journey-skip');
  await wait(() => window.__astra.getState().story.phase === 'arrival');
  for (let i = 0; i < 24; i++) {
    const phase = await page.evaluate(() => window.__astra.getState().story.phase);
    if (phase === 'exploration') break;
    await page.click('#narrator-next', { force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await wait(() => window.__astra.getState().story.phase === 'exploration', 30000);
  await page.keyboard.press('r');
  await wait(() => !window.__astra.getState().mounted, 20000);
  await page.waitForTimeout(800);
  await shot('02-exploration');

  // Ground / road / trail / rock beauty passes.
  await look('03-road-rocks', 0, 6, 0, -6, -0.12);
  await look('04-road-ahead', -14, 2.4, 6, 1.5, -0.10);
  await look('05-forest-floor-down', -6, -8, -6.2, -8.4, -0.85);
  await look('06-road-down', 0, 0.6, 0.4, 0.2, -0.9);
  await look('07-boulder-outcrop', -24, -12, -28, -14, -0.05);
  await look('08-trail', 7.8, -6, 7.8, -12, -0.15);
  await look('09-trail-down', 7.8, -9, 7.9, -9.4, -0.85);

  // Player sprite: stand the actor in front of the camera.
  await page.evaluate(() => {
    const a = window.__astra.getAdventure();
    window.__astra.teleport(-14, 2.4);
    a.controller.yaw = 0; a.controller.pitch = 0; a.controller.avatar.rotation.y = 0;
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => { const a = window.__astra.getAdventure(); if (a.setView) a.setView('third'); });
  await page.click('[data-view="third"]').catch(() => {});
  await page.waitForTimeout(1400);
  await shot('10-player-sprite');

  // Wagon team (oxen + horse sprites) head-on.
  await page.evaluate(() => {
    const a = window.__astra.getAdventure();
    const lead = a.oxSkins?.[0]?.figure?.root ?? a.wagon.root;
    const yaw = a.wagon.root.rotation.y;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const px = lead.position.x + fx * 9, pz = lead.position.z + fz * 9;
    window.__astra.teleport(px, pz);
    a.controller.yaw = Math.atan2(-(lead.position.x - px), -(lead.position.z - pz));
    a.controller.pitch = -0.05;
    a.controller.avatar.rotation.y = a.controller.yaw;
  });
  await page.waitForTimeout(1400);
  await shot('11-wagon-team');

  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 12).join('\n') : 'NO PAGE ERRORS');
} catch (e) {
  console.log('CAPTURE FAILED:', e.message);
  await shot('zz-failure');
  console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 12).join('\n') : 'no captured errors');
}
await browser.close();
