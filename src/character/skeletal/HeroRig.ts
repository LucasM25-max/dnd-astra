import * as THREE from 'three';

/**
 * Skeletal hero rig: a 22-bone humanoid in a relaxed A-pose bind position.
 *
 * All rest rotations are identity — the A-pose comes from joint *positions*,
 * and limb geometry is authored along the bone segments, so the bind pose
 * needs no counter-rotation. Units are metres; the hero stands ~1.80 m and
 * faces +Z. Bone names follow the Mixamo convention so future GLB clips can
 * retarget onto this rig.
 */

export const BONE_NAMES = [
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'ShoulderL',
  'ShoulderR',
  'UpperArmL',
  'UpperArmR',
  'LowerArmL',
  'LowerArmR',
  'HandL',
  'HandR',
  'UpperLegL',
  'UpperLegR',
  'LowerLegL',
  'LowerLegR',
  'FootL',
  'FootR',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

/** Bind-pose world position + parent for every bone. Mirrored L/R pairs. */
interface BoneDef {
  pos: [number, number, number];
  parent: BoneName | null;
}

export const BONE_DEFS: Record<BoneName, BoneDef> = {
  Hips: { pos: [0, 0.98, 0], parent: null },
  Spine: { pos: [0, 1.1, 0], parent: 'Hips' },
  Chest: { pos: [0, 1.32, 0], parent: 'Spine' },
  Neck: { pos: [0, 1.5, 0], parent: 'Chest' },
  Head: { pos: [0, 1.62, 0], parent: 'Neck' },
  ShoulderL: { pos: [0.07, 1.46, 0], parent: 'Chest' },
  ShoulderR: { pos: [-0.07, 1.46, 0], parent: 'Chest' },
  UpperArmL: { pos: [0.25, 1.43, 0], parent: 'ShoulderL' },
  UpperArmR: { pos: [-0.25, 1.43, 0], parent: 'ShoulderR' },
  LowerArmL: { pos: [0.3, 1.16, 0.01], parent: 'UpperArmL' },
  LowerArmR: { pos: [-0.3, 1.16, 0.01], parent: 'UpperArmR' },
  HandL: { pos: [0.33, 0.9, 0.02], parent: 'LowerArmL' },
  HandR: { pos: [-0.33, 0.9, 0.02], parent: 'LowerArmR' },
  UpperLegL: { pos: [0.11, 0.94, 0], parent: 'Hips' },
  UpperLegR: { pos: [-0.11, 0.94, 0], parent: 'Hips' },
  LowerLegL: { pos: [0.12, 0.5, 0.01], parent: 'UpperLegL' },
  LowerLegR: { pos: [-0.12, 0.5, 0.01], parent: 'UpperLegR' },
  FootL: { pos: [0.12, 0.09, 0.06], parent: 'LowerLegL' },
  FootR: { pos: [-0.12, 0.09, 0.06], parent: 'LowerLegR' },
};

/** Where a bone's segment ends in bind space (child joint, or a virtual tip). */
const SEGMENT_TIPS: Partial<Record<BoneName, [number, number, number]>> = {
  Head: [0, 1.82, 0.01],
  HandL: [0.34, 0.74, 0.04],
  HandR: [-0.34, 0.74, 0.04],
  FootL: [0.12, 0.05, 0.24],
  FootR: [-0.12, 0.05, 0.24],
};

export interface HeroRig {
  /** Root group holding the whole bone hierarchy (identity transform). */
  group: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  skeleton: THREE.Skeleton;
  /** Bind-pose world position of each bone (handy for geometry authoring). */
  bindPos: Record<BoneName, THREE.Vector3>;
  /** Bind-pose segment end for each bone (child joint or virtual tip). */
  segmentTip: Record<BoneName, THREE.Vector3>;
  /** Total hero height in metres (crown of the head). */
  height: number;
}

export function buildRig(): HeroRig {
  const group = new THREE.Group();
  group.name = 'HeroRig';
  const bones = {} as Record<BoneName, THREE.Bone>;
  const bindPos = {} as Record<BoneName, THREE.Vector3>;
  for (const name of BONE_NAMES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const def = BONE_DEFS[name];
    bindPos[name] = new THREE.Vector3(...def.pos);
    bones[name] = bone;
  }
  // Local transforms: rest rotation identity, position relative to the parent.
  for (const name of BONE_NAMES) {
    const def = BONE_DEFS[name];
    if (def.parent === null) {
      bones[name].position.copy(bindPos[name]);
      group.add(bones[name]);
    } else {
      bones[name].position.copy(bindPos[name]).sub(bindPos[def.parent]);
      bones[def.parent].add(bones[name]);
    }
  }
  const childrenOf = (name: BoneName): BoneName[] =>
    BONE_NAMES.filter(n => BONE_DEFS[n].parent === name);
  const segmentTip = {} as Record<BoneName, THREE.Vector3>;
  for (const name of BONE_NAMES) {
    const tip = SEGMENT_TIPS[name];
    if (tip) {
      segmentTip[name] = new THREE.Vector3(...tip);
      continue;
    }
    const kids = childrenOf(name);
    // Childless non-tip bones (shoulders feed arms) fall back to the first child.
    const child = kids[0];
    segmentTip[name] = child ? bindPos[child].clone() : bindPos[name].clone();
  }
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(Object.values(bones));
  return { group, bones, skeleton, bindPos, segmentTip, height: 1.8 };
}

/** Unit direction of a bone's segment in bind space. */
export function segmentDir(rig: HeroRig, name: BoneName): THREE.Vector3 {
  return rig.segmentTip[name].clone().sub(rig.bindPos[name]).normalize();
}

/**
 * Closest-point parameter of `p` on the segment a→b, in segment-length units
 * (0 at a, 1 at b), clamped. Used to place skin-weight blends along limbs.
 */
export function segmentParam(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-10) return 0;
  const t = p.clone().sub(a).dot(ab) / lenSq;
  return Math.min(1, Math.max(0, t));
}
