// Combat sprite probe: spring the ambush and prove the goblins render as
// 16-direction sprite cards. Verifies (a) EncounterView built SpriteFigure
// bodies (not Humanoid rigs), (b) the goblin card draws (same-task
// double-render toggle diff), (c) attack rows exist on the goblin figure.
import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const libs = path.join(os.tmpdir(), 'astra-browser-libs'); await fs.mkdir(libs, { recursive: true });
const tar = path.join(libs, 'libraries.tar');
await fs.writeFile(tar, brotliDecompressSync(await fs.readFile('node_modules/@sparticuz/chromium/bin/al2023.tar.br'))); execFileSync('tar', ['-xf', tar, '-C', libs]);
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !['--single-process', '--in-process-gpu'].includes(a)), env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` }, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().toLowerCase().includes('pointer lock')) errors.push('CONSOLE: ' + m.text()); });
await page.addInitScript(() => localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality: 'performance', atmosphere: 'golden', volume: .3, sensitivity: 1, invertY: false })));
const wait = (predicate, t = 90000) => page.waitForFunction(predicate, undefined, { timeout: t, polling: 100 });
setTimeout(() => { console.log('WATCHDOG: aborting'); process.exit(2); }, 420000).unref?.();

try {
  await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-ready="true"]', { timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'detached' });
  await page.click('#character-create');
  await page.waitForSelector('[data-character="name"]');
  await page.fill('[data-character="name"]', 'Combat Sprite Check');
  await page.waitForTimeout(400);
  await page.click('.cc-footer [data-action="character-create"]');
  await page.waitForTimeout(600);
  await page.click('#enter-world'); await wait(() => window.__astra.getState().story.active);
  await page.waitForTimeout(800);
  await page.click('#journey-skip'); await wait(() => window.__astra.getState().story.phase === 'arrival');
  await page.waitForTimeout(600);
  for (let i = 0; i < 24; i++) {
    const phase = await page.evaluate(() => window.__astra.getState().story.phase);
    if (phase === 'exploration') break;
    await page.click('#narrator-next', { force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await wait(() => window.__astra.getState().story.phase === 'exploration', 30000);

  await page.keyboard.press('r');
  await wait(() => !window.__astra.getState().mounted, 20000);
  await wait(() => window.__astra.getAdventure().controller.controlMode === 'foot', 20000);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__astra.teleport(9.7, 2.0));
  await wait(() => window.__astra.getCombatPhase().phase === 'active' || window.__astra.getCombatPhase().phase === 'sprung', 30000);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'qa/combat-goblin-cards.png' });

  // What did EncounterView build, and does a goblin card actually draw?
  const probe = await page.evaluate(() => {
    const a = window.__astra.getAdventure();
    const view = a.combatDirector.view;
    const renderer = a.combatDirector.renderer;
    const cam = a.camera;
    let scene = a.controller.avatar;
    while (scene.parent) scene = scene.parent;
    const report = { actors: [] };
    for (const [id, av] of view.actors) {
      report.actors.push({
        id,
        bodyType: av.body?.constructor?.name,
        isSprite: !!av.body?.debugState,
        visible: av.body?.root?.visible,
      });
    }
    const goblins = [...view.actors.values()].filter(av => av.body?.debugState);
    if (goblins.length) {
      const project = (x, y, z) => {
        const m = cam.matrixWorldInverse.elements, p = cam.projectionMatrix.elements;
        const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
        const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
        const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
        const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
        return { x: +(cx / cw * .5 + .5).toFixed(2), y: +(1 - (cy / cw * .5 + .5)).toFixed(2), front: cw > 0 };
      };
      report.projections = goblins.map(g => {
        g.body.root.updateWorldMatrix(true, false);
        const e = g.body.root.matrixWorld.elements;
        return { id: g.combatant?.id, ...project(e[12], e[13], e[14]) };
      });
      report.goblinStates = goblins[0].body.debugState();
      // Same-task double render at FULL resolution: hide ALL goblin cards.
      const c2 = document.createElement('canvas'); c2.width = renderer.domElement.width; c2.height = renderer.domElement.height;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      const grab = () => { renderer.render(scene, cam); ctx.drawImage(renderer.domElement, 0, 0); return ctx.getImageData(0, 0, c2.width, c2.height).data; };
      const base = grab();
      for (const g of goblins) g.body.root.visible = false;
      const hidden = grab();
      for (const g of goblins) g.body.root.visible = true;
      let n = 0;
      for (let i = 0; i < base.length; i += 4) {
        if (Math.abs(base[i] - hidden[i]) + Math.abs(base[i + 1] - hidden[i + 1]) + Math.abs(base[i + 2] - hidden[i + 2]) > 30) n++;
      }
      report.goblinToggleDiffPx = n;
      report.goblinOnScreen = n > 40;
      // restore the app's own frame
      renderer.render(scene, cam);
    }
    return report;
  });
  console.log('combat actor bodies:', JSON.stringify(probe.actors, null, 1));
  console.log('goblin figure state:', JSON.stringify({ ...probe.goblinStates, worldPos: undefined }));
  console.log('goblin NDC projections:', JSON.stringify(probe.projections));
  console.log('goblin card toggle diff px:', probe.goblinToggleDiffPx, probe.goblinOnScreen ? '→ DRAWN ✓' : '→ NOT DRAWN');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
} catch (e) {
  console.log('CHECK FAILED:', e.message);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no captured errors');
}
await browser.close();
