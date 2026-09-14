import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Camp site textures. Derived from the canonical environment set already in
 * assets-source/ so the camp reads as the same ground and timber as the
 * rest of the woodland ("use existing ones where available"), and where the
 * camp needs a surface the environment set has no sheet for (the trodden,
 * scorched circle around the fire, chared log ends, the wool bedroll) the
 * existing photo sheets are re-graded rather than invented from scratch.
 *
 * Re-run after replacing any source image: `npm run assets:camp`.
 */

const OUT = 'public/textures/camp';
async function exists(file) { try { await stat(file); return true; } catch { return false; } }
async function resolveSource(name) {
  for (const dir of ['assets-source/incoming', 'assets-source'])
    for (const variant of [name, name.replace(/-/g, ' ')])
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const file = path.join(dir, variant + ext);
        if (await exists(file)) return file;
      }
  throw new Error(`Texture source not found for "${name}"`);
}

async function rawBuffer(img) { return img.raw().toBuffer({ resolveWithObject: true }); }

/** Derive a tangent-space normal map from luminance (same recipe as prepare-textures). */
async function writeNormal(data, info, outFile, strength = 2.6) {
  const w = info.width, h = info.height, c = info.channels;
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) height[i] = (data[i * c] * .299 + data[i * c + 1] * .587 + data[i * c + 2] * .114) / 255;
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (height[y * w + (x + 1) % w] - height[y * w + (x + w - 1) % w]) * strength;
    const dy = (height[((y + 1) % h) * w + x] - height[((y + h - 1) % h) * w + x]) * strength;
    const n = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (y * w + x) * 3;
    out[i] = Math.round((-dx * n * .5 + .5) * 255);
    out[i + 1] = Math.round((dy * n * .5 + .5) * 255);
    out[i + 2] = Math.round((n * .5 + .5) * 255);
  }
  await sharp(out, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 92, effort: 6 }).toFile(outFile);
}

await mkdir(OUT, { recursive: true });
const size = 512;

// --- Trodden, scorched camp earth: forest soil darkened with ash and a
// heavier litter speckle so the clearing floor reads as used ground.
{
  const a = await rawBuffer(sharp(await resolveSource('forest-soil')).resize(size, size).removeAlpha());
  const b = await rawBuffer(sharp(await resolveSource('leaf-litter')).resize(size, size).removeAlpha());
  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const speck = Math.random() < .012 ? 42 : 0; // charcoal flecks
    for (let ch = 0; ch < 3; ch++) {
      const s = a.data[i * 3 + ch] * .62 + b.data[i * 3 + ch] * .30; // trodden soil with worked-in litter
      out[i * 3 + ch] = Math.max(0, Math.min(255, Math.round(s * .78 + speck * (ch === 1 ? 0.9 : 1))));
    }
  }
  const info = { width: size, height: size, channels: 3 };
  await sharp(out, { raw: info }).webp({ quality: 86, effort: 6 }).toFile(`${OUT}/camp-ground.webp`);
  await writeNormal(out, info, `${OUT}/camp-ground-normal.webp`, 3.1);
}

// --- Chared firewood: the oak plank sheet, dimmed and high-contrast so the
// grain breaks into cracked, burnt timber.
{
  const { data, info } = await rawBuffer(sharp(await resolveSource('wagon-oak')).resize(size, size).removeAlpha());
  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    for (let ch = 0; ch < 3; ch++) {
      const v = data[i * 3 + ch];
      const crushed = Math.max(0, Math.min(255, (v - 128) * 2.4 + 128)); // crack contrast
      const tint = ch === 0 ? .30 : ch === 1 ? .245 : .20;              // ember-lit umber
      out[i * 3 + ch] = Math.round(crushed * tint + (v < 70 ? 4 : 0));
    }
  }
  const camp = { width: size, height: size, channels: 3 };
  await sharp(out, { raw: camp }).webp({ quality: 86, effort: 6 }).toFile(`${OUT}/charred-log.webp`);
  await writeNormal(out, camp, `${OUT}/charred-log-normal.webp`, 4.2);
}

// --- Bedroll wool: burlap, dimmed to a dusty blue-grey with a warm
// firelight bias so it matches the world's colour law.
{
  const { data } = await rawBuffer(sharp(await resolveSource('wagon-burlap')).resize(256, 256).removeAlpha());
  const out = Buffer.alloc(256 * 256 * 3);
  for (let i = 0; i < 256 * 256; i++) {
    const r = data[i * 3] * 1.02, g = data[i * 3 + 1] * .96, b = data[i * 3 + 2] * .9;
    out[i * 3] = Math.round((r * .44 + 18) * .82);       // warm grey-blue wool
    out[i * 3 + 1] = Math.round((g * .46 + 20) * .86);
    out[i * 3 + 2] = Math.round((b * .52 + 30) * .95);
  }
  await sharp(out, { raw: { width: 256, height: 256, channels: 3 } }).webp({ quality: 84, effort: 6 }).toFile(`${OUT}/bedroll-wool.webp`);
  await writeNormal(out, { width: 256, height: 256, channels: 3 }, `${OUT}/bedroll-wool-normal.webp`, 2.8);
}

console.log('Prepared camp textures: trodden scorch ground, charred logs, wool bedroll (each with derived normals).');
