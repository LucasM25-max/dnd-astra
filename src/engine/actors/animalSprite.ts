import {
  View, limb, blob, coatPattern, shade, dot, speckle, sheenLine, v3, addV, subV, scaleV, sortItems, type V3, type DrawItem,
} from './sprites';

/**
 * Draught oxen and horses painted as 16-direction billboards.
 * The body is a hull of elliptical cross-sections so it foreshortens like a
 * 3D mass from every angle; legs use the same two-bone IK as the fighter.
 */

export type AnimalSpecies = 'ox' | 'horse';

export interface AnimalLeg { hip: V3; knee: V3; ankle: V3; toe: V3 }

export interface AnimalPose {
  species: AnimalSpecies;
  body: V3[];            // hull control points (cross-section samples)
  neck: [V3, V3];        // base → top
  skull: V3; muzzle: V3; muzzleTip: V3;
  ears: [V3, V3]; eyes: [V3, V3]; horns: [V3[], V3[]] | null;
  legs: AnimalLeg[];     // FL, FR, RL, RR
  tail: V3[];
  mane?: V3[];
  breath: number;
}

interface SpeciesSpec {
  frontLeg: { x: number; z: number; hipY: number };
  rearLeg: { x: number; z: number; hipY: number };
  thigh: number; shin: number;
  stride: number; lift: number;
  sections: [number, number, number, number][]; // [z, halfWidth, centreY, halfHeight]
  neckBase: V3; neckTop: V3;
  skullUp: V3; muzzleUp: V3; muzzleTipUp: V3;
  headDown: { neckTop: V3; skull: V3; muzzle: V3; muzzleTip: V3 };
  legRadius: number; neckR: number;
}

// Character space follows the sprite system's convention: +z = facing.
const OX: SpeciesSpec = {
  frontLeg: { x: .20, z: .45, hipY: 1.00 }, rearLeg: { x: .22, z: -.60, hipY: .92 },
  thigh: .44, shin: .42, stride: .13, lift: .05,
  sections: [[.60, .26, 1.06, .34], [.28, .30, 1.14, .40], [-.05, .34, 1.05, .38], [-.52, .30, 1.02, .36]],
  neckBase: v3(0, 1.26, .52), neckTop: v3(0, 1.30, .84),
  skullUp: v3(0, 1.34, 1.01), muzzleUp: v3(0, 1.255, 1.19), muzzleTipUp: v3(0, 1.235, 1.29),
  headDown: { neckTop: v3(0, 1.05, .72), skull: v3(0, 1.14, .95), muzzle: v3(0, 1.08, 1.08), muzzleTip: v3(0, 1.06, 1.16) },
  legRadius: .075, neckR: .115,
};
const HORSE: SpeciesSpec = {
  frontLeg: { x: .17, z: .42, hipY: 1.04 }, rearLeg: { x: .18, z: -.58, hipY: .98 },
  thigh: .42, shin: .40, stride: .16, lift: .06,
  sections: [[.58, .24, 1.08, .34], [.20, .29, 1.15, .38], [-.20, .32, 1.06, .37], [-.58, .27, 1.03, .34]],
  neckBase: v3(0, 1.30, .48), neckTop: v3(0, 1.36, .86),
  skullUp: v3(0, 1.42, .98), muzzleUp: v3(0, 1.315, 1.16), muzzleTipUp: v3(0, 1.285, 1.27),
  headDown: { neckTop: v3(0, 1.04, .74), skull: v3(0, 1.06, .88), muzzle: v3(0, .975, 1.03), muzzleTip: v3(0, .945, 1.11) },
  legRadius: .055, neckR: .088,
};

function ik2(upper: V3, lower: V3, l1: number, l2: number): V3 {
  let dy = lower.y - upper.y, dz = lower.z - upper.z;
  let d = Math.hypot(dy, dz);
  const maxD = l1 + l2 - 1e-4;
  if (d > maxD) { dy *= maxD / d; dz *= maxD / d; d = maxD; }
  d = Math.max(d, 1e-4);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const uy = dy / d, uz = dz / d;
  return v3(upper.x, upper.y + a * uy + h * uz, upper.z + a * uz - h * uy);
}

