import * as THREE from 'three';

/**
 * Fake-3D sprite actors: 2D animation frames playing inside the 3D world.
 *
 * Each character is painted as 16 direction variants (22.5° steps) of a small
 * animation set on an offscreen canvas atlas — a true sprite sheet. At
 * runtime an upright cylindrical billboard shows the variant whose direction
 * matches the angle between the camera and the actor's facing, so the actor
 * reads as a 3D figure that turns, walks, and breathes even though it is a
 * flat image. Neighbouring variants crossfade near the 22.5° boundaries, so
 * orbiting the camera never pops between angles.
 *
 * All geometry is plain 2D math (character space: x = right, y = up,
 * z = facing), which keeps the painters unit-testable without a DOM. Tiles
 * are painted at 2× resolution and downscaled into the atlas with a fine
 * photographic grain, so edges stay smooth and surfaces sit next to the
 * photorealistic world textures instead of reading as flat cartoons.
 */

export interface V3 { x: number; y: number; z: number }
export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const addV = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const subV = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scaleV = (a: V3, s: number): V3 => v3(a.x * s, a.y * s, a.z * s);
export const lerpV = (a: V3, b: V3, t: number): V3 => v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const normV = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return v3(a.x / l, a.y / l, a.z / l); };

export function normalizeAngle(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Signed angle from the actor's facing to the direction toward the camera.
 * 0 → camera in front (face), ±π → behind, positive → camera on the actor's
 * left side, negative → on its right. Matches the world convention where
 * forward = (-sin yaw, 0, -cos yaw).
 */
export function viewAngle(yaw: number, x: number, z: number, camX: number, camZ: number): number {
  const dx = camX - x, dz = camZ - z;
  if (Math.hypot(dx, dz) < 1e-4) return 0;
  return normalizeAngle(Math.atan2(dx, dz) - Math.atan2(-Math.sin(yaw), -Math.cos(yaw)));
}

export function directionIndex(yaw: number, x: number, z: number, camX: number, camZ: number): number {
  return ((Math.round(viewAngle(yaw, x, z, camX, camZ) / (Math.PI / 8)) % 16) + 16) % 16;
}

/** Half-width (in 22.5° steps) of the crossfade zone around each boundary. */
export const DIRECTION_BLEND_HALF_WIDTH = .22;

/**
 * Smooth direction picking: the closest side is shown at any moment, and the
 * two flanking variants crossfade across the boundary instead of popping.
 * Returns tile indices `a` → `b` and the mix factor `t` (0 = all `a`).
 */
export function directionBlend(yaw: number, x: number, z: number, camX: number, camZ: number, halfWidth = DIRECTION_BLEND_HALF_WIDTH): { a: number; b: number; t: number } {
  const f = ((viewAngle(yaw, x, z, camX, camZ) / (Math.PI / 8)) % 16 + 16) % 16;
  const i0 = Math.floor(f) % 16, f0 = f - Math.floor(f);
  const d = f0 - .5; // −.5..+.5; ±.5 is a tile centre, 0 the boundary
  if (d <= -halfWidth) return { a: i0, b: i0, t: 0 };
  if (d >= halfWidth) return { a: (i0 + 1) % 16, b: (i0 + 1) % 16, t: 0 };
  const t = (d + halfWidth) / (2 * halfWidth);
  return { a: i0, b: (i0 + 1) % 16, t: t * t * (3 - 2 * t) };
}

/** Camera-relative angle at which atlas direction `dir` is painted. */
export const relForIndex = (dir: number) => normalizeAngle(dir * (Math.PI / 8));

// ---------------------------------------------------------------------------
// Normal-mapped sprite lighting
// ---------------------------------------------------------------------------

/**
 * Shared per-frame light rig for every sprite actor. world.ts refreshes these
 * from the sun + hemisphere each frame; all sprite materials reference the
 * SAME uniform objects, so one update lights every billboard.
 */
export const spriteLightUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uHemiSky: { value: new THREE.Color(.5, .5, .5) },
  uHemiGround: { value: new THREE.Color(.3, .3, .3) },
};

