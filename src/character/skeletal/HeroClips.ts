import * as THREE from 'three';
import { BONE_NAMES, type BoneName, type HeroRig } from './HeroRig';

/**
 * Procedural hero animation: every clip is authored as eased pose keys
 * (Euler degrees per bone + a hips root offset) and sampled at 30 fps into
 * real THREE.AnimationClips played by an AnimationMixer.
 *
 * Conventions (hero faces +Z, Y up, bind rotations identity; the R bones
 * sit at -X, which is the anatomical right of a fighter facing the viewer):
 * - limbs hanging down swing FORWARD with negative X, BACKWARD with positive X
 * - torso/head pitch forward with positive X, arch back with negative X
 * - right-arm abduction (out to -X) is negative Z; left arm mirrors positive
 * - elbow flexion is negative X (forearm forward); knee flexion is positive X
 * - chest twist toward the hero's own right (-X) is negative Y
 *
 * NO-COMBAT: attack / hit / death exist for the creation-preview flourish
 * buttons ONLY. Gameplay code plays locomotion + one-shots through
 * SkeletalCharacterModel, which rejects preview-only names (tested). The
 * salute is a non-combat ceremonial emote, safe in both contexts.
 */

export type ClipName =
  | 'idle'
  | 'idle_dual'
  | 'idle_bow'
  | 'walk'
  | 'run'
  | 'attack_slash_1h'
  | 'thrust_1h'
  | 'slash_2h'
  | 'dual_strike'
  | 'bow_draw'
  | 'dodge_roll'
  | 'hit_react'
  | 'death'
  | 'interact'
  | 'tie_knot'
  | 'second_wind'
  | 'long_rest_sit'
  | 'stand_up'
  | 'sit_chair'
  | 'stand_chair'
  | 'idle_drawn'
  | 'draw'
  | 'sheathe'
  | 'salute';

export const PREVIEW_ONLY_CLIPS: ReadonlySet<ClipName> = new Set([
  'attack_slash_1h',
  'thrust_1h',
  'slash_2h',
  'dual_strike',
  'bow_draw',
  'dodge_roll',
  'hit_react',
  'death',
]);

export type EaseName = 'linear' | 'smooth' | 'in' | 'out' | 'inout';
export type Pose = Partial<Record<BoneName, [number, number, number]>>;

export interface ClipKey {
  t: number;
  pose: Pose;
  /** Hips offset from bind (metres). Defaults to [0, 0, 0]. */
  root?: [number, number, number];
  /** Easing of the transition INTO this key. Defaults to 'smooth'. */
  ease?: EaseName;
}

export interface ClipDef {
  name: ClipName;
  duration: number;
  loop: boolean;
  previewOnly: boolean;
  keys: ClipKey[];
}

const D2R = Math.PI / 180;

function ease(name: EaseName, t: number): number {
  switch (name) {
    case 'linear':
      return t;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - (1 - t) * (1 - t) * (1 - t);
    case 'inout':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'smooth':
    default:
      return t * t * (3 - 2 * t);
  }
}

// --- Pose fragments (shared stance pieces, tuned against screenshots) ---

const RELAXED_ARMS: Pose = {
  UpperArmL: [0, 0, 6],
  LowerArmL: [-26, 0, 0],
  UpperArmR: [2, 0, -9],
  LowerArmR: [-16, 0, 0],
};

const DUAL_ARMS: Pose = {
  UpperArmL: [-6, 0, 9],
  LowerArmL: [-22, 0, 0],
  HandL: [0, 0, 10],
  UpperArmR: [-6, 0, -9],
  LowerArmR: [-22, 0, 0],
  HandR: [0, 0, -10],
};

const SIT_POSE: Pose = {
  UpperLegL: [-78, 0, 16],
  LowerLegL: [108, 0, 0],
  FootL: [42, 0, 0],
  UpperLegR: [-78, 0, -16],
  LowerLegR: [108, 0, 0],
  FootR: [42, 0, 0],
  Spine: [4, 0, 0],
  Chest: [5, 0, 0],
  Head: [10, 0, 0],
  UpperArmL: [-32, 0, 8],
  LowerArmL: [-28, 0, 0],
  UpperArmR: [-32, 0, -8],
  LowerArmR: [-28, 0, 0],
};

// --- Clip catalogue ---

function idleClip(name: 'idle' | 'idle_dual' | 'idle_bow' | 'idle_drawn', arms: Pose, breathe: number, sway: number): ClipDef {
  const keys: ClipKey[] = [0, 1, 2, 3].map(i => {
    const phase = (i / 4) * Math.PI * 2;
    const br = Math.sin(phase);
    const sw = Math.sin(phase + Math.PI / 3);
    return {
      t: i,
      root: [sw * 0.008 * sway, br * 0.011 * breathe, 0],
      pose: {
        ...arms,
        Chest: [1.2 + br * 1.4 * breathe, sw * 1.5 * sway, sw * 1.2 * sway],
        Spine: [0.6 + br * 0.6, 0, 0],
        Head: [br * 1.2, sw * 4 * sway, sw * 1.5],
        UpperArmL: [arms.UpperArmL?.[0] ?? 0, 0, (arms.UpperArmL?.[2] ?? 0) + sw * 1.2],
        UpperArmR: [arms.UpperArmR?.[0] ?? 0, 0, (arms.UpperArmR?.[2] ?? 0) - sw * 1.2],
      },
    };
  });
  return { name, duration: 4, loop: true, previewOnly: false, keys };
}

// --- Parametric gait model ------------------------------------------------
// Walk and run are generated from a mathematical stride rather than hand-
// keyed: phase = 0 is left heel strike, the right leg carries π. Thigh swing,
// knee flexion (stance dip vs swing lift), ankle rockers, counter-swinging
// arms, pelvis yaw/roll, shoulder counter-twist, and the vertical bob are
// continuous functions of the phase — so the cycle has no "keyframe pulse"
// and the contacts actually match.

