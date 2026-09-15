import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const libs = path.join(os.tmpdir(), 'astra-browser-libs'); await fs.mkdir(libs, { recursive: true });
const tar = path.join(libs, 'libraries.tar');
await fs.writeFile(tar, brotliDecompressSync(await fs.readFile('node_modules/@sparticuz/chromium/bin/al2023.tar.br'))); execFileSync('tar', ['-xf', tar, '-C', libs]);
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !['--single-process', '--in-process-gpu'].includes(a)), env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` }, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(90000);
const errors = [], failed = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().toLowerCase().includes('pointer lock')) errors.push(m.text()); });
page.on('requestfailed', r => failed.push(r.url()));
await page.addInitScript(() => localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality: 'performance', atmosphere: 'golden', volume: .35, sensitivity: 1, invertY: false })));
const state = () => page.evaluate(() => window.__astra.getState());
const inventory = () => page.evaluate(() => window.__astra.getInventory());
const character = () => page.evaluate(() => window.__astra.getCharacter());
const wait = predicate => page.waitForFunction(predicate, undefined, { timeout: 90000, polling: 100 });
// The dice overlay is player-gated: press Roll, read the result, press Continue.
// Anything that spends a die in the world has to walk through both buttons.
async function playDiceRoll(timeoutMs = 20000) {
  const opened = await page.waitForSelector('#dice-overlay.visible #dice-roll:not([disabled])', { timeout: timeoutMs }).catch(() => null);
  if (!opened) return null;
  await opened.click();
  await page.waitForSelector('#dice-continue:not([hidden])', { timeout: 30000 });
  const natural = (await page.locator('#dice-natural').innerText()).trim();
  await page.click('#dice-continue');
  await page.waitForSelector('#dice-overlay.visible', { state: 'hidden', timeout: 15000 });
  return natural;
}
try {
  await page.goto(process.env.BASE_URL ?? 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
  // Title first: the world only loads once the player presses Begin.
  await page.waitForSelector('#enter-world:visible');
  assert.equal(await page.locator('#char-creation').count(), 0);
  console.log('✓ Title opens before the world loads');
  // FORGE YOUR LEGEND gates entry: Begin opens creation; the world loads behind it.
  await page.click('#enter-world');
  await page.waitForSelector('#char-creation:visible');
  await page.click('[data-recommended]');
  assert.equal(await page.locator('[data-review]').isDisabled(), false);
  await page.click('[data-review]');
  await page.waitForSelector('[data-forge]:visible');
  await page.click('[data-forge]');
  await page.waitForSelector('#char-creation', { state: 'detached' });
  await page.waitForSelector('[data-ready="true"]', { timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'detached' });
  const hero = await character();
  assert(hero && hero.name.length >= 2); assert.equal(hero.class, 'Fighter'); assert.equal(hero.hp.current, hero.hp.max);
  await page.waitForSelector('#hero-plate:visible');
  console.log('✓ Character creation forges a level-1 Fighter and lights the hero plate');
  await wait(() => window.__astra.getState().story.active);
  assert.equal((await state()).story.phase, 'journey'); assert((await page.locator('#narrator-text').textContent()).startsWith('You began your adventuring career in the city of Neverwinter.'));
  assert.equal((await state()).mounted, true); assert.equal((await inventory()).gold, 0);
  assert.equal(await page.locator('[data-view="first"]').isDisabled(), true);
  // The forge→load gap can outlive autoplay activation; any gesture restores voice.
  await page.keyboard.press('Shift');
  await wait(() => window.__astra.getState().story.fallback === false);
  await wait(() => window.__astra.getState().story.progress > .025);
  assert.equal((await state()).story.fallback, false);
  await page.click('#narrator-pause'); const progress = (await state()).story.progress;
  await page.waitForTimeout(400); assert(Math.abs((await state()).story.progress - progress) < .002);
  console.log('✓ Narrator uses real audio, exact text, cinematic input lock, and synchronized pause');
  await page.click('#journey-skip'); await wait(() => window.__astra.getState().story.phase === 'arrival');
  assert.equal((await state()).mounted, true); assert.equal((await inventory()).arrived, true);
  assert((await page.locator('#narrator-text').textContent()).startsWith("You've been on the Triboar Trail for about half a day"));
  await page.click('#narrator-pause');
  const beforeDrive = (await state()).wagon.x;
  await page.keyboard.down('w');
  await page.waitForFunction(x => window.__astra.getState().wagon.x > x + .25, beforeDrive, { timeout: 90000, polling: 100 });
  await page.keyboard.up('w'); await page.keyboard.down('Space'); await page.waitForTimeout(500); await page.keyboard.up('Space');
  assert((await state()).wagon.x > beforeDrive);
  console.log('✓ Skipping hands control back, starts arrival narration, and the wagon can be driven');
  await page.click('#narrator-next'); await page.click('#narrator-next'); await wait(() => window.__astra.getState().story.phase === 'exploration');
  await page.keyboard.press('r'); await wait(() => !window.__astra.getState().mounted);
  await page.keyboard.press('e'); await page.waitForSelector('[data-kind="cargo"]');
  assert.equal(await page.locator('#dialog-title').innerText(), 'The oil barrel');
  await page.locator('[data-loot-quantity="oil"]').fill('3'); await page.click('[data-take-item="oil"]');
  assert.equal((await inventory()).inventory.oil, 3); assert.equal((await inventory()).cargo.oil.oil, 47); assert.equal((await inventory()).gold, 0);
  await page.click('[data-action="take-all"]'); assert.equal((await inventory()).inventory.oil, 50);
  assert.equal(await page.locator('[data-action="take-all"]').isDisabled(), true);
  await page.keyboard.press('i'); await page.waitForSelector('[data-kind="inventory"]');
  assert.equal(await page.locator('#purse-gold').innerText(), '0'); assert((await page.locator('#item-detail').innerText()).includes('0.10 gp'));
  await page.locator('#inventory-search').fill('shovel'); assert((await page.locator('#inventory-list').innerText()).includes('Nothing on this page'));
  await page.locator('#inventory-search').fill('oil'); assert((await page.locator('#inventory-list').innerText()).includes('Lantern oil'));
  await page.keyboard.press('Escape');
  console.log('✓ Dismount, opening, partial/all looting, decimal gp, inventory search, and no duplicate oil');
  // Walk along the wagon, not a test-only teleport, to reach an actual wooden flour crate.
  const footStart = await state(); await page.keyboard.down('s');
  await page.waitForFunction(start => {
    const p = window.__astra.getState(); return Math.hypot(p.x - start.x, p.z - start.z) > 1.8;
  }, footStart, { timeout: 90000, polling: 100 }); await page.keyboard.up('s');
  await wait(() => window.__astra.getState().interaction?.kind === 'cargo' && window.__astra.getState().interaction.id.startsWith('flour'));
  await page.keyboard.press('e'); await page.waitForSelector('[data-kind="cargo"]'); assert((await page.locator('#dialog-title').innerText()).includes('Flour crate'));
  await page.click('[data-action="take-all"]'); assert.equal((await inventory()).inventory.flour, 6);
  await page.keyboard.press('Escape');
  console.log('✓ Walking reaches a wooden crate; opening it transfers its six flour sacks');
  // The walking hero: locomotion clip blends in, the model faces its travel
  // direction (not reversed), and the seated lockup stays released.
  const walkStart = await state();
  await page.keyboard.down('w');
  await page.waitForFunction(start => {
    const p = window.__astra.getState(); return Math.hypot(p.x - start.x, p.z - start.z) > 1.4 && window.__astra.getHeroAnim().clip === 'walk';
  }, walkStart, { timeout: 90000, polling: 90 });
  const walkAnim = await page.evaluate(() => window.__astra.getHeroAnim());
  await page.keyboard.up('w');
  assert.equal(walkAnim.clip, 'walk', `walk clip blends in (got ${walkAnim.clip})`);
  assert.equal(walkAnim.seated, false, 'the dismounted hero is standing, not seated');
  assert(walkAnim.facingErr < 0.35, `the hero faces where it walks (off by ${walkAnim.facingErr.toFixed(2)} rad)`);
  // Sprint blends to the run clip.
  await page.keyboard.down('Shift'); await page.keyboard.down('w');
  await page.waitForFunction(() => window.__astra.getHeroAnim().clip === 'run', undefined, { timeout: 90000, polling: 90 });
  await page.keyboard.up('w'); await page.keyboard.up('Shift');
  console.log('✓ Locomotion blends idle→walk→run and the hero faces its movement');
  // Floating health bar: visible over the hero, and it shrinks on damage.
  await page.evaluate(() => { window.__astra.debugDamage(3); });
  await page.waitForSelector('#hero-health.visible');
  const healthVisible = await page.locator('#hero-health.visible').count();
  assert(healthVisible >= 1, 'the floating health bar shows above the hero in third person');
  console.log('✓ A health bar floats above the hero and reflects damage');
  // Ransacked belongings: kneel + narration + dust, recorded in the save (System 4).
  await page.evaluate(() => window.__astra.teleport(10.5, 1.9));
  await wait(() => window.__astra.getWorld().nearestInteractionId() === 'ransacked_belongings');
  await page.keyboard.press('e');
  await wait(() => (window.__astra.getInventory().inspected ?? []).includes('ransacked_belongings'));
  console.log('✓ The ransacked belongings kneel-and-narrate and record the inspection');
  await page.keyboard.press('Space'); await wait(() => !window.__astra.getState().grounded); await wait(() => window.__astra.getState().grounded);
  await page.keyboard.press('v'); await wait(() => window.__astra.getState().mode === 'first'); await page.keyboard.press('v'); await wait(() => window.__astra.getState().mode === 'third');
  await page.keyboard.press('m'); await page.waitForSelector('[data-kind="map"]'); assert.equal((await state()).paused, true);
  await page.keyboard.press('m'); await page.waitForSelector('#dialog-backdrop', { state: 'hidden' });
  await page.keyboard.press('n'); await page.waitForSelector('[data-kind="journal"]'); assert((await page.locator('.journal-scroll').innerText()).includes('Two horses wander the road, sniffing at ransacked personal effects.'));
  await page.keyboard.press('Escape');
  console.log('✓ Jump/landing, both camera modes, live map, and the complete story journal work');
  // Character sheet (C) and the camp menu (pause-menu rest shortcut path).
  await page.keyboard.press('c'); await page.waitForSelector('[data-kind="sheet"]');
  assert((await page.locator('#dialog').innerText()).includes('LEVEL 1 HUMAN FIGHTER'));
  assert((await page.locator('#dialog').innerText()).includes('Second Wind'));
  await page.keyboard.press('Escape');
  // The character sheet is still fading; wait it out before the dice block clicks.
  await page.waitForSelector('#dialog-backdrop', { state: 'hidden' });
  // Dice overlay contract (System 4): nothing rolls and nothing closes until the
  // player presses Roll, then Continue — no auto-roll, no auto-dismiss.
  await page.evaluate(() => { window.__astra.previewRoll(20, 2, 'Smoke Check', 10); return true; });
  await page.waitForSelector('#dice-overlay.visible #dice-roll');
  assert.equal(await page.locator('#dice-continue').isHidden(), true);
  assert.equal((await page.locator('#dice-natural').innerText()).trim(), '');
  // A stray key press and a click on the backdrop must not start or skip the
  // roll. (Enter/Space are still allowed — they activate the focused button.)
  await page.keyboard.press('KeyA');
  await page.keyboard.press('Escape');
  await page.mouse.click(12, 12);
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#dice-roll').isDisabled(), false, 'the die must still be waiting for the Roll button');
  const beforeGate = (await character()).hp.current;
  await page.click('#dice-roll');
  await page.waitForSelector('#dice-continue:not([hidden])', { timeout: 30000 });
  const natural = (await page.locator('#dice-natural').innerText()).trim();
  assert(Number(natural) >= 1 && Number(natural) <= 20, `expected a d20 result, saw "${natural}"`);
  assert((await page.locator('#dice-banner').innerText()).length > 0, 'the verdict should be on screen');
  // The die has to be inside the tray view: compare its drawn bounds with the canvas.
  const framing = await page.evaluate(() => {
    const canvas = document.querySelector('#dice-stage canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
  });
  assert(framing !== null && framing.x >= 0 && framing.y >= 0 && framing.x + framing.w <= framing.vw && framing.y + framing.h <= framing.vh, `dice canvas must be on screen: ${JSON.stringify(framing)}`);
  const containment = await page.evaluate(() => window.__astra.getDiceContainment());
  assert(containment.rescues === 0, `the die needed ${containment.rescues} frame rescues; the tray walls should hold it alone`);
  await page.mouse.click(12, 12);
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#dice-overlay.visible').count(), 1, 'a background click must not dismiss the result');
  await page.click('#dice-continue');
  await page.waitForSelector('#dice-overlay.visible', { state: 'hidden' });
  assert.equal((await character()).hp.current, beforeGate, 'a preview roll must not touch the hero');
  console.log(`✓ Dice overlay waits for Roll (${natural} on the d20), then for Continue`);
  // Short rest: damage the hero, spend a hit die, heal by the roll (System 5).
  const hpBeforeDamage = (await character()).hp.current;
  await page.evaluate(() => window.__astra.debugDamage(4));
  await page.waitForFunction(before => window.__astra.getCharacter().hp.current === Math.max(1, before - 4), hpBeforeDamage, { timeout: 90000, polling: 100 });
  await page.evaluate(() => window.__astra.openCamp());
  await page.waitForSelector('#camp-menu.visible');
  assert((await page.locator('#camp-menu').innerText()).includes('LONG REST'));
  assert((await page.locator('#camp-menu').innerText()).includes('SHORT REST'));
  const hpBeforeRest = (await character()).hp.current;
  const diceBeforeRest = (await character()).hitDice.current;
  const spendButton = page.locator('[data-camp="short-spend"]');
  assert.equal(await spendButton.isDisabled(), false);
  await spendButton.click();
  const hitDie = await playDiceRoll();
  assert(hitDie !== null && Number(hitDie) >= 1 && Number(hitDie) <= 10, `short rest should roll a visible d10, saw ${hitDie}`);
  await page.waitForFunction(before => window.__astra.getCharacter().hitDice.current === before - 1, diceBeforeRest, { timeout: 90000, polling: 100 });
  const afterRest = await character();
  assert.equal(afterRest.hitDice.current, diceBeforeRest - 1);
  assert(afterRest.hp.current > hpBeforeRest && afterRest.hp.current <= afterRest.hp.max);
  assert((await page.locator('#camp-short').innerText()).includes(`${diceBeforeRest - 1}d10`));
  await page.click('[data-camp="close"]');
  await page.waitForSelector('#camp-menu', { state: 'hidden' });
  console.log('✓ Character sheet, the make-camp menu, and a short rest that spends a hit die all work');
  // A story dialog can surface again as the world resumes behind a finished
  // roll; clear it before poking at the HUD, and prove it is still closable.
  if (await page.locator('#dialog-backdrop:not([hidden])').count()) {
    await page.click('#dialog [data-action=\"close\"]');
    await page.waitForFunction(() => document.querySelector('#dialog-backdrop')?.hidden === true, null, { timeout: 10000 });
  }
  await page.click('#settings-toggle');
  await page.click('[data-weather="rain"]'); assert.equal(await page.locator('[data-weather="rain"]').getAttribute('aria-pressed'), 'true');
  await page.click('[data-weather="auto"]'); assert.equal(await page.locator('[data-weather="auto"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#sensitivity').fill('1.3'); assert.equal(await page.locator('#sensitivity-value').innerText(), '1.3×');
  await page.click('[data-action="audio"]'); assert.equal(await page.locator('[data-action="audio"]').getAttribute('aria-checked'), 'true'); await page.click('[data-action="audio"]');
  await page.click('[data-action="narrator-voice"]'); assert.equal(await page.locator('[data-action="narrator-voice"]').getAttribute('aria-checked'), 'false'); await page.click('[data-action="narrator-voice"]');
  await page.click('[data-action="close"]');
  await page.keyboard.press('h'); await page.waitForSelector('[data-kind="help"]'); await page.keyboard.press('Escape');
  await page.keyboard.press('p'); const photo = page.waitForEvent('download', { timeout: 120000 }); await page.click('#capture-photo'); assert((await photo).suggestedFilename().startsWith('astra-triboar-trail-')); await page.click('#exit-photo');
  console.log('✓ Weather, settings, separate voice/ambience controls, help, and PNG capture work');
  const beforeReload = await inventory();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#enter-world:visible');
  assert.equal(await page.locator('#enter-world span').innerText(), 'Continue your journey');
  assert.equal(await page.locator('#char-creation').count(), 0);
  await page.click('#enter-world');
  await page.waitForSelector('[data-ready="true"]', { timeout: 180000 }); await page.waitForSelector('#loading', { state: 'detached' });
  assert.deepEqual((await inventory()).inventory, beforeReload.inventory); assert.deepEqual((await inventory()).cargo, beforeReload.cargo);
  assert((await character())?.name === hero.name);
  await wait(() => window.__astra.getState().story.phase === 'exploration');
  assert.equal((await state()).mounted, false); assert.equal((await inventory()).gold, 0);
  console.log('✓ Reload preserves inventory, remaining cargo, open lids, location, and completed introduction');
  const wasLocked = await page.evaluate(() => { const locked = !!document.pointerLockElement; if (locked) document.exitPointerLock(); return locked; });
  if (wasLocked) { await page.waitForSelector('[data-kind="pause"]'); await page.click('[data-action="close"]'); }
  const yaw = (await state()).yaw;
  await page.mouse.move(490, 200); await page.mouse.down({ button: 'right' }); await page.mouse.move(555, 215, { steps: 4 }); await page.mouse.up({ button: 'right' });
  assert(Math.abs((await state()).yaw - yaw) > .05);
  await page.evaluate(() => { document.querySelector('#world-canvas').requestPointerLock = () => Promise.reject(new DOMException('Blocked by iframe', 'SecurityError')); });
  await page.mouse.click(490, 200); await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Drag to look'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
  await page.click('#inventory-toggle'); assert(await page.locator('[data-kind="inventory"]').isVisible()); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.click('[data-action="close"]');
  console.log('✓ Embedded-preview drag fallback and the mobile inventory layout work');
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  console.log('All chapter browser smoke tests passed.');
} catch (error) {
  console.log('Last state:', await state().catch(() => null));
  console.log('Last inventory:', await inventory().catch(() => null));
  throw error;
} finally { console.log('Uncaught browser errors:', errors); await browser.close(); }
