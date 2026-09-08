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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(90000);
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().toLowerCase().includes('pointer lock')) errors.push('CONSOLE: ' + m.text()); });
await page.addInitScript(() => localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality: 'performance', atmosphere: 'golden', volume: .3, sensitivity: 1, invertY: false })));
const A = () => page.evaluate(() => window.__astra);
const wait = (predicate, t = 90000) => page.waitForFunction(predicate, undefined, { timeout: t, polling: 100 });
const shot = name => page.screenshot({ path: `qa/${name}.png` });
await fs.mkdir('qa', { recursive: true });

setTimeout(() => { console.log('WATCHDOG: aborting'); process.exit(2); }, 560000).unref?.();
try {
  await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-ready="true"]', { timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'detached' });
  await page.waitForTimeout(1200);
  await shot('01-title');
  const titleCursor = await page.evaluate(() => getComputedStyle(document.body).cursor);
  console.log('title cursor:', titleCursor);

  // Create a hero so the ambush has a character sheet to fight with.
  console.log('step: creating character');
  await page.click('#character-create');
  await page.waitForSelector('[data-character="name"]');
  await page.fill('[data-character="name"]', 'Astra Tester');
  await page.waitForTimeout(500);
  await page.selectOption('[data-character="class"]', 'fighter').catch(() => {});
  await page.waitForTimeout(500);
  const confirmDisabled = await page.evaluate(() => document.querySelector('.cc-footer [data-action="character-create"]').disabled);
  if (confirmDisabled) {
    const problems = await page.evaluate(() => Array.from(document.querySelectorAll('.cc-problems span')).map(x => x.textContent));
    console.log('creator problems:', problems.join(' | '));
  }
  await page.click('.cc-footer [data-action="character-create"]');
  await page.waitForTimeout(800);
  console.log('step: character created');

  await page.click('#enter-world'); await wait(() => window.__astra.getState().story.active);
  await page.waitForTimeout(1500); await shot('02-journey-wagon');
  await page.click('#journey-skip'); await wait(() => window.__astra.getState().story.phase === 'arrival');
  await page.waitForTimeout(1200); await shot('03-arrival');
  // The next control can be visually de-emphasised while audio plays; force-click until exploration.
  for (let i = 0; i < 24; i++) {
    const phase = await page.evaluate(() => window.__astra.getState().story.phase);
    if (phase === 'exploration') break;
    await page.click('#narrator-next', { force: true }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await wait(() => window.__astra.getState().story.phase === 'exploration', 30000);
  await page.waitForTimeout(800); await shot('04-exploration');

  // Cursor must be visible in exploration.
  const exploreCursor = await page.evaluate(() => getComputedStyle(document.querySelector('canvas')).cursor);
  console.log('exploration canvas cursor:', exploreCursor);

  // Step down from the wagon, then walk into the ambush.
  console.log('step: dismounting');
  await page.keyboard.press('r');
  await wait(() => !window.__astra.getState().mounted, 20000);
  console.log('step: dismounted, teleporting to ambush');
  await page.evaluate(() => window.__astra.teleport(9.7, 2.0));
  await wait(() => window.__astra.getCombatPhase().phase === 'active' || window.__astra.getCombatPhase().phase === 'sprung', 30000);
  console.log('combat sprung');
  await page.waitForTimeout(2600); await shot('05-combat-start');

  // UI overlap audit.
  const overlap = await page.evaluate(() => {
    const sels = ['.combat-order', '.combat-log', '.combat-bar', '.combat-preview', '.combat-banner'];
    const boxes = sels.map(sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const vis = getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0; return { sel, x: r.x, y: r.y, w: r.width, h: r.height, vis }; }).filter(Boolean);
    const clashes = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (hit && a.vis && b.vis) clashes.push(`${a.sel} <-> ${b.sel}`);
    }
    // hidden HUD elements during combat
    const hiddenOk = ['.map-cluster', '.bottom-bar', '.region-label', '.control-hints', '.journey-status', '.narrator-panel'].map(sel => {
      const el = document.querySelector(sel); if (!el) return sel + ':absent';
      return sel + ':' + (getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).opacity === '0' ? 'hidden-ok' : 'VISIBLE!');
    });
    return { clashes, hiddenOk, cursor: getComputedStyle(document.querySelector('canvas')).cursor };
  });
  console.log('overlap audit:', JSON.stringify(overlap, null, 1));

  // Wait for the hero's turn, then attack and capture the presentation frames.
  await wait(() => window.__astra.getCombat().isPlayerTurn, 150000);
  const enemies = await page.evaluate(() => window.__astra.getCombat().combatants.filter(c => c.side === 'enemy' && !c.dead && c.hp > 0).map(c => c.id));
  console.log('enemies:', enemies.join(','));
  const target = enemies[0];
  const frames = ['06-dice', '07-windup', '08-impact', '09-aftermath'];
  page.evaluate(id => window.__astra.combatAttack(id), target);
  for (let i = 0; i < frames.length; i++) { await page.waitForTimeout(i === 0 ? 700 : 800); await shot(frames[i]); }
  await page.waitForTimeout(2500); await shot('10-settled');

  // Sample every enemy root over an enemy turn: the smoothed visual position
  // must walk towards the engine's authoritative square, not jump onto it.
  // (It used to read `av.root`, which does not exist — ActorView keeps its
  // object under `body` — so every sample threw and the check read zero.)
  const posSamples = [];
  const sampler = setInterval(() => {
    page.evaluate(() => {
      const v = window.__astra.getAdventure().combatDirector.view;
      if (!v) return null;
      const out = {};
      for (const [id, av] of v.actors) {
        const c = av.combatant;
        out[id] = {
          x: +av.body.root.position.x.toFixed(2),
          z: +av.body.root.position.z.toFixed(2),
          tx: +c.position.x.toFixed(2), tz: +c.position.z.toFixed(2),
          gap: +Math.hypot(c.position.x - av.body.root.position.x, c.position.z - av.body.root.position.z).toFixed(2),
        };
      }
      return out;
    }).then(p => posSamples.push(p)).catch(() => {});
  }, 120);
  await page.evaluate(() => window.__astra.combatEndTurn());
  await page.waitForTimeout(9000);
  clearInterval(sampler);
  const samples = posSamples.filter(Boolean);
  const moved = [];
  let midFlight = 0;
  for (const snapshot of samples) {
    for (const [id, p] of Object.entries(snapshot)) {
      moved.push(id);
      // A gap that is small-but-nonzero means the body is still catching up,
      // which is exactly what a teleport would never show.
      if (p.gap > 0.1 && p.gap < 4) midFlight++;
    }
  }
  const distinct = new Set(samples.map(s => Object.entries(s).map(([id, p]) => `${id}@${p.x},${p.z}`).join('|')));
  console.log('enemy turn: snapshots', samples.length, 'distinct frames', distinct.size, 'caught mid-interpolation', midFlight);
  await shot('11-after-enemy-turn');

  // Dice results should appear in the log with presentation data.
  const log = await page.evaluate(() => window.__astra.getCombat().log.map(l => l.kind + (l.attack ? ` [d20:${l.attack.d20.join('/')} total:${l.attack.total} dmg:${l.attack.damage} crit:${l.attack.critical}]` : '')).slice(-8));
  console.log('log tail:', JSON.stringify(log, null, 1));

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
} catch (e) {
  console.log('QA FAILED:', e.message);
  await shot('qa-failure');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no captured errors');
}
await browser.close();
