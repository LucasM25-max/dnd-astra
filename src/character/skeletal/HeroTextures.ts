import * as THREE from 'three';
import type { PortraitPreset } from '../../game/character';
import { BODY_MATERIAL_SLOTS } from './BodyParts';

/**
 * Procedural hero textures, painted on canvas at runtime (no downloads, no
 * external art, always in sync with the portrait presets). Every painter is
 * deterministic (seeded RNG) so screenshots and tests are stable.
 *
 * This module never touches the DOM itself: callers supply a canvas factory,
 * which keeps the painters unit-testable with a stub 2D context.
 */

export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement;
export type Ctx = CanvasRenderingContext2D;

/** Deterministic RNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(c: RGB, a: number): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

/** Linear mix of two hex colours. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const m = ca.map((v, i) => Math.round(v + (cb[i] - v) * t)) as RGB;
  return `#${m.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Fill with a vertical gradient (top → bottom). */
function vGradient(ctx: Ctx, w: number, h: number, top: string, bottom: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Tileable soft-blotch noise: warm/cool mottling for skin and cloth. */
function blotches(ctx: Ctx, w: number, h: number, rand: () => number, colors: string[], count: number, rMin: number, rMax: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rMin + rand() * (rMax - rMin);
    // Draw wrapped copies so the texture tiles seamlessly.
    for (const [ox, oy] of [[0, 0], [-w, 0], [w, 0], [0, -h], [0, h]]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      const c = hexToRgb(colors[(rand() * colors.length) | 0]);
      g.addColorStop(0, rgba(c, alpha));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Fine per-pixel-ish grain (random 1–2 px rects). */
function grain(ctx: Ctx, w: number, h: number, rand: () => number, count: number, light: string, dark: string, alpha: number): void {
  const cl = hexToRgb(light);
  const cd = hexToRgb(dark);
  for (let i = 0; i < count; i++) {
    const c = rand() < 0.5 ? cl : cd;
    ctx.fillStyle = rgba(c, alpha * (0.4 + rand() * 0.6));
    const s = rand() < 0.85 ? 1 : 2;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
}

// --- Skin & face ---

const IRIS: Record<string, string> = {
  male_01: '#5a4128',
  male_02: '#6b7a5e',
  male_03: '#3e5a78',
  female_01: '#6e4a2a',
  female_02: '#7a7f8a',
  female_03: '#2e2019',
};

/** Plain skin: gradient + mottling + grain. Base for every skin region. */
export function paintSkin(ctx: Ctx, w: number, h: number, tone: string, seed = 7): void {
  const rand = seededRandom(seed);
  vGradient(ctx, w, h, mixHex(tone, '#ffffff', 0.1), mixHex(tone, '#5a3a26', 0.22));
  blotches(ctx, w, h, rand, [mixHex(tone, '#ff9a7a', 0.25), mixHex(tone, '#7a4a30', 0.3)], Math.round(w / 6), w / 40, w / 10, 0.16);
  grain(ctx, w, h, rand, w * h * 0.02, '#ffffff', '#3a2418', 0.08);
}

interface FaceLayout {
  cx: number;
  eyeY: number;
  eyeDX: number;
  eyeW: number;
  browY: number;
  noseTop: number;
  noseBase: number;
  mouthY: number;
  mouthW: number;
}

/**
 * Sphere-map face (head geometry). The head looks down +Z, which sits at
 * u = 0.25 on SphereGeometry, so the face occupies x ∈ [0.10, 0.40]·w.
 * Canvas top (y = 0) is the crown; the equator (face centre) is y = 0.5·h.
 */
export function paintFaceSphere(ctx: Ctx, w: number, h: number, preset: PortraitPreset): void {
  paintSkin(ctx, w, h, preset.skin, 21);
  // Lowered half a brow: the helm brim clears at ~1.70 and the eyes must sit
  // beneath it (eyes ≈ 1.684, brows ≈ 1.695, mouth ≈ 1.627).
  const L: FaceLayout = {
    cx: w * 0.25,
    eyeY: h * 0.511,
    eyeDX: w * 0.048,
    eyeW: w * 0.026,
    browY: h * 0.481,
    noseTop: h * 0.521,
    noseBase: h * 0.606,
    mouthY: h * 0.671,
    mouthW: w * 0.062,
  };
  paintFaceFeatures(ctx, L, preset, h * 0.0016);
}

function paintFaceFeatures(ctx: Ctx, L: FaceLayout, preset: PortraitPreset, px: number): void {
  const female = preset.id.startsWith('female');
  const dark = mixHex(preset.skin, '#1d100a', 0.72);
  const shade = mixHex(preset.skin, '#4a2c1a', 0.45);
  const light = mixHex(preset.skin, '#ffffff', 0.45);
  const iris = IRIS[preset.id] ?? '#4a3524';

  // Eye sockets: soft shadow beds so the eyes sit *in* the face.
  for (const s of [-1, 1]) {
    const ex = L.cx + s * L.eyeDX;
    const g = ctx.createRadialGradient(ex, L.eyeY, 0, ex, L.eyeY, L.eyeW * 1.5);
    const sc = hexToRgb(shade);
    g.addColorStop(0, rgba(sc, 0.5));
    g.addColorStop(1, rgba(sc, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(ex, L.eyeY, L.eyeW * 1.5, L.eyeW * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // White.
    ctx.fillStyle = female ? '#f2e8dc' : '#ece2d4';
    ctx.beginPath();
    ctx.ellipse(ex, L.eyeY, L.eyeW, L.eyeW * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    // Iris + pupil + catchlight.
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(ex, L.eyeY, L.eyeW * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14100c';
    ctx.beginPath();
    ctx.arc(ex, L.eyeY, L.eyeW * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(ex - L.eyeW * 0.16, L.eyeY - L.eyeW * 0.18, Math.max(1, L.eyeW * 0.1), 0, Math.PI * 2);
    ctx.fill();
    // Upper lid line.
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(1.2, px * (female ? 1.6 : 1.1));
    ctx.beginPath();
    ctx.ellipse(ex, L.eyeY - L.eyeW * 0.08, L.eyeW * 1.02, L.eyeW * 0.62, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    // Brow.
    ctx.strokeStyle = mixHex(preset.hairColor, '#000000', 0.15);
    ctx.lineWidth = Math.max(1.5, px * (female ? 1.8 : 3));
    ctx.lineCap = 'round';
    ctx.beginPath();
    const bow = female ? 0.35 : 0.22;
    ctx.moveTo(ex - L.eyeW * 1.15, L.browY + L.eyeW * 0.25);
    ctx.quadraticCurveTo(ex, L.browY - L.eyeW * bow, ex + L.eyeW * 1.15, L.browY + L.eyeW * (female ? 0.35 : 0.15));
    ctx.stroke();
  }

  // Nose: shaded flanks + base shadow + nostrils + bridge highlight.
  ctx.strokeStyle = rgba(hexToRgb(shade), 0.75);
  ctx.lineWidth = Math.max(1, px * 1.1);
  ctx.beginPath();
  ctx.moveTo(L.cx - L.eyeW * 0.32, L.noseTop);
  ctx.quadraticCurveTo(L.cx - L.eyeW * 0.5, (L.noseTop + L.noseBase) / 2, L.cx - L.eyeW * 0.42, L.noseBase);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(L.cx + L.eyeW * 0.32, L.noseTop);
  ctx.quadraticCurveTo(L.cx + L.eyeW * 0.5, (L.noseTop + L.noseBase) / 2, L.cx + L.eyeW * 0.42, L.noseBase);
  ctx.stroke();
  ctx.fillStyle = rgba(hexToRgb(shade), 0.8);
  ctx.beginPath();
  ctx.ellipse(L.cx, L.noseBase + L.eyeW * 0.12, L.eyeW * 0.5, L.eyeW * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(hexToRgb(dark), 0.9);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(L.cx + s * L.eyeW * 0.32, L.noseBase, L.eyeW * 0.11, L.eyeW * 0.16, s * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(hexToRgb(light), 0.55);
  ctx.lineWidth = Math.max(1, px);
  ctx.beginPath();
  ctx.moveTo(L.cx, L.noseTop + L.eyeW * 0.2);
  ctx.lineTo(L.cx, L.noseBase - L.eyeW * 0.1);
  ctx.stroke();

  // Mouth.
  if (female) {
    ctx.fillStyle = mixHex('#8a4a3c', preset.skin, 0.25);
    ctx.beginPath();
    ctx.ellipse(L.cx, L.mouthY, L.mouthW / 2, L.mouthW * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = mixHex('#5a2a24', preset.skin, 0.2);
    ctx.lineWidth = Math.max(1, px * 0.9);
    ctx.beginPath();
    ctx.moveTo(L.cx - L.mouthW / 2, L.mouthY);
    ctx.quadraticCurveTo(L.cx, L.mouthY + L.mouthW * 0.07, L.cx + L.mouthW / 2, L.mouthY);
    ctx.stroke();
  } else {
    ctx.strokeStyle = mixHex(dark, '#6a3a30', 0.35);
    ctx.lineWidth = Math.max(1.2, px * 1.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(L.cx - L.mouthW / 2, L.mouthY);
    ctx.quadraticCurveTo(L.cx, L.mouthY + L.mouthW * 0.05, L.cx + L.mouthW / 2, L.mouthY - L.mouthW * 0.02);
    ctx.stroke();
    ctx.fillStyle = rgba(hexToRgb(shade), 0.5);
    ctx.beginPath();
    ctx.ellipse(L.cx, L.mouthY + L.mouthW * 0.1, L.mouthW * 0.32, L.mouthW * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cheek modelling + jaw ambient occlusion ground the features.
  const cheek = ctx.createRadialGradient(L.cx, L.mouthY, 0, L.cx, L.mouthY, L.mouthW * 2.2);
  const shc = hexToRgb(shade);
  cheek.addColorStop(0.55, rgba(shc, 0));
  cheek.addColorStop(1, rgba(shc, 0.35));
  ctx.fillStyle = cheek;
  ctx.fillRect(L.cx - L.mouthW * 2.2, L.eyeY, L.mouthW * 4.4, L.mouthY * 0.9);

  // Male jaw stubble (weathered/scarred/fair presets).
  if (!female) {
    const rand = seededRandom(preset.id.length * 131 + 5);
    ctx.fillStyle = rgba(hexToRgb(mixHex(preset.hairColor, preset.skin, 0.4)), 0.28);
    const jawY = L.mouthY + L.mouthW * 0.12;
    for (let i = 0; i < 260; i++) {
      const x = L.cx + (rand() - 0.5) * L.mouthW * 2.6;
      const y = jawY + rand() * L.mouthW * 1.1;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }

  // Bram's scar: left cheek slash with stitch marks.
  if (preset.id === 'male_02') {
    const sx = L.cx - L.eyeDX * 1.7;
    ctx.strokeStyle = mixHex(preset.skin, '#ffffff', 0.5);
    ctx.lineWidth = Math.max(1.2, px * 1.2);
    ctx.beginPath();
    ctx.moveTo(sx, L.eyeY + L.eyeW * 0.6);
    ctx.lineTo(sx + L.eyeW * 0.9, L.mouthY - L.eyeW * 0.4);
    ctx.stroke();
    ctx.strokeStyle = rgba(hexToRgb(dark), 0.7);
    ctx.lineWidth = Math.max(1, px * 0.8);
    for (let i = 0; i < 4; i++) {
      const t = 0.15 + i * 0.23;
      const x = sx + (L.eyeW * 0.9) * t;
      const y = L.eyeY + L.eyeW * 0.6 + (L.mouthY - L.eyeW - L.eyeY) * t;
      ctx.beginPath();
      ctx.moveTo(x - L.eyeW * 0.22, y);
      ctx.lineTo(x + L.eyeW * 0.22, y);
      ctx.stroke();
    }
  }
}

// --- Cloth, mail, leather, steel, wood ---

/** Quilted gambeson: diamond stitching with puffed cells (tiles horizontally). */
export function paintGambeson(ctx: Ctx, w: number, h: number, base = '#4a5a3a', seed = 11): void {
  const rand = seededRandom(seed);
  vGradient(ctx, w, h, mixHex(base, '#ffffff', 0.12), mixHex(base, '#000000', 0.25));
  // Diamond quilt: two diagonal line families (slope ±1/2, row pitch `step`
  // divides both axes, so the pattern tiles seamlessly for the torso wrap).
  const step = w / 8;
  const slope = step / (w / 4);
  ctx.lineWidth = Math.max(1, w / 256);
  for (let row = -2; row <= h / step + 2; row++) {
    for (const dir of [1, -1]) {
      const y0 = row * step;
      // Stitch groove.
      ctx.strokeStyle = rgba(hexToRgb(mixHex(base, '#000000', 0.55)), 0.85);
      ctx.beginPath();
      ctx.moveTo(-step, y0);
      ctx.lineTo(w + step, y0 + dir * (w + step * 2) * slope);
      ctx.stroke();
      // Puff highlight offset from the groove.
      ctx.strokeStyle = rgba(hexToRgb(mixHex(base, '#ffffff', 0.4)), 0.4);
      ctx.beginPath();
      ctx.moveTo(-step, y0 + step * 0.14);
      ctx.lineTo(w + step, y0 + step * 0.14 + dir * (w + step * 2) * slope);
      ctx.stroke();
    }
  }
  // Stitch dashes along the grooves.
  ctx.fillStyle = mixHex('#c9a86a', base, 0.35);
  const dashStep = w / 48;
  for (let y = dashStep / 2; y < h; y += dashStep) {
    for (let x = dashStep / 2; x < w; x += dashStep) {
      if (((x + y) / dashStep) % 4 < 0.6) ctx.fillRect(x, y, 2, 1);
    }
  }
  blotches(ctx, w, h, rand, [mixHex(base, '#000000', 0.4)], Math.round(w / 10), w / 30, w / 8, 0.14);
  grain(ctx, w, h, rand, w * h * 0.015, '#ffffff', '#101408', 0.07);
}

/** Heavy wool trousers: near-horizontal weave with fold shading. */
export function paintTrousers(ctx: Ctx, w: number, h: number, base = '#5c4a33', seed = 13): void {
  const rand = seededRandom(seed);
  vGradient(ctx, w, h, mixHex(base, '#ffffff', 0.08), mixHex(base, '#000000', 0.3));
  // Weave: alternating slightly-lighter rows + vertical thread ticks.
  for (let y = 0; y < h; y += 2) {
    ctx.fillStyle = rgba(hexToRgb(mixHex(base, '#ffffff', 0.12)), 0.25);
    ctx.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 3) {
    ctx.fillStyle = rgba(hexToRgb(mixHex(base, '#000000', 0.3)), 0.2);
    ctx.fillRect(x, 0, 1, h);
  }
  // Soft vertical folds.
  for (let i = 0; i < 7; i++) {
    const x = (i + 0.5) * (w / 7) + (rand() - 0.5) * w * 0.04;
    const g = ctx.createLinearGradient(x - w / 28, 0, x + w / 28, 0);
    const dc = hexToRgb(mixHex(base, '#000000', 0.5));
    g.addColorStop(0, rgba(dc, 0));
    g.addColorStop(0.5, rgba(dc, 0.35));
    g.addColorStop(1, rgba(dc, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 28, 0, w / 14, h);
  }
  grain(ctx, w, h, rand, w * h * 0.012, '#ffffff', '#14100a', 0.08);
}

/** Riveted mail: interlocking ring rows with top-left key light (tiles). */
export function paintMail(ctx: Ctx, w: number, h: number, base = '#6a6f76', seed = 17): void {
  const rand = seededRandom(seed);
  ctx.fillStyle = mixHex(base, '#000000', 0.55);
  ctx.fillRect(0, 0, w, h);
  const ringR = Math.max(3, w / 42);
  const dx = ringR * 1.55;
  const dy = ringR * 1.15;
  let row = 0;
  for (let y = dy / 2; y < h + dy; y += dy, row++) {
    for (let x = (row % 2 ? dx / 2 : 0); x < w + dx; x += dx) {
      // Ring shadow bed.
      ctx.fillStyle = rgba(hexToRgb(mixHex(base, '#000000', 0.75)), 0.9);
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.fill();
      // Ring: bright arc top-left fading to dark bottom-right.
      for (const [a0, a1, col] of [
        [Math.PI * 0.7, Math.PI * 1.7, mixHex(base, '#ffffff', 0.55)],
        [Math.PI * 1.7, Math.PI * 2.7, mixHex(base, '#000000', 0.45)],
      ] as const) {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, ringR * 0.34);
        ctx.beginPath();
        ctx.arc(x, y, ringR * 0.72, a0, a1);
        ctx.stroke();
      }
      // Rivet dot.
      ctx.fillStyle = mixHex(base, '#ffffff', 0.7);
      ctx.beginPath();
      ctx.arc(x - ringR * 0.3, y - ringR * 0.3, Math.max(0.8, ringR * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  grain(ctx, w, h, rand, w * h * 0.01, '#cfd4dc', '#0c0d10', 0.12);
}

/** Worked leather: creases + grain. `dark` pushes toward boot-black. */
export function paintLeather(ctx: Ctx, w: number, h: number, base = '#6b4a2e', seed = 19): void {
  const rand = seededRandom(seed);
  vGradient(ctx, w, h, mixHex(base, '#ffffff', 0.1), mixHex(base, '#000000', 0.3));
  blotches(ctx, w, h, rand, [mixHex(base, '#3a2414', 0.5), mixHex(base, '#8a6240', 0.5)], Math.round(w / 8), w / 24, w / 6, 0.2);
  // Crease lines.
  ctx.strokeStyle = rgba(hexToRgb(mixHex(base, '#000000', 0.5)), 0.5);
  ctx.lineWidth = Math.max(1, w / 300);
  for (let i = 0; i < w / 7; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const len = w / 30 + rand() * (w / 10);
    const ang = rand() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5 + (rand() - 0.5) * 6, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  grain(ctx, w, h, rand, w * h * 0.02, '#c9a06a', '#1a0f08', 0.09);
}

/** Hair: dark roots shading to tipped strands (keeps crowns out of washout). */
export function paintHair(ctx: Ctx, w: number, h: number, base: string, seed = 47): void {
  const rand = seededRandom(seed);
  vGradient(ctx, w, h, mixHex(base, '#000000', 0.5), mixHex(base, '#ffffff', 0.14));
  // Strand streaks running down V.
  for (let i = 0; i < w * 1.2; i++) {
    const x = rand() * w;
    const light = rand() < 0.4;
    ctx.strokeStyle = rgba(hexToRgb(light ? mixHex(base, '#ffd9a0', 0.45) : mixHex(base, '#000000', 0.5)), light ? 0.35 : 0.4);
    ctx.lineWidth = 1 + rand();
    const y0 = rand() * h * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 8, y0 + h * 0.3, x + (rand() - 0.5) * 5, y0 + h * (0.4 + rand() * 0.4));
    ctx.stroke();
  }
  grain(ctx, w, h, rand, w * h * 0.006, '#ffffff', '#000000', 0.08);
}

/** Brushed plate steel (subtle; metalness comes from the material). */
export function paintPlate(ctx: Ctx, w: number, h: number, base = '#8a9098', seed = 23): void {
  const rand = seededRandom(seed);
  vGradient(ctx, w, h, mixHex(base, '#ffffff', 0.25), mixHex(base, '#2a2d33', 0.4));
  for (let i = 0; i < h / 2; i++) {
    const y = rand() * h;
    ctx.fillStyle = rgba(hexToRgb(rand() < 0.5 ? mixHex(base, '#ffffff', 0.5) : mixHex(base, '#000000', 0.4)), 0.12);
    ctx.fillRect(0, y, w, 1);
  }
  // Edge wear: brighter top band (catches the key light on domes).
  const edge = ctx.createLinearGradient(0, 0, 0, h * 0.3);
  edge.addColorStop(0, rgba(hexToRgb('#ffffff'), 0.22));
  edge.addColorStop(1, rgba(hexToRgb('#ffffff'), 0));
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h * 0.3);
  grain(ctx, w, h, rand, w * h * 0.008, '#ffffff', '#202329', 0.1);
}

/** Polished blade steel with a central fuller groove (blade UVs run lengthwise). */
export function paintBlade(ctx: Ctx, w: number, h: number, seed = 29): void {
  const rand = seededRandom(seed);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#7d848d');
  g.addColorStop(0.32, '#d7dde5');
  g.addColorStop(0.5, '#9aa1a9');
  g.addColorStop(0.68, '#d7dde5');
  g.addColorStop(1, '#7d848d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Fuller groove.
  const fg = ctx.createLinearGradient(w * 0.42, 0, w * 0.58, 0);
  fg.addColorStop(0, 'rgba(40,44,50,0)');
  fg.addColorStop(0.5, 'rgba(40,44,50,0.55)');
  fg.addColorStop(1, 'rgba(40,44,50,0)');
  ctx.fillStyle = fg;
  ctx.fillRect(w * 0.42, h * 0.06, w * 0.16, h * 0.88);
  // Etched rune-band near the hilt (v = 1 end).
  ctx.strokeStyle = 'rgba(52,44,30,0.8)';
  ctx.lineWidth = Math.max(1, w / 90);
  const ry = h * 0.88;
  ctx.beginPath();
  ctx.moveTo(w * 0.3, ry);
  ctx.lineTo(w * 0.7, ry);
  ctx.moveTo(w * 0.36, ry);
  ctx.lineTo(w * 0.36, ry - h * 0.05);
  ctx.lineTo(w * 0.46, ry);
  ctx.lineTo(w * 0.46, ry - h * 0.05);
  ctx.moveTo(w * 0.56, ry);
  ctx.lineTo(w * 0.64, ry - h * 0.05);
  ctx.moveTo(w * 0.56, ry - h * 0.05);
  ctx.lineTo(w * 0.64, ry);
  ctx.stroke();
  // Scratches along the length.
  for (let i = 0; i < w / 3; i++) {
    const x = rand() * w;
    const y = rand() * h;
    ctx.fillStyle = rgba(hexToRgb(rand() < 0.5 ? '#ffffff' : '#3a3f45'), 0.18);
    ctx.fillRect(x, y, 1, h * 0.02 + rand() * h * 0.08);
  }
}

/** Wood grain running along V (hafts, bow, shield boards). */
export function paintWood(ctx: Ctx, w: number, h: number, base = '#5e4128', seed = 31): void {
  const rand = seededRandom(seed);
  vGradient(ctx, w, h, mixHex(base, '#3a2617', 0.4), mixHex(base, '#7a5a38', 0.4));
  for (let i = 0; i < w / 2; i++) {
    const x = rand() * w;
    const dark = rand() < 0.6;
    ctx.strokeStyle = rgba(hexToRgb(dark ? mixHex(base, '#1d1108', 0.6) : mixHex(base, '#d8a86a', 0.45)), dark ? 0.4 : 0.3);
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(x, -4);
    const wob = 2 + rand() * 5;
    const ph = rand() * Math.PI * 2;
    for (let y = 0; y <= h + 8; y += 16) {
      ctx.lineTo(x + Math.sin((y / h) * Math.PI * 2 + ph) * wob, y);
    }
    ctx.stroke();
  }
  // A knot or two.
  for (let k = 0; k < 2; k++) {
    const x = rand() * w;
    const y = rand() * h;
    for (let r = 6; r > 0; r -= 2) {
      ctx.strokeStyle = rgba(hexToRgb(mixHex(base, '#140c06', 0.6)), 0.5);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 1.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  grain(ctx, w, h, rand, w * h * 0.008, '#d8a86a', '#140c06', 0.1);
}

/** Round-shield face: oak boards, iron rim, gold Astra sigil (planar UV disc). */
export function paintShieldFace(ctx: Ctx, w: number, h: number, seed = 37): void {
  const rand = seededRandom(seed);
  const cx = w / 2;
  const cy = h / 2;
  const R = w / 2;
  // Oak boards (vertical planks clipped to the disc).
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  paintWood(ctx, w, h, '#6e4e2c', seed);
  // Plank seams.
  ctx.fillStyle = 'rgba(20,12,6,0.7)';
  for (let i = 1; i < 6; i++) ctx.fillRect((w / 6) * i - 1, 0, 2, h);
  // Radial shade: darker rim, worn centre.
  const shade = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
  shade.addColorStop(0, 'rgba(255,230,180,0.10)');
  shade.addColorStop(0.75, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(10,6,3,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  // Gold ring + tower sigil.
  ctx.strokeStyle = '#c9a44e';
  ctx.lineWidth = Math.max(2, w / 64);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.68, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#d8b45e';
  // Tower: battlement block + door arch.
  const tw = R * 0.34;
  const th = R * 0.52;
  const tx = cx - tw / 2;
  const ty = cy - th / 2;
  ctx.fillRect(tx, ty + th * 0.18, tw, th * 0.82);
  for (let i = 0; i < 4; i++) ctx.fillRect(tx + (tw / 4) * i + tw / 16, ty, tw / 8, th * 0.18);
  ctx.fillStyle = '#2a1c10';
  ctx.beginPath();
  ctx.moveTo(cx - tw * 0.14, cy + th * 0.5);
  ctx.lineTo(cx - tw * 0.14, cy + th * 0.1);
  ctx.arc(cx, cy + th * 0.1, tw * 0.14, Math.PI, 0);
  ctx.lineTo(cx + tw * 0.14, cy + th * 0.5);
  ctx.closePath();
  ctx.fill();
  // Battle wear: nicks and scratches over the paint.
  ctx.fillStyle = 'rgba(30,20,12,0.5)';
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = R * (0.3 + rand() * 0.65);
    ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1 + rand() * 3, 1);
  }
  ctx.restore();
  // Iron rim band.
  ctx.strokeStyle = '#3c3f45';
  ctx.lineWidth = Math.max(3, w / 40);
  ctx.beginPath();
  ctx.arc(cx, cy, R - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(220,226,232,0.5)';
  ctx.lineWidth = Math.max(1, w / 160);
  ctx.beginPath();
  ctx.arc(cx, cy, R - w / 40, 0, Math.PI * 2);
  ctx.stroke();
  // Rim rivets.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = cx + Math.cos(a) * (R - w / 26);
    const y = cy + Math.sin(a) * (R - w / 26);
    ctx.fillStyle = '#b9bec6';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, w / 130), 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Portrait thumbnails (flat frontal bust for the selector grid) ---

/** Painted 2D portrait bust matching a preset (helm/hair/face). */
export function paintPortraitBust(ctx: Ctx, w: number, h: number, preset: PortraitPreset): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2b3a2c');
  bg.addColorStop(1, '#141d15');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const female = preset.id.startsWith('female');
  // Shoulders / mail.
  ctx.fillStyle = '#5a6068';
  ctx.beginPath();
  ctx.ellipse(cx, h * 1.02, w * 0.42, h * 0.34, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, h * 1.02, w * 0.42, h * 0.34, 0, Math.PI * 1.15, Math.PI * 1.85);
  ctx.fill();
  // Neck + head base.
  ctx.fillStyle = preset.skin;
  ctx.fillRect(cx - w * 0.07, h * 0.62, w * 0.14, h * 0.2);
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.44, w * (female ? 0.2 : 0.22), h * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  // Jaw shading.
  ctx.fillStyle = 'rgba(60,35,20,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.62, w * 0.16, h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  // Flat-layout face features (reuse the sphere painter's feature code).
  paintFaceFeatures(ctx, {
    cx,
    eyeY: h * 0.42,
    eyeDX: w * 0.085,
    eyeW: w * 0.045,
    browY: h * 0.355,
    noseTop: h * 0.43,
    noseBase: h * 0.55,
    mouthY: h * 0.62,
    mouthW: w * 0.11,
  }, preset, w / 320);
  // Hair or helm.
  if (preset.helm) {
    ctx.fillStyle = '#7d838c';
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.26, w * 0.24, h * 0.2, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.06, h * 0.16, w * 0.08, h * 0.07, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // Nasal guard.
    ctx.fillStyle = '#6a7078';
    ctx.fillRect(cx - w * 0.018, h * 0.3, w * 0.036, h * 0.2);
  } else {
    ctx.fillStyle = preset.hairColor;
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.24, w * 0.24, h * 0.19, 0, Math.PI, 0);
    ctx.fill();
    if (preset.hairStyle === 'long' || preset.hairStyle === 'braid') {
      ctx.fillRect(cx - w * 0.24, h * 0.24, w * 0.07, h * 0.42);
      ctx.fillRect(cx + w * 0.17, h * 0.24, w * 0.07, h * 0.42);
      if (preset.hairStyle === 'braid') {
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        for (let y = h * 0.3; y < h * 0.62; y += h * 0.05) {
          ctx.beginPath();
          ctx.moveTo(cx - w * 0.24, y);
          ctx.lineTo(cx - w * 0.17, y + h * 0.025);
          ctx.moveTo(cx + w * 0.24, y);
          ctx.lineTo(cx + w * 0.17, y + h * 0.025);
          ctx.stroke();
        }
      }
    }
    // Hairline softening over the forehead.
    ctx.fillStyle = preset.hairColor;
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.3, w * 0.19, h * 0.06, 0, Math.PI, 0);
    ctx.fill();
  }
  // Vignette.
  const vg = ctx.createRadialGradient(cx, h * 0.45, h * 0.2, cx, h * 0.45, h * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// --- Material assembly ---

function toTexture(factory: CanvasFactory, w: number, h: number, paint: (ctx: Ctx) => void): THREE.CanvasTexture {
  const canvas = factory(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  paint(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Body materials in BODY_MATERIAL_SLOTS order for the merged SkinnedMesh. */
export function createBodyMaterials(factory: CanvasFactory, preset: PortraitPreset): THREE.MeshStandardMaterial[] {
  const skin = toTexture(factory, 256, 256, ctx => paintSkin(ctx, 256, 256, preset.skin, 7));
  const head = toTexture(factory, 512, 512, ctx => paintFaceSphere(ctx, 512, 512, preset));
  const gambeson = toTexture(factory, 512, 512, ctx => paintGambeson(ctx, 512, 512));
  const trousers = toTexture(factory, 256, 256, ctx => paintTrousers(ctx, 256, 256));
  const foot = toTexture(factory, 128, 128, ctx => paintLeather(ctx, 128, 128, '#4a3220', 41));
  const std = (map: THREE.Texture, roughness: number, bump?: THREE.Texture): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ map, roughness, metalness: 0, bumpMap: bump, bumpScale: bump ? 0.6 : 0 });
  return [
    std(skin, 0.62), // skin
    std(head, 0.58), // head
    std(gambeson, 0.92, gambeson), // gambeson
    std(trousers, 0.95, trousers), // trouser
    std(foot, 0.8), // foot
  ];
}

export const BODY_TEXTURE_SIZE: Record<string, number> = {
  skin: 256,
  head: 512,
  gambeson: 512,
  trouser: 256,
  foot: 128,
};

export { BODY_MATERIAL_SLOTS };
