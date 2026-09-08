import sharp from 'sharp';
const file = process.argv[2];
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const isBg = (x, y) => { const i = (y * W + x) * C; return Math.min(data[i], data[i + 2]) - data[i + 1] > 60; };
// solid mask with 3x3 majority
const solid = new Uint8Array(W * H);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isBg(x + dx, y + dy)) c++;
  solid[y * W + x] = c >= 5 ? 1 : 0;
}
// connected components (iterative flood fill)
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
    const nb = [p - 1, p + 1, p - W, p + W];
    for (const q of nb) { if (q < 0 || q >= W * H) continue; if (solid[q] && labels[q] < 0) { labels[q] = id; stack.push(q); } }
  }
  blobs.push({ minX, maxX, minY, maxY, area, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
}
const big = blobs.filter(b => b.area > 3000).sort((a, b) => b.area - a.area);
console.log('blobs > 3000px:', big.length);
for (const b of big.slice(0, 40)) console.log(`  ${b.minX},${b.minY} ${b.maxX - b.minX + 1}x${b.maxY - b.minY + 1} area=${b.area} cx=${Math.round(b.cx)} cy=${Math.round(b.cy)}`);
// also 8x8 region report
console.log('region report (avg color / solid%):');
for (let by = 0; by < 8; by++) { let line = '';
  for (let bx = 0; bx < 8; bx++) {
    const x0 = Math.floor(bx * W / 8), x1 = Math.floor((bx + 1) * W / 8), y0 = Math.floor(by * H / 8), y1 = Math.floor((by + 1) * H / 8);
    let r = 0, g = 0, b2 = 0, s = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * W + x) * C; r += data[i]; g += data[i + 1]; b2 += data[i + 2]; if (solid[y * W + x]) s++; n++; }
    line += `(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b2 / n)}|${Math.round(100 * s / n)}%) `;
  } console.log(line); }
