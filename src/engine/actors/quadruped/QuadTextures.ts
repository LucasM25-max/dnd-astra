import * as THREE from 'three';
import {
  blotches,
  grain,
  hexToRgb,
  mixHex,
  rgba,
  seededRandom,
  type CanvasFactory,
  type Ctx,
} from '../../../character/skeletal/HeroTextures';
import type { QuadSpecies } from './QuadrupedRig';

/**
 * Procedural coat, skin, horn, hoof and tack textures for the quadrupeds.
 *
 * Same contract as the hero's painters: deterministic (seeded), painted on a
 * caller-supplied canvas, never touching the DOM directly. Each body region
 * gets its own map because each region needs its own *content*: the trunk
 * carries form shading, mud and dapples along the flank; the head carries the
 * facial marking, nostrils and mouth line; the legs carry dark points and a
 * light fetlock band; the horn carries growth rings.
 *
 * UV conventions are fixed by `QuadrupedBody`'s loft helper and mirrored here:
 *   u = 0 at the animal's left side (+X in bind space), rising through
 *       0.25 = topline/crest, 0.5 = right side, 0.75 = belly/throat.
 *   v = 0 at the front (chest / poll / coronet) → 1 at the back.
 * Coats are painted light-on-dark in *value*, so the animal's colour enters
 * through `material.color` multiply — the same map serves every tint.
 *
 * Every albedo painter also draws a height pass (`mode: 'height'`), which
 * `heightToNormal` convolves into a tangent-space normal map, so relief and
 * colour always agree (a mud splat bumps, a hoof ring ridges, a horn sheath
 * grooves).
 */

export type QuadMapKind =
  | 'trunk' | 'neck' | 'head' | 'leg' | 'hair' | 'hide' | 'hoof' | 'horn' | 'eye' | 'leather' | 'felt';

/** Face markings a horse can wear; oxen only use 'plain'/'patched'. */
export type QuadMarking = 'plain' | 'blaze' | 'stripe' | 'star' | 'snip' | 'patched';

export interface QuadPaint {
  species: QuadSpecies;
  /** Coat base colour — the painter derives shade/light/mud from it. */
  base: string;
  /** Mane, tail and forelock colour. */
  mane: string;
  /** Lower-leg / muzzle points colour. */
  points: string;
  marking: QuadMarking;
  seed: number;
}

interface Derived {
  base: string;
  dark: string;
  deeper: string;
  light: string;
  pale: string;
  mud: string;
  rand: () => number;
}

function derive(p: QuadPaint): Derived {
  return {
    base: p.base,
    dark: mixHex(p.base, '#1c130a', 0.42),
    deeper: mixHex(p.base, '#0d0906', 0.68),
    light: mixHex(p.base, '#fff4dd', 0.34),
    pale: mixHex(p.base, '#ffffff', 0.72),
    mud: mixHex(p.base, '#3d2c1a', 0.58),
    rand: seededRandom(p.seed),
  };
}

/** Albedo canvases are sRGB; height/normal canvases stay in linear space. */
export interface QuadTextures {
  trunk: THREE.Texture; trunkBump: THREE.Texture | null;
  neck: THREE.Texture; neckBump: THREE.Texture | null;
  head: THREE.Texture; headBump: THREE.Texture | null;
  leg: THREE.Texture; legBump: THREE.Texture | null;
  hair: THREE.Texture; hairBump: THREE.Texture | null;
  hide: THREE.Texture; hideBump: THREE.Texture | null;
  hoof: THREE.Texture; hoofBump: THREE.Texture | null;
  horn: THREE.Texture; hornBump: THREE.Texture | null;
  eye: THREE.Texture;
  leather: THREE.Texture; leatherBump: THREE.Texture | null;
  felt: THREE.Texture; feltBump: THREE.Texture | null;
  /** All textures owned by this set, for disposal. */
  all: THREE.Texture[];
}

/** Painted texture sizes (power of two, chosen against the 2.5–7 m camera). */
export const QUAD_MAP_SIZE: Record<QuadMapKind, [number, number]> = {
  trunk: [512, 512], neck: [256, 256], head: [512, 512], leg: [256, 256],
  hair: [256, 512], hide: [256, 256], hoof: [128, 128], horn: [192, 256],
  eye: [256, 128], leather: [256, 256], felt: [128, 128],
};

/* ------------------------------------------------------------------ */
/* Shared drawing primitives                                           */
/* ------------------------------------------------------------------ */

/** Lay short coat strokes across the canvas following the hair flow. */
function hairFlow(
  ctx: Ctx, w: number, h: number, rand: () => number,
  opts: { count: number; angle: number; len: [number, number]; width: [number, number]; light: string; dark: string; alpha: number },
): void {
  for (let i = 0; i < opts.count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const len = opts.len[0] + rand() * (opts.len[1] - opts.len[0]);
    const light = rand() < 0.5;
    ctx.strokeStyle = rgba(hexToRgb(light ? opts.light : opts.dark), opts.alpha * (0.45 + rand() * 0.55));
    ctx.lineWidth = opts.width[0] + rand() * (opts.width[1] - opts.width[0]);
    ctx.lineCap = 'round';
    const a = opts.angle + (rand() - 0.5) * 0.5;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A slight bow in every stroke keeps the coat from reading as hatching.
    ctx.quadraticCurveTo(x + dx * 0.5 + dy * 0.14, y + dy * 0.5 - dx * 0.14, x + dx, y + dy);
    // Wrapped copy so the pattern tiles across the seam.
    if (x + dx > w || x + dx < 0) { ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w + dx * 0.5 + dy * 0.14, y + dy * 0.5 - dx * 0.14, x - w + dx, y + dy); }
    ctx.stroke();
  }
}

