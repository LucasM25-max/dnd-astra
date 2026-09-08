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
const blobs = [];
const stack = [];
for (let i = 0; i < W * H; i++) {
  if (!solid[i] || labels[i] >= 0) continue;
  const id = blobs.length; stack.push(i); labels[i] = id;
  let minX = W, maxX = 0, minY = H, maxY = 0, area = 0;
  while (stack.length) {
    const p = stack.pop(); const x = p % W, y = (p / W) | 0; area++;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= W * H) continue; if (solid[q] && labels[q] < 0) { labels[q] = id; stack.push(q); } }
  }
  blobs.push({ minX, maxX, minY, maxY, area, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
}
const big = blobs.filter(b => b.area > 2500);
console.log(file.split('/').pop(), `${W}x${H}`, 'cells:', big.length);
if (big.length === 16) {
  // reading order: sort by row bands then column bands
  const rows = [];
  for (const b of [...big].sort((a, b) => a.cy - b.cy)) {
    const row = rows.find(r => Math.abs(r.cy - b.cy) < 60);
    if (row) row.items.push(b); else rows.push({ cy: b.cy, items: [b] });
  }
  const ordered = rows.flatMap(r => r.items.sort((a, b) => a.cx - b.cx));
  const widths = ordered.map(b => b.maxX - b.minX + 1);
  console.log('  rows:', rows.length, 'row counts:', rows.map(r => r.items.length).join(','));
  console.log('  widths:', widths.join(','));
  // signatures
  let cos16 = 0, alt = 0, norm = 0;
  for (let i = 0; i < 16; i++) { cos16 += widths[i] * Math.cos(Math.PI * i / 4); alt += widths[i] * (i % 2 ? -1 : 1); norm += widths[i] * widths[i]; }
  const a = Math.hypot(16 * 0, 1); // placeholder
  const cosMean = widths.reduce((s, w) => s + w, 0) / 16;
  let sxx = 0; for (const w of widths) sxx += (w - cosMean) ** 2;
  const cosScore = cos16 / Math.sqrt(sxx * 8); // correlation with cos(pi i/4)
  const altScore = alt / Math.sqrt(sxx * 16);
  console.log('  orbit-score (want +1):', cosScore.toFixed(2), ' 4-canonical-score:', altScore.toFixed(2));
  // aspect check: all cells similar height?
  const heights = ordered.map(b => b.maxY - b.minY + 1);
  console.log('  heights:', heights.join(','));
}
