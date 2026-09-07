/**
 * Deep audit harness. Drives the real game in a real browser and records every
 * console error, page error, and failed request across many systems.
 */
import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import path from 'node:path'; import os from 'node:os';
const libs = path.join(os.tmpdir(), 'astra-browser-libs');
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(a => !['--single-process','--in-process-gpu'].includes(a)),
  env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs,'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.setDefaultTimeout(120000);
const errs = [], failed = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/pointer lock/i.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
page.on('requestfailed', r => { if (!/favicon/.test(r.url())) failed.push(r.url()); });

await page.addInitScript(() => localStorage.setItem('astra-preferences-v1',
  JSON.stringify({ quality:'performance', atmosphere:'golden', volume:0, sensitivity:1, invertY:false })));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const m = await import('/src/game/character.ts');
  m.saveCharacter(m.finalizeCharacter(m.withDefaultChoices({ ...m.defaultDraft(), name: 'Mira' })));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ready="true"]', { timeout: 200000 });
console.log('== booted ==');

// Enumerate every interactive control that is visible on the title screen.
const controls = await page.evaluate(() => [...document.querySelectorAll('button,[role=button]')]
  .filter(b => b.offsetParent !== null)
  .map(b => ({ id: b.id, action: b.dataset.action, label: (b.textContent||'').trim().slice(0,40), aria: b.getAttribute('aria-label') })));
console.log('TITLE CONTROLS:', JSON.stringify(controls, null, 1));

// Open every dialog in turn and check it renders something and can close.
for (const kind of ['help','settings','map','journal','inventory','character','pause']) {
  const before = errs.length;
  const ok = await page.evaluate(k => { try { window.__astra.openDialog?.(k); return true; } catch { return false; } }, kind);
  await page.waitForTimeout(350);
  const shown = await page.locator('#dialog').isVisible().catch(() => false);
  const title = await page.locator('#dialog-title').textContent().catch(() => null);
  console.log(`DIALOG ${kind}: api=${ok} visible=${shown} title=${JSON.stringify(title)} newErrors=${errs.length - before}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
}

console.log('== errors ==', JSON.stringify(errs, null, 1));
console.log('== failed requests ==', JSON.stringify(failed, null, 1));
await browser.close();
