import {
  View, limb, mass, blob, mailPattern, shade, dot, speckle, sheenLine, v3, addV, subV, scaleV, normV, sortItems, relForIndex, type V3, type DrawItem,
} from './sprites';

/**
 * The Wanderer: a fighter in chain mail carrying a greatsword (right hand),
 * a flail (left hip) and two javelins (back). Painted as 16 directions ×
 * (idle, 6 walk, 6 sprint, 1 seated) frames.
 */

export type FighterAction = 'idle' | 'walk' | 'sprint' | 'seated' | 'attack' | 'hit' | 'down';

/** Equipment + portrait variant for the painted fighter (creation choices map here). */
export interface FighterLook {
  skin: string;
  skinShade: string;
  hairColor: string;
  hairStyle: 'short' | 'long' | 'braid';
  helm: boolean;
  mainHand: 'greatsword' | 'longsword' | 'battleaxe' | 'warhammer';
  offHand: 'shield' | 'shortsword' | null;
  bow: boolean;
}
export const DEFAULT_LOOK: FighterLook = {
  skin: '#d9b38c', skinShade: '#b98f66', hairColor: '#4a3524', hairStyle: 'short',
  helm: true, mainHand: 'greatsword', offHand: null, bow: false,
};
export const lookKey = (look: FighterLook): string =>
  [look.skin, look.hairColor, look.hairStyle, look.helm ? 'h' : 'n', look.mainHand, look.offHand ?? 'no', look.bow ? 'b' : 'nb'].join('|');

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

const MAIL = '#8d949c', MAIL_DARK = '#6d747d', MAIL_HI = '#bcc3cb', LEATHER = '#54432e', BOOT = '#463826',
  SKIN = '#d9b38c', SKIN_SH = '#b98f66', STEEL_D = '#7d858e', BLADE_RIDGE = '#eef2f5', BRASS = '#8a6d3a',
  BRASS_HI = '#d8b96a', GAMBE = '#c9b992', GAMBE_D = '#9d8c6c', GAUNT = '#5a4630',
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

/** Shared sword-pose builder for the flourish actions (grip + tip → full SwordPose). */
function flourishSword(grip: V3, tip: V3): SwordPose {
  const dir = normV(subV(tip, grip));
  const hb = normV(v3(tip.x - grip.x, 0, tip.z - grip.z));
  const g = v3(-hb.z, 0, hb.x);
  return {
    grip, tip,
    guardA: addV(grip, scaleV(g, .13)), guardB: subV(grip, scaleV(g, .13)),
    pommel: subV(grip, scaleV(dir, .08)),
  };
}
/** Shared flail + javelins for the flourish actions (keyed sway, no wall clock). */
function flourishGear(hipY: number, bob: number, shZ: number, sway: number): { flailPts: V3[]; flailBall: V3; javA: [V3, V3]; javB: [V3, V3] } {
  const fx = -.15 + sway;
  const flailPts = [v3(fx + .02, hipY - .07, .03), v3(fx, hipY - .22, .05), v3(fx - .02, hipY - .36, .06), v3(fx - .03, hipY - .45, .05)];
  const flailBall = v3(fx - .03, hipY - .52, .05);
  const jz = shZ - .14;
  const javA: [V3, V3] = [v3(-.17, hipY - .02 + bob, jz - .02), v3(.17, hipY + .76 + bob, jz - .16)];
  const javB: [V3, V3] = [v3(.15, hipY - .04 + bob, jz + .05), v3(-.15, hipY + .72 + bob, jz - .11)];
  return { flailPts, flailBall, javA, javB };
}
function flourishLegs(hipL0: V3, hipR0: V3, footL: V3, footR: V3) {
  const kneeL = ik2(hipL0, footL, .46, .44, 1);
  const kneeR = ik2(hipR0, footR, .46, .44, 1);
  const ankleL = v3(footL.x, footL.y + .01, footL.z - .01);
  const ankleR = v3(footR.x, footR.y + .01, footR.z - .01);
  const toeL = v3(footL.x, Math.max(footL.y, .012), footL.z + .125);
  const toeR = v3(footR.x, Math.max(footR.y, .012), footR.z + .125);
  return { kneeL, kneeR, ankleL, ankleR, toeL, toeR };
}

/**
 * Paint-only 4-frame attack flourish (creation preview only — no hit
 * detection, damage, or AI). Keyed from `phase`: 0 windup, 1 slash,
 * 2 follow-through, 3 recover-to-guard.
 */
export function attackPose(phase: number): FighterPose {
  const key = Math.round(phase / (Math.PI * 2) * 4) % 4;
  const hipY = .90, bob = [0.01, -0.02, -0.03, 0][key];
  const leanZ = [0, .08, .05, .02][key];
  const footL = v3(-.16, .01, .18), footR = v3(.16, .01, -.14);
  const hipL = v3(-.09, hipY + bob, 0), hipR = v3(.09, hipY + bob, 0);
  const legs = flourishLegs(hipL, hipR, footL, footR);
  const shY = hipY + .455 + bob, shZ = leanZ;
  const shoulderL = v3(-.175, shY, shZ), shoulderR = v3(.175, shY, shZ);
  const handRs = [v3(.28, 1.42, -.18), v3(-.05, 1.15, .30), v3(-.28, .85, .25), v3(.20, .95, .28)];
  const handLs = [v3(-.25, 1.00, -.05), v3(-.30, .95, .15), v3(-.22, .90, .10), v3(-.225, hipY + .09, .02)];
  const handR = handRs[key], handL = handLs[key];
  const elbowL = ik2(shoulderL, handL, .29, .27, -1);
  const elbowR = ik2(shoulderR, handR, .29, .27, -1);
  const head = v3(0, hipY + .60 + bob, shZ + .01);
  // One-handed slash: tip travels from high-back-right across to low-left.
  const tips = [addV(handR, v3(.17, .48, -.37)), v3(-.55, 1.10, .45), v3(-.35, .55, .30), addV(handR, v3(-.05, -.20, .27))];
  const sword = flourishSword(handR, tips[key]);
  const gear = flourishGear(hipY, bob, shZ, [-.02, .05, .03, 0][key]);
  return {
    action: 'attack', bob, seated: false,
    hipL, hipR, ...legs, shoulderL, shoulderR, elbowL, elbowR, handL, handR, head,
    sword, flailPts: gear.flailPts, flailBall: gear.flailBall, javA: gear.javA, javB: gear.javB,
  };
}

