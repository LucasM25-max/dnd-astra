import * as THREE from 'three';

/**
 * Skeletal quadruped rig for the draught oxen and the living horses.
 *
 * Authored in character space (+Z = facing, Y up, metres) with the same
 * conventions as the hero rig: rest rotations are identity and the part
 * geometry is authored along the bone segments. `SkeletalQuadruped` rotates
 * the whole assembly π about Y at build so the avatar world convention
 * (forward = −Z at yaw 0) holds, exactly like the player.
 *
 * The skeleton is a real animal's hierarchy rather than four sticks on a box:
 * the spine is a four-bone chain so the back springs, the neck has two bones
 * so grazing bends instead of pivoting, the forelegs hang off rotating
 * shoulder blades (the scapula is where a horse's stride comes from), the head
 * carries jaw, ear and eyelid bones so the face animates, and the tail has
 * three joints for a swishing switch.
 *
 * Bone names follow the Mixamo quadruped-ish convention so future GLB clips
 * could retarget onto this rig.
 */

export type QuadSpecies = 'ox' | 'horse';

export const QUAD_BONES = [
  'Root', 'Hips', 'Loin', 'Chest', 'Withers', 'Neck1', 'Neck2', 'Head', 'Jaw',
  'EarL', 'EarR', 'EyelidL', 'EyelidR',
  'Tail1', 'Tail2', 'Tail3',
  'ShoulderFL', 'UpperLegFL', 'LowerLegFL', 'FootFL',
  'ShoulderFR', 'UpperLegFR', 'LowerLegFR', 'FootFR',
  'PelvisRL', 'UpperLegRL', 'LowerLegRL', 'FootRL',
  'PelvisRR', 'UpperLegRR', 'LowerLegRR', 'FootRR',
] as const;
export type QuadBoneName = (typeof QUAD_BONES)[number];

export type LegId = 'FL' | 'FR' | 'RL' | 'RR';
export const LEG_IDS: LegId[] = ['FL', 'FR', 'RL', 'RR'];
/** Forelegs hang off the scapula, hind legs off the pelvis. */
export const LEG_ROOT: Record<LegId, QuadBoneName> = {
  FL: 'ShoulderFL', FR: 'ShoulderFR', RL: 'PelvisRL', RR: 'PelvisRR',
};
export const isForeLeg = (leg: LegId): boolean => leg[0] === 'F';

/** One elliptical cross-section of a lofted body part. */
export interface LoftSection {
  at: [number, number, number];
  /** Half-width across the animal, half-height up. */
  hw: number;
  hh: number;
  /** Vertical offset in metres: sculpts the belly tuck and muscle masses. */
  off?: [number, number];
  /** Roll the ellipse in its own plane (radians). */
  roll?: number;
}

export interface LegSpec {
  /**
   * Six loft joints, proximal → distal.
   * Foreleg: scapula top, shoulder, elbow, knee, fetlock, coronary.
   * Hindleg: hip, stifle, hock, fetlock, pastern, coronary.
   */
  chain: [number, number, number][];
  /** Elliptical radii per joint: [half-width, half-height]. */
  radii: [number, number][];
  /** 1 = hock points back (hind), -1 = knee points forward (fore). */
  kneeSign: 1 | -1;
  /** Hoof capsule: half-width, depth, height. */
  hoof: [number, number, number];
}

export interface GaitSpec {
  /** Full cycle seconds at a walk / trot. */
  duration: number;
  /** Stride length in metres and hoof lift in metres. */
  stride: number;
  lift: number;
  /** Fraction of the cycle each foot is on the ground. */
  duty: number;
  /**
   * Cycle fraction (0..1) at which each foot *lands*. Read straight off an
   * actual footfall diagram: a horse's walk is LH → LF → RH → RF, a yoke ox's
   * amble compresses those into two lateral couples, and a trot is diagonal
   * pairs landing together.
   */
  phases: Record<LegId, number>;
  /** Ground covered per cycle, in metres: what couples the clip to real speed. */
  cycleTravel: number;
}