/**
 * Pure Sobel normal kernel in billboard tangent space (U right, V up, W
 * toward the viewer). Canvas row+1 points V-down, matching the normal
 * convention in scripts/prepare-textures.mjs. `heightAt` is sampled with
 * tile-clamped coordinates by the caller so tiles never bleed into each
 * other. Returns RGB triplets in 0..1.
 */
export function sobelNormal(heightAt: (x: number, y: number) => number, x: number, y: number, strength: number): [number, number, number] {
  const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength;
  const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength;
  const n = 1 / Math.sqrt(dx * dx + dy * dy + 1);
  return [-dx * n * .5 + .5, dy * n * .5 + .5, n * .5 + .5];
}

/**
 * Projects character-space points to the billboard's canvas.
 * Character space: x = right, y = up, z = facing. The camera sits at `rel`
 * (see viewAngle), so toCam in character space is (-sin rel, 0, cos rel).
 */
export class View {
  readonly rel: number;
  readonly cosR: number;
  readonly sinR: number;
  /** Animation phase (radians) and wall-clock seconds for the current frame. */
  phase = 0;
  t = 0;
  /** Which action/frame is being painted (set by buildSheet for the painter). */
  action: string = 'idle';
  frame = 0;
  constructor(yaw: number, x: number, z: number, camX: number, camZ: number, public pxPerMeter: number) {
    this.rel = viewAngle(yaw, x, z, camX, camZ);
    this.cosR = Math.cos(this.rel); this.sinR = Math.sin(this.rel);
  }
  get facing() { return this.cosR; } // 1 = face on, -1 = back on
  /** Screen x in metres, measured from the actor's centre. */
  sx(p: V3) { return -(p.x * this.cosR + p.z * this.sinR); }
  /** Depth toward the camera in metres (bigger = nearer). */
  depth(p: V3) { return p.z * this.cosR - p.x * this.sinR; }
  /** Is `p` on the camera side of `centre`? (used for facial features, etc.) */
  near(p: V3, centre: V3) {
    return (p.z - centre.z) * this.cosR - (p.x - centre.x) * this.sinR > 0;
  }
  toScreen(p: V3, width: number, height: number, padBottom = 0): { x: number; y: number; depth: number; scale: number } {
    const scale = 1 + this.depth(p) * .06; // subtle near/far size
    return {
      x: width / 2 + this.sx(p) * this.pxPerMeter * scale,
      y: height - padBottom - p.y * this.pxPerMeter * scale,
      depth: this.depth(p), scale,
    };
  }
}

/** A painter item: drawn after everything with smaller depth. */
export interface DrawItem { depth: number; draw: () => void }
export function sortItems(items: DrawItem[]) { items.sort((a, b) => a.depth - b.depth); }

// ---------------------------------------------------------------------------
// Canvas drawing helpers (require a 2D context; called only in the browser)
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

export function shade(color: string, amount: number): string {
  let r = 0, g = 0, b = 0;
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
  }
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amount * 255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Thick round-capped limb stroke: soft contact edge, body shading, top sheen. */
export function limb(ctx: Ctx, a: V3, b: V3, r: number, color: string, view: View, width: number, height: number, padBottom = 0) {
  const A = view.toScreen(a, width, height, padBottom), B = view.toScreen(b, width, height, padBottom);
  const mid = view.depth(scaleV(addV(a, b), .5));
  const w = Math.max(1.4, 2 * r * view.pxPerMeter * (1 + mid * .06));
  ctx.lineCap = 'round';
  // A narrow, translucent contact edge instead of a cartoon outline.
  ctx.save(); ctx.globalAlpha = .8;
  ctx.strokeStyle = shade(color, -.24); ctx.lineWidth = w + 1.7;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  ctx.restore();
  const g = ctx.createLinearGradient(A.x, Math.min(A.y, B.y), B.x, Math.max(A.y, B.y));
  g.addColorStop(0, shade(color, .10)); g.addColorStop(.55, color); g.addColorStop(1, shade(color, -.13));
  ctx.strokeStyle = g; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  // Cylindrical top-light sheen.
  if (w > 3) {
    ctx.save(); ctx.globalAlpha = .22;
    ctx.strokeStyle = shade(color, .30); ctx.lineWidth = Math.max(1, w * .26);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    ctx.restore();
  }
  return view.depth(scaleV(addV(a, b), .5));
}