/**
 * Paint-only 2-frame hit reaction (creation preview only): 0 impact
 * (stagger back, blade dragged down), 1 brace-and-recover.
 */
export function hitPose(phase: number): FighterPose {
  const key = phase < Math.PI ? 0 : 1;
  const hipY = key === 0 ? .93 : .95, bob = key === 0 ? -.02 : 0;
  const leanZ = key === 0 ? -.12 : -.03;
  const footL = v3(-.10, .01, .10), footR = key === 0 ? v3(.12, .02, -.25) : v3(.10, .01, -.12);
  const hipL = v3(-.09, hipY + bob, 0), hipR = v3(.09, hipY + bob, 0);
  const legs = flourishLegs(hipL, hipR, footL, footR);
  const shY = hipY + .455 + bob, shZ = leanZ;
  const shoulderL = v3(-.175, shY, shZ), shoulderR = v3(.175, shY, shZ);
  const handR = key === 0 ? v3(.25, .70, 0) : v3(.22, .85, .15);
  const handL = key === 0 ? v3(-.28, 1.05, -.10) : v3(-.24, .95, .05);
  const elbowL = ik2(shoulderL, handL, .29, .27, -1);
  const elbowR = ik2(shoulderR, handR, .29, .27, -1);
  const head = v3(0, hipY + .60 + bob + (key === 0 ? .03 : 0), shZ + (key === 0 ? -.03 : .01));
  const sword = flourishSword(handR, key === 0 ? v3(.45, .10, .20) : v3(.40, .50, .30));
  const gear = flourishGear(hipY, bob, shZ, key === 0 ? -.04 : -.01);
  return {
    action: 'hit', bob, seated: false,
    hipL, hipR, ...legs, shoulderL, shoulderR, elbowL, elbowR, handL, handR, head,
    sword, flailPts: gear.flailPts, flailBall: gear.flailBall, javA: gear.javA, javB: gear.javB,
  };
}

/**
 * Paint-only 1-frame down pose (creation preview only): on one knee,
 * head bowed, sword point grounded.
 */
export function downPose(): FighterPose {
  const hipY = .52, bob = 0;
  const footL = v3(-.10, .01, .28), footR = v3(.16, .10, -.22);
  const hipL = v3(-.09, hipY, 0), hipR = v3(.09, hipY, 0);
  const kneeL = ik2(hipL, footL, .46, .44, 1);
  const kneeR = v3(.14, .06, -.02);
  const ankleL = v3(footL.x, footL.y + .01, footL.z - .01);
  const ankleR = v3(footR.x, footR.y, footR.z + .06);
  const toeL = v3(footL.x, Math.max(footL.y, .012), footL.z + .125);
  const toeR = v3(footR.x, footR.y, footR.z + .02);
  const shY = hipY + .44, shZ = .10;
  const shoulderL = v3(-.175, shY, shZ), shoulderR = v3(.175, shY, shZ);
  const handR = v3(.22, .48, .32), handL = v3(-.14, .30, .16);
  const elbowL = ik2(shoulderL, handL, .29, .27, -1);
  const elbowR = ik2(shoulderR, handR, .29, .27, -1);
  const head = v3(0, hipY + .52, shZ + .06);
  const sword = flourishSword(handR, v3(.28, .02, .44));
  const gear = flourishGear(hipY, bob, shZ, 0);
  return {
    action: 'down', bob, seated: false,
    hipL, hipR, kneeL, kneeR, ankleL, ankleR, toeL, toeR,
    shoulderL, shoulderR, elbowL, elbowR, handL, handR, head,
    sword, flailPts: gear.flailPts, flailBall: gear.flailBall, javA: gear.javA, javB: gear.javB,
  };
}

/**
 * Pure pose math (no DOM). `phase` is the gait phase in radians; `t` a
 * wall-clock value for idle sway. All heights in metres, z = facing.
 */
export function fighterPose(action: FighterAction, phase: number, t: number): FighterPose {
  if (action === 'attack') return attackPose(phase);
  if (action === 'hit') return hitPose(phase);
  if (action === 'down') return downPose();
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
  items.push({
    depth: view.depth(mid(hip, knee)), draw: () => {
      limb(ctx, hip, knee, .072, MAIL, view, W, H, pad);
      // Poleyn: dished steel knee cop with a glint and side wings.
      blob(ctx, knee, .050, .050, STEEL_D, view, W, H, pad);
      const s = view.toScreen(knee, W, H, pad);
      dot(ctx, s.x - 2.4 * s.scale, s.y - 3 * s.scale, 1.5, '#eef2f5', .85);
      sheenLine(ctx, s.x - 6 * s.scale, s.y + 2 * s.scale, s.x - 2 * s.scale, s.y + 5 * s.scale, 0, MAIL_HI, 1.4, .5);
    },
  });
  items.push({
    depth: view.depth(mid(knee, ankle)), draw: () => {
      limb(ctx, knee, ankle, .058, MAIL_DARK, view, W, H, pad);
      // Greave sheen down the shin front.
      const A = view.toScreen(knee, W, H, pad), B = view.toScreen(ankle, W, H, pad);
      sheenLine(ctx, A.x, A.y, B.x, B.y, 2.2, '#d5dbe1', 1.6, .4);
    },
  });
  items.push({
    depth: view.depth(mid(ankle, toe)), draw: () => {
      limb(ctx, ankle, toe, .048, BOOT, view, W, H, pad);
      // Toe cap, heel counter, sole and hobnails.
      blob(ctx, toe, .030, .026, shade(BOOT, .07), view, W, H, pad);
      const A = view.toScreen(v3(ankle.x, .028, ankle.z - .03), W, H, pad);
      const B = view.toScreen(v3(toe.x, .014, toe.z + .03), W, H, pad);
      ctx.save(); ctx.strokeStyle = '#221a10'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.restore();
      sheenLine(ctx, A.x, A.y - 3, B.x, B.y - 3, 0, '#8a6f4d', 1.3, .55);
      const T = view.toScreen(toe, W, H, pad);
      dot(ctx, T.x - 2, T.y + 3, .9, '#151009', .8); dot(ctx, T.x + 2, T.y + 3, .9, '#151009', .8);
    },
  });
}