export interface SpeciesSpec {
  trunk: LoftSection[];
  neck1: LoftSection[];
  neck2: LoftSection[];
  head: LoftSection[];
  skull: [number, number, number];
  eye: { x: number; y: number; z: number; r: number };
  ear: { y: number; z: number; len: number; wide: number; tilt: number; spread: number };
  jaw: { hinge: [number, number]; len: number; drop: number; wide: number };
  horn?: { root: [number, number, number]; reach: number; r: number; rise: number; spread: number; curl: number };
  mane?: { crest: number; length: number };
  dewlap?: boolean;
  tail: LoftSection[];
  tuft: { r: number; len: number };
  legs: Record<LegId, LegSpec>;
  /** Harness anchors: ox yoke pad / horse bridle, in bind space. */
  tack: { collarY: number; collarZ: number; chestY: number; chestZ: number };
  gait: { walk: GaitSpec; trot: GaitSpec; bob: number; roll: number; trotSpeed: number };
  height: number;
  nose: [number, number, number];
}

/**
 * A yoke ox: broad and deep-chested with a muscular rump, horns, a heavy
 * dewlap, and a lateral footfall sequence — cattle move both left legs then
 * both right, which is why a team ambles rather than struts.
 */
const OX: SpeciesSpec = {
  // A draught ox is a rectangular prism with a heavy shoulder hump over the
  // withers, a deep brisket, and a wide, low-set rump.
  trunk: [
    { at: [0, 1.02, 0.78], hw: 0.235, hh: 0.295 },
    { at: [0, 1.12, 0.56], hw: 0.305, hh: 0.355 },
    { at: [0, 1.15, 0.3], hw: 0.34, hh: 0.365 },
    { at: [0, 1.1, 0.04], hw: 0.335, hh: 0.35 },
    { at: [0, 1.05, -0.24], hw: 0.315, hh: 0.325 },
    { at: [0, 1.08, -0.46], hw: 0.325, hh: 0.34 },
    { at: [0, 1.14, -0.64], hw: 0.315, hh: 0.325 },
    { at: [0, 1.08, -0.82], hw: 0.235, hh: 0.265 },
  ],
  // The neck rises *forward* out of the withers and the head hangs down off
  // the poll at ~35°: the posture a grazing, yoked beast actually holds.
  neck1: [
    // Broad at the root, but a neck — not a bell welded to the shoulders: the
    // flare is what read as a hood draped over the withers.
    { at: [0, 1.26, 0.62], hw: 0.196, hh: 0.212 },
    { at: [0, 1.38, 0.7], hw: 0.184, hh: 0.198 },
    { at: [0, 1.47, 0.79], hw: 0.17, hh: 0.182 },
  ],
  neck2: [
    { at: [0, 1.53, 0.85], hw: 0.175, hh: 0.185 },
    { at: [0, 1.58, 0.91], hw: 0.16, hh: 0.168 },
    { at: [0, 1.61, 0.97], hw: 0.15, hh: 0.155 },
  ],
  head: [
    { at: [0, 1.61, 1.02], hw: 0.152, hh: 0.145 },
    { at: [0, 1.57, 1.1], hw: 0.146, hh: 0.138 },
    { at: [0, 1.51, 1.17], hw: 0.132, hh: 0.12 },
    { at: [0, 1.45, 1.23], hw: 0.118, hh: 0.102 },
    { at: [0, 1.39, 1.28], hw: 0.104, hh: 0.088 },
    { at: [0, 1.33, 1.33], hw: 0.09, hh: 0.072 },
  ],
  skull: [0, 1.585, 1.08],
  eye: { x: 0.128, y: 1.555, z: 1.1, r: 0.032 },
  ear: { y: 1.6, z: 1.0, len: 0.11, wide: 0.05, tilt: -0.42, spread: 0.95 },
  jaw: { hinge: [1.44, 1.06], len: 0.28, drop: 0.04, wide: 0.086 },
  horn: { root: [0.132, 1.64, 1.0], reach: 0.26, r: 0.044, rise: 0.14, spread: 1.1, curl: 0.5 },
  dewlap: true,
  tail: [
    { at: [0, 1.22, -0.86], hw: 0.055, hh: 0.055 },
    { at: [0, 1.08, -0.95], hw: 0.042, hh: 0.045 },
    { at: [0, 0.88, -0.96], hw: 0.034, hh: 0.036 },
    { at: [0, 0.66, -0.9], hw: 0.028, hh: 0.03 },
  ],
  tuft: { r: 0.052, len: 0.17 },
  legs: {
    FL: {
      chain: [[0.19, 1.28, 0.42], [0.205, 1.02, 0.5], [0.21, 0.74, 0.36], [0.21, 0.5, 0.42], [0.21, 0.3, 0.4], [0.21, 0.13, 0.42]],
      radii: [[0.13, 0.15], [0.115, 0.125], [0.082, 0.09], [0.06, 0.066], [0.056, 0.06], [0.062, 0.066]],
      kneeSign: -1, hoof: [0.082, 0.1, 0.09],
    },
    FR: {
      chain: [[-0.19, 1.28, 0.42], [-0.205, 1.02, 0.5], [-0.21, 0.74, 0.36], [-0.21, 0.5, 0.42], [-0.21, 0.3, 0.4], [-0.21, 0.13, 0.42]],
      radii: [[0.13, 0.15], [0.115, 0.125], [0.082, 0.09], [0.06, 0.066], [0.056, 0.06], [0.062, 0.066]],
      kneeSign: -1, hoof: [0.082, 0.1, 0.09],
    },
    RL: {
      chain: [[0.21, 1.16, -0.62], [0.22, 0.92, -0.44], [0.215, 0.58, -0.74], [0.21, 0.34, -0.68], [0.21, 0.2, -0.65], [0.21, 0.13, -0.64]],
      radii: [[0.165, 0.18], [0.12, 0.135], [0.075, 0.085], [0.058, 0.064], [0.055, 0.06], [0.06, 0.066]],
      kneeSign: 1, hoof: [0.078, 0.095, 0.085],
    },
    RR: {
      chain: [[-0.21, 1.16, -0.62], [-0.22, 0.92, -0.44], [-0.215, 0.58, -0.74], [-0.21, 0.34, -0.68], [-0.21, 0.2, -0.65], [-0.21, 0.13, -0.64]],
      radii: [[0.165, 0.18], [0.12, 0.135], [0.075, 0.085], [0.058, 0.064], [0.055, 0.06], [0.06, 0.066]],
      kneeSign: 1, hoof: [0.078, 0.095, 0.085],
    },
  },
  tack: { collarY: 1.34, collarZ: 0.64, chestY: 0.96, chestZ: 0.66 },
  gait: {
    // Cattle amble: the left couple then the right couple, long stance, almost
    // no suspension — which is why a team of oxen rolls rather than struts.
    walk: { duration: 1.32, stride: 0.19, lift: 0.052, duty: 0.68, phases: { RL: 0, FL: 0.12, RR: 0.5, FR: 0.62 }, cycleTravel: 1.05 },
    trot: { duration: 0.95, stride: 0.25, lift: 0.08, duty: 0.52, phases: { FL: 0, RR: 0, FR: 0.5, RL: 0.5 }, cycleTravel: 1.9 },
    bob: 0.024, roll: 2.7, trotSpeed: 1.1,
  },
  height: 1.5,
  nose: [0, 1.3, 1.37],
};

