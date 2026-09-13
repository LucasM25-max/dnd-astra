import sharp from 'sharp';
import { stat, unlink } from 'node:fs/promises';

/**
 * Phase-0 system asset preparation (dice).
 *
 * The PR #37 dice art ships at 1–3 MB per PNG. This script converts it to
 * game-ready WebP at sane sizes so the dice system can actually use it:
 *
 *   dice_body_albedo.webp     1024²  bone-ivory grain (sRGB)
 *   dice_body_normal.webp     1024²  matching normals (q95 — vectors survive)
 *   dice_body_roughness.webp  1024²  face-rough / edge-smooth variation
 *   dice_tray.webp            1024w  leather tray, keeps 1408:768 aspect
 *
 * Source PNGs are deleted after a successful conversion — the WebP files are
 * the canonical game assets (see public/credits.txt). Re-run after replacing
 * any source art: `npm run assets:systems`.
 */

const DICE = 'public/textures/dice';

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

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

const jobs = [
  { src: `${DICE}/dice_body_albedo.png`, run: () => toWebp(`${DICE}/dice_body_albedo.png`, `${DICE}/dice_body_albedo.webp`, { size: 1024, quality: 90, square: true }) },
  { src: `${DICE}/dice_body_normal.png`, run: () => toWebp(`${DICE}/dice_body_normal.png`, `${DICE}/dice_body_normal.webp`, { size: 1024, quality: 95, square: true }) },
  { src: `${DICE}/dice_body_roughness.png`, run: () => toWebp(`${DICE}/dice_body_roughness.png`, `${DICE}/dice_body_roughness.webp`, { size: 1024, quality: 90, square: true }) },
  { src: `${DICE}/dice_tray.png`, run: () => toWebp(`${DICE}/dice_tray.png`, `${DICE}/dice_tray.webp`, { size: 1024, quality: 88 }) },
];

const sources = [
  `${DICE}/dice_body_albedo.png`, `${DICE}/dice_body_normal.png`,
  `${DICE}/dice_body_roughness.png`, `${DICE}/dice_tray.png`,
];
const outputs = [
  `${DICE}/dice_body_albedo.webp`, `${DICE}/dice_body_normal.webp`,
  `${DICE}/dice_body_roughness.webp`, `${DICE}/dice_tray.webp`,
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
console.log(`Prepared dice WebP: ${kb(before)} → ${kb(after)}${savings}.`);
console.log('Outputs:', outputs.join(', '));
