import {
  View, limb, mass, blob, mailPattern, shade, v3, addV, subV, scaleV, normV, sortItems, type V3, type DrawItem,
} from './sprites';

/**
 * The Wanderer: a fighter in chain mail carrying a greatsword (right hand),
 * a flail (left hip) and two javelins (back). Painted as 16 directions ×
 * (idle, 6 walk, 6 sprint, 1 seated) frames.
 */

export type FighterAction = 'idle' | 'walk' | 'sprint' | 'seated';

export interface SwordPose { grip: V3; pommel: V3; tip: V3; guardA: V3; guardB: V3 }

export interface FighterPose {
  action: FighterAction;
  bob: number;
  hipL: V3; hipR: V3; kneeL: V3; kneeR: V3; ankleL: V3; ankleR: V3; toeL: V3; toeR: V3;
  shoulderL: V3; shoulderR: V3; elbowL: V3; elbowR: V3; handL: V3; handR: V3;
  head: V3;
  sword: SwordPose;
  flailPts: V3[]; flailBall: V3;
  javA: [V3, V3]; javB: [V3, V3];
  seated: boolean;
}

const MAIL = '#8d949c', MAIL_DARK = '#6d747d', LEATHER = '#54432e', BOOT = '#463826',
  SKIN = '#d9b38c', STEEL = '#c6cdd4', BLADE_RIDGE = '#eef2f5', BRASS = '#8a6d3a',
  JAVELIN = '#74603f', JAVELIN_TIP = '#9aa2a8', FLAIL = '#4a4f55';

/** Two-bone IK in the character's y-z plane. `bend` +1 → knee/forward, −1 → elbow/back. */
function ik2(upper: V3, lower: V3, l1: number, l2: number, bend: 1 | -1): V3 {
  let dy = lower.y - upper.y, dz = lower.z - upper.z;
  let d = Math.hypot(dy, dz);
  const maxD = l1 + l2 - 1e-4;
  if (d > maxD) { dy *= maxD / d; dz *= maxD / d; d = maxD; }
  d = Math.max(d, 1e-4);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const uy = dy / d, uz = dz / d;
  const py = bend === 1 ? uz : -uz, pz = bend === 1 ? -uy : uy;
  return v3(upper.x, upper.y + a * uy + h * py, upper.z + a * uz + h * pz);
}

/**
 * Pure pose math (no DOM). `phase` is the gait phase in radians; `t` a
 * wall-clock value for idle sway. All heights in metres, z = facing.
 */
