import sharp from 'sharp';
import { stat, unlink } from 'node:fs/promises';

/**
 * Phase-0 system asset preparation (dice + particles).
 *
 * The PR #37 art ships at 1–3 MB per PNG and is never loaded by the game:
 * dice PBR sets are ignored by DieMeshFactory, and ParticleEffects is fully
 * procedural. This script converts the art to game-ready WebP at sane sizes
 * so Phase 1 (dice) and later phases can actually use it:
 *
 *   dice_body_albedo.webp     1024²  bone-ivory grain (sRGB)
 *   dice_body_normal.webp     1024²  matching normals (q95 — vectors survive)
 *   dice_body_roughness.webp  1024²  face-rough / edge-smooth variation
 *   dice_tray.webp            1024w  leather tray, keeps 1408:768 aspect
 *   dust_mote.webp             128²  white + luminance alpha (tintable)
 *   campfire_ember.webp         64²  warm glow + luminance alpha (additive)
 *   campfire_smoke.webp        128²  grey + luminance alpha (normal blend)
 *
 * Source PNGs are deleted after a successful conversion — the WebP files are
 * the canonical game assets (see public/credits.txt). Re-run after replacing
 * any source art: `npm run assets:systems`.
 */

const DICE = 'public/textures/dice';
const PARTICLES = 'public/textures/particles';

async function bytes(file) {
  try { return (await stat(file)).size; } catch { return 0; }
}

/** Resize RGB art to WebP, preserving aspect unless `square` is set. */
async function toWebp(src, dest, { size = 1024, quality = 90, square = false } = {}) {
  const pipeline = sharp(src);
  if (square) pipeline.resize(size, size, { fit: 'cover' });
  else pipeline.resize(size, null, { withoutEnlargement: true });
  await pipeline.webp({ quality, effort: 6 }).toFile(dest);
}

/**
 * Build a tintable sprite: white/grey RGB with luminance-derived alpha, so
 * THREE material `color` tints cleanly and edges feather to transparent.
 * `keepHue` preserves the source colour (embers) instead of whitening.
 */
async function toSprite(src, dest, { size = 128, keepHue = false, quality = 90 } = {}) {
  const { data, info } = await sharp(src)
    .resize(size, size, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * c], g = data[i * c + 1], b = data[i * c + 2];
    const lum = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    if (keepHue) {
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b;
    } else {
      // Pure luminance grey: material `color` tints predictably.
      out[i * 4] = lum; out[i * 4 + 1] = lum; out[i * 4 + 2] = lum;
    }
    out[i * 4 + 3] = lum;
  }
  await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality, alphaQuality: 95, effort: 6 })
    .toFile(dest);
}

/**
 * Procedural soft dot (dust motes). The AI source had a baked-in
 * transparency-checkerboard artefact, so the spec's "soft white circle with
 * feathered alpha edges" is generated directly: warm-white core, smooth
 * falloff, true alpha. Tintable via material `color`.
 */
async function makeSoftDot(dest, { size = 128 } = {}) {
  const out = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - center, y - center) / center; // 0 centre → 1 edge
      const core = Math.max(0, 1 - d * 1.6);
      const halo = Math.max(0, 1 - d);
      const alpha = Math.round(255 * Math.pow(halo, 2.1));
      const bright = Math.round(255 * (0.72 + 0.28 * Math.pow(core, 1.4)));
      const i = (y * size + x) * 4;
      out[i] = bright; out[i + 1] = Math.round(bright * 0.985); out[i + 2] = Math.round(bright * 0.94);
      out[i + 3] = alpha;
    }
  }
  await sharp(out, { raw: { width: size, height: size, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 100, effort: 6 })
    .toFile(dest);
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

const jobs = [
  { src: `${DICE}/dice_body_albedo.png`, run: () => toWebp(`${DICE}/dice_body_albedo.png`, `${DICE}/dice_body_albedo.webp`, { size: 1024, quality: 90, square: true }) },
  { src: `${DICE}/dice_body_normal.png`, run: () => toWebp(`${DICE}/dice_body_normal.png`, `${DICE}/dice_body_normal.webp`, { size: 1024, quality: 95, square: true }) },
  { src: `${DICE}/dice_body_roughness.png`, run: () => toWebp(`${DICE}/dice_body_roughness.png`, `${DICE}/dice_body_roughness.webp`, { size: 1024, quality: 90, square: true }) },
  { src: `${DICE}/dice_tray.png`, run: () => toWebp(`${DICE}/dice_tray.png`, `${DICE}/dice_tray.webp`, { size: 1024, quality: 88 }) },
  // Dust is fully procedural (see makeSoftDot) — no source file needed.
  { src: null, run: () => makeSoftDot(`${PARTICLES}/dust_mote.webp`, { size: 128 }) },
  { src: `${PARTICLES}/campfire_ember.png`, run: () => toSprite(`${PARTICLES}/campfire_ember.png`, `${PARTICLES}/campfire_ember.webp`, { size: 64, keepHue: true }) },
  { src: `${PARTICLES}/campfire_smoke.png`, run: () => toSprite(`${PARTICLES}/campfire_smoke.png`, `${PARTICLES}/campfire_smoke.webp`, { size: 128 }) },
];

const sources = [
  `${DICE}/dice_body_albedo.png`, `${DICE}/dice_body_normal.png`,
  `${DICE}/dice_body_roughness.png`, `${DICE}/dice_tray.png`,
  `${PARTICLES}/dust_mote.png`, `${PARTICLES}/campfire_ember.png`, `${PARTICLES}/campfire_smoke.png`,
];
const outputs = [
  `${DICE}/dice_body_albedo.webp`, `${DICE}/dice_body_normal.webp`,
  `${DICE}/dice_body_roughness.webp`, `${DICE}/dice_tray.webp`,
  `${PARTICLES}/dust_mote.webp`, `${PARTICLES}/campfire_ember.webp`, `${PARTICLES}/campfire_smoke.webp`,
];

const before = (await Promise.all(sources.map(bytes))).reduce((a, b) => a + b, 0);
for (const job of jobs) {
  if (job.src && !(await exists(job.src))) {
    console.log(`Skipping ${job.src} — source not present (output kept).`);
    continue;
  }
  await job.run();
}
const after = (await Promise.all(outputs.map(bytes))).reduce((a, b) => a + b, 0);
if (after === 0) throw new Error('Conversion produced no output — source PNGs left untouched.');
for (const src of sources) {
  if (await exists(src)) await unlink(src);
}

const kb = n => `${(n / 1024).toFixed(0)} KB`;
const savings = before > 0 ? ` (${Math.round((1 - after / before) * 100)}% smaller)` : ' (outputs refreshed)';
console.log(`Prepared dice + particle WebP: ${kb(before)} → ${kb(after)}${savings}.`);
console.log('Outputs:', outputs.join(', '));
