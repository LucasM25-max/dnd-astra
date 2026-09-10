import {
  View, limb, blob, coatPattern, shade, v3, addV, subV, scaleV, sortItems, type V3, type DrawItem,
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
  const ears: [V3, V3] = [subV(skull, v3(earOff.x, earOff.y, -earOff.z)), addV(skull, v3(earOff.x, earOff.y, -earOff.z))];
  const eyeOff = species === 'ox' ? v3(.105, .02, .04) : v3(.07, 0, .05);
  const eyes: [V3, V3] = [subV(skull, v3(eyeOff.x, eyeOff.y, -eyeOff.z)), addV(skull, v3(eyeOff.x, eyeOff.y, -eyeOff.z))];
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

export function paintAnimal(ctx: Ctx, view: View, pose: AnimalPose, pal: AnimalPalette) {
  const W = 352, H = 224, pad = 6;
  const items: DrawItem[] = [];
  const mid = (a: V3, b: V3) => v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  const ox = pose.species === 'ox';

  // Legs (farther legs draw first via sorting).
  for (const leg of pose.legs) {
    items.push({ depth: view.depth(mid(leg.hip, leg.knee)), draw: () => limb(ctx, leg.hip, leg.knee, ox ? .078 : .058, pal.coat, view, W, H, pad) });
    items.push({ depth: view.depth(mid(leg.knee, leg.ankle)), draw: () => limb(ctx, leg.knee, leg.ankle, ox ? .062 : .046, pal.dark, view, W, H, pad) });
    items.push({ depth: view.depth(mid(leg.ankle, leg.toe)), draw: () => limb(ctx, leg.ankle, leg.toe, ox ? .05 : .04, '#2e2820', view, W, H, pad) });
  }

  // Body mass: hull of cross-section samples.
  items.push({
    depth: view.depth(v3(0, 1.05, 0)),
    draw: () => {
      const pts = pose.body.map(p => view.toScreen(p, W, H, pad));
      const path = hullPath(pts);
      const yMin = Math.min(...pts.map(p => p.y)), yMax = Math.max(...pts.map(p => p.y));
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = pal.dark; ctx.lineWidth = 3; ctx.stroke(path);
      const g = ctx.createLinearGradient(0, yMin, 0, yMax);
      g.addColorStop(0, shade(pal.coat, .12)); g.addColorStop(.52, pal.coat); g.addColorStop(1, shade(pal.coat, -.18));
      ctx.fillStyle = g; ctx.fill(path);
      ctx.clip(path);
      const pat = coatPattern(ctx);
      if (pat) { ctx.globalAlpha = .5; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      // Underbelly shade.
      const bellyY = view.toScreen(v3(0, .92, 0), W, H, pad).y;
      const bg = ctx.createLinearGradient(0, bellyY - 14, 0, bellyY + 16);
      bg.addColorStop(0, 'rgba(24,17,10,0)'); bg.addColorStop(1, 'rgba(24,17,10,.28)');
      ctx.fillStyle = bg; ctx.fillRect(0, bellyY - 14, W, 60);
      ctx.restore();
    },
  });

  // Tail.
  items.push({
    depth: view.depth(pose.tail[0]),
    draw: () => {
      for (let i = 0; i < pose.tail.length - 1; i++) limb(ctx, pose.tail[i], pose.tail[i + 1], ox ? .02 : .024, pal.dark, view, W, H, pad);
      blob(ctx, pose.tail[pose.tail.length - 1], ox ? .03 : .045, ox ? .045 : .05, pal.dark, view, W, H, pad);
    },
  });

  // Neck.
  const neckMid = mid(pose.neck[0], pose.neck[1]);
  items.push({ depth: view.depth(neckMid) - .02, draw: () => {
    limb(ctx, pose.neck[0], mid(pose.neck[0], pose.neck[1]), (ox ? .125 : .10), pal.coat, view, W, H, pad);
    limb(ctx, mid(pose.neck[0], pose.neck[1]), pose.neck[1], ox ? .105 : .085, pal.coat, view, W, H, pad);
    if (pose.mane) limb(ctx, pose.mane[0], pose.mane[1], .048, '#33261a', view, W, H, pad);
  } });

  // Head.
  items.push({
    depth: view.depth(pose.skull),
    draw: () => {
      if (ox) {
        blob(ctx, pose.skull, .135, .15, shade(pal.coat, -.08), view, W, H, pad);
        blob(ctx, pose.muzzle, .108, .098, pal.muzzle, view, W, H, pad);
        blob(ctx, pose.muzzleTip, .075, .07, pal.muzzle, view, W, H, pad);
        // Nostrils.
        for (const s of [-1, 1]) {
          const n = addV(pose.muzzleTip, v3(s * .045, .008, .02));
          if (view.near(n, pose.muzzleTip)) blob(ctx, n, .014, .018, '#241d15', view, W, H, pad);
        }
        // Halter: noseband + cheek straps + rings.
        const nbA = addV(pose.muzzle, v3(-.088, .012, -.03)), nbB = addV(pose.muzzle, v3(.088, .012, -.03));
        limb(ctx, nbA, nbB, .012, '#4a3826', view, W, H, pad);
        for (const s of [-1, 1]) {
          limb(ctx, addV(pose.muzzle, v3(s * .088, .012, -.03)), addV(pose.skull, v3(s * .10, .06, -.07)), .011, '#4a3826', view, W, H, pad);
          const ring = addV(pose.muzzle, v3(s * .105, .008, -.045));
          if (view.near(ring, pose.skull)) blob(ctx, ring, .02, .02, '#5d5344', view, W, H, pad);
        }
        // Ears.
        for (const e of pose.ears) blob(ctx, e, .048, .03, shade(pal.coat, -.12), view, W, H, pad);
        // Horns.
        if (pose.horns) for (const h of pose.horns) {
          limb(ctx, h[0], h[1], .024, '#d9cca6', view, W, H, pad);
          limb(ctx, h[1], h[2], .019, '#cbbd97', view, W, H, pad);
          limb(ctx, h[2], h[3], .013, '#b7a67e', view, W, H, pad);
        }
      } else {
        blob(ctx, pose.skull, .10, .155, shade(pal.coat, -.08), view, W, H, pad);
        limb(ctx, pose.muzzle, pose.muzzleTip, .062, shade(pal.coat, -.08), view, W, H, pad);
        blob(ctx, pose.muzzleTip, .052, .055, pal.muzzle, view, W, H, pad);
        for (const s of [-1, 1]) {
          const n = addV(pose.muzzleTip, v3(s * .032, .01, .015));
          if (view.near(n, pose.muzzleTip)) blob(ctx, n, .011, .015, '#241d15', view, W, H, pad);
        }
        for (const e of pose.ears) blob(ctx, e, .022, .055, shade(pal.coat, -.14), view, W, H, pad);
      }
      for (const e of pose.eyes) {
        if (view.near(e, pose.skull)) {
          blob(ctx, e, ox ? .014 : .012, ox ? .016 : .013, '#1c1710', view, W, H, pad);
          blob(ctx, addV(e, v3(0, .005, .004)), .004, .004, '#8d8577', view, W, H, pad);
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
