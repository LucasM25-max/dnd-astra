import sharp from 'sharp';
const a = await sharp('qa/sprite-check-visible.png').raw().toBuffer({ resolveWithObject: true });
const b = await sharp('qa/sprite-check-player-hidden.png').raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = a.info;
// Player strip from layout: x 640±75, y 296..485
const strip = { x0: 565, x1: 715, y0: 296, y1: 485 };
let inDiff = 0, inN = 0, outDiff = 0;
const grid = Array.from({ length: 10 }, () => Array(16).fill(0));
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * channels;
  const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2]);
  const inStrip = x >= strip.x0 && x <= strip.x1 && y >= strip.y0 && y <= strip.y1;
  if (inStrip) { inN++; if (d > 42) inDiff++; }
  else if (d > 42) outDiff++;
  if (d > 42) { const gy = Math.min(9, Math.floor(y / H * 10)), gx = Math.min(15, Math.floor(x / W * 16)); grid[gy][gx]++; }
}
console.log(`strip diff: ${inDiff}/${inN} (${(100 * inDiff / inN).toFixed(1)}%)  outside diff: ${outDiff} (${(100 * outDiff / (W * H - inN)).toFixed(2)}%)`);
console.log('diff density grid (rows=y deciles, cols=x sixteenths):');
for (const row of grid) console.log(row.map(v => v > 999 ? 'X' : v > 99 ? '9' : v > 9 ? '.' : ' ').join(''));