/** Pure pose math. `phase` = gait phase, `t` = wall clock, `headDown` 0..1. */
export function animalPose(species: AnimalSpecies, phase: number, t: number, headDown = 0, walking = 1): AnimalPose {
  const S = species === 'ox' ? OX : HORSE;
  const breath = (1 - walking) * Math.sin(t * 1.6) * .009 + Math.sin(phase * 2) * .012 * walking;
  const body: V3[] = [];
  for (const [z, hw, cy, hh] of S.sections) {
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      body.push(v3(hw * Math.cos(a), cy + hh * Math.sin(a) + breath, z));
    }
  }
  const neck: [V3, V3] = [addV(S.neckBase, v3(0, breath, 0)),
    addV(addV(S.neckTop, v3(0, breath, 0)), scaleV(subV(S.headDown.neckTop, S.neckTop), headDown))];
  const skull = addV(addV(S.skullUp, v3(0, breath, 0)), scaleV(subV(S.headDown.skull, S.skullUp), headDown));
  const muzzle = addV(addV(S.muzzleUp, v3(0, breath, 0)), scaleV(subV(S.headDown.muzzle, S.muzzleUp), headDown));
  const muzzleTip = addV(addV(S.muzzleTipUp, v3(0, breath, 0)), scaleV(subV(S.headDown.muzzleTip, S.muzzleTipUp), headDown));

  const legs: AnimalLeg[] = [];
  // Far-side legs are staggered slightly in z so a pure profile view still
  // reads as four legs instead of two perfectly overlapped pairs.
  const defs = [
    { x: -S.frontLeg.x, z: S.frontLeg.z - .10, hipY: S.frontLeg.hipY, ph: 0 },
    { x: S.frontLeg.x, z: S.frontLeg.z, hipY: S.frontLeg.hipY, ph: Math.PI },
    { x: -S.rearLeg.x, z: S.rearLeg.z + .10, hipY: S.rearLeg.hipY, ph: Math.PI * 1.5 },
    { x: S.rearLeg.x, z: S.rearLeg.z, hipY: S.rearLeg.hipY, ph: Math.PI * .5 },
  ];
  for (const def of defs) {
    const ph = phase + def.ph;
    const hip = v3(def.x, def.hipY + breath * .6, def.z);
    const foot = v3(def.x, S.lift * Math.max(0, Math.cos(ph)) * walking, def.z + S.stride * Math.sin(ph) * walking);
    const knee = ik2(hip, foot, S.thigh, S.shin);
    const ankle = v3(foot.x, foot.y + .012, foot.z - .008);
    const toe = v3(foot.x, Math.max(foot.y, .012), foot.z + .09);
    legs.push({ hip, knee, ankle, toe });
  }

  const sway = Math.sin(t * 1.3) * .05 + Math.sin(phase) * .04 * walking;
  const tail: V3[] = species === 'ox'
    ? [v3(0, 1.24 + breath, -.66), v3(sway, .98, -.74), v3(sway * 1.4, .82, -.78)]
    : [v3(0, 1.22 + breath, -.64), v3(sway * .8, 1.0, -.76), v3(sway * 1.5, .74, -.84), v3(sway * 2, .58, -.88)];

  const earOff = species === 'ox' ? v3(.145, .11, -.11) : v3(.055, .125, -.03);
  const ears: [V3, V3] = [
    v3(skull.x - earOff.x, skull.y + earOff.y, skull.z + earOff.z),
    v3(skull.x + earOff.x, skull.y + earOff.y, skull.z + earOff.z),
  ];
  const eyeOff = species === 'ox' ? v3(.105, .02, .04) : v3(.07, 0, .05);
  const eyes: [V3, V3] = [
    v3(skull.x - eyeOff.x, skull.y + eyeOff.y, skull.z + eyeOff.z),
    v3(skull.x + eyeOff.x, skull.y + eyeOff.y, skull.z + eyeOff.z),
  ];
  let horns: [V3[], V3[]] | null = null;
  if (species === 'ox') {
    const horn = (s: number) => [
      v3(skull.x + s * .07, skull.y + .13, skull.z - .03),
      v3(skull.x + s * .16, skull.y + .21, skull.z - .015),
      v3(skull.x + s * .235, skull.y + .29, skull.z + .02),
      v3(skull.x + s * .255, skull.y + .345, skull.z + .05),
    ];
    horns = [horn(-1), horn(1)];
  }
  const mane = species === 'horse' ? [addV(neck[0], v3(0, .10, -.02)), addV(neck[1], v3(0, .09, -.02))] : undefined;

  return { species, body, neck, skull, muzzle, muzzleTip, ears, eyes, horns, legs, tail, mane, breath };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