function arm(ctx: Ctx, view: View, W: number, H: number, pad: number, sh: V3, el: V3, hand: V3, items: DrawItem[]) {
  const mid = (a: V3, b: V3) => v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  items.push({ depth: view.depth(mid(sh, el)) - .01, draw: () => limb(ctx, sh, el, .054, MAIL, view, W, H, pad) });
  items.push({
    depth: view.depth(mid(el, hand)), draw: () => {
      limb(ctx, el, hand, .046, MAIL_DARK, view, W, H, pad);
      // Couter (elbow cop) + vambrace sheen.
      blob(ctx, el, .038, .038, STEEL_D, view, W, H, pad);
      const A = view.toScreen(el, W, H, pad), B = view.toScreen(hand, W, H, pad);
      sheenLine(ctx, A.x, A.y, B.x, B.y, 1.8, '#d5dbe1', 1.3, .38);
    },
  });
  items.push({
    depth: view.depth(hand), draw: () => {
      // Leather gauntlet with steel cuff, knuckle plates and grip shadow.
      blob(ctx, hand, .044, .042, GAUNT, view, W, H, pad);
      const s = view.toScreen(hand, W, H, pad);
      speckle(ctx, s.x, s.y, 4 * s.scale, 3.4 * s.scale, 9, 31, '#2c2114', .5);
      sheenLine(ctx, s.x - 3 * s.scale, s.y - 2 * s.scale, s.x + 3 * s.scale, s.y - 2 * s.scale, 0, '#a07c52', 1.2, .6);
      dot(ctx, s.x, s.y - 1, 1, '#3a2d1d', .7);
    },
  });
  items.push({
    depth: view.depth(sh) - .02, draw: () => {
      // Pauldron: layered lames with rivets and a top glint.
      blob(ctx, v3(sh.x, sh.y + .01, sh.z), .078, .070, MAIL, view, W, H, pad);
      const s = view.toScreen(v3(sh.x, sh.y + .01, sh.z), W, H, pad);
      ctx.save(); ctx.strokeStyle = shade(MAIL, -.20); ctx.lineWidth = 1.3;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath(); ctx.arc(s.x, s.y - 4 * s.scale + i * 5 * s.scale, 8.5 * s.scale, Math.PI * .15, Math.PI * .85); ctx.stroke();
      }
      ctx.restore();
      dot(ctx, s.x - 5 * s.scale, s.y + 1, 1.1, '#3c4147', .9);
      dot(ctx, s.x + 5 * s.scale, s.y + 1, 1.1, '#3c4147', .9);
      dot(ctx, s.x - 2 * s.scale, s.y - 5 * s.scale, 1.4, '#e8edf1', .7);
    },
  });
}