/**
 * A draught horse: longer, springier legs, a sloping croup, a defined withers,
 * a lateral-sequence walk with clear overstep, and a two-beat diagonal trot
 * with real suspension.
 */
const HORSE: SpeciesSpec = {
  // A riding horse's barrel is deepest just behind the elbow and tups up hard
  // toward the flank; the forechest is a narrow wedge, not a flat wall.
  trunk: [
    { at: [0, 1.16, 0.82], hw: 0.195, hh: 0.275 },
    { at: [0, 1.26, 0.58], hw: 0.238, hh: 0.315 },
    { at: [0, 1.3, 0.32], hw: 0.27, hh: 0.315 },
    { at: [0, 1.25, 0.06], hw: 0.275, hh: 0.3 },
    { at: [0, 1.19, -0.2], hw: 0.26, hh: 0.27 },
    { at: [0, 1.23, -0.44], hw: 0.268, hh: 0.288 },
    { at: [0, 1.3, -0.64], hw: 0.262, hh: 0.275 },
    { at: [0, 1.2, -0.82], hw: 0.2, hh: 0.23 },
  ],
  // A horse's neck is a long lever set at ~45° out of the withers, tapering to
  // a poll that is noticeably narrower than the chest, and the head drops
  // forward from there. Getting this angle right is most of the silhouette.
  // The neck's root is *wider* than the crest and sinks into the withers, so
  // the two read as one mass — the classic giveaway of a bad horse is a neck
  // stuck on top of a barrel like a garden hose.
  neck1: [
    { at: [0, 1.44, 0.62], hw: 0.205, hh: 0.225 },
    { at: [0, 1.6, 0.7], hw: 0.172, hh: 0.19 },
    { at: [0, 1.72, 0.79], hw: 0.142, hh: 0.158 },
  ],
  neck2: [
    { at: [0, 1.8, 0.86], hw: 0.128, hh: 0.14 },
    { at: [0, 1.86, 0.93], hw: 0.114, hh: 0.124 },
    { at: [0, 1.9, 1.0], hw: 0.102, hh: 0.11 },
  ],
  head: [
    { at: [0, 1.885, 1.06], hw: 0.102, hh: 0.106 },
    { at: [0, 1.855, 1.15], hw: 0.096, hh: 0.1 },
    { at: [0, 1.805, 1.24], hw: 0.086, hh: 0.088 },
    { at: [0, 1.735, 1.32], hw: 0.076, hh: 0.074 },
    { at: [0, 1.665, 1.39], hw: 0.069, hh: 0.06 },
    { at: [0, 1.60, 1.45], hw: 0.06, hh: 0.046 },
  ],
  skull: [0, 1.865, 1.13],
  eye: { x: 0.1, y: 1.83, z: 1.17, r: 0.03 },
  ear: { y: 1.93, z: 1.04, len: 0.125, wide: 0.044, tilt: -0.28, spread: 0.42 },
  jaw: { hinge: [1.74, 1.12], len: 0.3, drop: 0.035, wide: 0.072 },
  mane: { crest: 0.1, length: 0.44 },
  tail: [
    { at: [0, 1.29, -0.84], hw: 0.068, hh: 0.062 },
    { at: [0, 1.12, -0.95], hw: 0.058, hh: 0.056 },
    { at: [0, 0.9, -0.98], hw: 0.048, hh: 0.048 },
    { at: [0, 0.66, -0.94], hw: 0.038, hh: 0.04 },
  ],
  tuft: { r: 0.058, len: 0.24 },
  legs: {
    FL: {
      chain: [[0.155, 1.46, 0.34], [0.165, 1.16, 0.46], [0.168, 0.84, 0.34], [0.166, 0.6, 0.42], [0.162, 0.36, 0.4], [0.16, 0.14, 0.42]],
      radii: [[0.105, 0.125], [0.092, 0.1], [0.062, 0.07], [0.05, 0.056], [0.046, 0.05], [0.05, 0.054]],
      kneeSign: -1, hoof: [0.064, 0.08, 0.075],
    },
    FR: {
      chain: [[-0.155, 1.46, 0.34], [-0.165, 1.16, 0.46], [-0.168, 0.84, 0.34], [-0.166, 0.6, 0.42], [-0.162, 0.36, 0.4], [-0.16, 0.14, 0.42]],
      radii: [[0.105, 0.125], [0.092, 0.1], [0.062, 0.07], [0.05, 0.056], [0.046, 0.05], [0.05, 0.054]],
      kneeSign: -1, hoof: [0.064, 0.08, 0.075],
    },
    RL: {
      chain: [[0.17, 1.26, -0.6], [0.185, 0.98, -0.42], [0.176, 0.62, -0.76], [0.17, 0.36, -0.7], [0.168, 0.21, -0.67], [0.166, 0.14, -0.66]],
      radii: [[0.15, 0.17], [0.092, 0.105], [0.06, 0.07], [0.048, 0.054], [0.044, 0.048], [0.048, 0.052]],
      kneeSign: 1, hoof: [0.062, 0.078, 0.07],
    },
    RR: {
      chain: [[-0.17, 1.26, -0.6], [-0.185, 0.98, -0.42], [-0.176, 0.62, -0.76], [-0.17, 0.36, -0.7], [-0.168, 0.21, -0.67], [-0.166, 0.14, -0.66]],
      radii: [[0.15, 0.17], [0.092, 0.105], [0.06, 0.07], [0.048, 0.054], [0.044, 0.048], [0.048, 0.052]],
      kneeSign: 1, hoof: [0.062, 0.078, 0.07],
    },
  },
  tack: { collarY: 1.42, collarZ: 0.66, chestY: 1.06, chestZ: 0.68 },
  gait: {
    // Lateral-sequence 4-beat walk (LH → LF → RH → RF) with an overstep, then
    // the two-beat diagonal trot with real suspension.
    walk: { duration: 1.06, stride: 0.24, lift: 0.06, duty: 0.62, phases: { RL: 0, FL: 0.25, RR: 0.5, FR: 0.75 }, cycleTravel: 1.35 },
    trot: { duration: 0.7, stride: 0.34, lift: 0.108, duty: 0.4, phases: { FL: 0, RR: 0, FR: 0.5, RL: 0.5 }, cycleTravel: 2.55 },
    bob: 0.028, roll: 2.1, trotSpeed: 1.35,
  },
  height: 1.62,
  nose: [0, 1.57, 1.49],
};

