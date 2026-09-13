import sharp from 'sharp';
import { stat, unlink } from 'node:fs/promises';

/**
 * System 2 + System 5 asset preparation: creation-screen art, portrait
 * skins, weapon card art, and the rest time-lapse sky pair.
 *
 * The shipped PR #37 art lives at 1.7–2.9 MB per PNG. This script:
 *   1. converts the creation banners / arch frame / parchment / wax seal
 *      and the six portrait faces + seven weapon cards to game-ready WebP,
 *      with a mild warm grade (R ×1.03, B ×0.93, sat ×1.04) so the faces
 *      read warm under the firelight world;
 *   2. generates the rest time-lapse sky pair (sky_night / sky_dawn)
 *      procedurally — seamless equirectangular 1024×512 with period-wrapped
 *      starfields, tuned to crossfade behind the camp;
 *   3. re-encodes the creation background sky (dusk) to WebP;
 *   4. deletes the superseded PNGs and the dead character/body/albedo PNGs
 *      (the skeletal rig is fully procedural — see HeroTextures).
 *
 * Re-run after replacing any source art: `npm run assets:creation`.
 */

const CREATION = 'public/images/creation';
const SKIES = 'public/images/skies';
const FACES = 'public/textures/character';
const WEAPONS = 'public/textures/weapons';
const PARTICLES = 'public/textures/particles';

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}
async function bytes(file) {
  try { return (await stat(file)).size; } catch { return 0; }
}

/** WebP conversion with auto alpha handling. */
async function toWebp(src, dest, { size = 1024, quality = 88, square = false } = {}) {
  const pipeline = sharp(src).rotate(); // honour EXIF orientation
  const { hasAlpha } = await pipeline.stats().catch(() => ({ hasAlpha: false }));
  if (square) pipeline.resize(size, size, { fit: 'cover' });
  else pipeline.resize(size, null, { withoutEnlargement: true });
  await pipeline.webp({ quality, effort: 6, alphaQuality: hasAlpha ? 95 : undefined }).toFile(dest);
}

/**
 * Mild warm grade: R ×1.03, B ×0.93, saturation ×1.04 — matches the game's
 * firelight colour language (see README Style Law).
 */
async function toWebpGraded(src, dest, { size = 512, quality = 88 } = {}) {
  const { data, info } = await sharp(src).rotate().resize(size, null, { withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const out = Buffer.from(data);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * c], g = data[i * c + 1], b = data[i * c + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = v => luma + (v - luma) * 1.04;
    out[i * c] = Math.min(255, Math.round(sat(r) * 1.03));
    out[i * c + 1] = Math.min(255, Math.round(sat(g)));
    out[i * c + 2] = Math.min(255, Math.round(sat(b) * 0.93));
  }
  await sharp(out, { raw: { width: w, height: h, channels: c } })
    .webp({ quality, effort: 6 })
    .toFile(dest);
}

// ---------------------------------------------------------------------------
// Procedural time-lapse skies (seamless equirectangular, 1024 × 512)
// ---------------------------------------------------------------------------

/** Deterministic PRNG so the skies are stable across runs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.max(0, Math.min(1, v));
/** Multi-stop vertical gradient: [[t, [r,g,b]], …] ascending t. */
function gradientY(t, stops) {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = clamp01((t - t0) / (t1 - t0));
      const s = k * k * (3 - 2 * k); // smoothstep
      return [lerp(c0[0], c1[0], s), lerp(c0[1], c1[1], s), lerp(c0[2], c1[2], s)];
    }
  }
  return stops[stops.length - 1][1];
}
/** Add a period-wrapped star (drawn at x, x±W so the sphere seam is invisible). */
function stampStar(px, W, H, x, y, radius, color) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dy) / radius;
      if (d > 1) continue;
      const a = Math.pow(1 - d, 1.6);
      for (const ox of [-W, 0, W]) {
        const xx = Math.round(x + dx + ox);
        const yy = Math.round(y + dy);
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        const i = (yy * W + xx) * 4;
        px[i] = Math.min(255, px[i] + color[0] * a);
        px[i + 1] = Math.min(255, px[i + 1] + color[1] * a);
        px[i + 2] = Math.min(255, px[i + 2] + color[2] * a);
      }
    }
  }
}

/** Deep winter night: dark teal-blue gradient, ~700 wrapped stars, faint galactic band. */
async function paintSkyNight(dest) {
  const W = 1024, H = 512;
  const px = Buffer.alloc(W * H * 4);
  const rand = mulberry32(0x572a1101);
  const stops = [
    [0.0, [4, 8, 16]],
    [0.38, [7, 13, 26]],
    [0.62, [10, 19, 36]],
    [0.8, [13, 26, 47]],
    [1.0, [16, 31, 55]],
  ];
  for (let y = 0; y < H; y++) {
    const [r, g, b] = gradientY(y / H, stops);
    for (let x = 0; x < W; x++) {
      // Faint galactic band: a soft diagonal luminance swell.
      const band = Math.exp(-Math.pow((y / H - 0.42 - 0.16 * Math.sin((x / W) * Math.PI * 2)) * 4.2, 2));
      const i = (y * W + x) * 4;
      px[i] = r + 6 * band;
      px[i + 1] = g + 8 * band;
      px[i + 2] = b + 14 * band;
      px[i + 3] = 255;
    }
  }
  const tints = [[210, 225, 255], [235, 240, 255], [255, 244, 224]];
  for (let n = 0; n < 720; n++) {
    const x = rand() * W;
    const y = rand() * H * 0.92;
    const mag = Math.pow(rand(), 3.2); // a few bright, most faint
    const radius = mag > 0.6 ? 2 : 1;
    const bright = 40 + 215 * mag;
    const tint = tints[Math.floor(rand() * tints.length)];
    stampStar(px, W, H, x, y, radius, [bright * (tint[0] / 255), bright * (tint[1] / 255), bright * (tint[2] / 255)]);
  }
  await sharp(px, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 82, effort: 6 }).toFile(dest);
}