function swordPaint(ctx: Ctx, view: View, W: number, H: number, pad: number, s: SwordPose, kind: FighterLook['mainHand'] = 'greatsword') {
  const blade = () => {
    if (kind === 'battleaxe' || kind === 'warhammer') {
      // Wooden haft from pommel to head.
      limb(ctx, s.pommel, s.tip, kind === 'battleaxe' ? .016 : .018, '#5d4a30', view, W, H, pad);
      const HS = view.toScreen(s.tip, W, H, pad);
      if (kind === 'battleaxe') {
        // Bearded axe head: dark iron wedge with a keen edge.
        const dir = normV(subV(s.tip, s.grip));
        const side = normV(v3(-dir.z, 0, dir.x));
        const edge = [
          addV(s.tip, scaleV(dir, .02)), addV(s.tip, addV(scaleV(side, .13), scaleV(dir, -.02))),
          addV(s.tip, addV(scaleV(side, .11), scaleV(dir, -.17))), addV(s.tip, scaleV(dir, -.19)),
        ];
        mass(ctx, edge, '#3d434a', view, W, H, pad);
        sheenLine(ctx, HS.x - 4, HS.y - 2, HS.x + 6, HS.y + 8, 0, '#dfe5ea', 1.6, .7);
        blob(ctx, s.tip, .022, .022, '#2b2f34', view, W, H, pad);
      } else {
        // Warhammer: heavy iron head with a rear spike.
        blob(ctx, s.tip, .055, .055, '#4a4f55', view, W, H, pad);
        const dir = normV(subV(s.tip, s.grip));
        const back = subV(s.tip, scaleV(dir, .10));
        limb(ctx, s.tip, back, .012, '#33373c', view, W, H, pad);
        dot(ctx, HS.x - 3, HS.y - 4, 1.6, '#dfe5ea', .8);
        speckle(ctx, HS.x, HS.y, 5 * HS.scale, 5 * HS.scale, 8, 41, '#22252a', .5);
      }
      limb(ctx, s.grip, s.pommel, .017, '#3a2d1d', view, W, H, pad);
      const PS = view.toScreen(s.pommel, W, H, pad);
      dot(ctx, PS.x, PS.y, 1.4, '#8a6d3a', .9);
      return;
    }
    const grip = view.toScreen(s.grip, W, H, pad), tip = view.toScreen(s.tip, W, H, pad);
    const d = normV({ x: tip.x - grip.x, y: tip.y - grip.y, z: 0 });
    const narrow = kind === 'longsword' ? .78 : 1;
    const px = -d.y, py = d.x, w = .017 * view.pxPerMeter * narrow;
    const path = new Path2D();
    path.moveTo(grip.x + px * w, grip.y + py * w);
    path.lineTo(tip.x + px * w * .12, tip.y + py * w * .12);
    path.lineTo(tip.x - px * w * .12, tip.y - py * w * .12);
    path.lineTo(grip.x - px * w, grip.y - py * w);
    path.closePath();
    ctx.save();
    ctx.strokeStyle = '#5b6169'; ctx.lineWidth = 1.6; ctx.stroke(path);
    // Lenticular cross-section: dark fuller groove, bright flats, keen edges.
    const across = ctx.createLinearGradient(grip.x - px * w, grip.y - py * w, grip.x + px * w, grip.y + py * w);
    across.addColorStop(0, '#f4f7f9'); across.addColorStop(.28, '#aeb6be');
    across.addColorStop(.5, '#7e878f'); across.addColorStop(.72, '#aeb6be'); across.addColorStop(1, '#f4f7f9');
    ctx.fillStyle = across; ctx.fill(path);
    ctx.save(); ctx.clip(path);
    const along = ctx.createLinearGradient(grip.x, grip.y, tip.x, tip.y);
    along.addColorStop(0, 'rgba(70,78,86,.35)'); along.addColorStop(.35, 'rgba(70,78,86,0)');
    along.addColorStop(1, 'rgba(255,255,255,.18)');
    ctx.fillStyle = along; ctx.fillRect(Math.min(grip.x, tip.x) - w - 2, Math.min(grip.y, tip.y) - 2, Math.abs(tip.x - grip.x) + w * 2 + 4, Math.abs(tip.y - grip.y) + 4);
    ctx.restore();
    ctx.strokeStyle = BLADE_RIDGE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(grip.x, grip.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.restore();
    // Crossguard with finials, spiral-wrapped grip, wheel pommel.
    limb(ctx, s.guardA, s.guardB, .018, BRASS, view, W, H, pad);
    blob(ctx, s.guardA, .020, .020, BRASS_HI, view, W, H, pad);
    blob(ctx, s.guardB, .020, .020, BRASS_HI, view, W, H, pad);
    limb(ctx, s.grip, s.pommel, .019, LEATHER, view, W, H, pad);
    const G = view.toScreen(s.grip, W, H, pad), P = view.toScreen(s.pommel, W, H, pad);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      sheenLine(ctx, G.x + (P.x - G.x) * t - 2, G.y + (P.y - G.y) * t + 2, G.x + (P.x - G.x) * t + 2, G.y + (P.y - G.y) * t - 2, 0, '#2c2114', 1.2, .7);
    }
    blob(ctx, s.pommel, .026, .026, BRASS, view, W, H, pad);
    const PS = view.toScreen(s.pommel, W, H, pad);
    dot(ctx, PS.x - 1.5, PS.y - 1.5, 1.3, BRASS_HI, .9);
  };
  return blade;
}

function javelinPaint(ctx: Ctx, view: View, W: number, H: number, pad: number, [tail, tip]: [V3, V3]) {
  limb(ctx, tail, tip, .011, JAVELIN, view, W, H, pad);
  // Ash grain along the shaft + leather binding below the head.
  const T = view.toScreen(tail, W, H, pad), H0 = view.toScreen(tip, W, H, pad);
  sheenLine(ctx, T.x, T.y, H0.x, H0.y, 1, '#93805c', 1, .55);
  const dir = normV(subV(tip, tail));
  const base = subV(tip, scaleV(dir, .11));
  const side = normV(v3(-dir.z, 0, dir.x));
  const wrap0 = subV(tip, scaleV(dir, .13)), wrap1 = subV(tip, scaleV(dir, .085));
  limb(ctx, wrap0, wrap1, .0135, LEATHER, view, W, H, pad);
  const barb = v3(tip.x, tip.y + .012, tip.z);
  limb(ctx, base, barb, .007, JAVELIN_TIP, view, W, H, pad);
  limb(ctx, addV(base, scaleV(side, .016)), addV(tip, scaleV(side, -.004)), .005, JAVELIN_TIP, view, W, H, pad);
  limb(ctx, addV(base, scaleV(side, -.016)), addV(tip, scaleV(side, .004)), .005, JAVELIN_TIP, view, W, H, pad);
  const HS = view.toScreen(barb, W, H, pad);
  dot(ctx, HS.x, HS.y - 1, 1.1, '#e8edf1', .8);
}

