import sharp from 'sharp';
import { mkdir, readdir, writeFile } from 'node:fs/promises';

/**
 * Builds runtime sprite atlases from the generated turn-around sheets in
 * assets-source/sprites/.
 *
 * Each source sheet is a 4x4 grid of 16 viewing angles of one character on a
 * flat magenta background (see the prompts in the repo history / docs). The
 * script:
 *
 *   1. finds the 16 figure blobs (noise-robust connected components),
 *   2. orders them left-to-right, top-to-bottom (the orbit order),
 *   3. keys the magenta out with a soft threshold and despills magenta edges,
 *   4. normalizes every cell: one scale per character (derived from the idle
 *      sheet), bottom-anchored and centred, so feet land on the same line in
 *      every frame,
 *   5. packs the cells into one atlas per character — 16 direction columns x
 *      one row per animation sheet — and writes public/sprites/manifest.json.
 *
 * Adding a new state later (attack, hurt, down, graze, more walk frames) is
 * just: drop `<kind>-<state>.png` into assets-source/sprites/ (4x4 turn-around
 * of the same character) and re-run `npm run assets:sprites`.
 *
 * Engine-side column convention:
 *   column 0 = front view, 4 = actor's right flank, 8 = back, 12 = left flank.
 */

const SRC = 'assets-source/sprites';
const OUT = 'public/sprites';

/** Per-character build table: atlas cell size (px) and world height (m). */
const KINDS = {
  player: { cellW: 128, cellH: 272, height: 1.78, states: { idle: ['idle', 0], walk: ['walk', 3.1], run: ['run', 5.6], attack: ['attack', 0], hurt: ['hurt', 0], down: ['down', 0] } },
  goblin: { cellW: 136, cellH: 248, height: 1.24, states: { idle: ['idle', 0], walk: ['walk', 3.4], attack: ['attack', 0], hurt: ['hurt', 0], down: ['down', 0] } },
  horse: { cellW: 288, cellH: 240, height: 1.62, states: { idle: ['idle', 0], walk: ['walk', 2.6], graze: ['graze', 0], alert: ['alert', 0] } },
  ox: { cellW: 304, cellH: 240, height: 1.4, states: { idle: ['idle', 0], walk: ['walk', 2.2], graze: ['graze', 0], alert: ['alert', 0] } },
};
/** A state may be built from several ordered sheets (a multi-frame cycle). */
const SHEETS_PER_STATE = { idle: ['idle'], walk: ['walk-0', 'walk-1', 'walk-2', 'walk-3'], run: ['run-0', 'run-1'], attack: ['attack'], hurt: ['hurt'], down: ['down'], graze: ['graze-0', 'graze-1'], alert: ['alert'] };

const isMagenta = (r, g, b) => Math.min(r, b) - g > 60;