/** Filled smooth closed polygon through 3D points (body masses). */
export function mass(ctx: Ctx, points: V3[], color: string, view: View, width: number, height: number, padBottom = 0, extra?: (path: Path2D) => void) {
  const pts = points.map(p => view.toScreen(p, width, height, padBottom));
  const path = new Path2D();
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  path.moveTo((pts[pts.length - 1].x + pts[0].x) / 2, (pts[pts.length - 1].y + pts[0].y) / 2);
  for (let i = 0; i < pts.length; i++) {
    const m = mid(pts[i], pts[(i + 1) % pts.length]);
    path.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  path.closePath();
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.globalAlpha = .85;
  ctx.strokeStyle = shade(color, -.24); ctx.lineWidth = 2; ctx.stroke(path);
  ctx.globalAlpha = 1;
  const yMin = Math.min(...pts.map(p => p.y)), yMax = Math.max(...pts.map(p => p.y));
  const xMin = Math.min(...pts.map(p => p.x)), xMax = Math.max(...pts.map(p => p.x));
  const g = ctx.createLinearGradient(0, yMin, 0, yMax);
  g.addColorStop(0, shade(color, .13)); g.addColorStop(.5, color); g.addColorStop(1, shade(color, -.16));
  ctx.fillStyle = g; ctx.fill(path);
  // Soft skylight across the upper mass.
  ctx.save(); ctx.clip(path);
  const sheen = ctx.createLinearGradient(0, yMin, 0, yMin + (yMax - yMin) * .5);
  sheen.addColorStop(0, 'rgba(255,252,240,.13)'); sheen.addColorStop(1, 'rgba(255,252,240,0)');
  ctx.fillStyle = sheen; ctx.fillRect(xMin, yMin, xMax - xMin, (yMax - yMin) * .5 + 1);
  ctx.restore();
  if (extra) extra(path);
  ctx.restore();
  return view.depth(points[0]);
}

/** Simple filled blob (heads, hands, pommels…) with a faint rim highlight. */
export function blob(ctx: Ctx, p: V3, rx: number, ry: number, color: string, view: View, width: number, height: number, padBottom = 0) {
  const s = view.toScreen(p, width, height, padBottom);
  const r = Math.max(1.2, rx * view.pxPerMeter * s.scale);
  ctx.save();
  ctx.translate(s.x, s.y); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(-r * .35, -r * .45, r * .2, 0, 0, r * 1.35);
  g.addColorStop(0, shade(color, .16)); g.addColorStop(.65, color); g.addColorStop(1, shade(color, -.18));
  ctx.fillStyle = g;
  ctx.save(); ctx.globalAlpha = .8;
  ctx.strokeStyle = shade(color, -.22); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  if (r > 4) {
    ctx.save(); ctx.globalAlpha = .5;
    ctx.strokeStyle = 'rgba(255,252,242,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r * .74, Math.PI * 1.02, Math.PI * 1.62); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  return s.depth;
}

/**
 * Fine photographic grain over a freshly painted tile (device pixels).
 * Call with `source-atop` so only painted pixels pick it up; the deterministic
 * seed keeps neighbouring direction tiles consistent.
 */
/** Screen-space filled dot (rivets, hobnails, glints, nostrils). */
export function dot(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

/** Deterministic speckle inside an ellipse (stubble, grain, brushing, pelt flecks). */
export function speckle(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, n: number, seed: number, color: string, alpha: number, rMax = 1.1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  ctx.save(); ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
    ctx.globalAlpha = alpha * (.4 + rnd() * .6);
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr, .4 + rnd() * rMax, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Off-centre bright line (greave sheens, shaft grain, horn ridges). */
export function sheenLine(ctx: Ctx, ax: number, ay: number, bx: number, by: number, off: number, color: string, width: number, alpha: number) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  const px = -dy / L * off, py = dx / L * off;
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(ax + px, ay + py); ctx.lineTo(bx + px, by + py); ctx.stroke(); ctx.restore();
}

export function grainTile(g: Ctx, W: number, H: number, seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const n = Math.floor(W * H / 1500);
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H;
    g.fillStyle = rnd() > .5
      ? `rgba(255,250,240,${(.03 + rnd() * .06).toFixed(3)})`
      : `rgba(10,8,5,${(.04 + rnd() * .07).toFixed(3)})`;
    g.fillRect(x, y, 1.3, 1.3);
  }
}

let mailPatternCache: CanvasPattern | null = null;
export function mailPattern(ctx: Ctx): CanvasPattern | null {
  if (mailPatternCache) return mailPatternCache;
  const c = document.createElement('canvas'); c.width = c.height = 12;
  const g = c.getContext('2d')!;
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = col * 4 + (row % 2) * 2, y = row * 4;
    g.strokeStyle = 'rgba(30,34,40,.62)'; g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, 1.9, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(232,238,244,.5)'; g.lineWidth = .8;
    g.beginPath(); g.arc(x, y, 1.9, Math.PI * 1.05, Math.PI * 1.55); g.stroke();
  }
  mailPatternCache = ctx.createPattern(c, 'repeat');
  return mailPatternCache;
}

let coatPatternCache: CanvasPattern | null = null;
export function coatPattern(ctx: Ctx): CanvasPattern | null {
  if (coatPatternCache) return coatPatternCache;
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const g = c.getContext('2d')!;
  const rng = (n: number) => { const s = Math.sin(n * 127.1) * 43758.545; return s - Math.floor(s); };
  for (let i = 0; i < 150; i++) {
    const a = rng(i) * .13;
    g.fillStyle = i % 2 ? `rgba(255,250,235,${a})` : `rgba(28,20,12,${a + .04})`;
    g.beginPath(); g.ellipse(rng(i + 40) * 48, rng(i + 80) * 48, 1 + rng(i + 120) * 2.6, .7 + rng(i + 160) * 1.5, rng(i) * 3, 0, Math.PI * 2); g.fill();
  }
  // A few longer guard hairs for a pelt read.
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(20,14,8,${.10 + rng(i + 300) * .12})`; g.lineWidth = .8;
    const x = rng(i + 320) * 48, y = rng(i + 340) * 48, a = rng(i + 360) * Math.PI;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5); g.stroke();
  }
  coatPatternCache = ctx.createPattern(c, 'repeat');
  return coatPatternCache;
}

// ---------------------------------------------------------------------------
// Sheets and the runtime billboard actor
// ---------------------------------------------------------------------------

export interface SheetAction { name: string; frames: number; offset: number }
export interface SpriteSheet {
  canvas: HTMLCanvasElement;
  /** Half-resolution normal atlas with the same tile layout (same UVs sample it). */
  normalCanvas: HTMLCanvasElement;
  cols: number; rows: number; tileW: number; tileH: number;
  pxPerMeter: number; worldW: number; worldH: number; bottomPad: number;
  actions: SheetAction[];
  tile(actionIndex: number, frame: number, dir: number): { col: number; row: number };
}

export interface SheetSpec {
  tileW: number; tileH: number; pxPerMeter: number; worldH: number; bottomPad: number;
  actions: { name: string; frames: number }[];
  /** 2 → sixteen directions packed as two groups of 8 (keeps the atlas under the 4096 texture limit). */
  directionGroups?: 1 | 2;
  /** Paint each tile at this multiple, then downscale (default 2: smooth edges without growing the atlas). */
  supersample?: number;
  paint: (ctx: Ctx, view: View) => void;
}

export function buildSheet(spec: SheetSpec): SpriteSheet {
  const groups = spec.directionGroups ?? 1;
  const SS = spec.supersample ?? 2;
  const totalFrames = spec.actions.reduce((n, a) => n + a.frames, 0);
  const offsets: number[] = []; let off = 0;
  for (const a of spec.actions) { offsets.push(off); off += a.frames; }
  const cols = groups === 2 ? 8 : 16;
  const rows = totalFrames * groups;
  const canvas = document.createElement('canvas');
  canvas.width = cols * spec.tileW; canvas.height = rows * spec.tileH;
  const ctx = canvas.getContext('2d')!;
  // Each tile is painted large on a scratch canvas (tile-space coordinates,
  // so painters are unchanged), grained, then downscaled into the atlas.
  const tmp = document.createElement('canvas');
  tmp.width = spec.tileW * SS; tmp.height = spec.tileH * SS;
  const tctx = tmp.getContext('2d')!;
  const camR = 12;
  for (let dir = 0; dir < 16; dir++) {
    const rel = relForIndex(dir);
    // Actor at the origin with yaw 0 (forward = -Z world); camera placed at `rel`.
    const camX = -Math.sin(rel) * camR, camZ = -Math.cos(rel) * camR;
    const rowOffset = (d: number) => (groups === 2 && d >= 8 ? totalFrames : 0);
    for (let ai = 0; ai < spec.actions.length; ai++) {
      const action = spec.actions[ai];
      for (let f = 0; f < action.frames; f++) {
        const c = dir % cols, r = rowOffset(dir) + offsets[ai] + f;
        tctx.setTransform(1, 0, 0, 1, 0, 0);
        tctx.clearRect(0, 0, tmp.width, tmp.height);
        tctx.setTransform(SS, 0, 0, SS, 0, 0);
        const view = new View(0, 0, 0, camX, camZ, spec.pxPerMeter);
        view.phase = action.frames > 1 ? f / action.frames * Math.PI * 2 : 0;
        view.t = action.frames > 1 ? (f / action.frames) * 1.05 : 0;
        view.action = action.name;
        view.frame = f;
        spec.paint(tctx, view);
        tctx.setTransform(1, 0, 0, 1, 0, 0);
        tctx.globalCompositeOperation = 'source-atop';
        grainTile(tctx, tmp.width, tmp.height, dir * 131 + ai * 17 + f * 7 + 1);
        tctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, c * spec.tileW, r * spec.tileH, spec.tileW, spec.tileH);
      }
    }
  }
  // Half-resolution normal atlas derived from the painted tiles (same layout,
  // so the same tile UVs sample it). Sobel sampling is clamped inside each
  // tile so neighbours never bleed across tile borders. The transparent
  // background reads as low "height", which bevels the silhouette slightly.
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = canvas.width >> 1; normalCanvas.height = canvas.height >> 1;
  {
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const nctx = normalCanvas.getContext('2d')!;
    const out = nctx.createImageData(normalCanvas.width, normalCanvas.height);
    const lumAt = (x: number, y: number) => {
      const i = (y * canvas.width + x) * 4;
      return (src[i] * .299 + src[i + 1] * .587 + src[i + 2] * .114) / 255;
    };
    const strength = 2.4, hw = spec.tileW >> 1, hh = spec.tileH >> 1;
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * spec.tileW, y0 = ty * spec.tileH;
      const x1 = x0 + spec.tileW - 1, y1 = y0 + spec.tileH - 1;
      const h = (x: number, y: number) => lumAt(Math.min(x1, Math.max(x0, x)), Math.min(y1, Math.max(y0, y)));
      for (let j = 0; j < hh; j++) for (let i = 0; i < hw; i++) {
        const [r, g, b] = sobelNormal(h, x0 + i * 2, y0 + j * 2, strength);
        const o = ((ty * hh + j) * normalCanvas.width + tx * hw + i) * 4;
        out.data[o] = r * 255; out.data[o + 1] = g * 255; out.data[o + 2] = b * 255; out.data[o + 3] = 255;
      }
    }
    nctx.putImageData(out, 0, 0);
  }
  return {
    canvas, normalCanvas, cols, rows, tileW: spec.tileW, tileH: spec.tileH, pxPerMeter: spec.pxPerMeter,
    worldW: spec.worldH * spec.tileW / spec.tileH, worldH: spec.worldH, bottomPad: spec.bottomPad,
    actions: spec.actions.map((a, i) => ({ name: a.name, frames: a.frames, offset: offsets[i] })),
    tile(actionIndex, frame, dir) {
      const rowOffset = groups === 2 && dir >= 8 ? totalFrames : 0;
      return { col: dir % cols, row: rowOffset + offsets[actionIndex] + frame };
    },
  };
}

export interface ActorState {
  dt: number; speed: number;
  sprint?: boolean; seated?: boolean; sniff?: boolean; paused?: boolean;
}

/** A camera-facing 16-direction billboard with a soft ground shadow. */
export class SpriteActor {
  readonly root = new THREE.Group();
  readonly plane: THREE.Mesh;
  readonly shadow: THREE.Mesh;
  protected material: THREE.ShaderMaterial;
  protected sheet: SpriteSheet;
  protected gait = 0;
  protected clock = 0;
  protected actionName = 'idle';
  protected frame = 0;
  protected gaitHz: number;
  protected sprintHz: number;
  protected bobAmp: number;
  readonly anchors = new Map<string, THREE.Object3D>();
  private worldPos = new THREE.Vector3();
  private worldQuat = new THREE.Quaternion();
  private tmpVec = new THREE.Vector3();
  private faceQuat = new THREE.Quaternion();
  private rootQuat = new THREE.Quaternion();
  private faceEuler = new THREE.Euler();

  constructor(sheet: SpriteSheet, private readonly camera: THREE.Camera, opts: { name?: string; shadowRadius?: number; gaitHz?: number; sprintHz?: number; bobAmp?: number }) {
    this.sheet = sheet; this.camera = camera;
    this.root.name = opts.name ?? 'Sprite actor';
    this.gaitHz = opts.gaitHz ?? 1; this.sprintHz = opts.sprintHz ?? 1.35; this.bobAmp = opts.bobAmp ?? .03;
    const texture = new THREE.CanvasTexture(sheet.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.generateMipmaps = true;
    // Linear (non-colour) normal atlas; same layout, so the same tile UVs sample it.
    const normalTexture = new THREE.CanvasTexture(sheet.normalCanvas);
    normalTexture.minFilter = THREE.LinearMipmapLinearFilter;
    normalTexture.magFilter = THREE.LinearFilter;
    normalTexture.anisotropy = 4;
    normalTexture.generateMipmaps = true;
    this.material = new THREE.ShaderMaterial({
      fog: true,
      transparent: true, // soft anti-aliased silhouette instead of a hard cutout
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uAtlas: { value: texture },
          uNormal: { value: normalTexture },
          uTileA: { value: new THREE.Vector2() }, uTileB: { value: new THREE.Vector2() },
          uMix: { value: 0 }, uSize: { value: new THREE.Vector2(1, 1) },
          uFaceYaw: { value: 0 },
        },
      ]),
      vertexShader: `
        uniform vec2 uTileA, uTileB, uSize;
        varying vec2 vUvA;
        varying vec2 vUvB;
        #include <fog_pars_vertex>
        void main() {
          // Tiles are in tile units; the canvas is flipped, so row 0 sits at v = 1.
          vUvA = vec2((uTileA.x + uv.x) * uSize.x, (${sheet.rows}.0 - uTileA.y - 1.0 + uv.y) * uSize.y);
          vUvB = vec2((uTileB.x + uv.x) * uSize.x, (${sheet.rows}.0 - uTileB.y - 1.0 + uv.y) * uSize.y);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas, uNormal;
        uniform float uMix, uFaceYaw;
        uniform vec3 uSunDir, uSunColor, uHemiSky, uHemiGround;
        varying vec2 vUvA;
        varying vec2 vUvB;
        #include <fog_pars_fragment>
        void main() {
          vec4 c = mix(texture2D(uAtlas, vUvA), texture2D(uAtlas, vUvB), uMix);
          if (c.a < .05) discard;
          // Normal-mapped sun + hemisphere: the billboard's tangent-space
          // normal is yawed into world space like the plane itself.
          vec3 n = normalize(mix(texture2D(uNormal, vUvA).rgb, texture2D(uNormal, vUvB).rgb, uMix) * 2.0 - 1.0);
          float cy = cos(uFaceYaw), sy = sin(uFaceYaw);
          vec3 wN = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);
          vec3 hemi = mix(uHemiGround, uHemiSky, wN.y * .5 + .5);
          float ndl = max(dot(wN, uSunDir), 0.0);
          vec3 light = hemi * .8 + uSunColor * (ndl * .85 + .15) + vec3(.10);
          gl_FragColor = vec4(c.rgb * light, c.a);
          #include <fog_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    // All actors share one light rig: point at the same uniform objects that
    // world.ts refreshes every frame (merge() above cloned them, so re-link).
    this.material.uniforms.uSunDir = spriteLightUniforms.uSunDir;
    this.material.uniforms.uSunColor = spriteLightUniforms.uSunColor;
    this.material.uniforms.uHemiSky = spriteLightUniforms.uHemiSky;
    this.material.uniforms.uHemiGround = spriteLightUniforms.uHemiGround;
    const geo = new THREE.PlaneGeometry(sheet.worldW, sheet.worldH);
    geo.translate(0, sheet.worldH / 2, 0); // feet at the origin
    this.plane = new THREE.Mesh(geo, this.material);
    this.plane.frustumCulled = false;
    this.root.add(this.plane);
    const sc = document.createElement('canvas'); sc.width = sc.height = 128;
    const sg = sc.getContext('2d')!;
    const rg = sg.createRadialGradient(64, 64, 4, 64, 64, 62);
    rg.addColorStop(0, 'rgba(10,14,9,.55)'); rg.addColorStop(.45, 'rgba(10,14,9,.26)'); rg.addColorStop(1, 'rgba(10,14,9,0)');
    sg.fillStyle = rg; sg.fillRect(0, 0, 128, 128);
    const radius = opts.shadowRadius ?? .9;
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, opacity: .8, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = .015; this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
  }
  anchor(name: string, local: V3): THREE.Object3D {
    const o = new THREE.Object3D(); o.position.set(local.x, local.y, local.z); this.root.add(o);
    this.anchors.set(name, o); return o;
  }
  /** Swap the sprite sheet (equipment/portrait variants share the same layout). */
  setSheet(sheet: SpriteSheet): void {
    (this.material.uniforms.uAtlas.value as THREE.Texture).dispose();
    (this.material.uniforms.uNormal.value as THREE.Texture).dispose();
    const texture = new THREE.CanvasTexture(sheet.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    const normalTexture = new THREE.CanvasTexture(sheet.normalCanvas);
    normalTexture.minFilter = THREE.LinearMipmapLinearFilter;
    normalTexture.magFilter = THREE.LinearFilter;
    normalTexture.anisotropy = 4;
    this.material.uniforms.uAtlas.value = texture;
    this.material.uniforms.uNormal.value = normalTexture;
    this.sheet = sheet;
  }
  get currentAction(): string { return this.actionName; }
  anchorPosition(name: string, target: THREE.Vector3): THREE.Vector3 {
    const a = this.anchors.get(name);
    return a ? a.getWorldPosition(target) : target.set(0, 0, 0);
  }
  /** Reposition an existing anchor (character space = root local space). */
  setAnchor(name: string, p: V3) { this.anchors.get(name)?.position.set(p.x, p.y, p.z); }
  /** The actor's world yaw (works even nested under a tilted wagon). */
  worldYaw(): number {
    this.root.getWorldQuaternion(this.worldQuat);
    this.tmpVec.set(0, 0, -1).applyQuaternion(this.worldQuat);
    return Math.atan2(-this.tmpVec.x, -this.tmpVec.z);
  }
  /** Height of the root above the ground; keeps the shadow blob on the floor while airborne. */
  shadowDrop = 0;
  protected frameOverride: number | undefined;
  /** Creation-preview only: force-painted action (e.g. 'attack'). Always null during gameplay. */
  private previewName: string | null = null;
  private previewT = 0;
  /**
   * Force the actor to paint `name` instead of its picked gait action. Creation
   * preview / flourish use only — callers must call clearPreview() afterwards.
   * Paint-only: no hit detection, damage, or AI is involved.
   */
  previewAction(name: string): void { this.previewName = name; this.previewT = 0; }
  clearPreview(): void { this.previewName = null; this.previewT = 0; }
  get isPreviewing(): boolean { return this.previewName !== null; }
  /** Choose the animation for this frame (subclasses override for species/actors). */
  protected pickAction(_state: ActorState, _sheet: SpriteSheet): SheetAction {
    const name = _state.seated ? 'seated' : _state.speed > .18 ? (_state.sprint ? 'sprint' : 'walk') : 'idle';
    return _sheet.actions.find(a => a.name === name) ?? _sheet.actions[0];
  }
  /** Advance animation and pick the right atlas tile. `state.speed` is m/s. */
  update(state: ActorState) {
    const camera = this.camera, { dt, speed, paused } = state;
    const sheet = this.sheet;
    this.actionName = this.pickAction(state, sheet).name;
    // Creation preview / flourish: force-paint the preview action (paint-only).
    if (this.previewName && sheet.actions.some(a => a.name === this.previewName)) {
      this.actionName = this.previewName;
      if (!paused) this.previewT += dt;
    }
    if (!paused) {
      this.clock += dt;
      const hz = this.actionName === 'sprint' ? this.sprintHz : this.gaitHz;
      this.gait = (this.gait + speed * hz * dt * Math.PI * 2) % (Math.PI * 2);
    }
    const act = sheet.actions.find(a => a.name === this.actionName) ?? sheet.actions[0];
    const gaitFrame = Math.floor(this.gait / (Math.PI * 2) * act.frames) % act.frames;
    const idleFrame = act.frames > 1 ? Math.floor(this.clock * .4) % act.frames : 0;
    this.frame = this.frameOverride ?? (act.name === 'idle' ? idleFrame : gaitFrame);
    if (this.previewName && act.name === this.previewName && act.frames > 1) {
      this.frame = Math.floor(this.previewT * 6) % act.frames;
    }
    this.root.getWorldPosition(this.worldPos);
    const blend = directionBlend(
      this.worldYaw(), this.worldPos.x, this.worldPos.z, camera.position.x, camera.position.z,
    );
    const ai = sheet.actions.indexOf(act);
    const A = sheet.tile(ai, this.frame, blend.a);
    const B = sheet.tile(ai, this.frame, blend.b);
    const u = this.material.uniforms;
    (u.uTileA.value as THREE.Vector2).set(A.col, A.row);
    (u.uTileB.value as THREE.Vector2).set(B.col, B.row);
    (u.uMix.value as number) = blend.t;
    (u.uSize.value as THREE.Vector2).set(1 / sheet.cols, 1 / sheet.rows);
    this.applyPose(state);
    // Upright cylindrical billboard: the plane yaws to face the camera while
    // staying vertical, compensating for the root's own world rotation (the
    // oxen ride under a tilted wagon). A full spherical copy would tip the
    // figure over whenever the camera looks down and mis-face it whenever the
    // root itself is turned.
    const dx = camera.position.x - this.worldPos.x, dz = camera.position.z - this.worldPos.z;
    if (dx * dx + dz * dz > 1e-6) {
      const faceYaw = Math.atan2(dx, dz);
      this.faceEuler.set(0, faceYaw, 0);
      this.faceQuat.setFromEuler(this.faceEuler);
      this.root.getWorldQuaternion(this.rootQuat);
      this.plane.quaternion.copy(this.rootQuat.invert().multiply(this.faceQuat));
      (u.uFaceYaw.value as number) = faceYaw;
    }
    this.shadow.position.y = .015 - Math.max(0, this.shadowDrop);
    this.shadow.visible = !state.seated;
  }
  /** Hook: bob the plane and refresh anchors for the current pose. */
  protected applyPose(_state: ActorState) {
    this.plane.position.y = this.bob();
  }
  protected bob(): number {
    if (this.actionName === 'walk') return Math.abs(Math.sin(this.gait)) * this.bobAmp;
    if (this.actionName === 'sprint') return Math.abs(Math.sin(this.gait)) * this.bobAmp * 1.6;
    if (this.actionName === 'seated') return 0;
    return Math.sin(this.clock * 1.6) * .006;
  }
  dispose() {
    this.material.dispose();
    (this.material.uniforms.uAtlas.value as THREE.Texture).dispose();
    (this.material.uniforms.uNormal.value as THREE.Texture).dispose();
    (this.plane.geometry as THREE.BufferGeometry).dispose();
    (this.shadow.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.shadow.material as THREE.Material).dispose();
    (this.shadow.geometry as THREE.BufferGeometry).dispose();
  }
}

/** Add the actor to a parent group, feet at `position`, facing `yaw`. */
export function placeActor(actor: SpriteActor, parent: THREE.Object3D, position: THREE.Vector3, yaw: number) {
  actor.root.position.copy(position); actor.root.rotation.y = yaw;
  parent.add(actor.root);
}
