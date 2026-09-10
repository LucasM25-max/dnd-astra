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
 * NO-COMBAT: attack / hit / death / salute exist for the creation-preview
 * flourish buttons ONLY. Gameplay code plays locomotion + one-shots through
 * SkeletalCharacterModel, which rejects preview-only names (tested).
 */

export type ClipName =
  | 'idle'
  | 'idle_dual'
  | 'idle_bow'
  | 'walk'
  | 'run'
  | 'attack_slash_1h'
  | 'hit_react'
  | 'death'
  | 'interact'
  | 'second_wind'
  | 'long_rest_sit'
  | 'stand_up'
  | 'salute';

export const PREVIEW_ONLY_CLIPS: ReadonlySet<ClipName> = new Set([
  'attack_slash_1h',
  'hit_react',
  'death',
  'salute',
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

function idleClip(name: 'idle' | 'idle_dual' | 'idle_bow', arms: Pose, breathe: number, sway: number): ClipDef {
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

const WALK_CYCLE: ClipKey[] = [
  {
    t: 0,
    root: [0, -0.008, 0],
    pose: {
      UpperLegL: [-28, 0, 0], LowerLegL: [8, 0, 0], FootL: [-4, 0, 0],
      UpperLegR: [26, 0, 0], LowerLegR: [18, 0, 0], FootR: [22, 0, 0],
      Hips: [0, 5, 0], Spine: [2, 0, 0], Chest: [1, -5, 0], Head: [0, 3, 0],
      UpperArmL: [18, 0, 4], LowerArmL: [-20, 0, 0],
      UpperArmR: [-20, 0, -4], LowerArmR: [-26, 0, 0],
    },
  },
  {
    t: 0.25,
    root: [0, -0.026, 0],
    pose: {
      UpperLegL: [-6, 0, 0], LowerLegL: [24, 0, 0], FootL: [8, 0, 0],
      UpperLegR: [8, 0, 0], LowerLegR: [42, 0, 0], FootR: [34, 0, 0],
      Hips: [0, 0, 0], Spine: [2.5, 0, 0], Chest: [1, 0, 0], Head: [1, 0, 0],
      UpperArmL: [6, 0, 4], LowerArmL: [-22, 0, 0],
      UpperArmR: [-6, 0, -4], LowerArmR: [-24, 0, 0],
    },
  },
  {
    t: 0.5,
    root: [0, -0.008, 0],
    pose: {
      UpperLegL: [26, 0, 0], LowerLegL: [18, 0, 0], FootL: [22, 0, 0],
      UpperLegR: [-28, 0, 0], LowerLegR: [8, 0, 0], FootR: [-4, 0, 0],
      Hips: [0, -5, 0], Spine: [2, 0, 0], Chest: [1, 5, 0], Head: [0, -3, 0],
      UpperArmL: [-20, 0, 4], LowerArmL: [-26, 0, 0],
      UpperArmR: [18, 0, -4], LowerArmR: [-20, 0, 0],
    },
  },
  {
    t: 0.75,
    root: [0, -0.026, 0],
    pose: {
      UpperLegL: [8, 0, 0], LowerLegL: [42, 0, 0], FootL: [34, 0, 0],
      UpperLegR: [-6, 0, 0], LowerLegR: [24, 0, 0], FootR: [8, 0, 0],
      Hips: [0, 0, 0], Spine: [2.5, 0, 0], Chest: [1, 0, 0], Head: [1, 0, 0],
      UpperArmL: [-6, 0, 4], LowerArmL: [-24, 0, 0],
      UpperArmR: [6, 0, -4], LowerArmR: [-22, 0, 0],
    },
  },
];

const RUN_CYCLE: ClipKey[] = [
  {
    t: 0,
    root: [0, -0.01, 0],
    pose: {
      UpperLegL: [-46, 0, 0], LowerLegL: [20, 0, 0], FootL: [30, 0, 0],
      UpperLegR: [38, 0, 0], LowerLegR: [72, 0, 0], FootR: [48, 0, 0],
      Hips: [0, 6, 0], Spine: [9, 0, 0], Chest: [6, -6, 0], Head: [-6, 4, 0],
      UpperArmL: [30, 0, 5], LowerArmL: [-62, 0, 0],
      UpperArmR: [-34, 0, -5], LowerArmR: [-58, 0, 0],
    },
  },
  {
    t: 0.155,
    root: [0, -0.045, 0],
    pose: {
      UpperLegL: [-10, 0, 0], LowerLegL: [44, 0, 0], FootL: [20, 0, 0],
      UpperLegR: [10, 0, 0], LowerLegR: [88, 0, 0], FootR: [55, 0, 0],
      Hips: [0, 0, 0], Spine: [10, 0, 0], Chest: [7, 0, 0], Head: [-6, 0, 0],
      UpperArmL: [10, 0, 5], LowerArmL: [-66, 0, 0],
      UpperArmR: [-10, 0, -5], LowerArmR: [-64, 0, 0],
    },
  },
  {
    t: 0.31,
    root: [0, -0.01, 0],
    pose: {
      UpperLegL: [38, 0, 0], LowerLegL: [72, 0, 0], FootL: [48, 0, 0],
      UpperLegR: [-46, 0, 0], LowerLegR: [20, 0, 0], FootR: [30, 0, 0],
      Hips: [0, -6, 0], Spine: [9, 0, 0], Chest: [6, 6, 0], Head: [-6, -4, 0],
      UpperArmL: [-34, 0, 5], LowerArmL: [-58, 0, 0],
      UpperArmR: [30, 0, -5], LowerArmR: [-62, 0, 0],
    },
  },
  {
    t: 0.465,
    root: [0, -0.045, 0],
    pose: {
      UpperLegL: [10, 0, 0], LowerLegL: [88, 0, 0], FootL: [55, 0, 0],
      UpperLegR: [-10, 0, 0], LowerLegR: [44, 0, 0], FootR: [20, 0, 0],
      Hips: [0, 0, 0], Spine: [10, 0, 0], Chest: [7, 0, 0], Head: [-6, 0, 0],
      UpperArmL: [-10, 0, 5], LowerArmL: [-64, 0, 0],
      UpperArmR: [10, 0, -5], LowerArmR: [-66, 0, 0],
    },
  },
];

export const CLIP_DEFS: Record<ClipName, ClipDef> = {
  idle: idleClip('idle', RELAXED_ARMS, 1, 1),
  idle_dual: idleClip('idle_dual', DUAL_ARMS, 1.25, 0.7),
  idle_bow: idleClip('idle_bow', RELAXED_ARMS, 0.9, 1.3),

  walk: { name: 'walk', duration: 1, loop: true, previewOnly: false, keys: WALK_CYCLE },
  run: { name: 'run', duration: 0.62, loop: true, previewOnly: false, keys: RUN_CYCLE },

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

  salute: {
    name: 'salute',
    duration: 1.2,
    loop: false,
    previewOnly: true,
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