async function loadSheetCells(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const bg = (x, y) => isMagenta(data[(y * W + x) * C], data[(y * W + x) * C + 1], data[(y * W + x) * C + 2]);
  // Solid (content) mask: 3x3 majority vote kills magenta-keyed speckle noise.
  const solid = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!bg(x + dx, y + dy)) c++;
    solid[y * W + x] = c >= 5 ? 1 : 0;
  }
  // Connected components → figure blobs.
  const labels = new Int32Array(W * H).fill(-1);
  const blobs = [];
  const stack = [];
  for (let seed = 0; seed < W * H; seed++) {
    if (!solid[seed] || labels[seed] >= 0) continue;
    const id = blobs.length; stack.push(seed); labels[seed] = id;
    let minX = W, maxX = 0, minY = H, maxY = 0, area = 0;
    while (stack.length) {
      const p = stack.pop(); const x = p % W, y = (p / W) | 0; area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H || !solid[q] || labels[q] >= 0) continue;
        labels[q] = id; stack.push(q);
      }
    }
    blobs.push({ minX, maxX, minY, maxY, area });
  }
  const figures = blobs.filter(b => b.area > 2500);
  if (figures.length !== 16) throw new Error(`${file}: expected 16 figure cells, found ${figures.length} (areas ${blobs.filter(b => b.area > 2500).map(b => b.area).join(',')})`);
  // Reading order: cluster into row bands by centre-y, then sort by centre-x.
  const withCentres = figures.map(b => ({ ...b, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 }));
  const rowPitch = Math.max(...withCentres.map(b => b.maxY - b.minY)) * 0.8;
  const rows = [];
  for (const b of withCentres.sort((a, b) => a.cy - b.cy)) {
    const row = rows.find(r => Math.abs(r.cy - b.cy) < rowPitch);
    if (row) row.items.push(b); else rows.push({ cy: b.cy, items: [b] });
  }
  if (rows.length !== 4 || rows.some(r => r.items.length !== 4)) throw new Error(`${file}: grid is ${rows.length} rows of ${rows.map(r => r.items.length).join(',')} — expected 4x4`);
  const ordered = rows.flatMap(r => r.items.sort((a, b) => a.cx - b.cx));

  // Extract each cell as RGBA with soft magenta keying + despill.
  const cells = ordered.map(b => {
    const w = b.maxX - b.minX + 1, h = b.maxY - b.minY + 1;
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((b.minY + y) * W + b.minX + x) * C;
      const r = data[i], g = data[i + 1], bl = data[i + 2];
      const magenta = Math.min(r, bl) - g;
      // Soft ramp: fully transparent above 90, opaque below 30.
      const alpha = Math.round(Math.max(0, Math.min(1, (90 - magenta) / 60)) * 255);
      const o = (y * w + x) * 4;
      if (alpha > 0 && magenta > 0) {
        // Despill: pull magenta-tinted edge pixels back toward neutral.
        px[o] = Math.max(0, r - magenta * 0.65);
        px[o + 1] = g;
        px[o + 2] = Math.max(0, bl - magenta * 0.65);
      } else { px[o] = r; px[o + 1] = g; px[o + 2] = bl; }
      px[o + 3] = alpha;
    }
    return { px, w, h };
  });
  return cells;
}

/**
 * Blit `src` (RGBA, srcW x srcH) into a cell of a flat atlas buffer.
 * The cell's bottom-centre sits at (cellW/2, cellH - pad); the source is
 * scaled by `scale` (nearest neighbour, alpha-composited over the cell).
 */
function blitCell(atlas, atlasW, src, srcW, srcH, cellX, cellY, cellW, cellH, scale) {
  const outW = Math.round(srcW * scale), outH = Math.round(srcH * scale);
  const x0 = Math.round(cellW / 2 - outW / 2), y0 = cellH - 3 - outH;
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < outW; x++) {
      const dx = x0 + x, dy = y0 + y;
      if (dx < 0 || dy < 0 || dx >= cellW || dy >= cellH) continue;
      const sx = Math.min(srcW - 1, Math.floor(x / scale));
      const si = (sy * srcW + sx) * 4;
      const di = ((cellY + dy) * atlasW + cellX + dx) * 4;
      const a = src[si + 3];
      if (a < 8) continue;
      if (a > 247) { atlas[di] = src[si]; atlas[di + 1] = src[si + 1]; atlas[di + 2] = src[si + 2]; atlas[di + 3] = 255; }
      else {
        const pa = atlas[di + 3] / 255, pb = a / 255, na = pb + pa * (1 - pb);
        atlas[di] = Math.round((src[si] * pb + atlas[di] * pa * (1 - pb)) / (na || 1));
        atlas[di + 1] = Math.round((src[si + 1] * pb + atlas[di + 1] * pa * (1 - pb)) / (na || 1));
        atlas[di + 2] = Math.round((src[si + 2] * pb + atlas[di + 2] * pa * (1 - pb)) / (na || 1));
        atlas[di + 3] = Math.round(na * 255);
      }
    }
  }
}

await mkdir(OUT, { recursive: true });
const available = new Set((await readdir(SRC)).filter(f => f.endsWith('.png')));
const manifest = { version: 1, figures: {} };
let built = 0;