export const QUAD_SPECS: Record<QuadSpecies, SpeciesSpec> = { ox: OX, horse: HORSE };

/** Spine bones front → back with the blend centre between each pair. */
export const SPINE_STOPS: [QuadBoneName, number][] = [
  ['Withers', 0.62], ['Chest', 0.19], ['Loin', -0.28], ['Hips', -0.78],
];

/** Joint positions the skeleton is authored around (bind space). */
export function quadBindPositions(spec: SpeciesSpec): Record<QuadBoneName, THREE.Vector3> {
  const v = (t: [number, number, number]) => new THREE.Vector3(t[0], t[1], t[2]);
  const bind = {} as Record<QuadBoneName, THREE.Vector3>;
  bind.Root = new THREE.Vector3(0, 0, 0);
  bind.Hips = v([0, spec.trunk[6].at[1], -0.66]);
  bind.Loin = v([0, spec.trunk[4].at[1], -0.16]);
  bind.Chest = v([0, spec.trunk[2].at[1], 0.34]);
  bind.Withers = v([0, spec.neck1[0].at[1] - spec.neck1[0].hh * 0.55, spec.neck1[0].at[2] - 0.14]);
  bind.Neck1 = v(spec.neck1[1].at);
  bind.Neck2 = v(spec.neck2[1].at);
  bind.Head = v(spec.neck2[2].at);
  bind.Jaw = v([0, spec.jaw.hinge[0], spec.jaw.hinge[1]]);
  bind.EarL = v([spec.ear.wide * 1.05, spec.ear.y, spec.ear.z]);
  bind.EarR = v([-spec.ear.wide * 1.05, spec.ear.y, spec.ear.z]);
  bind.EyelidL = v([spec.eye.x, spec.eye.y + spec.eye.r * 0.25, spec.eye.z + spec.eye.r * 0.35]);
  bind.EyelidR = v([-spec.eye.x, spec.eye.y + spec.eye.r * 0.25, spec.eye.z + spec.eye.r * 0.35]);
  bind.Tail1 = v(spec.tail[0].at);
  bind.Tail2 = v(spec.tail[1].at);
  bind.Tail3 = v(spec.tail[2].at);
  for (const leg of LEG_IDS) {
    const [p0, p1, p2, p3] = spec.legs[leg].chain;
    bind[LEG_ROOT[leg]] = v(p0);
    // Foreleg: UpperLeg hinges at the shoulder, LowerLeg at the elbow, Foot at
    // the fetlock. Hindleg: UpperLeg at the hip, LowerLeg at the stifle, Foot
    // at the hock (the tarsus is rigid enough to ride with the metatarsus).
    if (isForeLeg(leg)) {
      bind[`UpperLeg${leg}` as QuadBoneName] = v(p1);
      bind[`LowerLeg${leg}` as QuadBoneName] = v(p2);
      bind[`Foot${leg}` as QuadBoneName] = v(p3);
    } else {
      bind[`UpperLeg${leg}` as QuadBoneName] = v(p0);
      bind[`LowerLeg${leg}` as QuadBoneName] = v(p1);
      bind[`Foot${leg}` as QuadBoneName] = v(p2);
    }
  }
  return bind;
}

