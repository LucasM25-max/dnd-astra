import sharp from 'sharp';
const file = process.argv[2];
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const isBg = (x, y) => { const i = (y * W + x) * C; return Math.min(data[i], data[i + 2]) - data[i + 1] > 60; };
const solid = new Uint8Array(W * H);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isBg(x + dx, y + dy)) c++;
  solid[y * W + x] = c >= 5 ? 1 : 0;
}
const labels = new Int32Array(W * H).fill(-1);
const blobs = []; const stack = [];
for (let i = 0; i < W * H; i++) {
  if (!solid[i] || labels[i] >= 0) continue;
  const id = blobs.length; stack.push(i); labels[i] = id;
  let minX = W, maxX = 0, minY = H, maxY = 0, area = 0;
  while (stack.length) {
    const p = stack.pop(); const x = p % W, y = (p / W) | 0; area++;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= W * H) continue; if (solid[q] && labels[q] < 0) { labels[q] = id; stack.push(q); } }
  }
  blobs.push({ minX, maxX, minY, maxY, area });
}
const big = blobs.filter(b => b.area > 2500);
const rows = [];
for (const b of [...big].sort((a, b) => a.cy ?? (a.minY + a.maxY) / 2 - ((b.minY + b.maxY) / 2))) {}
for (const b of [...big].sort((a, b) => (a.minY + a.maxY) - (b.minY + b.maxY))) {
  const cy = (b.minY + b.maxY) / 2;
  const row = rows.find(r => Math.abs(r.cy - cy) < 60);
  if (row) row.items.push(b); else rows.push({ cy, items: [b] });
}
const cells = rows.flatMap(r => r.items.sort((a, b) => (a.minX + b.maxX - (b.minX + a.maxX)) * 0 - ((a.minX + a.maxX) - (b.minX + b.maxX))));
// rasterize each blob into a normalized 48x64 mask
const masks = cells.map(b => {
  const bw = b.maxX - b.minX + 1, bh = b.maxY - b.minY + 1;
  const m = new Uint8Array(48 * 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 48; x++) {
    const sx = b.minX + Math.floor(x * bw / 48), sy = b.minY + Math.floor(y * bh / 64);
    m[y * 48 + x] = solid[sy * W + sx] ? 1 : 0;
  }
  return m;
});
const iou = (a, b) => { let inter = 0, union = 0; for (let i = 0; i < a.length; i++) { if (a[i] || b[i]) union++; if (a[i] && b[i]) inter++; } return union ? inter / union : 0; };
console.log('adjacent similarity (i, i+1):');
let adj = [];
for (let i = 0; i < 16; i++) { const s = iou(masks[i], masks[(i + 1) % 16]); adj.push(s); process.stdout.write(s.toFixed(2).padStart(6)); }
console.log();
console.log('opposite similarity (i, i+8):');
for (let i = 0; i < 16; i++) process.stdout.write(iou(masks[i], masks[(i + 8) % 16]).toFixed(2).padStart(6));
console.log();
console.log('offset-4 similarity (i, i+4):');
for (let i = 0; i < 16; i++) process.stdout.write(iou(masks[i], masks[(i + 4) % 16]).toFixed(2).padStart(6));
console.log();
console.log('mean adjacent:', (adj.reduce((a, b) => a + b) / 16).toFixed(3));
