import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import path from 'node:path'; import os from 'node:os';
const libs = path.join(os.tmpdir(), 'astra-browser-libs');
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !['--single-process','--in-process-gpu'].includes(a)), env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs,'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` }, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(120000);
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.addInitScript(() => { localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality:'performance', atmosphere:'golden', volume:0, sensitivity:1, invertY:false })); });
await page.goto(process.env.BASE_URL || 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const m = await import('/src/game/character.ts');
  m.saveCharacter(m.finalizeCharacter(m.withDefaultChoices({ ...m.defaultDraft(), name: 'Mira' })));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ready="true"]', { timeout: 200000 });
await page.click('#enter-world');
await page.waitForFunction(() => window.__astra.getState().story.active, null, { polling: 100 });
const skip = page.locator('#narrator-skip'); if (await skip.count()) await skip.click();
await page.waitForFunction(() => ['arrival','free'].includes(window.__astra.getState().story.phase), null, { polling: 200, timeout: 120000 }).catch(()=>{});
await page.keyboard.press('KeyR'); await page.waitForTimeout(600);
await page.waitForFunction(() => { window.__astra.teleport(9.7, 3.4); return window.__astra.getCombat() !== null; }, null, { timeout: 30000, polling: 100 });

const dump = async (label) => {
  const d = await page.evaluate(() => {
    const a = window.__astra.getAdventure();
    const dir = a.combatDirector;
    const c = window.__astra.getCombat();
    return {
      phase: c.phase, round: c.round, active: c.activeId, isPlayerTurn: c.isPlayerTurn, finished: c.finished,
      dirPhase: dir.phase, presenting: dir.presenting, queue: dir.queue.length,
      cluster: dir.cluster ? { phase: dir.cluster.phase, timer: +dir.cluster.timer.toFixed(2), attacker: dir.cluster.attackerId } : null,
      pendingEnemy: dir.pendingEnemyTurn, enemyTimer: +dir.enemyTurnTimer.toFixed(2),
      combatants: c.combatants.map(x => `${x.id.slice(0,18)} hp${x.hp} act${x.budget?.action?1:0} mv${Math.round(x.budget?.movementUsed??0)}/${x.budget?.movement??0}`),
      log: c.log.slice(-6).map(l => `${l.kind}: ${l.text.slice(0, 70)}`),
    };
  });
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(d, null, 1));
};

await dump('sprung');
const c0 = await page.evaluate(() => window.__astra.getCombat());
const t = c0.combatants.filter(x => x.side === 'enemy' && !x.dead).sort((a,b)=>a.distanceFeet-b.distanceFeet)[0];
await page.evaluate(id => window.__astra.combatAttack(id), t.id);
await page.evaluate(() => window.__astra.combatEndTurn());
for (let i = 0; i < 10; i++) { await page.waitForTimeout(3000); await dump(`t+${(i+1)*3}s`); }
await browser.close();