for (const [kind, cfg] of Object.entries(KINDS)) {
  // Collect this kind's sheets, in state order.
  const rows = [];
  const stateRows = {};
  let row = 0;
  const idleCells = available.has(`${kind}-idle.png`) ? await loadSheetCells(`${SRC}/${kind}-idle.png`) : null;
  for (const [state, sheets] of Object.entries(SHEETS_PER_STATE)) {
    const present = sheets.filter(s => available.has(`${kind}-${s}.png`));
    if (!present.length) continue;
    if (state === 'idle' && !idleCells) continue;
    const stateRowIndices = [];
    for (const sheet of present) {
      const cells = sheet === 'idle' ? idleCells : await loadSheetCells(`${SRC}/${kind}-${sheet}.png`);
      rows.push({ cells, label: `${kind}-${sheet}` });
      stateRowIndices.push(row++);
    }
    stateRows[state] = stateRowIndices;
  }
  if (!rows.length) { console.log(`· ${kind}: no source sheets, skipping`); continue; }

  // One scale per kind, from the idle sheet's median figure height.
  const heights = idleCells.map(c => c.h).sort((a, b) => a - b);
  const medianH = heights[8];
  let cellW = cfg.cellW, cellH = cfg.cellH;
  const scale = (cellH * 0.94) / medianH;
  // Widen/tall-en the cell if any frame's content would be clamped, so wide
  // poses (a goblin's spread arms, an ox's horns) keep the shared scale.
  for (const r of rows) for (const cell of r.cells) {
    cellW = Math.max(cellW, Math.ceil(cell.w * scale) + 8);
    cellH = Math.max(cellH, Math.ceil(cell.h * scale) + 6);
  }

  const atlasW = cellW * 16, atlasH = cellH * rows.length;
  const atlas = new Uint8Array(atlasW * atlasH * 4); // zero alpha = empty
  let clipped = 0;
  rows.forEach((r, rowIndex) => {
    r.cells.forEach((cell, dir) => {
      let s = scale;
      if (cell.w * s > cellW - 6) s = (cellW - 6) / cell.w;
      if (cell.h * s > cellH - 4) s = Math.min(s, (cellH - 4) / cell.h);
      if (cell.w * scale > cellW - 6 || cell.h * scale > cellH - 4) clipped++;
      blitCell(atlas, atlasW, cell.px, cell.w, cell.h, dir * cellW, rowIndex * cellH, cellW, cellH, s);
    });
  });
  if (clipped) console.log(`  ! ${kind}: ${clipped}/16 cells clipped by the cell frame in some rows (check margins)`);

  // Typical standing width of the figure (idle median blob width), in world
  // metres at the same scale that maps cellH px -> cfg.height. The card may be
  // much wider (auto-expanded for reach poses); effects like the contact
  // shadow should follow the figure, not the card.
  const idleWidths = idleCells.map(c => c.w).sort((a, b) => a - b);
  const figureWidth = +(cfg.height * (idleWidths[8] * scale / cellH)).toFixed(2);

  const states = {};
  for (const [state, rowIndices] of Object.entries(stateRows)) {
    states[state] = { rows: rowIndices, fps: cfg.states[state]?.[1] ?? 3 };
  }
  await sharp(Buffer.from(atlas), { raw: { width: atlasW, height: atlasH, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(`${OUT}/${kind}.webp`);
  manifest.figures[kind] = { atlas: `${kind}.webp`, cellW, cellH, columns: 16, rows: rows.length, height: cfg.height, width: figureWidth, states };
  console.log(`✓ ${kind}: atlas ${atlasW}x${atlasH}, rows [${rows.map(r => r.label.split('-').slice(1).join('-')).join(', ')}], scale ${scale.toFixed(2)}`);
  built++;
}

await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`Prepared ${built} sprite figure${built === 1 ? '' : 's'} → ${OUT}/manifest.json`);
