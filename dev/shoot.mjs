/**
 * Dev-only: render every creature in the model lab and print the ASCII report.
 * Usage: node dev/shoot.mjs [model] [view] [pose]
 */
import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const libs = path.join(os.tmpdir(), 'astra-browser-libs');
await fs.mkdir(libs, { recursive: true });
if (!process.env.SKIP_EXTRACT) {
  const tar = path.join(libs, 'libraries.tar');
  try {
    await fs.writeFile(tar, brotliDecompressSync(await fs.readFile('node_modules/@sparticuz/chromium/bin/al2023.tar.br')));
    execFileSync('tar', ['-xf', tar, '-C', libs]);
  } catch { /* already extracted */ }
}
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(a => !['--single-process', '--in-process-gpu'].includes(a)),
  env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.setDefaultTimeout(180000);
page.on('pageerror', e => console.log('PAGEERROR', e.message));

const [model = 'goblin', view = 'three', pose = 'idle'] = process.argv.slice(2);
const extra = Object.fromEntries(process.argv.slice(5).map(a => a.split('=')));
const query = new URLSearchParams({ model, view, pose, ...extra });
await page.goto(`http://localhost:5173/dev/lab.html?${query}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__lab !== undefined, undefined, { timeout: 180000, polling: 300 }).catch(() => {});
const text = await page.evaluate(() => window.__lab ?? 'NO OUTPUT');
console.log(text);
await browser.close();
