// TEMP harness screenshots (deleted before merge).
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
await fs.writeFile(tar, brotliDecompressSync(await fs.readFile('node_modules/@sparticuz/chromium/bin/al2023.tar.br')));
execFileSync('tar', ['-xf', tar, '-C', libs]);
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter(a => !['--single-process', '--in-process-gpu'].includes(a)), '--use-gl=angle', '--use-angle=swiftshader'],
  env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Shots are [name, query] pairs; override via SHOTS="name:?a=1&b=2,...".
const DEFAULT_SHOTS = [
  ['front', 'angle=front&noturn=1&nopanel=1'],
  ['side', 'angle=side&noturn=1&nopanel=1'],
  ['back', 'angle=back&noturn=1&nopanel=1'],
  ['face', 'angle=face&noturn=1&nopanel=1'],
];
const spec = process.env.SHOTS
  ? process.env.SHOTS.split(',').map(s => { const i = s.indexOf(':'); return [s.slice(0, i), s.slice(i + 1)]; })
  : DEFAULT_SHOTS;
try {
  for (const [name, query] of spec) {
    await page.goto(`http://localhost:5173/model-preview.html?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__hero, undefined, { timeout: 30000, polling: 100 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `/tmp/hero-${name}.png` });
    console.log('shot', name, 'tris', await page.evaluate(() => window.__hero.triangleCount));
  }
  console.log('errors:', JSON.stringify(errors.slice(0, 10)));
} finally {
  await browser.close();
}
