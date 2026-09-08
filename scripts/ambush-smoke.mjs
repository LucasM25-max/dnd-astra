import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import assert from 'node:assert/strict';
import path from 'node:path'; import os from 'node:os';
const libs = path.join(os.tmpdir(), 'astra-browser-libs');
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !['--single-process','--in-process-gpu'].includes(a)), env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs,'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` }, headless: true });
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(120000);
const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR '+e.message)); page.on('console',m=>{if(m.type()==='error'&&!/pointer lock/i.test(m.text()))errs.push(m.text())});

// Seed a finished character before boot, using the game's own module.
await page.addInitScript(() => {
  localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality:'performance', atmosphere:'golden', volume:0, sensitivity:1, invertY:false }));
});
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const m = await import('/src/game/character.ts');
  // A fresh level 1 character, exactly as a new player starts.
  const draft = m.withDefaultChoices({ ...m.defaultDraft(), name: 'Mira' });
  m.saveCharacter(m.finalizeCharacter(draft));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ready="true"]', { timeout: 200000 });
const sheet = await page.evaluate(() => window.__astra.getState().character);
assert.equal(sheet.name, 'Mira');
assert.equal(sheet.level, 1, 'player must start at level 1');
console.log('  level', sheet.level, 'hp', sheet.maxHp, 'ac', sheet.armorClass);
console.log('✓ character loads');

// Skip the cinematic, dismount, walk to the horses.
await page.click('#enter-world');
await page.waitForFunction(() => window.__astra.getState().story.active, null, { polling: 100 });
await page.evaluate(() => window.__astra.getState().story.phase).then(p => console.log('phase', p));
const skip = page.locator('#narrator-skip');
if (await skip.count()) await skip.click();
await page.waitForFunction(() => window.__astra.getState().story.phase === 'arrival' || window.__astra.getState().story.phase === 'free', null, { polling: 200, timeout: 120000 }).catch(()=>{});
console.log('phase now', await page.evaluate(() => window.__astra.getState().story.phase));
await page.keyboard.press('KeyR'); // dismount
await page.waitForTimeout(600);
console.log('mounted', await page.evaluate(() => window.__astra.getState().mounted));

// Teleport next to the looted horses to spring the ambush.
// Walk into the trigger radius, re-asserting the position for a few frames in
// case the controller settles the avatar onto the terrain first.
await page.waitForFunction(() => {
  window.__astra.teleport(9.7, 3.4);
  return window.__astra.getCombat() !== null;
}, null, { timeout: 30000, polling: 100 });
let c = await page.evaluate(() => window.__astra.getCombat());
console.log('combat phase:', c?.phase, 'round', c?.round, 'combatants', c?.combatants?.length);
assert.ok(c, 'ambush did not spring');
assert.equal(c.combatants.filter(x => x.side === 'enemy').length, 4);
console.log('✓ four goblins spawned and initiative rolled');
console.log('  solo handicap:', c.solo?.notes);
assert.ok(c.solo && c.solo.notes.length, 'solo balance profile missing');
const heroC = c.combatants.find(x => x.side === 'party');
console.log('  hero in combat:', heroC.hp + '/' + heroC.maxHp, 'AC', heroC.ac);
assert.ok(heroC.maxHp > sheet.maxHp, 'solo hit point loan not applied');

// Play one turn, then prove the wiring rather than the outcome.
//
// Fighting the ambush to the death here used to be this script's main job, but
// a headless software renderer only manages a frame every second or two, so a
// five-combatant fight needed minutes of wall clock and the assert was really
// timing the renderer. tests/encounter.test.ts plays a hundred full fights in
// milliseconds; this suite's job is that the pieces are connected.
let playerTurns = 0;
const gotTurn = await page.waitForFunction(() => {
  const c = window.__astra.getCombat();
  return !c || c.finished || c.phase === 'resolved' || c.phase === 'lost' || c.isPlayerTurn;
}, null, { timeout: 90000, polling: 150 }).then(() => true).catch(() => false);
assert.ok(gotTurn, 'the player never got a turn');
const c2 = await page.evaluate(() => window.__astra.getCombat());
if (c2.isPlayerTurn) {
  playerTurns++;
  const target = c2.combatants.filter(x => x.side === 'enemy' && !x.dead).sort((a, b) => a.distanceFeet - b.distanceFeet)[0];
  assert.ok(target, 'no living goblin to strike');
  await page.evaluate(id => window.__astra.combatAttack(id), target.id);
}
console.log('player turns taken:', playerTurns);