interface GaitConfig {
  duration: number;
  samples: number;
  /** Pelvis height at the lowest dip, metres. */
  dip: number;
  /** Rise toward mid-stance, metres. */
  rise: number;
  /** Extra flight bounce (run), added where the legs exchange. */
  hop: number;
  /** Lateral pelvis sway onto the stance leg, metres. */
  hipSway: number;
  thigh: number;
  kneeLoad: number;
  kneeSwing: number;
  /** World-space foot pitch (toe-down +) at toe-off / heel strike. */
  toeOff: number;
  strikeToe: number;
  /** World-space foot pitch held through mid-swing (toe-up clearance). */
  swingLevel: number;
  splay: number;
  armSwing: number;
  elbowBase: number;
  elbowBack: number;
  lean: number;
  hipYaw: number;
  hipRoll: number;
  shoulder: number;
  headPitch: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep01 = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function legPose(a: number, cfg: GaitConfig, side: -1 | 1): Pose {
  const stance = a <= Math.PI;
  const q = stance ? a / Math.PI : (a - Math.PI) / Math.PI;
  const thigh = -cfg.thigh * Math.cos(a);
  // Stance: small shock-absorb dip mid-support. Swing: heel toward the seat,
  // then the shank whips forward as the foot reaches.
  const knee = stance
    ? cfg.kneeLoad * Math.sin(a)
    : cfg.kneeSwing * Math.pow(Math.sin(Math.PI * q), 0.82);
  // The ankle is authored in WORLD pitch, then the thigh/knee chain is
  // subtracted out. Stance: toe-up at heel strike, flat through mid-stance
  // (the planted sole stays on the ground), heel lifting into toe-off.
  // Swing: the toe-off pitch releases quickly to a level, slightly toe-up
  // carriage that reaches for the next heel strike. Because the chain is
  // compensated, a flexed swing knee can never leave the foot trailing
  // backwards — the old bug that read as feet facing the wrong way.
  const world = stance
    ? -cfg.strikeToe
      + cfg.strikeToe * smoothstep01(0.02, 0.34, q)
      + cfg.toeOff * smoothstep01(0.3, 1, q)
    : cfg.toeOff
      + (cfg.swingLevel - cfg.toeOff) * smoothstep01(0.0, 0.34, q)
      + (-cfg.strikeToe - cfg.swingLevel) * smoothstep01(0.62, 1, q);
  const foot = world - thigh - knee;
  const leg = side < 0 ? 'L' : 'R';
  return {
    [`UpperLeg${leg}`]: [thigh, 0, side * cfg.splay],
    [`LowerLeg${leg}`]: [knee, 0, 0],
    [`Foot${leg}`]: [foot, 0, 0],
  } as Pose;
}

function armPose(a: number, cfg: GaitConfig, side: -1 | 1): Pose {
  // The arm swings opposite the same-side leg; elbow flexes as it goes back.
  const arm = side < 0 ? 'L' : 'R';
  const swing = cfg.armSwing * Math.cos(a);
  const elbow = cfg.elbowBase + cfg.elbowBack * Math.max(0, -swing / (cfg.armSwing || 1));
  return {
    [`UpperArm${arm}`]: [swing, 0, side * (4 + Math.abs(swing) * 0.05)],
    [`LowerArm${arm}`]: [-elbow, 0, 0],
  } as Pose;
}

function gaitKeys(cfg: GaitConfig): ClipKey[] {
  const keys: ClipKey[] = [];
  for (let i = 0; i < cfg.samples; i++) {
    const p = i / cfg.samples;
    const a = p * Math.PI * 2;
    const pose: Pose = {
      ...legPose(a, cfg, -1),
      ...legPose(a + Math.PI, cfg, 1),
      ...armPose(a, cfg, -1),
      ...armPose(a + Math.PI, cfg, 1),
      Hips: [1.5 * Math.abs(Math.sin(a)), cfg.hipYaw * Math.cos(a), cfg.hipRoll * Math.sin(a)],
      Spine: [cfg.lean * 0.4 + 0.6, 0, 0],
      Chest: [cfg.lean * 0.6, -cfg.shoulder * Math.cos(a), 0],
      Head: [-cfg.headPitch * cfg.lean + 0.8 * Math.sin(a * 2), cfg.shoulder * 0.4 * Math.cos(a), 0],
    };
    const dip = cfg.dip - cfg.rise * Math.abs(Math.sin(a)) + cfg.hop * Math.pow(Math.cos(a), 2);
    // Weight shifts onto the stance leg; continuous over the cycle.
    keys.push({ t: +(p * cfg.duration).toFixed(4), ease: 'linear', root: [cfg.hipSway * Math.sin(a), -dip, 0], pose });
  }
  return keys;
}

const WALK_CYCLE: ClipKey[] = gaitKeys({
  duration: 1.06, samples: 20, dip: 0.024, rise: 0.015, hop: 0, hipSway: 0.014,
  thigh: 28, kneeLoad: 8, kneeSwing: 34, toeOff: 26, strikeToe: 12, swingLevel: -6, splay: 4.5,
  armSwing: 18, elbowBase: 22, elbowBack: 8, lean: 2.5,
  hipYaw: 2.4, hipRoll: 1.4, shoulder: 3, headPitch: 0.3,
});

const RUN_CYCLE: ClipKey[] = gaitKeys({
  duration: 0.64, samples: 20, dip: 0.044, rise: 0.025, hop: 0.028, hipSway: 0.02,
  thigh: 46, kneeLoad: 15, kneeSwing: 72, toeOff: 40, strikeToe: 14, swingLevel: -8, splay: 5.5,
  armSwing: 33, elbowBase: 58, elbowBack: 14, lean: 10,
  hipYaw: 4, hipRoll: 2.2, shoulder: 5, headPitch: 0.6,
});

/** Low guard: sword presented off the forearm, shield hand covering the chest. */
const GUARD_ARMS: Pose = {
  UpperArmL: [-14, 0, 9], LowerArmL: [-62, 0, 0], HandL: [0, 0, 6],
  UpperArmR: [4, 0, -13], LowerArmR: [-64, 0, -4], HandR: [0, 0, -8],
};

/**
 * Draw from the belt scabbard: reach down to the hilt, come up across the
 * hip, settle into the guard. `sheathe` replays the same poses backwards, so
 * the two always meet at the guard without drift.
 */
const DRAW_T = [0, 0.18, 0.34, 0.55];
const DRAW_POSES: Pose[] = [
  { ...RELAXED_ARMS },
  { ...RELAXED_ARMS, UpperArmR: [34, -10, -32], LowerArmR: [-36, 0, 0], Head: [10, 10, 0], Chest: [4, 12, 1], Spine: [3, 6, 0] },
  { UpperArmR: [6, -6, -22], LowerArmR: [-58, 0, -4], HandR: [0, 0, -6], UpperArmL: [-8, 0, 9], LowerArmL: [-30, 0, 0], Head: [2, 4, 0], Chest: [2, 4, 0], Spine: [1, 2, 0] },
  { ...GUARD_ARMS, Chest: [-1, 0, 0], Spine: [1, 0, 0] },
];
const DRAW_EASES: EaseName[] = ['inout', 'in', 'smooth', 'out'];
function drawSheatheClip(name: 'draw' | 'sheathe'): ClipDef {
  const poses = name === 'draw' ? DRAW_POSES : DRAW_POSES.slice().reverse();
  const keys: ClipKey[] = poses.map((pose, i) => ({
    t: name === 'draw' ? DRAW_T[i] : +(0.55 - DRAW_T[DRAW_POSES.length - 1 - i]).toFixed(3),
    ease: name === 'draw' ? DRAW_EASES[i] : DRAW_EASES[DRAW_POSES.length - 1 - i],
    pose,
  }));
  return { name, duration: 0.55, loop: false, previewOnly: false, keys };
}

export const CLIP_DEFS: Record<ClipName, ClipDef> = {
  idle: idleClip('idle', RELAXED_ARMS, 1, 1),
  idle_drawn: idleClip('idle_drawn', GUARD_ARMS, 1.15, 0.85),
  idle_dual: idleClip('idle_dual', DUAL_ARMS, 1.25, 0.7),
  idle_bow: idleClip('idle_bow', RELAXED_ARMS, 0.9, 1.3),

  walk: { name: 'walk', duration: 1.06, loop: true, previewOnly: false, keys: WALK_CYCLE },
  run: { name: 'run', duration: 0.64, loop: true, previewOnly: false, keys: RUN_CYCLE },

  attack_slash_1h: {
    name: 'attack_slash_1h',
    duration: 1.1,
    loop: false,
    previewOnly: true,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS, Chest: [2, 0, 0] } },
      {
        t: 0.28,
        ease: 'inout',
        root: [-0.03, -0.03, 0],
        pose: {
          Chest: [4, -28, -6], Spine: [2, -12, 0], Head: [2, -14, 0],
          UpperArmR: [52, 0, -48], LowerArmR: [-46, 0, 0],
          UpperArmL: [-18, 0, 14], LowerArmL: [-40, 0, 0],
          UpperLegL: [-8, 0, 3], LowerLegL: [10, 0, 0],
          UpperLegR: [10, 0, -4], LowerLegR: [12, 0, 0],
        },
      },
      {
        t: 0.44,
        ease: 'linear',
        root: [0.03, -0.07, 0.04],
        pose: {
          Chest: [14, 32, 6], Spine: [8, 14, 0], Head: [6, 18, 0],
          UpperArmR: [-78, 0, 12], LowerArmR: [-8, 0, 0],
          UpperArmL: [14, 0, 10], LowerArmL: [-30, 0, 0],
          UpperLegL: [-14, 0, 3], LowerLegL: [16, 0, 0],
          UpperLegR: [-6, 0, -4], LowerLegR: [10, 0, 0],
        },
      },
      {
        t: 0.68,
        ease: 'out',
        root: [0.02, -0.05, 0.03],
        pose: {
          Chest: [12, 36, 5], Spine: [7, 15, 0], Head: [6, 20, 0],
          UpperArmR: [-72, 0, 22], LowerArmR: [-14, 0, 0],
          UpperArmL: [16, 0, 8], LowerArmL: [-28, 0, 0],
          UpperLegL: [-14, 0, 3], LowerLegL: [16, 0, 0],
          UpperLegR: [-6, 0, -4], LowerLegR: [10, 0, 0],
        },
      },
      { t: 1.1, ease: 'inout', pose: { ...RELAXED_ARMS, Chest: [2, 0, 0] } },
    ],
  },

  // Dueling flourish: fencer's lunge, point punched straight ahead.
  thrust_1h: {
    name: 'thrust_1h',
    duration: 1.0,
    loop: false,
    previewOnly: true,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS, Chest: [2, 0, 0] } },
      {
        t: 0.26,
        ease: 'inout',
        root: [-0.02, -0.04, -0.02],
        pose: {
          Chest: [6, -24, 0], Spine: [3, -10, 0], Head: [2, -12, 0],
          UpperArmR: [30, 0, -20], LowerArmR: [-70, 0, 0],
          UpperArmL: [28, 0, 12], LowerArmL: [-36, 0, 0],
          UpperLegL: [-6, 0, 3], LowerLegL: [10, 0, 0],
          UpperLegR: [12, 0, -4], LowerLegR: [10, 0, 0],
        },
      },
      {
        t: 0.42,
        ease: 'linear',
        root: [0, -0.08, 0.18],
        pose: {
          Chest: [16, 20, 0], Spine: [9, 10, 0], Head: [8, 12, 0],
          UpperArmR: [-88, 0, 0], LowerArmR: [-4, 0, 0],
          HandR: [180, 0, 0],
          UpperArmL: [42, 0, 12], LowerArmL: [-18, 0, 0],
          UpperLegL: [-30, 0, 3], LowerLegL: [20, 0, 0],
          UpperLegR: [24, 0, -4], LowerLegR: [6, 0, 0],
        },
      },
      {
        t: 0.62,
        ease: 'out',
        root: [0, -0.08, 0.18],
        pose: {
          Chest: [16, 20, 0], Spine: [9, 10, 0], Head: [8, 12, 0],
          UpperArmR: [-88, 0, 0], LowerArmR: [-4, 0, 0],
          HandR: [180, 0, 0],
          UpperArmL: [42, 0, 12], LowerArmL: [-18, 0, 0],
          UpperLegL: [-30, 0, 3], LowerLegL: [20, 0, 0],
          UpperLegR: [24, 0, -4], LowerLegR: [6, 0, 0],
        },
      },
      { t: 1.0, ease: 'inout', pose: { ...RELAXED_ARMS, Chest: [2, 0, 0] } },
    ],
  },

  // Great-weapon flourish: two-handed overhead chop.
  slash_2h: {
    name: 'slash_2h',
    duration: 1.2,
    loop: false,
    previewOnly: true,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS, Chest: [2, 0, 0] } },
      {
        t: 0.34,
        ease: 'inout',
        root: [0, 0.02, -0.03],
        pose: {
          Chest: [-8, -10, 0], Spine: [-4, -5, 0], Head: [-10, -6, 0],
          UpperArmR: [-168, 0, -12], LowerArmR: [-24, 0, 0],
          UpperArmL: [-158, 0, 16], LowerArmL: [-30, 0, 0],
          UpperLegL: [-6, 0, 6], LowerLegL: [8, 0, 0],
          UpperLegR: [8, 0, -6], LowerLegR: [8, 0, 0],
        },
      },
      {
        t: 0.52,
        ease: 'linear',
        root: [0, -0.11, 0.1],
        pose: {
          Chest: [22, 8, 0], Spine: [12, 4, 0], Head: [12, 4, 0],
          UpperArmR: [-58, 0, -6], LowerArmR: [-10, 0, 0],
          UpperArmL: [-52, 0, 10], LowerArmL: [-12, 0, 0],
          UpperLegL: [-18, 0, 6], LowerLegL: [22, 0, 0],
          UpperLegR: [-10, 0, -6], LowerLegR: [18, 0, 0],
        },
      },
      {
        t: 0.78,
        ease: 'out',
        root: [0, -0.09, 0.08],
        pose: {
          Chest: [20, 8, 0], Spine: [11, 4, 0], Head: [12, 4, 0],
          UpperArmR: [-62, 0, -6], LowerArmR: [-12, 0, 0],
          UpperArmL: [-56, 0, 10], LowerArmL: [-14, 0, 0],
          UpperLegL: [-18, 0, 6], LowerLegL: [22, 0, 0],
          UpperLegR: [-10, 0, -6], LowerLegR: [18, 0, 0],
        },
      },
      { t: 1.2, ease: 'inout', pose: { ...RELAXED_ARMS, Chest: [2, 0, 0] } },
    ],
  },

  // Two-weapon flourish: scissoring twin cut, crouching through the middle.
  dual_strike: {
    name: 'dual_strike',
    duration: 1.1,
    loop: false,
    previewOnly: true,
    keys: [
      { t: 0, pose: { ...DUAL_ARMS, Chest: [2, 0, 0] } },
      {
        t: 0.26,
        ease: 'inout',
        root: [0, -0.04, 0],
        pose: {
          Chest: [4, 0, 0], Spine: [2, 0, 0], Head: [2, 0, 0],
          UpperArmR: [20, 0, -55], LowerArmR: [-40, 0, 0],
          UpperArmL: [20, 0, 55], LowerArmL: [-40, 0, 0],
          UpperLegL: [-10, 0, 5], LowerLegL: [14, 0, 0],
          UpperLegR: [-10, 0, -5], LowerLegR: [14, 0, 0],
        },
      },
      {
        t: 0.44,
        ease: 'linear',
        root: [0, -0.14, 0.06],
        pose: {
          Chest: [18, 0, 0], Spine: [10, 0, 0], Head: [8, 0, 0],
          UpperArmR: [-75, 0, 18], LowerArmR: [-10, 0, 0],
          UpperArmL: [-75, 0, -18], LowerArmL: [-10, 0, 0],
          UpperLegL: [-22, 0, 5], LowerLegL: [30, 0, 0],
          UpperLegR: [-22, 0, -5], LowerLegR: [30, 0, 0],
        },
      },
      {
        t: 0.7,
        ease: 'out',
        root: [0, -0.1, 0.04],
        pose: {
          Chest: [14, 0, 0], Spine: [8, 0, 0], Head: [6, 0, 0],
          UpperArmR: [-70, 0, 24], LowerArmR: [-14, 0, 0],
          UpperArmL: [-70, 0, -24], LowerArmL: [-14, 0, 0],
          UpperLegL: [-20, 0, 5], LowerLegL: [28, 0, 0],
          UpperLegR: [-20, 0, -5], LowerLegR: [28, 0, 0],
        },
      },
      { t: 1.1, ease: 'inout', pose: { ...DUAL_ARMS, Chest: [2, 0, 0] } },
    ],
  },

  // Archery flourish: sideways stance, draw to the cheek, loose.
  bow_draw: {
    name: 'bow_draw',
    duration: 1.4,
    loop: false,
    previewOnly: true,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS, Chest: [2, 0, 0] } },
      {
        t: 0.4,
        ease: 'inout',
        root: [0.02, -0.03, 0],
        pose: {
          Chest: [4, -35, 0], Spine: [2, -16, 0], Head: [4, -28, 0],
          UpperArmL: [-88, 0, 6], LowerArmL: [-2, 0, 0],
          UpperArmR: [-58, 0, -34], LowerArmR: [-112, 0, 0],
          UpperLegL: [-8, 0, 4], LowerLegL: [10, 0, 0],
          UpperLegR: [6, 0, -4], LowerLegR: [8, 0, 0],
        },
      },
      {
        t: 0.8,
        ease: 'inout',
        root: [0.02, -0.03, 0],
        pose: {
          Chest: [5, -36, 0], Spine: [2, -16, 0], Head: [4, -30, 0],
          UpperArmL: [-88, 0, 6], LowerArmL: [-2, 0, 0],
          UpperArmR: [-60, 0, -36], LowerArmR: [-116, 0, 0],
          UpperLegL: [-8, 0, 4], LowerLegL: [10, 0, 0],
          UpperLegR: [6, 0, -4], LowerLegR: [8, 0, 0],
        },
      },
      {
        t: 0.92,
        ease: 'linear',
        root: [0.02, -0.03, 0],
        pose: {
          Chest: [5, -36, 0], Spine: [2, -16, 0], Head: [4, -30, 0],
          UpperArmL: [-88, 0, 6], LowerArmL: [-2, 0, 0],
          UpperArmR: [-74, 0, -14], LowerArmR: [-28, 0, 0],
          UpperLegL: [-8, 0, 4], LowerLegL: [10, 0, 0],
          UpperLegR: [6, 0, -4], LowerLegR: [8, 0, 0],
        },
      },
      { t: 1.4, ease: 'inout', pose: { ...RELAXED_ARMS, Chest: [2, 0, 0] } },
    ],
  },

  // Evasion flourish: tucked forward roll (90-degree hips keys keep the
  // quaternion path rolling forward instead of unwinding).
  dodge_roll: {
    name: 'dodge_roll',
    duration: 0.9,
    loop: false,
    previewOnly: true,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS } },
      {
        t: 0.16,
        ease: 'in',
        root: [0, -0.3, 0.08],
        pose: {
          Hips: [-24, 0, 0], Chest: [38, 0, 0], Spine: [20, 0, 0], Head: [26, 0, 0],
          UpperArmL: [-40, 0, 6], LowerArmL: [-90, 0, 0],
          UpperArmR: [-40, 0, -6], LowerArmR: [-90, 0, 0],
          UpperLegL: [-70, 0, 4], LowerLegL: [95, 0, 0], FootL: [30, 0, 0],
          UpperLegR: [-70, 0, -4], LowerLegR: [95, 0, 0], FootR: [30, 0, 0],
        },
      },
      {
        t: 0.32, ease: 'linear', root: [0, -0.44, 0.3],
        pose: {
          Hips: [-110, 0, 0], Chest: [30, 0, 0], Spine: [18, 0, 0], Head: [24, 0, 0],
          UpperArmL: [-40, 0, 6], LowerArmL: [-95, 0, 0],
          UpperArmR: [-40, 0, -6], LowerArmR: [-95, 0, 0],
          UpperLegL: [-75, 0, 4], LowerLegL: [100, 0, 0], FootL: [30, 0, 0],
          UpperLegR: [-75, 0, -4], LowerLegR: [100, 0, 0], FootR: [30, 0, 0],
        },
      },
      {
        t: 0.48, ease: 'linear', root: [0, -0.42, 0.55],
        pose: {
          Hips: [-195, 0, 0], Chest: [26, 0, 0], Spine: [16, 0, 0], Head: [22, 0, 0],
          UpperArmL: [-40, 0, 6], LowerArmL: [-95, 0, 0],
          UpperArmR: [-40, 0, -6], LowerArmR: [-95, 0, 0],
          UpperLegL: [-75, 0, 4], LowerLegL: [100, 0, 0], FootL: [30, 0, 0],
          UpperLegR: [-75, 0, -4], LowerLegR: [100, 0, 0], FootR: [30, 0, 0],
        },
      },
      {
        t: 0.64, ease: 'linear', root: [0, -0.34, 0.72],
        pose: {
          Hips: [-280, 0, 0], Chest: [30, 0, 0], Spine: [18, 0, 0], Head: [22, 0, 0],
          UpperArmL: [-40, 0, 6], LowerArmL: [-90, 0, 0],
          UpperArmR: [-40, 0, -6], LowerArmR: [-90, 0, 0],
          UpperLegL: [-70, 0, 4], LowerLegL: [95, 0, 0], FootL: [28, 0, 0],
          UpperLegR: [-70, 0, -4], LowerLegR: [95, 0, 0], FootR: [28, 0, 0],
        },
      },
      {
        t: 0.78, ease: 'out', root: [0, -0.12, 0.8],
        pose: {
          Hips: [-360, 0, 0], Chest: [20, 0, 0], Spine: [12, 0, 0], Head: [10, 0, 0],
          UpperArmL: [-30, 0, 6], LowerArmL: [-60, 0, 0],
          UpperArmR: [-30, 0, -6], LowerArmR: [-60, 0, 0],
          UpperLegL: [-45, 0, 4], LowerLegL: [60, 0, 0], FootL: [18, 0, 0],
          UpperLegR: [-45, 0, -4], LowerLegR: [60, 0, 0], FootR: [18, 0, 0],
        },
      },
      { t: 0.9, ease: 'out', root: [0, 0, 0.82], pose: { ...RELAXED_ARMS, Hips: [-360, 0, 0] } },
    ],
  },

  hit_react: {
    name: 'hit_react',
    duration: 0.7,
    loop: false,
    previewOnly: true,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS } },
      {
        t: 0.13,
        ease: 'out',
        root: [0, -0.04, -0.09],
        pose: {
          Chest: [-13, -8, -4], Spine: [-6, -4, 0], Head: [-12, -6, -3], Neck: [-6, 0, 0],
          UpperArmR: [28, 0, -22], LowerArmR: [-52, 0, 0],
          UpperArmL: [24, 0, 20], LowerArmL: [-56, 0, 0],
          UpperLegL: [6, 0, 0], LowerLegL: [14, 0, 0],
          UpperLegR: [-4, 0, 0], LowerLegR: [10, 0, 0],
        },
      },
      { t: 0.42, ease: 'inout', root: [0, -0.015, -0.03], pose: { ...RELAXED_ARMS, Chest: [-4, -2, -1], Head: [-3, -2, 0] } },
      { t: 0.7, ease: 'inout', pose: { ...RELAXED_ARMS } },
    ],
  },

  death: {
    name: 'death',
    duration: 1.6,
    loop: false,
    previewOnly: true,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS } },
      {
        t: 0.3,
        ease: 'out',
        root: [0, -0.1, -0.08],
        pose: {
          Chest: [-16, 0, 0], Spine: [-8, 0, 0], Head: [-14, 0, 0],
          UpperArmR: [30, 0, -26], LowerArmR: [-30, 0, 0],
          UpperArmL: [30, 0, 26], LowerArmL: [-30, 0, 0],
          UpperLegL: [4, 0, 0], LowerLegL: [22, 0, 0],
          UpperLegR: [4, 0, 0], LowerLegR: [22, 0, 0],
        },
      },
      {
        t: 0.75,
        ease: 'inout',
        root: [-0.05, -0.52, 0.02],
        pose: {
          Hips: [0, 0, -12],
          Chest: [42, -8, -10], Spine: [24, -4, -6], Head: [26, 0, -14],
          UpperArmR: [-24, 0, -14], LowerArmR: [-38, 0, 0],
          UpperArmL: [38, 0, 18], LowerArmL: [-24, 0, 0],
          UpperLegL: [-72, 0, 8], LowerLegL: [96, 0, 0], FootL: [30, 0, 0],
          UpperLegR: [-64, 0, -10], LowerLegR: [88, 0, 0], FootR: [30, 0, 0],
        },
      },
      {
        t: 1.15,
        ease: 'inout',
        root: [-0.1, -0.6, 0.05],
        pose: {
          Hips: [6, 0, -22],
          Chest: [52, -10, -18], Spine: [30, -6, -10], Head: [30, 0, -24],
          UpperArmR: [-16, 0, -10], LowerArmR: [-20, 0, 0],
          UpperArmL: [48, 0, 14], LowerArmL: [-14, 0, 0],
          UpperLegL: [-78, 0, 6], LowerLegL: [104, 0, 0], FootL: [34, 0, 0],
          UpperLegR: [-70, 0, -12], LowerLegR: [96, 0, 0], FootR: [34, 0, 0],
        },
      },
      {
        t: 1.6,
        ease: 'smooth',
        root: [-0.1, -0.6, 0.05],
        pose: {
          Hips: [6, 0, -22],
          Chest: [52, -10, -18], Spine: [30, -6, -10], Head: [30, 0, -24],
          UpperArmR: [-16, 0, -10], LowerArmR: [-20, 0, 0],
          UpperArmL: [48, 0, 14], LowerArmL: [-14, 0, 0],
          UpperLegL: [-78, 0, 6], LowerLegL: [104, 0, 0], FootL: [34, 0, 0],
          UpperLegR: [-70, 0, -12], LowerLegR: [96, 0, 0], FootR: [34, 0, 0],
        },
      },
    ],
  },

  interact: {
    name: 'interact',
    duration: 0.9,
    loop: false,
    previewOnly: false,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS } },
      {
        t: 0.45,
        ease: 'inout',
        root: [-0.02, -0.44, 0.1],
        pose: {
          Chest: [20, 8, 0], Spine: [12, 4, 0], Head: [22, 6, 0],
          UpperArmR: [-72, 0, -6], LowerArmR: [-16, 0, 0],
          UpperArmL: [18, 0, 8], LowerArmL: [-20, 0, 0],
          UpperLegL: [-52, 0, 4], LowerLegL: [62, 0, 0], FootL: [18, 0, 0],
          UpperLegR: [-78, 0, -6], LowerLegR: [98, 0, 0], FootR: [44, 0, 0],
        },
      },
      {
        t: 0.9,
        ease: 'inout',
        root: [-0.02, -0.44, 0.1],
        pose: {
          Chest: [24, 8, 0], Spine: [14, 4, 0], Head: [26, 6, 0],
          UpperArmR: [-78, 0, -6], LowerArmR: [-12, 0, 0],
          UpperArmL: [18, 0, 8], LowerArmL: [-20, 0, 0],
          UpperLegL: [-52, 0, 4], LowerLegL: [62, 0, 0], FootL: [18, 0, 0],
          UpperLegR: [-78, 0, -6], LowerLegR: [98, 0, 0], FootR: [44, 0, 0],
        },
      },
    ],
  },

  // Kneel and work a knot at knee height: both hands turn over each other
  // while the head follows them — used for tying the horses off at the road.
  tie_knot: {
    name: 'tie_knot',
    duration: 2.4,
    loop: false,
    previewOnly: false,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS } },
      {
        t: 0.5,
        ease: 'inout',
        root: [-0.02, -0.44, 0.1],
        pose: {
          Chest: [22, 6, 0], Spine: [13, 3, 0], Head: [24, 4, 0],
          UpperArmR: [-58, 0, -10], LowerArmR: [-46, 0, 0], HandR: [10, 0, -6],
          UpperArmL: [-52, 0, 10], LowerArmL: [-50, 0, 0], HandL: [10, 0, 6],
          UpperLegL: [-52, 0, 4], LowerLegL: [62, 0, 0], FootL: [18, 0, 0],
          UpperLegR: [-78, 0, -6], LowerLegR: [98, 0, 0], FootR: [44, 0, 0],
        },
      },
      {
        t: 1.1,
        ease: 'smooth',
        root: [-0.02, -0.45, 0.11],
        pose: {
          Chest: [24, -4, 0], Spine: [14, -2, 0], Head: [26, -6, 0],
          UpperArmR: [-64, 0, -4], LowerArmR: [-38, 0, 0], HandR: [-14, 0, -4],
          UpperArmL: [-46, 0, 14], LowerArmL: [-58, 0, 0], HandL: [16, 0, 4],
          UpperLegL: [-52, 0, 4], LowerLegL: [62, 0, 0], FootL: [18, 0, 0],
          UpperLegR: [-78, 0, -6], LowerLegR: [98, 0, 0], FootR: [44, 0, 0],
        },
      },
      {
        t: 1.7,
        ease: 'smooth',
        root: [-0.02, -0.44, 0.1],
        pose: {
          Chest: [23, 5, 0], Spine: [13, 2, 0], Head: [25, 6, 0],
          UpperArmR: [-56, 0, -12], LowerArmR: [-50, 0, 0], HandR: [12, 0, -6],
          UpperArmL: [-54, 0, 8], LowerArmL: [-44, 0, 0], HandL: [-10, 0, 6],
          UpperLegL: [-52, 0, 4], LowerLegL: [62, 0, 0], FootL: [18, 0, 0],
          UpperLegR: [-78, 0, -6], LowerLegR: [98, 0, 0], FootR: [44, 0, 0],
        },
      },
      {
        t: 2.05,
        ease: 'inout',
        root: [-0.02, -0.42, 0.09],
        pose: {
          Chest: [18, 0, 0], Spine: [10, 0, 0], Head: [16, 0, 0],
          UpperArmR: [-40, 0, -8], LowerArmR: [-30, 0, 0],
          UpperArmL: [-36, 0, 8], LowerArmL: [-32, 0, 0],
          UpperLegL: [-52, 0, 4], LowerLegL: [62, 0, 0], FootL: [18, 0, 0],
          UpperLegR: [-78, 0, -6], LowerLegR: [98, 0, 0], FootR: [44, 0, 0],
        },
      },
      { t: 2.4, ease: 'out', pose: { ...RELAXED_ARMS } },
    ],
  },

  second_wind: {
    name: 'second_wind',
    duration: 1.3,
    loop: false,
    previewOnly: false,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS } },
      {
        t: 0.45,
        ease: 'inout',
        root: [0, -0.05, 0],
        pose: {
          Chest: [-6, 0, 0], Spine: [-3, 0, 0], Head: [-13, 0, 0], Neck: [-6, 0, 0],
          UpperArmR: [-28, 0, -2], LowerArmR: [-112, 0, 0],
          UpperArmL: [-44, 0, 12], LowerArmL: [-48, 0, 0],
          UpperLegL: [-4, 0, 0], LowerLegL: [10, 0, 0],
          UpperLegR: [-4, 0, 0], LowerLegR: [10, 0, 0],
        },
      },
      {
        t: 0.8,
        ease: 'out',
        root: [0, 0.015, 0.02],
        pose: {
          Chest: [7, 0, 0], Spine: [4, 0, 0], Head: [9, 0, 0],
          UpperArmR: [-34, 0, -6], LowerArmR: [-104, 0, 0],
          UpperArmL: [-50, 0, 14], LowerArmL: [-44, 0, 0],
          UpperLegL: [-2, 0, 0], LowerLegL: [4, 0, 0],
          UpperLegR: [-2, 0, 0], LowerLegR: [4, 0, 0],
        },
      },
      { t: 1.3, ease: 'inout', pose: { ...RELAXED_ARMS } },
    ],
  },

  long_rest_sit: {
    name: 'long_rest_sit',
    duration: 0.8,
    loop: false,
    previewOnly: false,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS } },
      { t: 0.8, ease: 'inout', root: [0, -0.52, 0], pose: { ...SIT_POSE } },
    ],
  },

  stand_up: {
    name: 'stand_up',
    duration: 0.65,
    loop: false,
    previewOnly: false,
    keys: [
      { t: 0, root: [0, -0.52, 0], pose: { ...SIT_POSE } },
      {
        t: 0.32,
        ease: 'inout',
        root: [0, -0.3, 0.04],
        pose: {
          Chest: [22, 0, 0], Spine: [14, 0, 0], Head: [8, 0, 0],
          UpperArmL: [-20, 0, 8], LowerArmL: [-30, 0, 0],
          UpperArmR: [-20, 0, -8], LowerArmR: [-30, 0, 0],
          UpperLegL: [-70, 0, 6], LowerLegL: [80, 0, 0], FootL: [20, 0, 0],
          UpperLegR: [-70, 0, -6], LowerLegR: [80, 0, 0], FootR: [20, 0, 0],
        },
      },
      { t: 0.65, ease: 'out', pose: { ...RELAXED_ARMS } },
    ],
  },

  // Wagon-seat sit: the avatar origin rides AT the seat (~1.1 m up), so the
  // hips drop to just above the cushion, thighs level, calves dangling, hands
  // forward where the reins run. Held while mounted / riding the journey.
  draw: drawSheatheClip('draw'),
  sheathe: drawSheatheClip('sheathe'),

  sit_chair: {
    name: 'sit_chair',
    duration: 0.7,
    loop: false,
    previewOnly: false,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS } },
      {
        t: 0.7,
        ease: 'inout',
        root: [0, -0.86, 0.02],
        pose: {
          UpperLegL: [-82, 0, 6], LowerLegL: [84, 0, 0], FootL: [4, 0, 0],
          UpperLegR: [-82, 0, -6], LowerLegR: [84, 0, 0], FootR: [4, 0, 0],
          Spine: [3, 0, 0], Chest: [4, 0, 0], Head: [4, 0, 0],
          UpperArmL: [-45, 0, 8], LowerArmL: [-20, 0, 0],
          UpperArmR: [-45, 0, -8], LowerArmR: [-20, 0, 0],
        },
      },
    ],
  },

  stand_chair: {
    name: 'stand_chair',
    duration: 0.6,
    loop: false,
    previewOnly: false,
    keys: [
      {
        t: 0,
        root: [0, -0.86, 0.02],
        pose: {
          UpperLegL: [-82, 0, 6], LowerLegL: [84, 0, 0], FootL: [4, 0, 0],
          UpperLegR: [-82, 0, -6], LowerLegR: [84, 0, 0], FootR: [4, 0, 0],
          Spine: [3, 0, 0], Chest: [4, 0, 0], Head: [4, 0, 0],
          UpperArmL: [-45, 0, 8], LowerArmL: [-20, 0, 0],
          UpperArmR: [-45, 0, -8], LowerArmR: [-20, 0, 0],
        },
      },
      {
        t: 0.3,
        ease: 'inout',
        root: [0, -0.42, 0.09],
        pose: {
          Chest: [24, 0, 0], Spine: [14, 0, 0], Head: [10, 0, 0],
          UpperArmL: [-24, 0, 8], LowerArmL: [-30, 0, 0],
          UpperArmR: [-24, 0, -8], LowerArmR: [-30, 0, 0],
          UpperLegL: [-52, 0, 6], LowerLegL: [66, 0, 0], FootL: [10, 0, 0],
          UpperLegR: [-52, 0, -6], LowerLegR: [66, 0, 0], FootR: [10, 0, 0],
        },
      },
      { t: 0.6, ease: 'out', pose: { ...RELAXED_ARMS } },
    ],
  },

  salute: {
    name: 'salute',
    duration: 1.2,
    loop: false,
    previewOnly: false,
    keys: [
      { t: 0, pose: { ...RELAXED_ARMS } },
      {
        t: 0.35,
        ease: 'inout',
        pose: {
          Chest: [3, 0, 0], Head: [13, 0, 0],
          UpperArmR: [-52, 0, 14], LowerArmR: [-92, 0, 0],
          UpperArmL: [0, 0, 6], LowerArmL: [-26, 0, 0],
        },
      },
      {
        t: 0.62,
        ease: 'inout',
        root: [0, 0.01, 0],
        pose: {
          Chest: [-4, 0, 0], Head: [-8, 0, 0],
          UpperArmR: [-158, 0, -8], LowerArmR: [-12, 0, 0],
          UpperArmL: [6, 0, 8], LowerArmL: [-30, 0, 0],
        },
      },
      {
        t: 0.9,
        ease: 'inout',
        pose: {
          Chest: [4, 0, 0], Head: [4, 0, 0],
          UpperArmR: [-30, 0, -14], LowerArmR: [-16, 0, 0],
          UpperArmL: [0, 0, 6], LowerArmL: [-26, 0, 0],
        },
      },
      { t: 1.2, ease: 'smooth', pose: { ...RELAXED_ARMS } },
    ],
  },
};