export function paintFighter(ctx: Ctx, view: View, pose: FighterPose, look: FighterLook = DEFAULT_LOOK) {
  const W = 220, H = 270, pad = 8;
  const items: DrawItem[] = [];
  const skin = look.skin || SKIN, skinShade = look.skinShade || SKIN_SH;
  const {
    hipL, hipR, kneeL, kneeR, ankleL, ankleR, toeL, toeR,
    shoulderL, shoulderR, elbowL, elbowR, handL, handR, head,
    sword, flailPts, flailBall, javA, javB, bob,
  } = pose;

  leg(ctx, view, W, H, pad, hipL, kneeL, ankleL, toeL, items);
  leg(ctx, view, W, H, pad, hipR, kneeR, ankleR, toeR, items);
  arm(ctx, view, W, H, pad, shoulderL, elbowL, handL, items);
  arm(ctx, view, W, H, pad, shoulderR, elbowR, handR, items);

  if (!look.bow) {
    // Javelins across the back (legacy Wanderer kit).
    for (const j of [javA, javB]) {
      const mid = v3((j[0].x + j[1].x) / 2, (j[0].y + j[1].y) / 2, (j[0].z + j[1].z) / 2);
      items.push({ depth: view.depth(mid), draw: () => javelinPaint(ctx, view, W, H, pad, j) });
    }
  } else {
    // Longbow + quiver across the back.
    const qMid = v3((javA[0].x + javA[1].x) / 2, (javA[0].y + javA[1].y) / 2, (javA[0].z + javA[1].z) / 2);
    items.push({
      depth: view.depth(qMid), draw: () => {
        limb(ctx, javA[0], javA[1], .034, '#4a3826', view, W, H, pad);
        const rim = view.toScreen(javA[1], W, H, pad);
        dot(ctx, rim.x, rim.y, 3.2, '#2c2114', .9);
        for (let i = 0; i < 3; i++) {
          const t = .86 + i * .04;
          const p = v3(javA[0].x + (javA[1].x - javA[0].x) * t, javA[0].y + (javA[1].y - javA[0].y) * t + .05, javA[0].z + (javA[1].z - javA[0].z) * t);
          blob(ctx, p, .012, .02, i === 1 ? '#b03a2e' : '#d8d2c0', view, W, H, pad);
        }
      },
    });
    const bMid = v3((javB[0].x + javB[1].x) / 2, (javB[0].y + javB[1].y) / 2, (javB[0].z + javB[1].z) / 2);
    items.push({
      depth: view.depth(bMid) - .01, draw: () => {
        const belly = v3(bMid.x, bMid.y, bMid.z - .09);
        limb(ctx, javB[0], belly, .012, '#6b4f2e', view, W, H, pad);
        limb(ctx, belly, javB[1], .012, '#6b4f2e', view, W, H, pad);
        limb(ctx, javB[0], javB[1], .004, '#d8cfb8', view, W, H, pad);
        blob(ctx, belly, .016, .016, '#3a2d1d', view, W, H, pad);
      },
    });
  }

  // Off-hand kit: round shield or a second short blade.
  if (look.offHand === 'shield') {
    const at = v3(handL.x - .07, handL.y + .03, handL.z + .03);
    items.push({
      depth: view.depth(at) + .03, draw: () => {
        blob(ctx, at, .175, .175, '#5a4630', view, W, H, pad);
        blob(ctx, at, .148, .148, '#2c3a5e', view, W, H, pad);
        const s = view.toScreen(at, W, H, pad);
        ctx.save();
        ctx.translate(s.x, s.y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#c9a84c';
        const r = 7.5 * s.scale;
        ctx.fillRect(-r / 2, -r / 2, r, r);
        ctx.restore();
        dot(ctx, s.x, s.y, 2.2, '#2c3a5e', .95);
        blob(ctx, at, .034, .034, '#8d949c', view, W, H, pad);
        dot(ctx, s.x - 2, s.y - 2.5, 1.2, '#eef2f5', .8);
      },
    });
  } else if (look.offHand === 'shortsword') {
    const dirO = normV(v3(-.35, -.8, .4));
    const tipO = addV(handL, scaleV(dirO, .6));
    const sideO = normV(v3(-dirO.z, 0, dirO.x));
    const off: SwordPose = {
      grip: handL, tip: tipO,
      guardA: addV(handL, scaleV(sideO, .09)), guardB: subV(handL, scaleV(sideO, .09)),
      pommel: subV(handL, scaleV(dirO, .06)),
    };
    items.push({ depth: view.depth(handL) + .02, draw: swordPaint(ctx, view, W, H, pad, off, 'longsword') });
  }

  // Chain-mail coif under the helm, with drape folds and a ring texture.
  items.push({
    depth: view.depth(v3(0, head.y - .10, head.z + .01)) - .01, draw: () => {
      blob(ctx, v3(0, head.y - .095, head.z + .005), .095, .10, MAIL_DARK, view, W, H, pad);
      const s = view.toScreen(v3(0, head.y - .095, head.z + .005), W, H, pad);
      const pat = mailPattern(ctx);
      if (pat) {
        ctx.save();
        ctx.beginPath(); ctx.arc(s.x, s.y, 13 * s.scale, 0, Math.PI * 2); ctx.clip();
        ctx.globalAlpha = .5; ctx.fillStyle = pat; ctx.fillRect(s.x - 16 * s.scale, s.y - 16 * s.scale, 32 * s.scale, 32 * s.scale);
        ctx.restore();
      }
      for (const fx of [-.045, 0, .045]) {
        const A = view.toScreen(v3(fx, head.y - .05, head.z + .02), W, H, pad);
        const B = view.toScreen(v3(fx * 1.4, head.y - .16, head.z), W, H, pad);
        sheenLine(ctx, A.x, A.y, B.x, B.y, 0, shade(MAIL_DARK, -.18), 1.6, .55);
      }
    },
  });

  // Torso (hauberk) with mail, folds, belt kit and collar; front kit and the
  // back harness each show only on their own side of the turn.
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
        if (pat) { ctx.save(); ctx.clip(path); ctx.globalAlpha = .5; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.restore(); }
        // Skirt folds: alternating soft shadow and light down the hauberk.
        ctx.save(); ctx.clip(path); ctx.globalAlpha = .30;
        blob(ctx, v3(-.10, hipY + .14 + bob, .03), .028, .13, shade(MAIL, -.22), view, W, H, pad);
        blob(ctx, v3(.105, hipY + .14 + bob, .03), .028, .13, shade(MAIL, -.22), view, W, H, pad);
        ctx.globalAlpha = .22;
        blob(ctx, v3(0, hipY + .16 + bob, .035), .034, .13, MAIL_HI, view, W, H, pad);
        ctx.restore();
        const f = view.facing;
        // Belt wraps all the way round; the kit hangs on the front.
        const bl = v3(-.135, hipY + .045 + bob, .03), br = v3(.135, hipY + .045 + bob, .03);
        limb(ctx, bl, br, .03, LEATHER, view, W, H, pad);
        const BS = view.toScreen(v3(0, hipY + .045 + bob, .03), W, H, pad);
        speckle(ctx, BS.x, BS.y, 16 * BS.scale, 3 * BS.scale, 14, 77, '#2c2114', .5);
        if (f > .15) {
          const buckle = v3(0, hipY + .045 + bob, .14);
          if (view.near(buckle, v3(0, hipY + .045 + bob, 0))) {
            blob(ctx, buckle, .022, .020, BRASS, view, W, H, pad);
            const KS = view.toScreen(buckle, W, H, pad);
            dot(ctx, KS.x - 1.2, KS.y - 1.2, 1.2, BRASS_HI, .9);
          }
          // Belt pouches + dagger sheath on the front hips.
          blob(ctx, v3(-.085, hipY - .01 + bob, .10), .026, .032, shade(LEATHER, -.06), view, W, H, pad);
          blob(ctx, v3(.088, hipY - .012 + bob, .10), .022, .028, shade(LEATHER, .03), view, W, H, pad);
          limb(ctx, v3(.115, hipY + .02 + bob, .09), v3(.125, hipY - .13 + bob, .075), .011, '#3a2d1d', view, W, H, pad);
          // Skirt split above the stride.
          limb(ctx, v3(0, hipY + .10 + bob, .045), v3(0, hipY - .015 + bob, .045), .007, shade(MAIL, -.30), view, W, H, pad);
        }
        if (f < -.15) {
          // Harness: crossed straps and a brass ring on the back.
          limb(ctx, v3(-.14, hipY + .40 + bob, -.06), v3(.13, hipY + .10 + bob, -.05), .014, LEATHER, view, W, H, pad);
          limb(ctx, v3(.14, hipY + .40 + bob, -.06), v3(-.13, hipY + .10 + bob, -.05), .014, LEATHER, view, W, H, pad);
          blob(ctx, v3(0, hipY + .25 + bob, -.075), .020, .020, BRASS, view, W, H, pad);
          const RS = view.toScreen(v3(0, hipY + .25 + bob, -.075), W, H, pad);
          dot(ctx, RS.x, RS.y, 1.4, '#3a2d12', .9);
        }
        // Quilted gambeson collar with stitching, mail above it.
        const cl = v3(-.085, hipY + .475 + bob, .02), cr = v3(.085, hipY + .475 + bob, .02);
        limb(ctx, cl, cr, .030, GAMBE, view, W, H, pad);
        const CS = view.toScreen(v3(0, hipY + .475 + bob, .02), W, H, pad);
        for (let i = -3; i <= 3; i++) dot(ctx, CS.x + i * 3.4 * CS.scale, CS.y, .8, GAMBE_D, .9);
        limb(ctx, v3(-.075, hipY + .50 + bob, .015), v3(.075, hipY + .50 + bob, .015), .018, MAIL_DARK, view, W, H, pad);
        // Armpit shade grounds the arms on both sides.
        ctx.save(); ctx.globalAlpha = .34;
        blob(ctx, v3(-.155, hipY + .40 + bob, .01), .030, .036, shade(MAIL, -.30), view, W, H, pad);
        blob(ctx, v3(.155, hipY + .40 + bob, .01), .030, .036, shade(MAIL, -.30), view, W, H, pad);
        ctx.restore();
      });
    },
  });

  // Flail: linked chain, spiked head with glints.
  items.push({ depth: view.depth(flailBall), draw: () => {
    for (let i = 0; i < flailPts.length - 1; i++) {
      const A = view.toScreen(flailPts[i], W, H, pad), B = view.toScreen(flailPts[i + 1], W, H, pad);
      const links = Math.max(2, Math.round(Math.hypot(B.x - A.x, B.y - A.y) / 4.5));
      for (let L = 0; L < links; L++) {
        const t = (L + .5) / links, x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
        ctx.save(); ctx.translate(x, y); ctx.rotate(L % 2 ? Math.PI / 2.3 : -.2);
        ctx.strokeStyle = '#61666d'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.ellipse(0, 0, 2.4, 1.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    }
    limb(ctx, flailPts[flailPts.length - 1], flailBall, .0085, FLAIL, view, W, H, pad);
    blob(ctx, flailBall, .052, .052, '#565b60', view, W, H, pad);
    const FS = view.toScreen(flailBall, W, H, pad);
    speckle(ctx, FS.x, FS.y, 6 * FS.scale, 6 * FS.scale, 10, 97, '#22252a', .5);
    dot(ctx, FS.x - 2.5 * FS.scale, FS.y - 3 * FS.scale, 1.6, '#dfe5ea', .85);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + .4;
      const dir = v3(Math.cos(a), Math.sin(a), 0);
      const base = addV(flailBall, scaleV(dir, .044)), tipS = addV(flailBall, scaleV(dir, .075));
      limb(ctx, base, tipS, .006, FLAIL, view, W, H, pad);
      const TS = view.toScreen(tipS, W, H, pad);
      dot(ctx, TS.x, TS.y, .9, '#c9d0d6', .8);
    }
  } });

  // Head: helm or hair, plus a face that only shows on the front of the turn.
  items.push({
    depth: view.depth(head),
    draw: () => {
      if (look.helm) {
        blob(ctx, v3(0, head.y + .01, head.z), .112, .122, '#9aa1a8', view, W, H, pad);
        const HS = view.toScreen(v3(0, head.y + .05, head.z), W, H, pad);
        speckle(ctx, HS.x, HS.y, 13 * HS.scale, 10 * HS.scale, 22, 55, '#5c636b', .35);
        dot(ctx, HS.x - 6 * HS.scale, HS.y - 7 * HS.scale, 2, '#eef2f5', .55);
      } else {
        // Unhelmed: hair dome with style-specific falls.
        blob(ctx, v3(0, head.y + .015, head.z), .108, .118, look.hairColor, view, W, H, pad);
        const HS = view.toScreen(v3(0, head.y + .05, head.z), W, H, pad);
        speckle(ctx, HS.x, HS.y, 12 * HS.scale, 9 * HS.scale, 26, 59, shade(look.hairColor, -.25), .5);
        sheenLine(ctx, HS.x - 7 * HS.scale, HS.y - 6 * HS.scale, HS.x + 5 * HS.scale, HS.y - 8 * HS.scale, 0, shade(look.hairColor, .3), 2, .5);
        if (look.hairStyle !== 'short') {
          const hang = look.hairStyle === 'long' ? .20 : .16;
          for (const sx of [-1, 1]) {
            limb(ctx, v3(sx * .095, head.y + .02, head.z - .01), v3(sx * .105, head.y - hang, head.z - .03), look.hairStyle === 'braid' ? .020 : .030, shade(look.hairColor, -.08), view, W, H, pad);
          }
          if (look.hairStyle === 'braid') {
            for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
              const BS = view.toScreen(v3(sx * .10, head.y - .05 - i * .05, head.z - .02), W, H, pad);
              dot(ctx, BS.x, BS.y, 1.2, '#8a6d3a', .9);
            }
          }
        }
      }
      const facePt = v3(0, head.y - .012, head.z + .088);
      const f = view.facing;
      if (f > .1 && view.near(facePt, head)) {
        // Neck shadow, then the face plane with cheek modelling.
        ctx.save(); ctx.globalAlpha = .45;
        blob(ctx, v3(0, head.y - .085, head.z + .045), .055, .035, '#7a5a3c', view, W, H, pad);
        ctx.restore();
        blob(ctx, facePt, .068, .078, skin, view, W, H, pad);
        ctx.save(); ctx.globalAlpha = .28;
        blob(ctx, v3(-.052, head.y - .015, head.z + .075), .020, .045, skinShade, view, W, H, pad);
        blob(ctx, v3(.052, head.y - .015, head.z + .075), .020, .045, skinShade, view, W, H, pad);
        ctx.restore();
        const JS = view.toScreen(v3(0, head.y - .052, head.z + .07), W, H, pad);
        speckle(ctx, JS.x, JS.y, 7 * JS.scale, 4.6 * JS.scale, 30, 71, '#6b4a2e', .5);
        // Brows, then eyes with whites, iris, pupil and catchlight.
        limb(ctx, v3(-.058, head.y + .028, head.z + .095), v3(-.028, head.y + .033, head.z + .10), .007, '#5c452c', view, W, H, pad);
        limb(ctx, v3(.058, head.y + .028, head.z + .095), v3(.028, head.y + .033, head.z + .10), .007, '#5c452c', view, W, H, pad);
        for (const sx of [-1, 1]) {
          const eye = v3(sx * .044, head.y + .008, head.z + .10);
          if (!view.near(eye, head)) continue;
          blob(ctx, eye, .0175, .0145, '#e9e2d4', view, W, H, pad);
          blob(ctx, v3(eye.x, eye.y - .001, eye.z + .004), .0095, .0095, '#4a5a66', view, W, H, pad);
          blob(ctx, v3(eye.x, eye.y - .001, eye.z + .007), .005, .005, '#14161a', view, W, H, pad);
          const ES = view.toScreen(v3(eye.x - .004, eye.y + .003, eye.z + .008), W, H, pad);
          dot(ctx, ES.x, ES.y, .9, '#ffffff', .95);
        }
        const nose = v3(0, head.y - .02, head.z + .112);
        if (view.near(nose, head)) {
          blob(ctx, nose, .014, .017, '#cfa87e', view, W, H, pad);
          const NS = view.toScreen(nose, W, H, pad);
          dot(ctx, NS.x - 1.6, NS.y + 1.6, .8, '#7a5638', .8); dot(ctx, NS.x + 1.6, NS.y + 1.6, .8, '#7a5638', .8);
          sheenLine(ctx, NS.x + 2, NS.y - 3, NS.x + 2.5, NS.y + 2, 0, '#8a6242', 1.1, .6);
        }
        const mouth = v3(0, head.y - .055, head.z + .092);
        if (view.near(mouth, head)) {
          limb(ctx, v3(mouth.x - .018, mouth.y, mouth.z), v3(mouth.x + .018, mouth.y, mouth.z), .006, '#8a5f43', view, W, H, pad);
          const MS = view.toScreen(mouth, W, H, pad);
          dot(ctx, MS.x, MS.y + 2.2, 1, '#a0714f', .6);
        }
        if (f > .3 && look.helm) {
          const nasalA = v3(0, head.y + .055, head.z + .115), nasalB = v3(0, head.y - .012, head.z + .115);
          limb(ctx, nasalA, nasalB, .011, '#7c838b', view, W, H, pad);
          const NA = view.toScreen(nasalA, W, H, pad), NB = view.toScreen(nasalB, W, H, pad);
          sheenLine(ctx, NA.x, NA.y, NB.x, NB.y, 1.4, '#e8edf1', 1, .6);
          const browA = v3(-.068, head.y + .075, head.z + .075), browB = v3(.068, head.y + .075, head.z + .075);
          limb(ctx, browA, browB, .02, '#7c838b', view, W, H, pad);
          for (const rx of [-.045, 0, .045]) {
            const RS = view.toScreen(v3(rx, head.y + .075, head.z + .095), W, H, pad);
            dot(ctx, RS.x, RS.y, 1.1, '#3c4147', .9);
            dot(ctx, RS.x - .4, RS.y - .4, .5, '#e8edf1', .8);
          }
        }
      } else if (Math.abs(f) <= .1) {
        // Pure profile: brow, lashed eye, nose bridge, lips and cheek plane.
        blob(ctx, v3(0, head.y + .004, head.z + .075), .030, .055, shade(skin, -.06), view, W, H, pad);
        blob(ctx, v3(0, head.y + .008, head.z + .10), .013, .011, '#e9e2d4', view, W, H, pad);
        blob(ctx, v3(0, head.y + .008, head.z + .106), .006, .007, '#14161a', view, W, H, pad);
        limb(ctx, v3(0, head.y + .032, head.z + .085), v3(0, head.y + .028, head.z + .115), .007, '#5c452c', view, W, H, pad);
        limb(ctx, v3(0, head.y + .02, head.z + .105), v3(0, head.y - .024, head.z + .120), .010, '#cfa87e', view, W, H, pad);
        blob(ctx, v3(0, head.y - .026, head.z + .118), .012, .010, shade(skin, -.10), view, W, H, pad);
        limb(ctx, v3(0, head.y - .052, head.z + .095), v3(0, head.y - .052, head.z + .108), .005, '#8a5f43', view, W, H, pad);
        const browA = v3(0, head.y + .075, head.z + .045), browB = v3(0, head.y + .072, head.z + .105);
        limb(ctx, browA, browB, .018, '#7c838b', view, W, H, pad);
      } else if (look.helm) {
        // Back of the turn: helm ridge, occipital rivets, longer mail curtain.
        limb(ctx, v3(0, head.y + .125, head.z - .01), v3(0, head.y - .02, head.z - .10), .012, '#7c838b', view, W, H, pad);
        for (const ry of [.06, .01]) {
          const RS = view.toScreen(v3(0, head.y + ry, head.z - .108), W, H, pad);
          dot(ctx, RS.x, RS.y, 1.1, '#3c4147', .9);
        }
        blob(ctx, v3(0, head.y - .16, head.z - .04), .075, .055, MAIL_DARK, view, W, H, pad);
      } else {
        // Back of the turn, unhelmed: hair mass falling past the shoulders.
        blob(ctx, v3(0, head.y - .10, head.z - .06), .085, look.hairStyle === 'short' ? .07 : .13, look.hairColor, view, W, H, pad);
      }
    },
  });

  items.push({ depth: view.depth(sword.grip) + .02, draw: swordPaint(ctx, view, W, H, pad, sword, look.mainHand) });

  sortItems(items);
  for (const it of items) it.draw();
}