const PARENT: Partial<Record<QuadBoneName, QuadBoneName>> = {
  Hips: 'Root',
  Loin: 'Hips', Chest: 'Loin', Withers: 'Chest',
  Neck1: 'Withers', Neck2: 'Neck1', Head: 'Neck2',
  Jaw: 'Head', EarL: 'Head', EarR: 'Head', EyelidL: 'Head', EyelidR: 'Head',
  Tail1: 'Hips', Tail2: 'Tail1', Tail3: 'Tail2',
  ShoulderFL: 'Withers', ShoulderFR: 'Withers',
  UpperLegFL: 'ShoulderFL', UpperLegFR: 'ShoulderFR',
  LowerLegFL: 'UpperLegFL', LowerLegFR: 'UpperLegFR',
  FootFL: 'LowerLegFL', FootFR: 'LowerLegFR',
  PelvisRL: 'Hips', PelvisRR: 'Hips',
  UpperLegRL: 'PelvisRL', UpperLegRR: 'PelvisRR',
  LowerLegRL: 'UpperLegRL', LowerLegRR: 'UpperLegRR',
  FootRL: 'LowerLegRL', FootRR: 'UpperLegRR',
};

export interface QuadRig {
  group: THREE.Group;
  bones: Record<QuadBoneName, THREE.Bone>;
  skeleton: THREE.Skeleton;
  bindPos: Record<QuadBoneName, THREE.Vector3>;
  species: QuadSpecies;
  spec: SpeciesSpec;
  height: number;
}