// --- Sampling ---

const SAMPLE_HZ = 30;

interface BoneKeys {
  times: number[];
  quats: THREE.Quaternion[];
}

/** Sorted keys with an auto-closing end key for loops (seamless cycles). */
function normalizedKeys(def: ClipDef): ClipKey[] {
  const keys = [...def.keys].sort((a, b) => a.t - b.t);
  if (def.loop) {
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (last.t < def.duration - 1e-6) {
      keys.push({
        t: def.duration,
        pose: { ...first.pose },
        root: first.root ? ([...first.root] as [number, number, number]) : undefined,
        ease: first.ease,
      });
    }
  }
  return keys;
}

/** Fill per-bone key tracks from pose keys (missing bones hold their last value). */
function collectBoneKeys(keys: ClipKey[]): Map<BoneName, BoneKeys> {
  const tracks = new Map<BoneName, BoneKeys>();
  for (const name of BONE_NAMES) tracks.set(name, { times: [], quats: [] });
  const held = new Map<BoneName, [number, number, number]>();
  for (const key of keys) {
    for (const [bone, euler] of Object.entries(key.pose) as [BoneName, [number, number, number]][]) {
      held.set(bone, euler);
    }
    for (const name of BONE_NAMES) {
      const track = tracks.get(name)!;
      const e = held.get(name) ?? [0, 0, 0];
      track.times.push(key.t);
      track.quats.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0] * D2R, e[1] * D2R, e[2] * D2R)));
    }
  }
  return tracks;
}