export interface AnimalPalette { coat: string; dark: string; muzzle: string }

function hullPath(pts: { x: number; y: number }[]): Path2D {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: { x: number; y: number }[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  const all = lower.concat(upper);
  const path = new Path2D();
  path.moveTo((all[all.length - 1].x + all[0].x) / 2, (all[all.length - 1].y + all[0].y) / 2);
  for (let i = 0; i < all.length; i++) {
    const m = { x: (all[i].x + all[(i + 1) % all.length].x) / 2, y: (all[i].y + all[(i + 1) % all.length].y) / 2 };
    path.quadraticCurveTo(all[i].x, all[i].y, m.x, m.y);
  }
  path.closePath();
  return path;
}

/** Fetlock tuft + hoof: coronet band, wall sheen, cloven groove or shoe. */
function hoof(ctx: Ctx, view: View, W: number, H: number, pad: number, ankle: V3, toe: V3, pal: AnimalPalette, ox: boolean, seed: number) {
  // Fetlock tuft behind the pastern.
  blob(ctx, addV(ankle, v3(0, -.015, -.035)), ox ? .028 : .034, ox ? .035 : .045, shade(pal.coat, .05), view, W, H, pad);
  const F = view.toScreen(addV(ankle, v3(0, -.03, -.04)), W, H, pad);
  speckle(ctx, F.x, F.y, 4 * F.scale, 4 * F.scale, 8, seed, shade(pal.coat, -.25), .55);
  // Hoof wall.
  limb(ctx, ankle, toe, ox ? .05 : .04, '#2e2820', view, W, H, pad);
  const A = view.toScreen(ankle, W, H, pad), T = view.toScreen(toe, W, H, pad);
  sheenLine(ctx, A.x, A.y, T.x, T.y, 1.6, '#7a6c55', 1.5, .65);
  // Coronet band where hair meets horn.
  sheenLine(ctx, A.x - 3, A.y + 1, A.x + 3, A.y + 1, 0, shade(pal.coat, .12), 1.6, .8);
  if (ox) {
    // Cloven groove down the front wall.
    sheenLine(ctx, A.x, A.y + 1, T.x, T.y + 2, 0, '#14100b', 1.3, .85);
  } else {
    // Iron shoe arc around the ground edge.
    ctx.save(); ctx.strokeStyle = '#4c4e45'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(T.x, T.y - 1, 4.2 * T.scale, Math.PI * .15, Math.PI * .85); ctx.stroke(); ctx.restore();
    dot(ctx, T.x - 3 * T.scale, T.y + 1, .8, '#878d92', .8); dot(ctx, T.x + 3 * T.scale, T.y + 1, .8, '#878d92', .8);
  }
}

export function paintAnimal(ctx: Ctx, view: View, pose: AnimalPose, pal: AnimalPalette) {
  const W = 352, H = 224, pad = 6;
  const items: DrawItem[] = [];
  const mid = (a: V3, b: V3) => v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  const ox = pose.species === 'ox';
  // Which flank faces the camera (character space x = right; rel > 0 → left side shows).
  const flank = view.rel > 0 ? -1 : 1;

  // Legs (farther legs draw first via sorting).
  pose.legs.forEach((leg, li) => {
    items.push({
      depth: view.depth(mid(leg.hip, leg.knee)), draw: () => {
        limb(ctx, leg.hip, leg.knee, ox ? .078 : .058, pal.coat, view, W, H, pad);
        // Joint shade + muscle seam down the upper leg.
        const K = view.toScreen(leg.knee, W, H, pad), P = view.toScreen(leg.hip, W, H, pad);
        ctx.save(); ctx.globalAlpha = .22;
        blob(ctx, leg.knee, ox ? .055 : .042, ox ? .05 : .04, pal.dark, view, W, H, pad);
        ctx.restore();
        sheenLine(ctx, P.x, P.y, K.x, K.y, -2.4, shade(pal.coat, -.22), 1.5, .5);
      },
    });
    items.push({
      depth: view.depth(mid(leg.knee, leg.ankle)), draw: () => {
        limb(ctx, leg.knee, leg.ankle, ox ? .062 : .046, pal.dark, view, W, H, pad);
        // Cannon bone sheen.
        const A = view.toScreen(leg.knee, W, H, pad), B = view.toScreen(leg.ankle, W, H, pad);
        sheenLine(ctx, A.x, A.y, B.x, B.y, 1.8, shade(pal.coat, .28), 1.4, .45);
      },
    });
    items.push({ depth: view.depth(mid(leg.ankle, leg.toe)), draw: () => hoof(ctx, view, W, H, pad, leg.ankle, leg.toe, pal, ox, 11 + li * 7) });
  });

  // Body mass: hull of cross-section samples with pelt, spine light and belly shade.
  items.push({
    depth: view.depth(v3(0, 1.05, 0)),
    draw: () => {
      const pts = pose.body.map(p => view.toScreen(p, W, H, pad));
      const path = hullPath(pts);
      const yMin = Math.min(...pts.map(p => p.y)), yMax = Math.max(...pts.map(p => p.y));
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.globalAlpha = .85;
      ctx.strokeStyle = pal.dark; ctx.lineWidth = 2; ctx.stroke(path);
      ctx.globalAlpha = 1;
      const g = ctx.createLinearGradient(0, yMin, 0, yMax);
      g.addColorStop(0, shade(pal.coat, .12)); g.addColorStop(.52, pal.coat); g.addColorStop(1, shade(pal.coat, -.18));
      ctx.fillStyle = g; ctx.fill(path);
      ctx.clip(path);
      const pat = coatPattern(ctx);
      if (pat) { ctx.globalAlpha = .5; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      // Coat lies along the spine: stroke pelage in the projected body direction.
      const withers = view.toScreen(v3(0, 1.45, .35), W, H, pad);
      const croup = view.toScreen(v3(0, 1.38, -.55), W, H, pad);
      const dx = croup.x - withers.x, dy = croup.y - withers.y, L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      for (let i = 0; i < pose.body.length; i += 2) {
        const s = view.toScreen(pose.body[i], W, H, pad);
        const jx = Math.sin(i * 12.9) * 2.2, jy = Math.cos(i * 7.7) * 2.2;
        ctx.save(); ctx.globalAlpha = .11; ctx.lineWidth = 1;
        ctx.strokeStyle = i % 4 ? shade(pal.coat, .30) : shade(pal.coat, -.30);
        ctx.beginPath(); ctx.moveTo(s.x - ux * 3 + jx, s.y - uy * 3 + jy); ctx.lineTo(s.x + ux * 3 + jx, s.y + uy * 3 + jy); ctx.stroke();
        ctx.restore();
      }
      // Spine light.
      sheenLine(ctx, withers.x, withers.y + 2, croup.x, croup.y + 2, 0, shade(pal.coat, .32), 3, .20);
      if (!ox) {
        // Faint dapples across the barrel.
        for (let i = 1; i < pose.body.length; i += 4) {
          const s = view.toScreen(pose.body[i], W, H, pad);
          ctx.save(); ctx.globalAlpha = .10; ctx.strokeStyle = shade(pal.coat, .35); ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(s.x, s.y, 4 + (i % 3), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
      }
      // Elbow and flank shade on the visible side + a hair whorl at the hip.
      ctx.save(); ctx.globalAlpha = .25;
      blob(ctx, v3(flank * .25, .95, .35), .09, .11, pal.dark, view, W, H, pad);
      ctx.restore();
      const hipS = view.toScreen(v3(flank * .28, 1.12, -.48), W, H, pad);
      ctx.save(); ctx.globalAlpha = .28; ctx.strokeStyle = shade(pal.coat, -.30); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(hipS.x, hipS.y, 3.4, .4, 4.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(hipS.x, hipS.y, 1.6, 2.2, 6.0); ctx.stroke(); ctx.restore();
      // Underbelly shade.
      const bellyY = view.toScreen(v3(0, .92, 0), W, H, pad).y;
      const bg = ctx.createLinearGradient(0, bellyY - 14, 0, bellyY + 16);
      bg.addColorStop(0, 'rgba(24,17,10,0)'); bg.addColorStop(1, 'rgba(24,17,10,.28)');
      ctx.fillStyle = bg; ctx.fillRect(0, bellyY - 14, W, 60);
      ctx.restore();
    },
  });

  // Tail with parted strands and a full switch.
  items.push({
    depth: view.depth(pose.tail[0]),
    draw: () => {
      for (let i = 0; i < pose.tail.length - 1; i++) {
        limb(ctx, pose.tail[i], pose.tail[i + 1], ox ? .02 : .024, pal.dark, view, W, H, pad);
        const A = view.toScreen(pose.tail[i], W, H, pad), B = view.toScreen(pose.tail[i + 1], W, H, pad);
        sheenLine(ctx, A.x, A.y, B.x, B.y, 1.6, shade(pal.coat, .20), 1, .5);
        sheenLine(ctx, A.x, A.y, B.x, B.y, -1.6, shade(pal.coat, -.25), 1, .5);
      }
      const tip = pose.tail[pose.tail.length - 1];
      blob(ctx, tip, ox ? .03 : .045, ox ? .045 : .05, pal.dark, view, W, H, pad);
      const T = view.toScreen(tip, W, H, pad);
      for (let i = -2; i <= 2; i++) {
        sheenLine(ctx, T.x + i * 2.4 * T.scale, T.y - 4 * T.scale, T.x + i * 3.2 * T.scale, T.y + 5 * T.scale, 0, i % 2 ? shade(pal.coat, .18) : pal.dark, 1.1, .6);
      }
    },
  });

  // Neck: throat groove, withers shade, ox dewlap, horse mane on its own side.
  const neckMid = mid(pose.neck[0], pose.neck[1]);
  items.push({ depth: view.depth(neckMid) - .02, draw: () => {
    if (ox) {
      // Dewlap curtain under the neck.
      blob(ctx, v3(0, 1.00, .55), .10, .16, shade(pal.coat, -.06), view, W, H, pad);
      blob(ctx, v3(0, .90, .68), .085, .12, shade(pal.coat, -.04), view, W, H, pad);
      blob(ctx, v3(0, .85, .78), .060, .08, shade(pal.coat, -.08), view, W, H, pad);
      const D = view.toScreen(v3(0, .80, .72), W, H, pad);
      speckle(ctx, D.x, D.y, 9 * D.scale, 5 * D.scale, 12, 41, shade(pal.coat, -.28), .5);
    }
    limb(ctx, pose.neck[0], mid(pose.neck[0], pose.neck[1]), (ox ? .125 : .10), pal.coat, view, W, H, pad);
    limb(ctx, mid(pose.neck[0], pose.neck[1]), pose.neck[1], ox ? .105 : .085, pal.coat, view, W, H, pad);
    // Throatlatch groove + crest light.
    limb(ctx, addV(pose.neck[0], v3(0, -.07, .01)), addV(pose.neck[1], v3(0, -.055, .005)), .011, shade(pal.coat, -.28), view, W, H, pad);
    const N0 = view.toScreen(pose.neck[0], W, H, pad), N1 = view.toScreen(pose.neck[1], W, H, pad);
    sheenLine(ctx, N0.x, N0.y, N1.x, N1.y, 3, shade(pal.coat, .30), 1.8, .35);
    ctx.save(); ctx.globalAlpha = .25;
    blob(ctx, v3(0, 1.44, .32), .10, .07, pal.dark, view, W, H, pad);
    ctx.restore();
    if (pose.mane) {
      // The mane falls on the actor's right: full on that side, a hint from
      // front/back, hidden from the far side.
      const show = flank > 0 ? 1 : Math.abs(view.facing) > .6 ? .55 : 0;
      if (show > 0) {
        ctx.save(); ctx.globalAlpha = show;
        for (let i = 0; i < 5; i++) {
          const t = i / 4, c = addV(pose.mane[0], scaleV(subV(pose.mane[1], pose.mane[0]), t));
          limb(ctx, c, addV(c, v3(.055 + (i % 2) * .012, -.13 - (i % 3) * .015, -.030)), .016, i % 2 ? '#2b2015' : '#3d2e1e', view, W, H, pad);
        }
        const M = view.toScreen(mid(pose.mane[0], pose.mane[1]), W, H, pad);
        sheenLine(ctx, M.x - 2, M.y - 8, M.x + 2, M.y + 10, 0, '#6b5638', 1.2, .5);
        ctx.restore();
      } else {
        // Off side: the far mane's top edge peeks over the crest.
        limb(ctx, pose.mane[0], pose.mane[1], .020, '#2b2015', view, W, H, pad);
      }
    }
  } });

  // Head: modelled skull, muzzle, ears, horns/tack; face furniture is gated
  // per side so cheek straps and nostrils never show through the far side.
  items.push({
    depth: view.depth(pose.skull),
    draw: () => {
      if (ox) {
        blob(ctx, pose.skull, .135, .15, shade(pal.coat, -.08), view, W, H, pad);
        // Forehead plane + cheek and jaw modelling.
        blob(ctx, addV(pose.skull, v3(0, .055, .015)), .088, .070, shade(pal.coat, -.01), view, W, H, pad);
        ctx.save(); ctx.globalAlpha = .30;
        blob(ctx, addV(pose.skull, v3(-.085, -.045, -.01)), .045, .075, pal.dark, view, W, H, pad);
        blob(ctx, addV(pose.skull, v3(.085, -.045, -.01)), .045, .075, pal.dark, view, W, H, pad);
        ctx.restore();
        const SK = view.toScreen(pose.skull, W, H, pad);
        speckle(ctx, SK.x, SK.y - 4 * SK.scale, 10 * SK.scale, 6 * SK.scale, 14, 61, shade(pal.coat, -.28), .45);
        blob(ctx, pose.muzzle, .108, .098, pal.muzzle, view, W, H, pad);
        blob(ctx, pose.muzzleTip, .075, .07, shade(pal.muzzle, .05), view, W, H, pad);
        const MT = view.toScreen(pose.muzzleTip, W, H, pad);
        speckle(ctx, MT.x, MT.y, 8 * MT.scale, 6 * MT.scale, 16, 83, '#3a2f22', .5);
        dot(ctx, MT.x - 4 * MT.scale, MT.y - 3 * MT.scale, 1.6, '#9a8871', .7);
        // Chin groove + lips.
        limb(ctx, addV(pose.muzzleTip, v3(0, -.055, .01)), addV(pose.muzzleTip, v3(0, -.075, -.03)), .008, '#4a3d2c', view, W, H, pad);
        // Nostrils with wing shading and wrinkles.
        for (const s of [-1, 1]) {
          const n = addV(pose.muzzleTip, v3(s * .045, .008, .02));
          if (!view.near(n, pose.muzzleTip)) continue;
          blob(ctx, addV(n, v3(s * .012, .012, -.005)), .020, .024, shade(pal.muzzle, -.14), view, W, H, pad);
          blob(ctx, n, .014, .018, '#241d15', view, W, H, pad);
          const NS = view.toScreen(n, W, H, pad);
          dot(ctx, NS.x, NS.y - 1, .9, '#0d0a07', .9);
          sheenLine(ctx, NS.x - 3, NS.y - 4, NS.x + 3, NS.y - 5, 0, shade(pal.muzzle, -.25), 1, .7);
        }
        // Halter: noseband with stitching, cheek straps, buckles and rings.
        const nbA = addV(pose.muzzle, v3(-.088, .012, -.03)), nbB = addV(pose.muzzle, v3(.088, .012, -.03));
        if (view.near(mid(nbA, nbB), pose.skull)) {
          limb(ctx, nbA, nbB, .012, '#4a3826', view, W, H, pad);
          const NB = view.toScreen(mid(nbA, nbB), W, H, pad);
          for (let i = -4; i <= 4; i++) dot(ctx, NB.x + i * 3 * NB.scale, NB.y, .7, '#8a7154', .9);
        }
        for (const s of [-1, 1]) {
          const top = addV(pose.skull, v3(s * .10, .06, -.07)), bot = addV(pose.muzzle, v3(s * .088, .012, -.03));
          if (!view.near(mid(top, bot), pose.skull)) continue;
          limb(ctx, bot, top, .011, '#4a3826', view, W, H, pad);
          blob(ctx, mid(top, bot), .016, .016, '#8a6d3a', view, W, H, pad);
          const ring = addV(pose.muzzle, v3(s * .105, .008, -.045));
          if (view.near(ring, pose.skull)) {
            blob(ctx, ring, .02, .02, '#5d5344', view, W, H, pad);
            const RS = view.toScreen(ring, W, H, pad);
            dot(ctx, RS.x - 1, RS.y - 1, 1, '#b8ac93', .9);
          }
        }
        // Ears with inner ear and rim light.
        for (const e of pose.ears) {
          blob(ctx, e, .048, .030, shade(pal.coat, -.12), view, W, H, pad);
          blob(ctx, addV(e, v3(0, .004, .012)), .026, .016, '#8a6a52', view, W, H, pad);
          const ES = view.toScreen(e, W, H, pad);
          sheenLine(ctx, ES.x - 4 * ES.scale, ES.y - 1, ES.x + 4 * ES.scale, ES.y - 1, 0, shade(pal.coat, .25), 1, .5);
        }
        // Horns with growth rings, shaded bases and polished tips.
        if (pose.horns) for (const h of pose.horns) {
          blob(ctx, h[0], .030, .030, shade(pal.coat, -.15), view, W, H, pad);
          limb(ctx, h[0], h[1], .024, '#d9cca6', view, W, H, pad);
          limb(ctx, h[1], h[2], .019, '#cbbd97', view, W, H, pad);
          limb(ctx, h[2], h[3], .013, '#b7a67e', view, W, H, pad);
          for (const jp of [h[1], h[2]]) {
            const JS = view.toScreen(jp, W, H, pad);
            sheenLine(ctx, JS.x - 3 * JS.scale, JS.y, JS.x + 3 * JS.scale, JS.y, 0, '#8a7c58', 1.2, .8);
          }
          const TS = view.toScreen(h[3], W, H, pad);
          dot(ctx, TS.x, TS.y, 1.2, '#efe4c4', .9);
          const H0 = view.toScreen(h[0], W, H, pad), H3 = view.toScreen(h[3], W, H, pad);
          sheenLine(ctx, H0.x, H0.y, H3.x, H3.y, 1.5, '#f2ead0', 1.1, .55);
        }
      } else {
        blob(ctx, pose.skull, .10, .155, shade(pal.coat, -.08), view, W, H, pad);
        // Forehead + jaw muscles + nasal shading.
        blob(ctx, addV(pose.skull, v3(0, .06, .01)), .062, .075, shade(pal.coat, -.02), view, W, H, pad);
        ctx.save(); ctx.globalAlpha = .30;
        blob(ctx, addV(pose.skull, v3(-.055, -.07, -.02)), .035, .055, pal.dark, view, W, H, pad);
        blob(ctx, addV(pose.skull, v3(.055, -.07, -.02)), .035, .055, pal.dark, view, W, H, pad);
        ctx.restore();
        limb(ctx, pose.muzzle, pose.muzzleTip, .062, shade(pal.coat, -.08), view, W, H, pad);
        const F0 = view.toScreen(pose.skull, W, H, pad), F1 = view.toScreen(pose.muzzleTip, W, H, pad);
        sheenLine(ctx, F0.x, F0.y, F1.x, F1.y, 2, shade(pal.coat, .25), 1.6, .4);
        blob(ctx, pose.muzzleTip, .052, .055, pal.muzzle, view, W, H, pad);
        const MT = view.toScreen(pose.muzzleTip, W, H, pad);
        speckle(ctx, MT.x, MT.y, 5 * MT.scale, 5 * MT.scale, 10, 89, '#3a2f22', .5);
        // Nostrils, lips and chin.
        for (const s of [-1, 1]) {
          const n = addV(pose.muzzleTip, v3(s * .032, .01, .015));
          if (!view.near(n, pose.muzzleTip)) continue;
          blob(ctx, addV(n, v3(s * .009, .009, -.004)), .016, .019, shade(pal.muzzle, -.14), view, W, H, pad);
          blob(ctx, n, .011, .015, '#241d15', view, W, H, pad);
          const NS = view.toScreen(n, W, H, pad);
          dot(ctx, NS.x, NS.y - 1, .8, '#0d0a07', .9);
        }
        limb(ctx, addV(pose.muzzleTip, v3(-.03, -.038, .01)), addV(pose.muzzleTip, v3(.03, -.038, .01)), .006, '#4a3d2c', view, W, H, pad);
        // Ears with inner ear, darker tips.
        for (const e of pose.ears) {
          blob(ctx, e, .022, .055, shade(pal.coat, -.14), view, W, H, pad);
          blob(ctx, addV(e, v3(0, -.008, .006)), .012, .032, '#8a6a52', view, W, H, pad);
          const ES = view.toScreen(addV(e, v3(0, .045, 0)), W, H, pad);
          dot(ctx, ES.x, ES.y, 1.2, shade(pal.coat, -.30), .8);
        }
        // Forelock falling between the ears.
        for (let i = -1; i <= 1; i++) {
          limb(ctx, addV(pose.skull, v3(i * .02, .10, -.01)), addV(pose.skull, v3(i * .028, .015, .055)), .009, i ? '#2b2015' : '#3d2e1e', view, W, H, pad);
        }
      }
      // Eyes with lids, lashes and catchlights.
      for (const e of pose.eyes) {
        if (!view.near(e, pose.skull)) continue;
        const E = view.toScreen(e, W, H, pad);
        ctx.save(); ctx.globalAlpha = .55; ctx.strokeStyle = shade(pal.coat, -.35); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(E.x, E.y - .5, (ox ? 3.4 : 3) * E.scale, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); ctx.restore();
        blob(ctx, e, ox ? .014 : .012, ox ? .016 : .013, '#1c1710', view, W, H, pad);
        dot(ctx, E.x - 1, E.y - 1.2, 1, '#f4efe4', .95);
        sheenLine(ctx, E.x - 2.5 * E.scale, E.y + 2 * E.scale, E.x + 2.5 * E.scale, E.y + 2 * E.scale, 0, shade(pal.coat, .20), 1, .5);
        if (!ox) {
          for (let L = -1; L <= 1; L++) {
            sheenLine(ctx, E.x + L * 2 * E.scale, E.y - 2.4 * E.scale, E.x + L * 2.6 * E.scale, E.y - 4 * E.scale, 0, '#14100b', .9, .7);
          }
        }
      }
    },
  });

  sortItems(items);
  for (const it of items) it.draw();
}

export const ANIMAL_SHEET = { tileW: 352, tileH: 224, pxPerMeter: 120, worldH: 224 / 120, bottomPad: 6 };

export const animalPalette = (coat: string): AnimalPalette => ({
  coat,
  dark: shade(coat, -.26),
  muzzle: '#6b5b47',
});