export const FIGHTER_SHEET = { tileW: 220, tileH: 270, pxPerMeter: 140, worldH: 270 / 140, bottomPad: 8 };

/** Paint a single front-facing fighter frame (creation preview, portraits). */
export function paintFighterPreview(
  canvas: HTMLCanvasElement, look: FighterLook, direction = 0,
  action: FighterAction = 'idle', frame = 0, frames = 1,
): void {
  canvas.width = FIGHTER_SHEET.tileW;
  canvas.height = FIGHTER_SHEET.tileH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const rel = relForIndex(direction);
  const camX = -Math.sin(rel) * 12, camZ = -Math.cos(rel) * 12;
  const view = new View(0, 0, 0, camX, camZ, FIGHTER_SHEET.pxPerMeter);
  // Same phase convention as buildSheet so flourish keyframes match the atlas.
  view.action = action;
  view.phase = frames > 1 ? (frame / frames) * Math.PI * 2 : 0;
  view.frame = frame;
  view.t = action === 'idle' ? 0.6 : (frames > 1 ? (frame / frames) * 1.05 : 0);
  paintFighter(ctx, view, fighterPose(action, view.phase, view.t), look);
}

// ---------------------------------------------------------------------------
// Runtime actor
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { SpriteActor, buildSheet, type SpriteSheet } from './sprites';

