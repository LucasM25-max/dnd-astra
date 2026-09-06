import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

// A self-contained headless browser for minimal Linux workspaces. No browser CDN required.
const libs = path.join(os.tmpdir(), 'astra-browser-libs');
await fs.mkdir(libs, { recursive: true });
const archive = brotliDecompressSync(await fs.readFile('node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
const tar = path.join(libs, 'libraries.tar'); await fs.writeFile(tar, archive); execFileSync('tar', ['-xf', tar, '-C', libs]);
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(a => a !== '--single-process' && a !== '--in-process-gpu'),
  env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(60000);
const errors = [], failedRequests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', message => { if (message.type() === 'error' && !message.text().toLowerCase().includes('pointer lock')) errors.push(message.text()); });
page.on('requestfailed', r => failedRequests.push(r.url()));
await page.addInitScript(() => localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality: 'performance', atmosphere: 'golden', volume: .35, sensitivity: 1, invertY: false })));
const getState = () => page.evaluate(() => window.__astra.getState());
const waitState = predicate => page.waitForFunction(predicate, undefined, { timeout: 60000, polling: 100 });
try {
  await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-ready="true"]', { timeout: 120000 });
  await page.waitForSelector('#loading', { state: 'detached' });
  console.log('✓ World and local assets load');
  const initial = await getState();
  assert.equal(initial.mode, 'third'); assert.equal(initial.started, false);
  await page.click('#enter-world');
  await waitState(() => window.__astra.getState().started);
  await page.keyboard.down('KeyW');
  await waitState(() => window.__astra.getState().x > -11.4);
  await page.keyboard.up('KeyW');
  const walked = await getState(); assert(walked.distanceWalked > .8);
  console.log('✓ WASD moves the grounded character');
  await page.keyboard.press('Space');
  await waitState(() => !window.__astra.getState().grounded);
  await waitState(() => window.__astra.getState().grounded);
  console.log('✓ Jump and gravity return the player to the terrain');
  await page.keyboard.press('KeyV');
  await waitState(() => window.__astra.getState().mode === 'first');
  assert.equal(await page.locator('body').getAttribute('data-view'), 'first');
  await page.keyboard.press('KeyV');
  await waitState(() => window.__astra.getState().mode === 'third');
  console.log('✓ First- and third-person views toggle');
  await page.keyboard.press('KeyP');
  await waitState(() => !window.__astra.getState().paused);
  assert.equal(await page.locator('body').getAttribute('data-photo'), 'true');
  assert.equal(await page.locator('#dialog-backdrop').isVisible(), false);
  await page.keyboard.press('KeyP');
  console.log('✓ Photo mode releases a captured mouse without an unwanted pause dialog');
  await page.keyboard.press('Escape');
  if (await page.locator('#dialog-backdrop').isVisible()) await page.click('[data-action="close"]');
  await page.keyboard.press('KeyM');
  await page.waitForSelector('[data-kind="map"]');
  assert.equal((await getState()).paused, true);
  const mapSize = await page.locator('#world-map-canvas').evaluate(c => [c.width, c.height]); assert(mapSize[0] > 100);
  await page.keyboard.press('KeyM');
  await page.waitForSelector('#dialog-backdrop', { state: 'hidden' });
  console.log('✓ World map displays and pauses movement; M closes it');
  await page.click('#settings-toggle');
  const selectedQuality = await page.evaluate(() => {
    document.querySelector('[data-quality="balanced"]').click();
    const selected = window.__astra.getDiagnostics().quality;
    document.querySelector('[data-quality="performance"]').click();
    return selected;
  });
  assert.equal(selectedQuality, 'balanced');
  await page.click('[data-atmosphere="blue"]');
  assert.equal(await page.locator('#time-label').innerText(), 'BLUE HOUR');
  await page.click('[data-atmosphere="golden"]');
  await page.locator('#sensitivity').fill('1.3');
  assert.equal(await page.locator('#sensitivity-value').innerText(), '1.3×');
  await page.locator('[data-setting="invert"]').check();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('astra-preferences-v1'))); assert.equal(saved.invertY, true); assert.equal(saved.sensitivity, 1.3);
  await page.click('[data-action="audio"]');
  assert.equal(await page.locator('[data-action="audio"]').getAttribute('aria-checked'), 'true');
  await page.click('[data-action="audio"]');
  await page.click('[data-action="close"]');
  console.log('✓ Atmospheres, sound, sliders, and saved preferences work');
  await page.keyboard.press('KeyH'); await page.waitForSelector('[data-kind="help"]');
  await page.keyboard.press('Escape'); await page.waitForSelector('#dialog-backdrop', { state: 'hidden' });
  await page.keyboard.press('KeyP');
  assert.equal(await page.locator('body').getAttribute('data-photo'), 'true');
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#capture-photo'); const download = await downloadPromise;
  assert(download.suggestedFilename().startsWith('astra-triboar-trail-'));
  await page.click('#exit-photo');
  console.log('✓ Controls dialog, photo mode, and PNG download work');
  // Pointer-lock-independent mouse look works in constrained/embedded previews.
  await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  if (await page.locator('#dialog-backdrop').isVisible()) await page.click('[data-action="close"]');
  const yaw = (await getState()).yaw;
  await page.mouse.move(450, 210); await page.mouse.down({ button: 'right' }); await page.mouse.move(510, 225, { steps: 4 }); await page.mouse.up({ button: 'right' });
  assert(Math.abs((await getState()).yaw - yaw) > .05);
  console.log('✓ Click-and-drag camera fallback works without pointer lock');
  await page.evaluate(() => { document.querySelector('#world-canvas').requestPointerLock = () => Promise.reject(new DOMException('Blocked by iframe permissions', 'SecurityError')); });
  await page.mouse.click(450, 210);
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Drag to look'));
  console.log('✓ Denied pointer lock gives a usable embedded-preview fallback');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.click('#settings-toggle'); assert(await page.locator('#dialog').isVisible());
  await page.click('[data-action="close"]');
  console.log('✓ Mobile-sized layout and settings fit the viewport');
  assert.deepEqual(errors, []); assert.deepEqual(failedRequests, []);
  await fs.mkdir('.artifacts', { recursive: true });
  const beforeResize = await page.evaluate(() => window.__astra.getDiagnostics().frame);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(frame => window.__astra.getDiagnostics().frame > frame + 3, beforeResize, { timeout: 120000, polling: 100 });
  // Stop scheduling render frames before screenshotting a software GPU, not during gameplay checks.
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: '.artifacts/browser-smoke.png', timeout: 120000 });
  console.log('✓ No uncaught browser errors or failed asset requests');
  console.log('All browser smoke tests passed.');
} finally {
  console.log('Browser errors:', errors);
  await browser.close();
}
