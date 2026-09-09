import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs/promises';
const OUT = process.argv[2] ?? '/tmp/sprite.png';
const libs = path.join(os.tmpdir(), 'astra-browser-libs');
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !['--single-process','--in-process-gpu'].includes(a)), env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs,'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` }, headless: true });
const page = await browser.newPage({ viewport: { width: 700, height: 520 } });
await page.addInitScript(() => localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality:'performance', atmosphere:'golden', volume:0, sensitivity:1, invertY:false })));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ready="true"]', { timeout: 180000 });
await page.click('#enter-world');
await page.waitForFunction(() => window.__astra.getState().story.active, undefined, { timeout: 90000 });
await page.click('#journey-skip');
await page.waitForFunction(() => window.__astra.getState().story.phase === 'arrival', undefined, { timeout: 90000 });
for (let i = 0; i < 24; i++) {
  if (await page.evaluate(() => window.__astra.getState().story.phase) === 'exploration') break;
  await page.click('#narrator-next', { force: true }).catch(() => {});
  await page.waitForTimeout(400);
}
await page.keyboard.press('r');
await page.waitForFunction(() => !window.__astra.getState().mounted, undefined, { timeout: 30000 });
await page.evaluate(() => { const a = window.__astra.getAdventure(); window.__astra.teleport(-14, 2.4); a.controller.yaw = 0; a.controller.pitch = -0.05; a.controller.avatar.rotation.y = 0; });
await page.click('[data-view="third"]').catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT, timeout: 90000 });
console.log('wrote', OUT);
await browser.close();
