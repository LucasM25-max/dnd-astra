import sharp from 'sharp';
import fs from 'node:fs/promises';
await fs.mkdir('public/textures', { recursive: true });
for (const name of ['wagon-oak', 'wagon-burlap', 'animal-coat']) {
  const { data, info } = await sharp(`assets-source/${name}.jpg`).resize(1024, 1024).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, c = info.channels, heights = new Float32Array(w * h), normals = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) heights[i] = (data[i * c] * .299 + data[i * c + 1] * .587 + data[i * c + 2] * .114) / 255;
  const strength = name === 'wagon-oak' ? 2.1 : name === 'wagon-burlap' ? 1.9 : 1.2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (heights[y * w + (x + 1) % w] - heights[y * w + (x + w - 1) % w]) * strength;
    const dy = (heights[((y + 1) % h) * w + x] - heights[((y + h - 1) % h) * w + x]) * strength;
    const n = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (y * w + x) * 3;
    normals[i] = Math.round((.5 - dx * n * .5) * 255); normals[i + 1] = Math.round((.5 + dy * n * .5) * 255); normals[i + 2] = Math.round((.5 + n * .5) * 255);
  }
  await sharp(normals, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 92 }).toFile(`public/textures/${name}-normal.webp`);
  await sharp(data, { raw: { width: w, height: h, channels: c } }).webp({ quality: 88 }).toFile(`public/textures/${name}.webp`);
}
console.log('Prepared wagon, sackcloth, and animal coat materials.');