/** Value gradient across the barrel: lit topline, shaded belly, both soft. */
function roundShade(ctx: Ctx, w: number, h: number, light: string, dark: string, strength: number): void {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  const lc = hexToRgb(light), dc = hexToRgb(dark);
  // u = 0 is the left flank, 0.25 the topline, 0.5 the right flank, 0.75 the belly.
  for (const [stop, col, a] of [
    [0.0, lc, strength * 0.35], [0.12, lc, 0], [0.25, lc, strength], [0.4, lc, 0],
    [0.52, dc, strength * 0.22], [0.66, dc, strength * 0.7], [0.78, dc, strength], [0.92, dc, strength * 0.35], [1.0, lc, strength * 0.35],
  ] as const) {
    g.addColorStop(stop, rgba(col, a));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Mud splashed up from the belly: dense low, tapering speckles higher.
 * `vRange` keeps the filth on the underside — flecks scattered over the whole
 * map read as mange, not mud.
 */
function mudSpatter(
  ctx: Ctx, w: number, h: number, rand: () => number, colour: string, lo: number, hi: number, count: number,
  vRange: [number, number] = [0, 1],
): void {
  const c = hexToRgb(colour);
  for (let i = 0; i < count; i++) {
    // u in [lo, hi] around the underside; flecks thin out toward `hi`.
    const t = rand();
    const u = lo + (hi - lo) * t;
    const x = (u % 1) * w;
    const y = h * (vRange[0] + (vRange[1] - vRange[0]) * Math.pow(rand(), 0.62));
    const fade = 1 - t;
    const r = (0.6 + rand() * 3.4) * (0.4 + fade);
    ctx.fillStyle = rgba(c, (0.16 + rand() * 0.4) * (0.35 + fade));
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rand() * 0.9), rand() * 3, 0, Math.PI * 2);
    ctx.fill();
    if (x < r * 3) { ctx.beginPath(); ctx.ellipse(x + w, y, r, r, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  // A solid filth line right along the belly seam.
  const seamY = h * 0.75;
  const g = ctx.createLinearGradient(0, seamY - h * 0.05, 0, seamY + h * 0.05);
  g.addColorStop(0, rgba(c, 0));
  g.addColorStop(0.5, rgba(c, 0.22));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, seamY - h * 0.05, w, h * 0.1);
}

/* ------------------------------------------------------------------ */
/* Trunk (barrel, chest, haunches)                                     */
/* ------------------------------------------------------------------ */

/**
 * @param mode 'albedo' paints colour; 'height' paints grey relief.
 */
export function paintTrunk(ctx: Ctx, w: number, h: number, p: QuadPaint, mode: 'albedo' | 'height' = 'albedo'): void {
  const d = derive(p);
  const height = mode === 'height';
  const flat = '#808080';
  ctx.fillStyle = height ? flat : d.base;
  ctx.fillRect(0, 0, w, h);
  roundShade(ctx, w, h, height ? '#c8c8c8' : d.light, height ? '#3a3a3a' : d.dark, height ? 0.35 : 0.5);

  // Long back: the topline is lit and slightly bleached by weather.
  const crest = ctx.createLinearGradient(0, 0, 0, h);
  const crestC = hexToRgb(height ? '#a8a8a8' : mixHex(d.base, '#efe0c0', 0.2));
  for (const [v, a] of [[0, 0.3], [0.12, 0.1], [0.55, 0], [0.9, 0.05], [1, 0.22]] as const) {
    crest.addColorStop(v, rgba(crestC, a));
  }
  ctx.fillStyle = crest;
  ctx.fillRect(0, 0, w, h);

  // Rib barrel: broad soft bands behind the shoulder, and a tuck ahead of the
  // stifle, so the animal reads as a body with a ribcage rather than a tube.
  for (const [v, amp, light] of [[0.2, 0.16, true], [0.3, 0.1, false], [0.62, 0.12, true], [0.74, 0.09, false]] as const) {
    const g = ctx.createLinearGradient(0, h * (v - amp), 0, h * (v + amp));
    const col = hexToRgb(light ? (height ? '#b4b4b4' : d.light) : (height ? '#4a4a4a' : d.dark));
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop(0.5, rgba(col, height ? 0.3 : 0.24));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, h * (v - amp), w, h * amp * 2);
  }

  // Shoulder blade and haunch mass: darker hollows in front of each.
  for (const [u, v] of [[0.16, 0.26], [0.84, 0.26], [0.14, 0.78], [0.86, 0.78]] as const) {
    const g = ctx.createRadialGradient(u * w, v * h, 0, u * w, v * h, w * 0.16);
    g.addColorStop(0, rgba(hexToRgb(height ? '#5a5a5a' : d.dark), 0.34));
    g.addColorStop(1, rgba(hexToRgb(height ? '#5a5a5a' : d.dark), 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Coat flow: withers hair rolls forward, flank hair lies back toward the stifle.
  const flowCount = Math.round((w * h) / 260);
  hairFlow(ctx, w, h, d.rand, {
    count: flowCount, angle: 0.5, len: [w * 0.02, w * 0.07], width: [0.7, 1.9],
    light: height ? '#b0b0b0' : mixHex(d.base, '#ffffff', 0.3),
    dark: height ? '#505050' : d.deeper, alpha: height ? 0.22 : 0.2,
  });

  // Individual mottling; grey horses dapple, oxen carry dust on the shoulders.
  if (p.species === 'horse') {
    for (let i = 0; i < 34; i++) {
      const x = d.rand() * w, y = d.rand() * h;
      const r = w * (0.018 + d.rand() * 0.05);
      const ring = height ? (d.rand() < 0.5 ? '#9e9e9e' : '#666666') : (d.rand() < 0.5 ? d.light : d.dark);
      const g = ctx.createRadialGradient(x, y, r * 0.35, x, y, r);
      g.addColorStop(0, rgba(hexToRgb(ring), 0));
      g.addColorStop(0.7, rgba(hexToRgb(ring), 0.3));
      g.addColorStop(1, rgba(hexToRgb(ring), 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    blotches(ctx, w, h, d.rand, [height ? '#a4a4a4' : mixHex(d.base, '#f2e6c8', 0.3), height ? '#5e5e5e' : d.dark], 22, w / 16, w / 5, 0.16);
  }

  // Dirt: splashed up the belly and crusted along the sheath/udder line.
  mudSpatter(ctx, w, h, d.rand, height ? '#3f3f3f' : d.mud, 0.55, 0.95, Math.round(w * 0.9));

  // A brand or a scar: one small ownership mark per animal, never a repeat.
  if (!height && d.rand() < 0.55) {
    const bx = (0.62 + d.rand() * 0.2) * w, by = 0.36 * h;
    ctx.strokeStyle = rgba(hexToRgb(mixHex(d.base, '#f4ead0', 0.5)), 0.24);
    ctx.lineWidth = Math.max(1.2, w / 200);
    ctx.beginPath();
    ctx.arc(bx, by, w * 0.03, 0.6, 5.1);
    ctx.stroke();
  }
  grain(ctx, w, h, d.rand, Math.round(w * h * 0.02), height ? '#ffffff' : '#ffffff', height ? '#000000' : '#120c07', height ? 0.1 : 0.075);
}

/* ------------------------------------------------------------------ */
/* Neck                                                                */
/* ------------------------------------------------------------------ */

export function paintNeck(ctx: Ctx, w: number, h: number, p: QuadPaint, mode: 'albedo' | 'height' = 'albedo'): void {
  const d = derive(p);
  const height = mode === 'height';
  ctx.fillStyle = height ? '#808080' : d.base;
  ctx.fillRect(0, 0, w, h);
  roundShade(ctx, w, h, height ? '#c4c4c4' : d.light, height ? '#3c3c3c' : d.dark, height ? 0.4 : 0.55);
  // Crest (top of neck) is darker where the mane roots; the throat is pale.
  const maneLine = ctx.createLinearGradient(0, h * 0.0, 0, h * 0.5);
  maneLine.addColorStop(0, rgba(hexToRgb(height ? '#6a6a6a' : mixHex(p.mane, d.base, 0.35)), 0.55));
  maneLine.addColorStop(1, rgba(hexToRgb(height ? '#6a6a6a' : mixHex(p.mane, d.base, 0.35)), 0));
  ctx.fillStyle = maneLine;
  ctx.fillRect(0, 0, w, h * 0.5);
  // Muscle along the neck root, plus a windpipe ridge under the throat.
  for (const [u, v, r, up] of [[0.3, 0.16, 0.2, true], [0.7, 0.16, 0.2, true], [0.5, 0.8, 0.12, false]] as const) {
    const g = ctx.createRadialGradient(u * w, v * h, 0, u * w, v * h, r * w);
    const col = hexToRgb(height ? (up ? '#a6a6a6' : '#5c5c5c') : (up ? d.light : d.dark));
    g.addColorStop(0, rgba(col, 0.34));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // A hair whorl at the shoulder, drawn as converging arcs.
  const wx = 0.5 * w, wy = 0.92 * h;
  ctx.strokeStyle = rgba(hexToRgb(height ? '#6e6e6e' : d.deeper), 0.3);
  ctx.lineWidth = Math.max(1, w / 220);
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(wx, wy, w * (0.03 + (i % 4) * 0.016), a0, a0 + 1.5);
    ctx.stroke();
  }
  hairFlow(ctx, w, h, d.rand, {
    count: Math.round((w * h) / 150), angle: 1.15, len: [w * 0.05, w * 0.2], width: [0.7, 1.7],
    light: height ? '#b2b2b2' : mixHex(d.base, '#ffffff', 0.32), dark: height ? '#4e4e4e' : d.deeper, alpha: height ? 0.24 : 0.24,
  });
  mudSpatter(ctx, w, h, d.rand, height ? '#444444' : d.mud, 0.62, 0.9, Math.round(w * 0.5));
  grain(ctx, w, h, d.rand, Math.round(w * h * 0.022), '#ffffff', height ? '#000000' : '#140d07', height ? 0.1 : 0.08);
}

/* ------------------------------------------------------------------ */
/* Head: markings, nostrils, mouth line                                */
/* ------------------------------------------------------------------ */

export function paintHead(ctx: Ctx, w: number, h: number, p: QuadPaint, mode: 'albedo' | 'height' = 'albedo'): void {
  const d = derive(p);
  const height = mode === 'height';
  ctx.fillStyle = height ? '#808080' : mixHex(d.base, '#efe3c8', 0.06);
  ctx.fillRect(0, 0, w, h);
  // Round the poll and flatten the shadow under the jaw.
  roundShade(ctx, w, h, height ? '#c6c6c6' : d.light, height ? '#404040' : d.dark, height ? 0.34 : 0.46);
  // Brow ridge and cheekbones catch the light; the hollow above the eye darkens.
  for (const [u, v, r, up] of [[0.06, 0.26, 0.11, false], [0.44, 0.26, 0.11, false], [0.0, 0.34, 0.1, true], [0.5, 0.34, 0.1, true], [0.16, 0.5, 0.13, true], [0.34, 0.5, 0.13, true]] as const) {
    const g = ctx.createRadialGradient(u * w, v * h, 0, u * w, v * h, r * w);
    const col = hexToRgb(height ? (up ? '#a8a8a8' : '#5a5a5a') : (up ? d.light : d.dark));
    g.addColorStop(0, rgba(col, 0.4));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // Periocular ring: pale for cattle, dark-rimmed for horses.
  const ringCol = height ? '#9c9c9c' : (p.species === 'ox' ? mixHex(d.base, '#f6ecd4', 0.5) : mixHex(d.base, '#180f08', 0.5));
  for (const u of [0.055, 0.445]) {
    for (const copy of [0, w]) {
      const g = ctx.createRadialGradient(u * w + copy, h * 0.29, h * 0.02, u * w + copy, h * 0.29, h * 0.09);
      g.addColorStop(0.3, rgba(hexToRgb(ringCol), 0));
      g.addColorStop(0.66, rgba(hexToRgb(ringCol), p.species === 'ox' ? 0.5 : 0.34));
      g.addColorStop(1, rgba(hexToRgb(ringCol), 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(u * w + copy, h * 0.29, h * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Facial marking down the bridge (u = 0.25 is the front of the face).
  if (!height && p.marking !== 'plain' && p.marking !== 'patched') {
    const cx = 0.25 * w;
    const half = p.marking === 'blaze' ? w * 0.055 : p.marking === 'stripe' ? w * 0.016 : w * 0.03;
    const v0 = p.marking === 'snip' ? 0.6 : 0.05;
    const v1 = p.marking === 'star' ? 0.24 : p.marking === 'snip' ? 0.78 : 0.68;
    const g = ctx.createLinearGradient(cx - half * 2.1, 0, cx + half * 2.1, 0);
    g.addColorStop(0, 'rgba(246,240,226,0)');
    g.addColorStop(0.32, 'rgba(246,240,226,0.9)');
    g.addColorStop(0.5, 'rgba(252,249,240,0.96)');
    g.addColorStop(0.68, 'rgba(246,240,226,0.9)');
    g.addColorStop(1, 'rgba(246,240,226,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - half * 2.1, h * v0, half * 4.2, h * (v1 - v0));
    // Feather the edges into the coat with irregular hair-level flecks.
    ctx.fillStyle = 'rgba(248,243,231,0.55)';
    for (let i = 0; i < 190; i++) {
      const t = d.rand();
      const y = h * (v0 + t * (v1 - v0));
      const sx = cx + (d.rand() < 0.5 ? -1 : 1) * half * (0.9 + d.rand() * 1.5);
      ctx.fillRect(sx, y, Math.max(1, w / 260), Math.max(1, w / 220) * (0.4 + d.rand()));
    }
  }
  if (!height && p.marking === 'patched') {
    // Paint/pinto blanket: one big irregular white sheet over the face.
    ctx.fillStyle = 'rgba(247,243,232,0.94)';
    ctx.beginPath();
    ctx.moveTo(0.1 * w, h * 0.1);
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      ctx.lineTo((0.1 + t * 0.32) * w + Math.sin(t * 9) * w * 0.02, (0.1 + t * 0.6) * h + Math.cos(t * 7) * h * 0.04);
    }
    for (let i = 22; i >= 0; i--) {
      const t = i / 22;
      ctx.lineTo((0.34 + t * 0.06) * w + Math.sin(t * 6) * w * 0.02, (0.1 + t * 0.7) * h + Math.cos(t * 8) * h * 0.03);
    }
    ctx.closePath();
    ctx.fill();
  }
  if (height && p.marking !== 'plain') {
    // A wide white blaze sits level with the coat; a star is a shallow dip.
    ctx.fillStyle = 'rgba(150,150,150,0.5)';
    ctx.fillRect(0.25 * w - w * 0.045, h * 0.06, w * 0.09, h * 0.6);
  }

  // Muzzle: the nose leather darkens and the planum (mirror) catches light.
  const muzzle = ctx.createLinearGradient(0, h * 0.62, 0, h);
  muzzle.addColorStop(0, rgba(hexToRgb(height ? '#6c6c6c' : mixHex(p.points, d.base, 0.25)), 0));
  muzzle.addColorStop(0.45, rgba(hexToRgb(height ? '#6c6c6c' : mixHex(p.points, d.base, 0.25)), 0.72));
  muzzle.addColorStop(1, rgba(hexToRgb(height ? '#5a5a5a' : mixHex(p.points, '#000000', 0.25)), 0.92));
  ctx.fillStyle = muzzle;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);

  // Nostrils: angled slits with a raised alar fold above each.
  for (const side of [-1, 1]) {
    const nx = 0.25 * w + side * w * 0.085;
    const ny = h * 0.83;
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(side * 0.55);
    ctx.fillStyle = height ? '#242424' : 'rgba(14,9,6,0.9)';
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.026, h * 0.026, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = height ? '#a8a8a8' : rgba(hexToRgb(mixHex(d.base, '#ffffff', 0.42)), 0.4);
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.045, w * 0.038, h * 0.016, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Mouth line across the front, curving up to the jowls; chin shadow below.
  ctx.strokeStyle = height ? '#2e2e2e' : rgba(hexToRgb(d.deeper), 0.85);
  ctx.lineWidth = Math.max(1.4, w / 150);
  ctx.lineCap = 'round';
  for (const copy of [-w, 0, w]) {
    ctx.beginPath();
    ctx.moveTo(0.25 * w + copy - w * 0.2, h * 0.93);
    ctx.quadraticCurveTo(0.25 * w + copy, h * 0.86, 0.25 * w + copy + w * 0.2, h * 0.93);
    ctx.stroke();
  }
  const chin = ctx.createLinearGradient(0, h * 0.93, 0, h);
  chin.addColorStop(0, rgba(hexToRgb(height ? '#6a6a6a' : d.dark), 0.4));
  chin.addColorStop(1, rgba(hexToRgb(height ? '#6a6a6e' : d.dark), 0));
  ctx.fillStyle = chin;
  ctx.fillRect(0, h * 0.9, w, h * 0.1);

  // Forelock / poll hair and, for cattle, the curly tuft between the horns.
  hairFlow(ctx, w, h, d.rand, {
    count: Math.round((w * h) / 190), angle: p.species === 'ox' ? 1.5 : 2.1, len: [w * 0.03, w * 0.11], width: [0.8, 2.1],
    light: height ? '#b0b0b0' : mixHex(d.base, '#ffffff', 0.3), dark: height ? '#4c4c4c' : d.deeper, alpha: height ? 0.2 : 0.2,
  });
  grain(ctx, w, h, d.rand, Math.round(w * h * 0.016), '#ffffff', height ? '#000000' : '#150e08', height ? 0.09 : 0.07);
}

/* ------------------------------------------------------------------ */
/* Legs                                                                */
/* ------------------------------------------------------------------ */

/** v = 0 at the shoulder/hip, 1 at the coronet: dark points, pale fetlock. */
export function paintLeg(ctx: Ctx, w: number, h: number, p: QuadPaint, mode: 'albedo' | 'height' = 'albedo'): void {
  const d = derive(p);
  const height = mode === 'height';
  ctx.fillStyle = height ? '#808080' : d.base;
  ctx.fillRect(0, 0, w, h);
  roundShade(ctx, w, h, height ? '#c0c0c0' : d.light, height ? '#3e3e3e' : d.dark, height ? 0.32 : 0.42);
  // Points: the coat darkens from the knee/hock down, then breaks to the
  // pale coronet band just above the hoof (socks sit on top of this).
  const pts = ctx.createLinearGradient(0, h * 0.42, 0, h);
  const ptCol = height ? '#525252' : p.points;
  pts.addColorStop(0, rgba(hexToRgb(ptCol), 0));
  pts.addColorStop(0.3, rgba(hexToRgb(ptCol), 0.8));
  pts.addColorStop(0.86, rgba(hexToRgb(ptCol), 0.95));
  pts.addColorStop(0.94, rgba(hexToRgb(ptCol), 0.2));
  pts.addColorStop(1, rgba(hexToRgb(ptCol), 0));
  ctx.fillStyle = pts;
  ctx.fillRect(0, h * 0.42, w, h * 0.58);
  const coronet = ctx.createLinearGradient(0, h * 0.9, 0, h * 0.99);
  coronet.addColorStop(0, rgba(hexToRgb(height ? '#a2a2a2' : mixHex(d.base, '#f7ecd6', 0.45)), 0));
  coronet.addColorStop(0.6, rgba(hexToRgb(height ? '#a2a2a2' : mixHex(d.base, '#f7ecd6', 0.45)), 0.55));
  coronet.addColorStop(1, rgba(hexToRgb(height ? '#a2a2a2' : mixHex(d.base, '#f7ecd6', 0.45)), 0));
  ctx.fillStyle = coronet;
  ctx.fillRect(0, h * 0.9, w, h * 0.09);
  // Tendon ridges down the back of the cannon, and a kneecap glow up front.
  for (const [u, up] of [[0.12, true], [0.38, false], [0.62, false], [0.88, true]] as const) {
    const g = ctx.createLinearGradient(u * w - w * 0.05, 0, u * w + w * 0.05, 0);
    const col = hexToRgb(height ? (up ? '#9e9e9e' : '#5a5a5a') : (up ? d.light : d.dark));
    g.addColorStop(0, rgba(col, 0));
    g.addColorStop(0.5, rgba(col, 0.3));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, h * 0.3, w, h * 0.66);
  }
  hairFlow(ctx, w, h, d.rand, {
    count: Math.round((w * h) / 90), angle: 1.62, len: [h * 0.02, h * 0.07], width: [0.7, 1.6],
    light: height ? '#b0b0b0' : mixHex(d.base, '#ffffff', 0.3), dark: height ? '#4e4e4e' : d.deeper, alpha: height ? 0.2 : 0.2,
  });
  // Mud up the legs is what sells a draught animal on a wet road.
  mudSpatter(ctx, w, h, d.rand, height ? '#4a4a4a' : d.mud, -0.3, 1.3, Math.round(w * 2.2), [0.34, 1]);
  grain(ctx, w, h, d.rand, Math.round(w * h * 0.02), '#ffffff', height ? '#000000' : '#130d08', height ? 0.1 : 0.075);
}

/* ------------------------------------------------------------------ */
/* Mane, tail and forelock hair                                        */
/* ------------------------------------------------------------------ */

/** v = 0 at the root, 1 at the tips. */
export function paintHairStrand(ctx: Ctx, w: number, h: number, p: QuadPaint, mode: 'albedo' | 'height' = 'albedo'): void {
  const d = derive(p);
  const height = mode === 'height';
  const base = height ? '#808080' : p.mane;
  vGrad(ctx, w, h, height ? '#6e6e6e' : mixHex(base, '#000000', 0.42), height ? '#969696' : mixHex(base, '#fff0d0', 0.16));
  const rand = d.rand;
  // Locks: bundles of strands, lighter on the lit side, in clumps of 3–9.
  const locks = Math.round(w / 3.2);
  for (let i = 0; i < locks; i++) {
    const x0 = (i / locks) * w + (rand() - 0.5) * (w / locks);
    const bundle = 2 + Math.floor(rand() * 6);
    const lit = rand() < 0.45;
    for (let s = 0; s < bundle; s++) {
      const x = x0 + (rand() - 0.5) * (w / locks) * 1.4;
      const amp = w * (0.01 + rand() * 0.05);
      const phase = rand() * 6.283;
      ctx.strokeStyle = rgba(hexToRgb(height ? (lit ? '#b6b6b6' : '#4a4a4a') : (lit ? mixHex(base, '#ffe9bf', 0.4) : mixHex(base, '#000000', 0.5))), height ? 0.3 : (lit ? 0.42 : 0.5));
      ctx.lineWidth = Math.max(0.6, w / 190 + rand() * (w / 150));
      ctx.beginPath();
      ctx.moveTo(x, -2);
      for (let y = 0; y <= h + 4; y += Math.max(6, h / 26)) {
        ctx.lineTo(x + Math.sin(y / h * 5 + phase) * amp, y);
      }
      ctx.stroke();
    }
  }
  // Root shadow band, so the mane does not look pasted on.
  const root = ctx.createLinearGradient(0, 0, 0, h * 0.14);
  root.addColorStop(0, rgba(hexToRgb(height ? '#3c3c3c' : '#000000'), 0.5));
  root.addColorStop(1, rgba(hexToRgb(height ? '#3c3c3c' : '#000000'), 0));
  ctx.fillStyle = root;
  ctx.fillRect(0, 0, w, h * 0.14);
  // A few flyaways at the tip edge (alpha, so they cut into whatever is behind).
  ctx.strokeStyle = rgba(hexToRgb(height ? '#c8c8c8' : mixHex(base, '#ffffff', 0.35)), 0.34);
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    ctx.lineWidth = Math.max(0.5, w / 300);
    ctx.beginPath();
    ctx.moveTo(x, h * (0.6 + rand() * 0.4));
    ctx.quadraticCurveTo(x + (rand() - 0.5) * w * 0.1, h * 0.9, x + (rand() - 0.5) * w * 0.18, h);
    ctx.stroke();
  }
  grain(ctx, w, h, rand, Math.round(w * h * 0.012), '#ffffff', '#000000', height ? 0.08 : 0.06);
}

function vGrad(ctx: Ctx, w: number, h: number, top: string, bottom: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ------------------------------------------------------------------ */
/* Soft skin: muzzle leather, inner ear, eyelids, sheath               */
/* ------------------------------------------------------------------ */

export function paintHide(ctx: Ctx, w: number, h: number, p: QuadPaint, mode: 'albedo' | 'height' = 'albedo'): void {
  const d = derive(p);
  const height = mode === 'height';
  const base = height ? '#808080' : mixHex(p.points, '#b98f80', 0.34);
  vGrad(ctx, w, h, height ? '#8e8e8e' : mixHex(base, '#ffffff', 0.12), height ? '#6e6e6e' : mixHex(base, '#000000', 0.28));
  // Pebbled skin: a hex-ish mesh of soft bumps.
  const rand = d.rand;
  const cell = Math.max(3, w / 42);
  for (let y = 0, row = 0; y < h; y += cell * 0.86, row++) {
    for (let x = (row % 2 ? cell / 2 : 0); x < w; x += cell) {
      const jx = x + (rand() - 0.5) * cell * 0.5, jy = y + (rand() - 0.5) * cell * 0.4;
      const r = cell * (0.28 + rand() * 0.2);
      const g = ctx.createRadialGradient(jx, jy, 0, jx, jy, r);
      g.addColorStop(0, rgba(hexToRgb(height ? '#b8b8b8' : mixHex(base, '#ffffff', 0.3)), 0.5));
      g.addColorStop(0.72, rgba(hexToRgb(height ? '#7e7e7e' : base), 0.2));
      g.addColorStop(1, rgba(hexToRgb(height ? '#4e4e4e' : mixHex(base, '#000000', 0.5)), 0.34));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(jx, jy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Freckles — cattle and horses both spot the muzzle.
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = rgba(hexToRgb(height ? '#4a4a4a' : mixHex(base, '#241410', 0.7)), 0.18 + rand() * 0.3);
    ctx.beginPath();
    ctx.ellipse(rand() * w, rand() * h, 1 + rand() * 3, 1 + rand() * 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Whisker follicles near the muzzle edge, and two soft fold lines.
  for (let i = 0; i < 70; i++) {
    const x = rand() * w, y = h * (0.55 + rand() * 0.4);
    ctx.fillStyle = rgba(hexToRgb(height ? '#3a3a3a' : '#1a100a'), 0.5);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.7, w / 220), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(hexToRgb(height ? '#4c4c4c' : mixHex(base, '#000000', 0.5)), 0.4);
  ctx.lineWidth = Math.max(1, w / 200);
  for (let i = 0; i < 3; i++) {
    const y = h * (0.2 + i * 0.26);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + h * 0.03, w * 0.7, y - h * 0.03, w, y + h * 0.01);
    ctx.stroke();
  }
  grain(ctx, w, h, rand, Math.round(w * h * 0.02), '#ffffff', '#000000', height ? 0.08 : 0.06);
}

/* ------------------------------------------------------------------ */
/* Hoof wall                                                           */
/* ------------------------------------------------------------------ */

/** v = 0 at the coronet, 1 at the ground surface. */
export function paintHoof(ctx: Ctx, w: number, h: number, p: QuadPaint, mode: 'albedo' | 'height' = 'albedo'): void {
  const d = derive(p);
  const height = mode === 'height';
  const dark = mixHex(p.points, '#0d0a07', 0.5);
  const pale = mixHex('#8d7454', p.points, 0.4);
  const base = height ? '#808080' : mixHex(dark, pale, p.species === 'ox' ? 0.5 : 0.28);
  vGrad(ctx, w, h, height ? '#909090' : mixHex(base, '#f3e6cd', 0.14), height ? '#6a6a6a' : mixHex(base, '#120c08', 0.42));
  const rand = d.rand;
  // Growth rings: horizontal, tighter together near the coronet.
  let y = h * 0.06;
  let gap = h * 0.02;
  for (let n = 0; y < h && n < 400; n++) {
    ctx.strokeStyle = rgba(hexToRgb(height ? '#a4a4a4' : mixHex(base, '#ffeecd', 0.24)), 0.3);
    ctx.lineWidth = Math.max(0.8, h / 220);
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const yy = y + Math.sin(t * 6.283 + y) * h * 0.006;
      i ? ctx.lineTo(t * w, yy) : ctx.moveTo(0, yy);
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(hexToRgb(height ? '#4c4c4c' : mixHex(base, '#000000', 0.5)), 0.26);
    ctx.beginPath();
    ctx.moveTo(0, y + gap * 0.4);
    ctx.lineTo(w, y + gap * 0.4);
    ctx.stroke();
    y += gap;
    gap *= 1.13;
  }
  // Vertical horn tubules + the toe crease (u = 0.5 is the front of the foot).
  for (let i = 0; i < w * 1.4; i++) {
    ctx.strokeStyle = rgba(hexToRgb(height ? (rand() < 0.5 ? '#9a9a9a' : '#5a5a5a') : (rand() < 0.5 ? '#ffffff' : '#000000')), 0.07);
    ctx.lineWidth = 0.8;
    const x = rand() * w;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.05);
    ctx.lineTo(x + (rand() - 0.5) * 3, h * (0.6 + rand() * 0.4));
    ctx.stroke();
  }
  const toe = ctx.createLinearGradient(w * 0.44, 0, w * 0.56, 0);
  toe.addColorStop(0, 'rgba(0,0,0,0)');
  toe.addColorStop(0.5, rgba(hexToRgb(height ? '#5e5e5e' : mixHex(base, '#000000', 0.45)), 0.4));
  toe.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = toe;
  ctx.fillRect(w * 0.42, h * 0.1, w * 0.16, h * 0.85);
  // Coronet band (soft, hair-covered) then ground wear and stained heels.
  const band = ctx.createLinearGradient(0, 0, 0, h * 0.12);
  band.addColorStop(0, rgba(hexToRgb(height ? '#c2c2c2' : mixHex(p.base, '#ffffff', 0.4)), 0.7));
  band.addColorStop(1, rgba(hexToRgb(height ? '#c2c2c2' : mixHex(p.base, '#ffffff', 0.4)), 0));
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, w, h * 0.12);
  const wear = ctx.createLinearGradient(0, h * 0.82, 0, h);
  wear.addColorStop(0, rgba(hexToRgb(height ? '#5c5c5c' : '#2a1d12'), 0));
  wear.addColorStop(1, rgba(hexToRgb(height ? '#5c5c5c' : '#2a1d12'), 0.6));
  ctx.fillStyle = wear;
  ctx.fillRect(0, h * 0.82, w, h * 0.18);
  grain(ctx, w, h, rand, Math.round(w * h * 0.03), '#ffffff', '#000000', height ? 0.09 : 0.07);
}

/* ------------------------------------------------------------------ */
/* Horn sheath                                                         */
/* ------------------------------------------------------------------ */

/** v = 0 at the skull root, 1 at the tip. */
export function paintHorn(ctx: Ctx, w: number, h: number, p: QuadPaint, mode: 'albedo' | 'height' = 'albedo'): void {
  const d = derive(p);
  const height = mode === 'height';
  const bone = mixHex('#d8c8a4', p.points, 0.18);
  const dark = mixHex(bone, '#211509', 0.55);
  vGrad(ctx, w, h, height ? '#767676' : dark, height ? '#9a9a9a' : mixHex(bone, '#fff3d8', 0.2));
  const rand = d.rand;
  // Annular growth ridges, denser toward the base.
  let y = h * 0.9, gap = h * 0.02;
  // Ridges crowd toward the tip, but the step is floored so the loop provably
  // terminates (a geometric decay alone never reaches the end).
  for (let n = 0; y > h * 0.04 && n < 400; n++) {
    ctx.strokeStyle = rgba(hexToRgb(height ? '#c6c6c6' : mixHex(bone, '#ffffff', 0.5)), 0.34);
    ctx.lineWidth = Math.max(1, h / 260);
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const yy = y + Math.sin(t * 6.283 * 2 + y * 0.1) * h * 0.008;
      i ? ctx.lineTo(t * w, yy) : ctx.moveTo(0, yy);
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(hexToRgb(height ? '#4a4a4a' : mixHex(dark, '#000000', 0.4)), 0.4);
    ctx.beginPath();
    ctx.moveTo(0, y - gap * 0.35);
    ctx.lineTo(w, y - gap * 0.35);
    ctx.stroke();
    y -= gap;
    gap *= 0.93;
  }
  // Weathering: vertical grain plus flaking near the worn tip.
  for (let i = 0; i < w * 1.2; i++) {
    ctx.strokeStyle = rgba(hexToRgb(rand() < 0.5 ? '#ffffff' : '#000000'), 0.06);
    ctx.lineWidth = 0.9;
    const x = rand() * w;
    ctx.beginPath();
    ctx.moveTo(x, rand() * h * 0.3);
    ctx.lineTo(x + (rand() - 0.5) * 4, h * (0.3 + rand() * 0.7));
    ctx.stroke();
  }
  const tip = ctx.createLinearGradient(0, 0, 0, h * 0.3);
  tip.addColorStop(0, rgba(hexToRgb(height ? '#3a3a3a' : '#241a10'), 0.75));
  tip.addColorStop(1, rgba(hexToRgb(height ? '#3a3a3a' : '#241a10'), 0));
  ctx.fillStyle = tip;
  ctx.fillRect(0, 0, w, h * 0.3);
  // Hair-stained, roughened base where the horn meets the poll.
  const foot = ctx.createLinearGradient(0, h * 0.84, 0, h);
  foot.addColorStop(0, rgba(hexToRgb(height ? '#5a5a5a' : mixHex(p.points, '#000000', 0.3)), 0));
  foot.addColorStop(1, rgba(hexToRgb(height ? '#5a5a5a' : mixHex(p.points, '#000000', 0.3)), 0.65));
  ctx.fillStyle = foot;
  ctx.fillRect(0, h * 0.84, w, h * 0.16);
  grain(ctx, w, h, rand, Math.round(w * h * 0.02), '#ffffff', '#000000', height ? 0.08 : 0.06);
}

/* ------------------------------------------------------------------ */
/* Eye                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Equirect eye: the cornea faces +Z, which lands at u = 0.25 on a
 * SphereGeometry (same convention as the hero's face sphere).
 * Cattle have a horizontal rectangular pupil; horses a round one.
 */
export function paintEye(ctx: Ctx, w: number, h: number, p: QuadPaint, mode: 'albedo' | 'height' = 'albedo'): void {
  const d = derive(p);
  if (mode === 'height') {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.25, h * 0.5, 0, w * 0.25, h * 0.5, w * 0.13);
    g.addColorStop(0, '#c8c8c8');
    g.addColorStop(0.8, '#a8a8a8');
    g.addColorStop(1, '#7a7a7a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // Sclera with warm vessels at the corners.
  vGrad(ctx, w, h, '#e7dccb', '#cdc0ad');
  const rand = d.rand;
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(${(140 + rand() * 40) | 0},${(80 + rand() * 30) | 0},${(70 + rand() * 20) | 0},${0.05 + rand() * 0.14})`;
    ctx.lineWidth = 0.8;
    const x = rand() * w, y = h * (0.2 + rand() * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 24, y + (rand() - 0.5) * 12, x + (rand() - 0.5) * 34, y + (rand() - 0.5) * 16);
    ctx.stroke();
  }
  const cx = w * 0.25, cy = h * 0.5;
  const irisR = w * 0.115;
  // Iris: amber-brown with radial fibres and a dark limbal ring.
  const irisBase = p.species === 'ox' ? '#4b3319' : mixHex('#5e3f1d', p.base, 0.3);
  const ig = ctx.createRadialGradient(cx, cy, irisR * 0.2, cx, cy, irisR);
  ig.addColorStop(0, mixHex(irisBase, '#000000', 0.35));
  ig.addColorStop(0.55, irisBase);
  ig.addColorStop(0.88, mixHex(irisBase, '#c99a4e', 0.35));
  ig.addColorStop(1, '#1c1109');
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < 150; i++) {
    const a = rand() * Math.PI * 2;
    const r0 = irisR * (0.2 + rand() * 0.3), r1 = irisR * (0.8 + rand() * 0.25);
    ctx.strokeStyle = rgba(hexToRgb(rand() < 0.5 ? mixHex(irisBase, '#f2d59a', 0.5) : mixHex(irisBase, '#120a04', 0.6)), 0.3);
    ctx.lineWidth = 0.6 + rand();
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();
  // Pupil.
  ctx.fillStyle = '#0a0705';
  if (p.species === 'ox') {
    ctx.beginPath();
    ctx.ellipse(cx, cy, irisR * 0.72, irisR * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(cx, cy, irisR * 0.3, irisR * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Catchlights: a broad key reflection plus a small ground bounce.
  ctx.fillStyle = 'rgba(255,252,244,0.9)';
  ctx.beginPath();
  ctx.ellipse(cx - irisR * 0.34, cy - irisR * 0.4, irisR * 0.26, irisR * 0.18, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(212,228,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(cx + irisR * 0.3, cy + irisR * 0.34, irisR * 0.14, irisR * 0.09, 0.4, 0, Math.PI * 2);
  ctx.fill();
  // Eyelid shadow top and bottom so the globe sits inside a socket.
  for (const [y0, y1] of [[cy - h * 0.34, cy - h * 0.12], [cy + h * 0.12, cy + h * 0.34]] as const) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(24,14,8,0.5)');
    g.addColorStop(1, 'rgba(24,14,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - h, y0, h * 2, y1 - y0);
  }
  grain(ctx, w, h, rand, Math.round(w * h * 0.01), '#ffffff', '#241a12', 0.05);
}

/* ------------------------------------------------------------------ */
/* Tack: harness leather and the yoke pad felt                         */
/* ------------------------------------------------------------------ */

/** Straps run along v: two rows of saddle stitch, glazed edges, wear. */
export function paintHarnessLeather(ctx: Ctx, w: number, h: number, seed = 91, base = '#4b3421'): void {
  const rand = seededRandom(seed);
  vGrad(ctx, w, h, mixHex(base, '#ffffff', 0.12), mixHex(base, '#000000', 0.3));
  ctx.fillStyle = rgba(hexToRgb(mixHex(base, '#000000', 0.55)), 0.5);
  ctx.fillRect(0, 0, w * 0.1, h);
  ctx.fillRect(w * 0.9, 0, w * 0.1, h);
  const gloss = ctx.createLinearGradient(w * 0.1, 0, w * 0.9, 0);
  gloss.addColorStop(0, 'rgba(255,236,200,0)');
  gloss.addColorStop(0.42, 'rgba(255,236,200,0.2)');
  gloss.addColorStop(0.62, 'rgba(255,236,200,0.05)');
  gloss.addColorStop(1, 'rgba(255,236,200,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(w * 0.1, 0, w * 0.8, h);
  // Grain.
  blotches(ctx, w, h, rand, [mixHex(base, '#000000', 0.35), mixHex(base, '#c08a4e', 0.35)], Math.round(w / 7), w / 22, w / 6, 0.16);
  // Stitching: two lines of slanted dashes.
  const stitch = mixHex('#d9c08a', base, 0.3);
  const step = Math.max(6, w / 22);
  for (const row of [0.28, 0.72]) {
    for (let y = 0; y < h; y += step) {
      ctx.fillStyle = rgba(hexToRgb(stitch), 0.85);
      ctx.beginPath();
      ctx.ellipse(w * row, y + step / 2, Math.max(0.8, w / 150), step * 0.24, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(20,12,6,0.4)';
      ctx.beginPath();
      ctx.ellipse(w * row, y + step / 2 + 1, Math.max(0.8, w / 150), step * 0.18, 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Buckle holes and stretched holes at the strap ends.
  for (let i = 0; i < 6; i++) {
    const y = h * (0.08 + i * 0.06);
    ctx.fillStyle = 'rgba(14,9,5,0.75)';
    ctx.beginPath();
    ctx.arc(w * 0.5, y, Math.max(1.2, w / 60), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(hexToRgb(mixHex(base, '#ffffff', 0.35)), 0.4);
    ctx.lineWidth = Math.max(0.8, w / 200);
    ctx.beginPath();
    ctx.arc(w * 0.5, y, Math.max(1.6, w / 48), 0, Math.PI * 2);
    ctx.stroke();
  }
  // Edge wear and sweat darkening at the ends of the strap.
  const wear = ctx.createLinearGradient(0, 0, 0, h);
  wear.addColorStop(0, 'rgba(12,8,4,0.3)');
  wear.addColorStop(0.35, 'rgba(12,8,4,0)');
  wear.addColorStop(0.75, 'rgba(12,8,4,0)');
  wear.addColorStop(1, 'rgba(12,8,4,0.42)');
  ctx.fillStyle = wear;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, rand, Math.round(w * h * 0.02), '#ffffff', '#0e0905', 0.07);
}

/** Matted wool felt for the ox yoke pad, with tar waterproofing. */
export function paintPadFelt(ctx: Ctx, w: number, h: number, seed = 101, base = '#6d5a41'): void {
  const rand = seededRandom(seed);
  vGrad(ctx, w, h, mixHex(base, '#ffffff', 0.14), mixHex(base, '#000000', 0.34));
  for (let i = 0; i < w * 3; i++) {
    ctx.strokeStyle = rgba(hexToRgb(rand() < 0.5 ? mixHex(base, '#ffffff', 0.3) : mixHex(base, '#000000', 0.4)), 0.12);
    ctx.lineWidth = 0.6 + rand() * 1.6;
    const x = rand() * w, y = rand() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * w * 0.06, y + (rand() - 0.5) * h * 0.05);
    ctx.stroke();
  }
  // Compression bands where the yoke bears down.
  for (const v of [0.3, 0.62]) {
    const g = ctx.createLinearGradient(0, h * (v - 0.08), 0, h * (v + 0.08));
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, rgba(hexToRgb(mixHex(base, '#000000', 0.55)), 0.4));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h * (v - 0.08), w, h * 0.16);
  }
  // Tarred underside streaks.
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = rgba(hexToRgb('#241a10'), 0.1 + rand() * 0.24);
    const x = rand() * w;
    ctx.fillRect(x, h * 0.7 + rand() * h * 0.2, Math.max(1, w / 90), h * (0.05 + rand() * 0.2));
  }
  grain(ctx, w, h, rand, Math.round(w * h * 0.03), '#ffffff', '#100b06', 0.09);
}

/* ------------------------------------------------------------------ */
/* Canvas → texture plumbing                                           */
/* ------------------------------------------------------------------ */

/** Bake a painter into a texture (sRGB for colour, linear for height/normal). */
export function quadCanvasTexture(
  factory: CanvasFactory, w: number, h: number, paint: (ctx: Ctx) => void, srgb: boolean,
): THREE.Texture | null {
  const canvas = factory(w, h);
  const ctx = canvas.getContext?.('2d') ?? null;
  if (!ctx) return null;
  paint(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Convolve a greyscale height canvas into a tangent-space normal map.
 * Sampling wraps in both axes so the result stays seamless. Returns null when
 * the environment cannot read pixels (a stub canvas in unit tests).
 */
export function heightToNormal(
  factory: CanvasFactory, w: number, h: number, strength: number, paint: (ctx: Ctx) => void,
): THREE.Texture | null {
  const canvas = factory(w, h);
  const ctx = canvas.getContext?.('2d') ?? null;
  if (!ctx || typeof ctx.getImageData !== 'function') return null;
  paint(ctx);
  let src: Uint8ClampedArray;
  try {
    src = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // Tainted canvas (no pixel access): skip relief, keep colour.
  }
  const out = ctx.createImageData(w, h);
  const at = (x: number, y: number): number => {
    const xi = ((x % w) + w) % w, yi = ((y % h) + h) % h;
    return src[(yi * w + xi) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(-dx, -dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

type HeightPainter = (ctx: Ctx, w: number, h: number) => void;

/** One height→normal pair per region; sizes stay half the albedo where legal. */
function relief(factory: CanvasFactory, size: [number, number], strength: number, paint: HeightPainter): THREE.Texture | null {
  const w = Math.max(64, size[0] >> (size[0] >= 512 ? 1 : 0));
  const h = Math.max(64, size[1] >> (size[0] >= 512 ? 1 : 0));
  return heightToNormal(factory, w, h, strength, ctx => paint(ctx, w, h));
}

/**
 * Build every texture a single animal needs. `marking` drives the head map so
 * two horses of the same colour still look like two different horses.
 * `sizeScale` (1 / 0.5) is the quality tier: the performance tier halves every
 * map, which is roughly a quarter of the VRAM for a fifth of the paint time.
 */
export function createQuadTextures(factory: CanvasFactory, p: QuadPaint, sizeScale = 1): QuadTextures {
  const sizeOf = (kind: QuadMapKind): [number, number] => {
    const [w, h] = QUAD_MAP_SIZE[kind];
    const s = sizeScale >= 1 ? 1 : 0.5;
    return [Math.max(64, Math.round(w * s)), Math.max(64, Math.round(h * s))];
  };
  const coat = (kind: QuadMapKind, paint: (ctx: Ctx, w: number, h: number, pp: QuadPaint, mode?: 'albedo' | 'height') => void): [THREE.Texture | null, THREE.Texture | null] => {
    const [w, h] = sizeOf(kind);
    const albedo = quadCanvasTexture(factory, w, h, ctx => paint(ctx, w, h, p, 'albedo'), true);
    return [albedo, relief(factory, [w, h], kind === 'head' ? 2.4 : 1.9, (c, ww, hh) => paint(c, ww, hh, p, 'height'))];
  };
  const [trunk, trunkBump] = coat('trunk', paintTrunk);
  const [neck, neckBump] = coat('neck', paintNeck);
  const [head, headBump] = coat('head', paintHead);
  const [leg, legBump] = coat('leg', paintLeg);
  const [hair, hairBump] = coat('hair', paintHairStrand);
  const [hide, hideBump] = coat('hide', paintHide);
  const [hoof, hoofBump] = coat('hoof', paintHoof);
  const [horn, hornBump] = coat('horn', paintHorn);
  const [eye] = coat('eye', paintEye);
  const [le, leN] = simplePair(factory, sizeOf('leather'), (c, w, h) => paintHarnessLeather(c, w, h, p.seed + 31));
  const [fe, feN] = simplePair(factory, sizeOf('felt'), (c, w, h) => paintPadFelt(c, w, h, p.seed + 41));
  // Named for the renderer's debug tools and the material tests; a normal map
  // is recognisable by its `_normal` suffix, which also drives colour space.
  const pairs: [string, THREE.Texture | null, THREE.Texture | null][] = [
    ['trunk', trunk, trunkBump], ['neck', neck, neckBump], ['head', head, headBump], ['leg', leg, legBump],
    ['hair', hair, hairBump], ['hide', hide, hideBump], ['hoof', hoof, hoofBump], ['horn', horn, hornBump],
    ['eye', eye, null], ['leather', le, leN], ['felt', fe, feN],
  ];
  for (const [key, albedo, normal] of pairs) {
    if (albedo) albedo.name = `quad_${key}`;
    if (normal) normal.name = `quad_${key}_normal`;
  }
  const keep = (t: THREE.Texture | null): THREE.Texture => t ?? new THREE.Texture();
  const all = [trunk, trunkBump, neck, neckBump, head, headBump, leg, legBump, hair, hairBump, hide, hideBump, hoof, hoofBump, horn, hornBump, eye, le, leN, fe, feN]
    .filter((t): t is THREE.Texture => !!t);
  return {
    trunk: keep(trunk), trunkBump, neck: keep(neck), neckBump, head: keep(head), headBump,
    leg: keep(leg), legBump, hair: keep(hair), hairBump, hide: keep(hide), hideBump,
    hoof: keep(hoof), hoofBump, horn: keep(horn), hornBump, eye: keep(eye),
    leather: keep(le), leatherBump: leN, felt: keep(fe), feltBump: feN, all,
  };
}

function simplePair(
  factory: CanvasFactory, [w, h]: [number, number], paint: (ctx: Ctx, w: number, h: number) => void,
): [THREE.Texture | null, THREE.Texture | null] {
  const albedo = quadCanvasTexture(factory, w, h, ctx => paint(ctx, w, h), true);
  const normal = heightToNormal(factory, w, h, 1.6, ctx => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    // Reuse the albedo layout as a height field, flattened to grey afterwards.
    const tmp = factory(w, h);
    const tctx = tmp.getContext?.('2d');
    if (tctx) {
      paint(tctx, w, h);
      ctx.globalAlpha = 0.6;
      ctx.drawImage(tmp, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(128,128,128,0.35)';
      ctx.fillRect(0, 0, w, h);
    }
  });
  return [albedo, normal];
}

/**
 * Coat palette per individual. Colours stay in the woodland grade the hero and
 * the wagon already sit in, and `mane`/`points` are derived so a bay, a grey
 * and a dun all read correctly from one painter set.
 */
export interface QuadPalette {
  base: string;
  mane: string;
  points: string;
  marking: QuadMarking;
}

export function quadPalette(species: QuadSpecies, tint: string, seed: number): QuadPalette {
  const rand = seededRandom(seed * 7919 + 13);
  const grey = species === 'horse' && isGrey(tint);
  const markings: QuadMarking[] = ['plain', 'blaze', 'stripe', 'star', 'snip'];
  return {
    base: tint,
    mane: grey ? mixHex(tint, '#e7e2d6', 0.3) : mixHex(tint, '#1a130c', rand() * 0.28 + (species === 'ox' ? 0.5 : 0.62)),
    points: mixHex(tint, species === 'ox' ? '#2a1d12' : '#20160e', species === 'ox' ? 0.34 : 0.55 + rand() * 0.2),
    marking: species === 'ox'
      ? (rand() < 0.3 ? 'patched' : 'plain')
      : markings[(rand() * markings.length) | 0],
  };
}

function isGrey(tint: string): boolean {
  const [r, g, b] = hexToRgb(tint);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max > 120 && max - min < 34;
}