export function fighterPose(action: FighterAction, phase: number, t: number): FighterPose {
  const seated = action === 'seated';
  const hipY = seated ? .055 : .97;
  const sinP = Math.sin(phase), cosP = Math.cos(phase);
  let bob = 0, leanZ = 0, leanY = 0;

  const stride = action === 'sprint' ? .44 : .30;
  const lift = action === 'sprint' ? .16 : .10;
  if (action === 'walk') { bob = Math.abs(cosP) * .026; leanZ = .02; }
  if (action === 'sprint') { bob = Math.abs(cosP) * .05; leanZ = .10; leanY = -.025; }
  if (action === 'idle') bob = Math.sin(t * 1.6) * .011;

  const hipL0 = v3(-.09, hipY, 0), hipR0 = v3(.09, hipY, 0);
  let footL: V3, footR: V3;
  if (seated) { footL = v3(-.10, .012, .40); footR = v3(.10, .012, .40); }
  else if (action === 'idle') { footL = v3(-.10, .01, .05); footR = v3(.10, .01, -.03); }
  else {
    footL = v3(-.09, lift * Math.max(0, cosP), stride * sinP);
    footR = v3(.09, lift * Math.max(0, -cosP), -stride * sinP);
  }
  const hipL = addV(hipL0, v3(0, bob, 0)), hipR = addV(hipR0, v3(0, bob, 0));
  const kneeL = ik2(hipL, footL, seated ? .34 : .46, seated ? .34 : .44, 1);
  const kneeR = ik2(hipR, footR, seated ? .34 : .46, seated ? .34 : .44, 1);
  const ankleL = v3(footL.x, footL.y + .01, footL.z - .01);
  const ankleR = v3(footR.x, footR.y + .01, footR.z - .01);
  const toeL = v3(footL.x, Math.max(footL.y, .012), footL.z + .125);
  const toeR = v3(footR.x, Math.max(footR.y, .012), footR.z + .125);

  const shY = hipY + .455 + bob + leanY, shZ = leanZ;
  const shoulderL = v3(-.175, shY, shZ), shoulderR = v3(.175, shY, shZ);
  let handL: V3, handR: V3;
  if (seated) { handL = v3(-.16, hipY + .44 + bob, .24); handR = v3(.16, hipY + .44 + bob, .24); }
  else if (action === 'idle') { handL = v3(-.225, hipY + .02 + bob, .02); handR = v3(.205, .86 + bob, .12); }
  else if (action === 'walk') {
    handL = v3(-.225, hipY + .02 + bob + Math.abs(sinP) * .02, .02 - .10 * sinP);
    handR = v3(.205, .86 + bob + Math.abs(cosP) * .015, .12 + .03 * sinP);
  } else {
    handL = v3(-.21, hipY + .01 + bob - .06 * Math.cos(phase + Math.PI), leanZ + .20 * Math.sin(phase + Math.PI));
    handR = v3(.16, 1.00 + bob, leanZ - .12);
  }
  const elbowL = ik2(shoulderL, handL, .29, .27, -1);
  const elbowR = ik2(shoulderR, handR, .29, .27, -1);

  const head = v3(0, hipY + .60 + bob, shZ + .01);

  // Greatsword.
  let sword: SwordPose;
  const guardDir = (grip: V3, tip: V3): [V3, V3] => {
    const hb = normV(v3(tip.x - grip.x, 0, tip.z - grip.z));
    const g = v3(-hb.z, 0, hb.x);
    return [addV(grip, scaleV(g, .13)), subV(grip, scaleV(g, .13))];
  };
  if (seated) {
    // Resting across the bench in front of the seat, tip pointing ahead.
    const grip = v3(-.34, .05, .30), tip = addV(grip, scaleV(normV(v3(.99, -.02, .13)), 1.02));
    const [guardA, guardB] = guardDir(grip, tip);
    sword = { grip, tip, guardA, guardB, pommel: subV(grip, scaleV(normV(subV(tip, grip)), .08)) };
  } else if (action === 'sprint') {
    const grip = handR, dir = normV(v3(.15, .80, -.58));
    const tip = addV(grip, scaleV(dir, 1.02));
    const hb = normV(v3(tip.x - grip.x, 0, tip.z - grip.z));
    const g = v3(-hb.z, 0, hb.x);
    sword = { grip, tip, guardA: addV(grip, scaleV(g, .13)), guardB: subV(grip, scaleV(g, .13)), pommel: subV(grip, scaleV(normV(subV(tip, grip)), .08)) };
  } else {
    // Low carry: the 1.02 m blade trails down and out to rest on the ground.
    const grip = handR;
    const dir = normV(v3(.35, -.82, .50 + (action === 'walk' ? .03 * sinP : 0)));
    const tip = addV(grip, scaleV(dir, 1.02));
    const [guardA, guardB] = guardDir(grip, tip);
    sword = { grip, tip, guardA, guardB, pommel: subV(grip, scaleV(normV(subV(tip, grip)), .08)) };
  }

  // Flail hanging from the left hip.
  const fx = -.15 - Math.sin(t * 1.7) * .012;
  const flailPts = [v3(fx + .02, hipY - .07, .03), v3(fx, hipY - .22, .05), v3(fx - .02, hipY - .36, .06), v3(fx - .03, hipY - .45, .05)];
  let flailBall = v3(fx - .03, hipY - .52, .05);
  if (seated) {
    for (let i = 0; i < flailPts.length; i++) { const p = flailPts[i]; flailPts[i] = v3(p.x - .12, p.y - .06, p.z + .10); }
    flailBall = v3(flailBall.x - .12, flailBall.y - .06, flailBall.z + .10);
  }

  // Javelins crossed diagonally across the back (tails low and wide, tips
  // high on opposite shoulders so both shafts stay readable).
  const jz = shZ - .14;
  const javA: [V3, V3] = [v3(-.17, hipY - .02 + bob, jz - .02), v3(.17, hipY + .76 + bob, jz - .16)];
  const javB: [V3, V3] = [v3(.15, hipY - .04 + bob, jz + .05), v3(-.15, hipY + .72 + bob, jz - .11)];

  return {
    action, bob, seated,
    hipL, hipR, kneeL, kneeR, ankleL, ankleR, toeL, toeR,
    shoulderL, shoulderR, elbowL, elbowR, handL, handR, head,
    sword, flailPts, flailBall, javA, javB,
  };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

function leg(ctx: Ctx, view: View, W: number, H: number, pad: number, hip: V3, knee: V3, ankle: V3, toe: V3, items: DrawItem[]) {
  const mid = (a: V3, b: V3) => v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  items.push({ depth: view.depth(mid(hip, knee)), draw: () => limb(ctx, hip, knee, .072, MAIL, view, W, H, pad) });
  items.push({ depth: view.depth(mid(knee, ankle)), draw: () => limb(ctx, knee, ankle, .058, MAIL_DARK, view, W, H, pad) });
  items.push({ depth: view.depth(mid(ankle, toe)), draw: () => limb(ctx, ankle, toe, .048, BOOT, view, W, H, pad) });
}

function arm(ctx: Ctx, view: View, W: number, H: number, pad: number, sh: V3, el: V3, hand: V3, items: DrawItem[]) {
  const mid = (a: V3, b: V3) => v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  items.push({ depth: view.depth(mid(sh, el)) - .01, draw: () => limb(ctx, sh, el, .054, MAIL, view, W, H, pad) });
  items.push({ depth: view.depth(mid(el, hand)), draw: () => limb(ctx, el, hand, .046, MAIL_DARK, view, W, H, pad) });
  items.push({ depth: view.depth(hand), draw: () => blob(ctx, hand, .042, .042, SKIN, view, W, H, pad) });
  items.push({ depth: view.depth(sh) - .02, draw: () => blob(ctx, v3(sh.x, sh.y + .01, sh.z), .078, .07, MAIL, view, W, H, pad) });
}

function swordPaint(ctx: Ctx, view: View, W: number, H: number, pad: number, s: SwordPose) {
  const blade = () => {
    const grip = view.toScreen(s.grip, W, H, pad), tip = view.toScreen(s.tip, W, H, pad);
    const ga = view.toScreen(s.guardA, W, H, pad), gb = view.toScreen(s.guardB, W, H, pad);
    const d = normV({ x: tip.x - grip.x, y: tip.y - grip.y, z: 0 });
    const px = -d.y, py = d.x, w = .017 * view.pxPerMeter;
    const path = new Path2D();
    path.moveTo(grip.x + px * w, grip.y + py * w);
    path.lineTo(tip.x + px * w * .12, tip.y + py * w * .12);
    path.lineTo(tip.x - px * w * .12, tip.y - py * w * .12);
    path.lineTo(grip.x - px * w, grip.y - py * w);
    path.closePath();
    ctx.save();
    ctx.strokeStyle = '#5b6169'; ctx.lineWidth = 2; ctx.stroke(path);
    const g = ctx.createLinearGradient(grip.x, grip.y, tip.x, tip.y);
    g.addColorStop(0, '#aab3bc'); g.addColorStop(.5, STEEL); g.addColorStop(1, '#b9c2ca');
    ctx.fillStyle = g; ctx.fill(path);
    ctx.strokeStyle = BLADE_RIDGE; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(grip.x, grip.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.restore();
    // Guard, grip, pommel.
    limb(ctx, s.guardA, s.guardB, .02, BRASS, view, W, H, pad);
    limb(ctx, s.grip, s.pommel, .019, LEATHER, view, W, H, pad);
    blob(ctx, s.pommel, .024, .024, BRASS, view, W, H, pad);
    void ga; void gb;
  };
  return blade;
}

function javelinPaint(ctx: Ctx, view: View, W: number, H: number, pad: number, [tail, tip]: [V3, V3]) {
  limb(ctx, tail, tip, .011, JAVELIN, view, W, H, pad);
  const dir = normV(subV(tip, tail));
  const base = subV(tip, scaleV(dir, .11));
  const side = normV(v3(-dir.z, 0, dir.x));
  const barb = v3(tip.x, tip.y + .012, tip.z);
  limb(ctx, base, barb, .007, JAVELIN_TIP, view, W, H, pad);
  limb(ctx, addV(base, scaleV(side, .016)), addV(tip, scaleV(side, -.004)), .005, JAVELIN_TIP, view, W, H, pad);
  limb(ctx, addV(base, scaleV(side, -.016)), addV(tip, scaleV(side, .004)), .005, JAVELIN_TIP, view, W, H, pad);
}

export function paintFighter(ctx: Ctx, view: View, pose: FighterPose) {
  const W = 220, H = 270, pad = 8;
  const items: DrawItem[] = [];
  const {
    hipL, hipR, kneeL, kneeR, ankleL, ankleR, toeL, toeR,
    shoulderL, shoulderR, elbowL, elbowR, handL, handR, head,
    sword, flailPts, flailBall, javA, javB, bob,
  } = pose;

  leg(ctx, view, W, H, pad, hipL, kneeL, ankleL, toeL, items);
  leg(ctx, view, W, H, pad, hipR, kneeR, ankleR, toeR, items);
  arm(ctx, view, W, H, pad, shoulderL, elbowL, handL, items);
  arm(ctx, view, W, H, pad, shoulderR, elbowR, handR, items);

  // Javelins across the back.
  for (const j of [javA, javB]) {
    const mid = v3((j[0].x + j[1].x) / 2, (j[0].y + j[1].y) / 2, (j[0].z + j[1].z) / 2);
    items.push({ depth: view.depth(mid), draw: () => javelinPaint(ctx, view, W, H, pad, j) });
  }

  // Chain-mail coif under the helm.
  items.push({ depth: view.depth(v3(0, head.y - .10, head.z + .01)) - .01, draw: () =>
    blob(ctx, v3(0, head.y - .095, head.z + .005), .095, .10, MAIL_DARK, view, W, H, pad) });

  // Torso (hauberk).
  const hipY = pose.seated ? .055 : .97;
  const torso: V3[] = [
    v3(-.19, hipY + .46 + bob, .01), v3(.19, hipY + .46 + bob, .01),
    v3(.165, hipY + .30 + bob, .02), v3(.115, hipY + .09 + bob, .02), v3(.135, hipY - .015 + bob, .03),
    v3(-.135, hipY - .015 + bob, .03), v3(-.115, hipY + .09 + bob, .02), v3(-.165, hipY + .30 + bob, .02),
  ];
  items.push({
    depth: view.depth(v3(0, hipY + .25, .02)),
    draw: () => {
      mass(ctx, torso, MAIL, view, W, H, pad, path => {
        const pat = mailPattern(ctx);
        if (pat) { ctx.save(); ctx.clip(path); ctx.globalAlpha = .4; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.restore(); }
        // Belt + buckle.
        const bl = v3(-.135, hipY + .045 + bob, .03), br = v3(.135, hipY + .045 + bob, .03);
        limb(ctx, bl, br, .03, LEATHER, view, W, H, pad);
        const buckle = v3(0, hipY + .045 + bob, .14);
        if (view.near(buckle, v3(0, hipY + .045 + bob, 0))) blob(ctx, buckle, .022, .02, BRASS, view, W, H, pad);
        // Collar.
        const cl = v3(-.085, hipY + .475 + bob, .02), cr = v3(.085, hipY + .475 + bob, .02);
        limb(ctx, cl, cr, .026, MAIL_DARK, view, W, H, pad);
      });
    },
  });

  // Flail.
  items.push({ depth: view.depth(flailBall), draw: () => {
    for (let i = 0; i < flailPts.length - 1; i++) limb(ctx, flailPts[i], flailPts[i + 1], .0085, FLAIL, view, W, H, pad);
    limb(ctx, flailPts[flailPts.length - 1], flailBall, .0085, FLAIL, view, W, H, pad);
    blob(ctx, flailBall, .052, .052, '#565b60', view, W, H, pad);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + .4;
      limb(ctx, flailBall, v3(flailBall.x + Math.cos(a) * .062, flailBall.y + Math.sin(a) * .062, flailBall.z), .007, FLAIL, view, W, H, pad);
    }
  } });

  // Head + helm.
  items.push({
    depth: view.depth(head),
    draw: () => {
      blob(ctx, v3(0, head.y + .01, head.z), .112, .122, '#9aa1a8', view, W, H, pad);
      const facePt = v3(0, head.y - .012, head.z + .088);
      const f = view.facing;
      if (f > .1 && view.near(facePt, head)) {
        blob(ctx, facePt, .068, .078, SKIN, view, W, H, pad);
        // Shaved-stubble shade on the jaw.
        ctx.save(); ctx.globalAlpha = .25;
        blob(ctx, v3(0, head.y - .052, head.z + .07), .05, .04, '#8a6a4a', view, W, H, pad);
        ctx.restore();
        const eyeL = v3(-.042, head.y + .008, head.z + .10), eyeR = v3(.042, head.y + .008, head.z + .10);
        if (view.near(eyeL, head)) blob(ctx, eyeL, .0115, .013, '#20242a', view, W, H, pad);
        if (view.near(eyeR, head)) blob(ctx, eyeR, .0115, .013, '#20242a', view, W, H, pad);
        const nose = v3(0, head.y - .02, head.z + .112);
        if (view.near(nose, head)) blob(ctx, nose, .014, .016, '#cfa87e', view, W, H, pad);
        const mouth = v3(0, head.y - .055, head.z + .092);
        if (view.near(mouth, head)) limb(ctx, v3(mouth.x - .018, mouth.y, mouth.z), v3(mouth.x + .018, mouth.y, mouth.z), .006, '#8a5f43', view, W, H, pad);
        if (f > .3) {
          const nasalA = v3(0, head.y + .055, head.z + .115), nasalB = v3(0, head.y - .012, head.z + .115);
          limb(ctx, nasalA, nasalB, .011, '#7c838b', view, W, H, pad);
          const browA = v3(-.068, head.y + .075, head.z + .075), browB = v3(.068, head.y + .075, head.z + .075);
          limb(ctx, browA, browB, .02, '#7c838b', view, W, H, pad);
        }
      } else if (Math.abs(f) <= .1) {
        // Pure profile: the face plane is edge-on, so only an eye slit and
        // the nose bump survive on the silhouette.
        blob(ctx, v3(0, head.y + .006, head.z + .104), .012, .016, '#20242a', view, W, H, pad);
        blob(ctx, v3(0, head.y - .024, head.z + .118), .016, .018, shade(SKIN, -.14), view, W, H, pad);
      }
    },
  });

  items.push({ depth: view.depth(sword.grip) + .02, draw: swordPaint(ctx, view, W, H, pad, sword) });

  sortItems(items);
  for (const it of items) it.draw();
}

export const FIGHTER_SHEET = { tileW: 220, tileH: 270, pxPerMeter: 140, worldH: 270 / 140, bottomPad: 8 };

// ---------------------------------------------------------------------------
// Runtime actor
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { SpriteActor, buildSheet, type SpriteSheet } from './sprites';

export class FighterActor extends SpriteActor {
  private static sheet: SpriteSheet | null = null;
  constructor(camera: THREE.Camera) {
    if (!FighterActor.sheet) {
      FighterActor.sheet = buildSheet({
        ...FIGHTER_SHEET,
        actions: [
          { name: 'idle', frames: 2 },
          { name: 'walk', frames: 6 },
          { name: 'sprint', frames: 6 },
          { name: 'seated', frames: 1 },
        ],
        paint: (ctx, view) => paintFighter(ctx, view, fighterPose(view.action as FighterAction, view.phase, view.t)),
      });
    }
    super(FighterActor.sheet, camera, {
      name: 'The Wanderer · chain-mail fighter',
      shadowRadius: .62,
      gaitHz: 2.3,
      sprintHz: 3.3,
    });
    this.anchor('handL', v3(-.22, 1.0, 0));
    this.anchor('handR', v3(.22, 1.0, 0));
  }
  protected applyPose(_state: { seated?: boolean }) {
    const pose = fighterPose(this.actionName as FighterAction, this.gait, this.clock);
    this.plane.position.y = pose.bob;
    this.setAnchor('handL', pose.handL);
    this.setAnchor('handR', pose.handR);
  }
  dispose() {
    this.anchors.forEach(a => a.removeFromParent());
    super.dispose();
  }
}