export function buildQuadrupedRig(species: QuadSpecies): QuadRig {
  const spec = QUAD_SPECS[species];
  const bindPos = quadBindPositions(spec);
  const group = new THREE.Group();
  group.name = `${species}_rig`;
  const bones = {} as Record<QuadBoneName, THREE.Bone>;
  for (const name of QUAD_BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    bones[name] = bone;
  }
  for (const name of QUAD_BONES) {
    const parent = PARENT[name];
    if (!parent) {
      bones[name].position.copy(bindPos[name]);
      group.add(bones[name]);
    } else {
      bones[name].position.copy(bindPos[name].clone().sub(bindPos[parent]));
      bones[parent].add(bones[name]);
    }
  }
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(QUAD_BONES.map(n => bones[n]));
  return { group, bones, skeleton, bindPos, species, spec, height: spec.height };
}

/** Unit direction from one bind joint to the next (the bone's long axis). */
export function boneAxis(bindPos: Record<QuadBoneName, THREE.Vector3>, from: QuadBoneName, to: QuadBoneName): THREE.Vector3 {
  return bindPos[to].clone().sub(bindPos[from]).normalize();
}

/** The bone a leg's foot segment lives on (hoof pitch compensation). */
export function footBone(leg: LegId): QuadBoneName {
  return `Foot${leg}` as QuadBoneName;
}

/** Cumulative pitch of the leg chain above the foot — used to plant hooves. */
export function legChainPitch(leg: LegId): QuadBoneName[] {
  return isForeLeg(leg)
    ? [`UpperLeg${leg}`, `LowerLeg${leg}`]
    : [`UpperLeg${leg}`, `LowerLeg${leg}`] as QuadBoneName[];
}

/** Fetlock height above the ground — used by tests and ground checks. */
export function fetlockHeight(spec: SpeciesSpec, leg: LegId): number {
  const c = spec.legs[leg].chain;
  return isForeLeg(leg) ? c[4][1] : c[3][1];
}

/** Belly clearance above the ground, which gates where a team can step. */
export function bellyClearance(spec: SpeciesSpec): number {
  let low = Infinity;
  for (const s of spec.trunk) low = Math.min(low, s.at[1] - s.hh);
  return low;
}
