import { chromium as playwright } from '@playwright/test';
import chromium from '@sparticuz/chromium';
import path from 'node:path'; import os from 'node:os';

/** Reads back which texture files the live scene actually bound, per surface. */
const libs = path.join(os.tmpdir(), 'astra-browser-libs');
const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(a => !['--single-process','--in-process-gpu'].includes(a)), env: { ...process.env, LD_LIBRARY_PATH: `${path.join(libs,'lib')}:${process.env.LD_LIBRARY_PATH ?? ''}` }, headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const textureRequests = [];
page.on('response', r => { const u = r.url(); if (u.includes('/textures/')) textureRequests.push(u.split('/').pop() + ' ' + r.status()); });
await page.addInitScript(() => localStorage.setItem('astra-preferences-v1', JSON.stringify({ quality:'performance', atmosphere:'golden', volume:0, sensitivity:1, invertY:false })));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ready="true"]', { timeout: 180000 });
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const a = window.__astra.getAdventure();
  let scene = a.wagon?.root ?? a.horses?.[0]?.root;
  while (scene && scene.parent) scene = scene.parent;
  const src = t => { const i = t && t.image; const s = i && (i.currentSrc || i.src); return s ? s.split('/').pop() : (t ? '(no-image)' : null); };
  const surfaces = [];
  const seen = new Set();
  scene?.traverse?.(o => {
    if (!(o.isMesh || o.isInstancedMesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const u = m.userData?.shader?.uniforms;
      const rec = {
        object: o.name || o.type,
        map: src(m.map),
        normalMap: src(m.normalMap),
        uRoad: u?.uRoad ? src(u.uRoad.value) : undefined,
        uStone: u?.uStone ? src(u.uStone.value) : undefined,
      };
      const key = JSON.stringify(rec);
      if (seen.has(key)) continue;
      seen.add(key); surfaces.push(rec);
    }
  });
  return surfaces;
});
const named = out.filter(o => /terrain|rock|stone|boulder|pebble|road|trail/i.test(o.object) || /rock|earth-path|forest-floor/.test(String(o.map)));
console.log('--- SURFACES OF INTEREST ---');
console.log(JSON.stringify(named, null, 1));
console.log('--- /textures/ REQUESTS ---');
console.log([...new Set(textureRequests)].sort().join('\n'));
await browser.close();
