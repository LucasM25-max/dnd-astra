// Derives tiling PBR albedo + normal maps for the encounter/creature art set.
// Source plates live in assets-source/; only the derived .webp files ship.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const PLATES = [
  { name: 'goblin-skin', size: 1024, bump: 2.6 },
  { name: 'goblin-cloth', size: 1024, bump: 2.4 },
  { name: 'leather-armor', size: 1024, bump: 2.8 },
  { name: 'chainmail', size: 1024, bump: 3.6 },
  { name: 'forged-steel', size: 1024, bump: 2.0 },
  { name: 'cave-rock', size: 1024, bump: 3.4 },
  { name: 'parchment', size: 1024, bump: 1.4 },
  // Creature-specific plates, generated for the photoreal model pass.
  { name: 'human-skin', size: 1024, bump: 1.2 },
  { name: 'ox-hide', size: 1024, bump: 1.1 },
  { name: 'horse-coat', size: 1024, bump: 1.0 },
];

await mkdir('public/textures', { recursive: true });

// Make the plate tile cleanly: mirror-blend the borders so repeat wrapping has no seam.
function makeSeamless(data, w, h, c) {
  const out = Buffer.from(data);
  const band = Math.floor(Math.min(w, h) * 0.12);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < band; x++) {
      const t = 0.5 * (1 - Math.cos((x / band) * Math.PI)); // 0 at edge -> 1 inside
      const a = (y * w + x) * c, b = (y * w + (w - 1 - x)) * c;
      for (let k = 0; k < c; k++) out[a + k] = Math.round(data[a + k] * t + data[b + k] * (1 - t));
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < band; y++) {
      const t = 0.5 * (1 - Math.cos((y / band) * Math.PI));
      const a = (y * w + x) * c, b = ((h - 1 - y) * w + x) * c;
      for (let k = 0; k < c; k++) out[a + k] = Math.round(out[a + k] * t + out[b + k] * (1 - t));
    }
  }
  return out;
}

for (const { name, size, bump } of PLATES) {
  const { data: raw, info } = await sharp(`assets-source/${name}.jpg`)
    .resize(size, size, { fit: 'cover' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, c = info.channels;
  const data = makeSeamless(raw, w, h, c);

  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) height[i] = (data[i * c] * 0.299 + data[i * c + 1] * 0.587 + data[i * c + 2] * 0.114) / 255;

  const normal = Buffer.alloc(w * h * 3);
  const rough = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const dx = (height[y * w + (x + 1) % w] - height[y * w + (x + w - 1) % w]) * bump;
    const dy = (height[((y + 1) % h) * w + x] - height[((y + h - 1) % h) * w + x] ) * bump;
    const n = 1 / Math.sqrt(dx * dx + dy * dy + 1), o = i * 3;
    normal[o] = Math.round((-dx * n * 0.5 + 0.5) * 255);
    normal[o + 1] = Math.round((dy * n * 0.5 + 0.5) * 255);
    normal[o + 2] = Math.round((n * 0.5 + 0.5) * 255);
    // Cavity-biased roughness: recessed, darker detail reads as rougher/dirtier.
    rough[i] = Math.round(Math.max(0, Math.min(1, 0.55 + (1 - height[i]) * 0.4)) * 255);
  }

  await sharp(data, { raw: { width: w, height: h, channels: c } }).webp({ quality: 88 }).toFile(`public/textures/${name}.webp`);
  await sharp(normal, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 93, effort: 6 }).toFile(`public/textures/${name}-normal.webp`);
  await sharp(rough, { raw: { width: w, height: h, channels: 1 } }).webp({ quality: 88 }).toFile(`public/textures/${name}-rough.webp`);
  console.log(`prepared ${name} (albedo + normal + roughness)`);
}