function collectRootKeys(keys: ClipKey[], hipsBase: THREE.Vector3): { times: number[]; points: THREE.Vector3[] } {
  const times: number[] = [];
  const points: THREE.Vector3[] = [];
  let held: [number, number, number] = [0, 0, 0];
  for (const key of keys) {
    if (key.root) held = key.root;
    times.push(key.t);
    points.push(new THREE.Vector3(hipsBase.x + held[0], hipsBase.y + held[1], hipsBase.z + held[2]));
  }
  return { times, points };
}

function sampleTrack<T>(times: number[], values: T[], eases: EaseName[], t: number, lerp: (a: T, b: T, k: number) => T): T {
  if (t <= times[0]) return values[0];
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) {
      const span = times[i] - times[i - 1];
      const k = span <= 0 ? 1 : (t - times[i - 1]) / span;
      return lerp(values[i - 1], values[i], ease(eases[i], k));
    }
  }
  return values[values.length - 1];
}

/** Sample one clip def into a THREE.AnimationClip (30 fps dense keys). */
export function buildClip(def: ClipDef, rig: HeroRig): THREE.AnimationClip {
  const keys = normalizedKeys(def);
  const eases = keys.map(k => k.ease ?? 'smooth');
  const boneTracks = collectBoneKeys(keys);
  const root = collectRootKeys(keys, rig.bindPos.Hips);
  const frames = Math.max(2, Math.round(def.duration * SAMPLE_HZ) + 1);
  const tracks: THREE.KeyframeTrack[] = [];
  const tmpQ = new THREE.Quaternion();
  for (const name of BONE_NAMES) {
    const bone = boneTracks.get(name)!;
    const times = new Float32Array(frames);
    const values = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) {
      const t = Math.min(def.duration, (f / (frames - 1)) * def.duration);
      const q = sampleTrack(bone.times, bone.quats, eases, t, (a, b, k) => tmpQ.copy(a).slerp(b, k).clone());
      times[f] = t;
      values[f * 4] = q.x;
      values[f * 4 + 1] = q.y;
      values[f * 4 + 2] = q.z;
      values[f * 4 + 3] = q.w;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [...times], [...values]));
  }
  {
    const times = new Float32Array(frames);
    const values = new Float32Array(frames * 3);
    const tmpV = new THREE.Vector3();
    for (let f = 0; f < frames; f++) {
      const t = Math.min(def.duration, (f / (frames - 1)) * def.duration);
      const p = sampleTrack(root.times, root.points, eases, t, (a, b, k) => tmpV.copy(a).lerp(b, k).clone());
      times[f] = t;
      values[f * 3] = p.x;
      values[f * 3 + 1] = p.y;
      values[f * 3 + 2] = p.z;
    }
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', [...times], [...values]));
  }
  return new THREE.AnimationClip(def.name, def.duration, tracks);
}

/** Build the full catalogue (loop clips get matching end keys automatically). */
export function buildClips(rig: HeroRig): Map<ClipName, THREE.AnimationClip> {
  const out = new Map<ClipName, THREE.AnimationClip>();
  for (const name of Object.keys(CLIP_DEFS) as ClipName[]) {
    out.set(name, buildClip(CLIP_DEFS[name], rig));
  }
  return out;
}
