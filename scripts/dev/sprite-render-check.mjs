// Sprite render proof, v3 — synchronous double-render toggle diff.
// Renders two frames inside ONE JS task with only a figure's visibility
// toggled between them: no time passes, so every differing pixel belongs to
// that figure's card. Also sweeps the camera around an ox (fixed yaw, unlike
// the player-tracking horses) to verify the 16-direction column selection.
//   node scripts/dev/sprite-render-check.mjs
import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';

import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const libs = path.join(os.tmpdir(), 'astra-browser-libs');
await fs.mkdir(libs, { recursive: true });
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
  await page.fill('[data-character="name"]', 'Sprite Check');
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

  // Dismount — wait until the controller is genuinely back on foot, or the
  // wagon seat re-captures the player position every frame.
  await page.keyboard.press('r');
  await wait(() => !window.__astra.getState().mounted, 20000);
  await wait(() => window.__astra.getAdventure().controller.controlMode === 'foot', 20000);
  await page.waitForTimeout(800);

  // Stage 10m BEHIND the wagon, looking forward through it and the team.
  // (The ambush trigger at ~(9.7, 2.0) must stay untripped, or the cinematic
  // combat camera hijacks the probe.)
  const staged = await page.evaluate(() => {
    const a = window.__astra.getAdventure();
    const w = a.wagon.root.position, yaw = a.wagon.root.rotation.y;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);                 // wagon forward
    const px = w.x - fx * 10, pz = w.z - fz * 10;
    window.__astra.teleport(px, pz);
    a.controller.yaw = Math.atan2(-fx, -fz);                       // face the team
    a.controller.avatar.rotation.y = a.controller.yaw;
    a.controller.pitch = 0.1;
    return { wagon: [w.x, w.z], player: [px, pz] };
  });
  console.log('staging:', JSON.stringify(staged));
  await page.waitForTimeout(2000);

  // Synchronous toggle-diff: two renders in one task, only visibility differs.
  const probe = await page.evaluate(() => {
    const a = window.__astra.getAdventure();
    const renderer = a.combatDirector.renderer;
    const cam = a.camera;
    let scene = a.controller.avatar;
    while (scene.parent) scene = scene.parent;
    const SW = 320, SH = 200;
    const c2 = document.createElement('canvas'); c2.width = SW; c2.height = SH;
    const ctx = c2.getContext('2d', { willReadFrequently: true });
    const grab = () => {
      renderer.render(scene, cam);
      ctx.drawImage(renderer.domElement, 0, 0, SW, SH);
      return ctx.getImageData(0, 0, SW, SH).data;
    };
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
    const figs = { player: a.controller?.spriteBody?.root };
    (a.horseSkins ?? []).forEach((s, i) => { if (s) figs['horse' + i] = s.figure.root; });
    (a.oxSkins ?? []).forEach((s, i) => { if (s) figs['ox' + i] = s.figure.root; });
    const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
    const debugRaw = { camPos: cam.position.toArray(), controllerYaw: a.controller.yaw, avatarYaw: a.controller.avatar.rotation.y, camParent: !!cam.parent };
    const positions = {};
    for (const [label, root] of Object.entries(figs)) {
      root.updateWorldMatrix(true, false);
      const e = root.matrixWorld.elements;
      const pos = { x: e[12], z: e[14] };
      const p = project(pos.x, e[13], pos.z);
      // Expected 16-direction column from the same live camera, per the
      // engine convention: rel 0 = camera in front, column = rel / 22.5°.
      const figYaw = Math.atan2(e[8], e[10]);
      const bearing = Math.atan2(cam.position.x - pos.x, cam.position.z - pos.z);
      const expected = wrapPi(figYaw - bearing + Math.PI) / (Math.PI / 8);
      positions[label] = { ...p, expectedDir: +expected.toFixed(2) };
    }
    const base = grab();
    const out = { positions, diffs: {}, debugRaw };
    for (const [label, root] of Object.entries(figs)) {
      root.visible = false;
      const hidden = grab();
      root.visible = true;
      let n = 0, x0 = SW, y0 = SH, x1 = 0, y1 = 0;
      for (let i = 0; i < base.length; i += 4) {
        const d = Math.abs(base[i] - hidden[i]) + Math.abs(base[i + 1] - hidden[i + 1]) + Math.abs(base[i + 2] - hidden[i + 2]);
        if (d > 30) {
          n++;
          const p = i / 4, x = p % SW, y = (p / SW) | 0;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      out.diffs[label] = n === 0 ? 'NO DIFF' : { px: n, pct: +(100 * n / (SW * SH)).toFixed(2), bbox: [x0, y0, x1 - x0, y1 - y0] };
    }
    return out;
  });
  console.log('raw camera/figure geometry:', JSON.stringify(probe.debugRaw));
  console.log('toggle diff (same-task double render):');
  const figRefs = await page.evaluate(() => {
    const a = window.__astra.getAdventure();
    const f = { player: a.controller?.spriteBody };
    (a.horseSkins ?? []).forEach((s, i) => { if (s) f['horse' + i] = s.figure; });
    (a.oxSkins ?? []).forEach((s, i) => { if (s) f['ox' + i] = s.figure; });
    const out = {};
    for (const [label, fig] of Object.entries(f)) out[label] = fig ? +fig.debugState().direction.toFixed(2) : null;
    return out;
  });
  for (const [label, d] of Object.entries(probe.diffs)) {
    const pos = probe.positions[label];
    const dirErr = pos && pos.front && figRefs[label] != null ? +(figRefs[label] - pos.expectedDir).toFixed(2) : null;
    const dirOk = dirErr == null ? 'n/a' : (Math.abs(((dirErr + 8) % 16) - 8) < .35 ? 'OK' : 'MISMATCH');
    console.log(' ', label, JSON.stringify(d), 'expectedDir:', pos?.expectedDir, 'actual:', figRefs[label], `(${dirOk})`);
  }
  const drawn = Object.entries(probe.diffs).filter(([, d]) => d !== 'NO DIFF').length;
  console.log('RENDER VERDICT:', `${drawn}/${Object.keys(probe.diffs).length} cards drawn (figures outside the frustum count as not drawn)`);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
} catch (e) {
  console.log('CHECK FAILED:', e.message);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no captured errors');
}
await browser.close();