export class FighterActor extends SpriteActor {
  private static sheets = new Map<string, SpriteSheet>();
  private lookCacheKey: string;
  constructor(camera: THREE.Camera, look: FighterLook = DEFAULT_LOOK) {
    super(FighterActor.sheetFor(look), camera, {
      name: 'The Wanderer · chain-mail fighter',
      shadowRadius: .62,
      gaitHz: 2.3,
      sprintHz: 3.3,
    });
    this.lookCacheKey = lookKey(look);
    this.anchor('handL', v3(-.22, 1.0, 0));
    this.anchor('handR', v3(.22, 1.0, 0));
  }
  private static sheetFor(look: FighterLook): SpriteSheet {
    const key = lookKey(look);
    const cached = FighterActor.sheets.get(key);
    if (cached) return cached;
    if (FighterActor.sheets.size > 5) {
      const oldest = FighterActor.sheets.keys().next();
      if (!oldest.done && oldest.value) FighterActor.sheets.delete(oldest.value);
    }
    const sheet = buildSheet({
      ...FIGHTER_SHEET,
      actions: [
        { name: 'idle', frames: 2 },
        { name: 'walk', frames: 6 },
        { name: 'sprint', frames: 6 },
        { name: 'seated', frames: 1 },
        // Paint-only flourish frames (creation preview only; never picked in gameplay).
        { name: 'attack', frames: 4 },
        { name: 'hit', frames: 2 },
        { name: 'down', frames: 1 },
      ],
      paint: (ctx, view) => paintFighter(ctx, view, fighterPose(view.action as FighterAction, view.phase, view.t), look),
    });
    FighterActor.sheets.set(key, sheet);
    return sheet;
  }
  /** Swap equipment/portrait visuals (rebuilds the cached sprite sheet). */
  setLook(look: FighterLook): void {
    const key = lookKey(look);
    if (key === this.lookCacheKey) return;
    this.lookCacheKey = key;
    this.setSheet(FighterActor.sheetFor(look));
  }
  protected applyPose(_state: { seated?: boolean }) {
    const pose = fighterPose(this.currentAction as FighterAction, this.gait, this.clock);
    this.plane.position.y = pose.bob;
    this.setAnchor('handL', pose.handL);
    this.setAnchor('handR', pose.handR);
  }
  dispose() {
    this.anchors.forEach(a => a.removeFromParent());
    super.dispose();
  }
}