// An attack entry must carry the payload the renderer stages a strike from:
// the dice it is about to throw, and the numbers the rules already decided.
await page.waitForFunction(() => window.__astra.getCombat().log.some(l => l.kind === 'attack' && l.attack), null, { timeout: 60000, polling: 150 });
c = await page.evaluate(() => window.__astra.getCombat());
const strike = c.log.filter(l => l.kind === 'attack' && l.attack).pop();
console.log('strike payload:', JSON.stringify({
  weapon: strike.attack.weapon, d20: strike.attack.d20, kept: strike.attack.kept,
  total: strike.attack.total, dc: strike.attack.dc, hit: strike.attack.hit,
  damage: strike.attack.damage, dice: strike.attack.damageDice, sides: strike.attack.damageSides,
}));
assert.ok(strike.attack.d20.length > 0, 'attack carries no d20 for the tray to throw');
assert.equal(strike.attack.total, strike.attack.kept + strike.attack.modifier, 'reported total is not the roll');
assert.ok(strike.attack.dc >= 10, 'no armour class to beat');
if (strike.attack.hit) assert.ok(strike.attack.damage > 0 && strike.attack.damageDice.length > 0, 'a hit with no damage dice');
console.log('✓ a strike carries the dice and numbers the presentation needs');

console.log('log tail:', c.log.slice(-4).map(l => l.text));
// Resolve the fight the way the suite always has, so the victory branch below
// is still exercised end to end.
await page.evaluate(() => window.__astra.combatDebugVictory());
await page.waitForFunction(() => {
  const c = window.__astra.getCombat();
  return c && (c.phase === 'resolved' || c.finished);
}, null, { timeout: 150000, polling: 150 });
c = await page.evaluate(() => window.__astra.getCombat());
console.log('final:', c.phase, 'outcome', c.outcome, 'round', c.round);
assert.ok(['resolved','lost'].includes(c.phase), 'combat never resolved: ' + c.phase);
console.log('✓ combat runs to a conclusion in the world');
await page.waitForSelector('.combat-result .result-panel', { state: 'visible', timeout: 30000 });
console.log('result heading:', await page.locator('.result-panel h2').textContent());
await page.screenshot({ path: 'ambush-result.png' });
await page.evaluate(() => window.__astra.combatFinish());
await page.waitForTimeout(400);
console.log('✓ after-action panel and finish work');

// --- Scenario 2: the victory branch, the fleeing goblin and the trail ------
// A fresh page, and a fresh character so the previous defeat does not carry.
// Close the first page first: headless software GL only reliably services one
// WebGL context at a time.
await page.close();
const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page2.setDefaultTimeout(120000);
page2.on('pageerror', e => errs.push('PAGEERROR2 ' + e.message));
page2.on('console', m => { if (m.type() === 'error' && !/pointer lock/i.test(m.text())) errs.push(m.text()); });
await page2.addInitScript(() => {
  localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality:'performance', atmosphere:'golden', volume:0, sensitivity:1, invertY:false }));
});
await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
await page2.evaluate(async () => {
  const m = await import('/src/game/character.ts');
  m.saveCharacter(m.finalizeCharacter(m.withDefaultChoices({ ...m.defaultDraft(), name: 'Bryn' })));
});
await page2.reload({ waitUntil: 'domcontentloaded' });
await page2.waitForSelector('[data-ready="true"]', { timeout: 200000 });
await page2.click('#enter-world');
await page2.waitForFunction(() => window.__astra.getState().story.active, null, { polling: 100 });
const skip2 = page2.locator('#narrator-skip');
if (await skip2.count()) await skip2.click();
await page2.waitForFunction(() => ['arrival','free'].includes(window.__astra.getState().story.phase), null, { polling: 200, timeout: 120000 }).catch(()=>{});
await page2.keyboard.press('KeyR');
await page2.waitForTimeout(800);
await page2.waitForFunction(() => {
  window.__astra.teleport(9.7, 3.4);
  return window.__astra.getCombat() !== null;
}, null, { timeout: 40000, polling: 100 });
console.log('✓ ambush springs for a second character');

const fled = await page2.evaluate(() => window.__astra.combatDebugVictory());
assert.ok(fled);
await page2.waitForFunction(() => {
  const c = window.__astra.getCombat();
  return c && (c.phase === 'resolved' || c.finished);
}, null, { timeout: 40000, polling: 150 });
const win = await page2.evaluate(() => window.__astra.getCombat());
console.log('victory phase:', win.phase, 'outcome', win.outcome);
assert.equal(win.outcome, 'victory');
await page2.waitForSelector('.combat-result .result-panel.won', { state: 'visible', timeout: 20000 });
console.log('victory heading:', await page2.locator('.result-panel h2').textContent());
await page2.screenshot({ path: 'ambush-victory.png' });
await page2.evaluate(() => window.__astra.combatFinish());
await page2.waitForTimeout(600);
const after = await page2.evaluate(() => window.__astra.getState().character);
console.log('after victory: level', after.level, 'xp', after.xp, 'hp', after.currentHp + '/' + after.maxHp);
assert.ok(after.xp > 0, 'no experience awarded');
assert.ok(after.maxHp <= 12, 'solo loan leaked onto the saved sheet: ' + after.maxHp);
console.log('✓ victory, xp award, and no stat leakage');

console.log('errors:', errs);
assert.equal(errs.length, 0);
await browser.close();
console.log('ALL AMBUSH TESTS PASSED');