/** Pre-dawn: indigo crown melting into an amber horizon glow, dim fading stars. */
async function paintSkyDawn(dest) {
  const W = 1024, H = 512;
  const px = Buffer.alloc(W * H * 4);
  const rand = mulberry32(0x572a2202);
  const stops = [
    [0.0, [9, 12, 30]],
    [0.4, [22, 30, 58]],
    [0.58, [52, 52, 80]],
    [0.72, [122, 88, 82]],
    [0.82, [201, 138, 82]],
    [0.9, [228, 168, 106]],
    [1.0, [150, 96, 62]],
  ];
  const glowX = 0.5, glowY = 0.8;
  for (let y = 0; y < H; y++) {
    const [r, g, b] = gradientY(y / H, stops);
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x / W - glowX) * 1.9, (y / H - glowY) * 2.4);
      const glow = Math.exp(-d * d * 4.5);
      // Thin mist bands ride the horizon.
      const mist = (0.5 + 0.5 * Math.sin((x / W) * Math.PI * 14 + 1.7)) * Math.exp(-Math.pow((y / H - 0.86) * 9, 2));
      const i = (y * W + x) * 4;
      px[i] = Math.min(255, r + 118 * glow + 26 * mist);
      px[i + 1] = Math.min(255, g + 74 * glow + 20 * mist);
      px[i + 2] = Math.min(255, b + 34 * glow + 12 * mist);
      px[i + 3] = 255;
    }
  }
  for (let n = 0; n < 220; n++) {
    const x = rand() * W;
    const y = rand() * H * 0.3; // only the upper sky still holds stars
    const mag = Math.pow(rand(), 3.4);
    const bright = 18 + 90 * mag;
    stampStar(px, W, H, x, y, 1, [bright, bright * 0.98, bright * 1.06]);
  }
  await sharp(px, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 82, effort: 6 }).toFile(dest);
}

// ---------------------------------------------------------------------------

const creationJobs = [
  { file: 'class_banner_fighter', size: 900, quality: 86 },
  { file: 'species_banner_human', size: 900, quality: 86 },
  { file: 'background_banner_soldier', size: 900, quality: 86 },
  { file: 'arch_frame', size: 1024, quality: 90, square: true },
  { file: 'parchment_bg', size: 2048, quality: 78 },
  { file: 'wax_seal_dragon', size: 768, quality: 90, square: true },
];
const faceFiles = ['face_m01', 'face_m02', 'face_m03', 'face_f01', 'face_f02', 'face_f03'];
const weaponFiles = ['longsword', 'battleaxe', 'warhammer', 'shortsword', 'longbow', 'quiver', 'shield'];

const sources = [];
const outputs = [];
const deletes = [];

for (const job of creationJobs) {
  const src = `${CREATION}/${job.file}.png`;
  const dest = `${CREATION}/${job.file}.webp`;
  if (await exists(src)) sources.push(src);
  outputs.push(dest);
  await toWebp(src, dest, { size: job.size, quality: job.quality, square: !!job.square });
}
// Dusk sky for the creation screen background.
if (await exists(`${SKIES}/sky_dusk.png`)) sources.push(`${SKIES}/sky_dusk.png`);
outputs.push(`${SKIES}/sky_dusk.webp`);
await toWebp(`${SKIES}/sky_dusk.png`, `${SKIES}/sky_dusk.webp`, { size: 2048, quality: 80 });
// Time-lapse pair (generated, no source).
outputs.push(`${SKIES}/sky_night.webp`, `${SKIES}/sky_dawn.webp`);
await paintSkyNight(`${SKIES}/sky_night.webp`);
await paintSkyDawn(`${SKIES}/sky_dawn.webp`);
// Portrait faces (graded warm).
for (const name of faceFiles) {
  const src = `${FACES}/${name}.png`;
  if (await exists(src)) sources.push(src);
  outputs.push(`${FACES}/${name}.webp`);
  await toWebpGraded(src, `${FACES}/${name}.webp`, { size: 512, quality: 88 });
}
// Weapon cards.
for (const name of weaponFiles) {
  const src = `${WEAPONS}/${name}.png`;
  if (await exists(src)) sources.push(src);
  outputs.push(`${WEAPONS}/${name}.webp`);
  await toWebp(src, `${WEAPONS}/${name}.webp`, { size: 512, quality: 86 });
}
// Dead art: the skeletal rig is procedural; particle sprites are procedural too.
deletes.push(
  `${FACES}/body_albedo.png`,
  `${FACES}/armour_chainmail_albedo.png`,
  `${PARTICLES}/campfire_ember.webp`,
  `${PARTICLES}/campfire_smoke.webp`,
  `${PARTICLES}/dust_mote.webp`,
);

const before = (await Promise.all(sources.map(bytes))).reduce((a, b) => a + b, 0);
const after = (await Promise.all(outputs.map(bytes))).reduce((a, b) => a + b, 0);
if (after === 0) throw new Error('Conversion produced no output — source PNGs left untouched.');
for (const src of sources) if (await exists(src)) await unlink(src);
for (const dead of deletes) if (await exists(dead)) await unlink(dead);

const kb = n => `${(n / 1024).toFixed(0)} KB`;
const savings = before > 0 ? ` (${Math.round((1 - after / before) * 100)}% smaller)` : ' (outputs refreshed)';
console.log(`Prepared creation + sky + character WebP: ${kb(before)} → ${kb(after)}${savings}.`);
console.log('Outputs:', outputs.join(', '));
