import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * World environment texture preparation.
 *
 * Canonical mapping (the user-supplied environment set):
 *   ground (forest floor)  <- leaf litter      (assets-source/leaf-litter.jpg)
 *   tree bark / deadwood   <- mossy bark       (assets-source/mossy-bark-detail.jpg)
 *   trail / road surface   <- earth path       (assets-source/earth-path.jpg)
 *   rocks / stones         <- rock             (assets-source/rock.jpg)
 *   foliage alpha cards    <- oak branch       (assets-source/oak-branch.jpg)
 *
 * Any source can be overridden by dropping a replacement image into
 * assets-source/incoming/ — e.g. `incoming/leaf litter.jpg` or
 * `incoming/rock.png` — and re-running `npm run assets:prepare`.
 * File names are matched leniently (spaces vs dashes, jpg/jpeg/png).
 */

const INCOMING = 'assets-source/incoming';

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

/** Resolve a logical source name to a real file, preferring incoming/ overrides. */
async function resolveSource(name) {
  const variants = [
    name, name.replace(/-/g, ' '), name.replace(/ /g, '-'),
    `${name.replace(/-/g, ' ')} texture`, `${name.replace(/-/g, ' ')} photo`,
  ];
  for (const dir of [INCOMING, 'assets-source']) {
    for (const variant of variants) {
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const file = path.join(dir, variant + ext);
        if (await exists(file)) return file;
      }
    }
  }
  throw new Error(`Texture source not found for "${name}" — looked in ${INCOMING}/ and assets-source/`);
}

/**
 * Derive a tangent-space normal map from a colour image's luminance and write
 * both the colour WebP and the normal map. `strength` controls relief depth.
 */
async function preparePbr(source, outName, { size = 1024, strength = 2.4, quality = 87, normalQuality = 93 } = {}) {
  const { data, info } = await sharp(source).resize(size, size).removeAlpha().raw().toBuffer({ resolveWithObject: true });
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
  await sharp(out, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: normalQuality, effort: 6 }).toFile(`public/textures/${outName}-normal.webp`);
  await sharp(data, { raw: { width: w, height: h, channels: c } }).webp({ quality }).toFile(`public/textures/${outName}.webp`);
}

await mkdir('public/textures', { recursive: true });
await mkdir(INCOMING, { recursive: true });

// Ground: the leaf-litter sheet becomes the forest floor itself.
await preparePbr(await resolveSource('leaf-litter'), 'ground-leaf-litter', { strength: 2.6 });
// Tree bark, deadwood, stumps and posts: the mossy bark close-up.
await preparePbr(await resolveSource('mossy-bark-detail'), 'bark-moss', { strength: 3.2 });
// The wagon trail.
await preparePbr(await resolveSource('earth-path'), 'earth-path', { strength: 2.2 });
// Rocks, boulders and pebbles.
await preparePbr(await resolveSource('rock'), 'rock', { strength: 3.3 });

// Foliage: alpha-tested leaf cards from the oak-branch photo.
{
  const source = await resolveSource('oak-branch');
  const { data, info } = await sharp(source).resize(768, 768).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const alpha = Math.min(255, Math.max(0, (Math.max(r, g, b) - 13) * 8));
    out[i * 4] = alpha < 5 ? 85 : r; out[i * 4 + 1] = alpha < 5 ? 105 : g; out[i * 4 + 2] = alpha < 5 ? 35 : b; out[i * 4 + 3] = alpha;
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: 94, alphaQuality: 100 }).toFile('public/textures/oak-leaves.webp');
}

console.log('Prepared the world environment set: leaf-litter ground, mossy bark, earth path, rock, oak foliage.');
