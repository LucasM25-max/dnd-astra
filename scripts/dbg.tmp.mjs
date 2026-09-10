import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const libs = path.join(os.tmpdir(), 'astra-browser-libs');
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter(a => !['--single-process', '--in-process-gpu'].includes(a)), '--use-gl=angle', '--use-angle=swiftshader'],
  env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs, 'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message.split('\n').slice(0,4).join(' | ')));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE:', m.text().slice(0, 300)); });
await page.goto('http://localhost:5173/model-preview.html?angle=front&noturn=1&nopanel=1', { waitUntil: 'networkidle' }).catch(e => console.log('NAV:', e.message.slice(0,200)));
await page.waitForTimeout(4000);
console.log('has __hero:', await page.evaluate(() => !!window.__hero));
await browser.close();
