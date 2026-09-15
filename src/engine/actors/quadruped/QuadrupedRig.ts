import * as THREE from 'three';

/**
 * Skeletal quadruped rig for the draught oxen and the living horses.
 *
 * Authored in character space (+Z = facing, Y up, metres) with the same
 * conventions as the hero rig: rest rotations are identity and the limb
 * geometry is authored along the bone segments. `SkeletalQuadruped` rotates
 * the whole assembly π about Y at build so the avatar world convention
 * (forward = −Z at yaw 0) holds, exactly like the player.
 *
 * Bone names follow the Mixamo quadruped-ish convention so future GLB clips
 * could retarget onto this rig.
 */

export type QuadSpecies = 'ox' | 'horse';

export const QUAD_BONES = [
  'Root', 'Hips', 'Chest', 'Neck', 'Head', 'Tail1', 'Tail2',
  'UpperLegFL', 'LowerLegFL', 'FootFL',
  'UpperLegFR', 'LowerLegFR', 'FootFR',
  'UpperLegRL', 'LowerLegRL', 'FootRL',
  'UpperLegRR', 'LowerLegRR', 'FootRR',
] as const;
export type QuadBoneName = (typeof QUAD_BONES)[number];

export type LegId = 'FL' | 'FR' | 'RL' | 'RR';
export const LEG_IDS: LegId[] = ['FL', 'FR', 'RL', 'RR'];

export interface SpeciesSpec {
  /** Elliptical barrel cross-sections: [z, halfWidth, centreY, halfHeight]. */
  sections: [number, number, number, number][];
  neckBase: [number, number, number];
  neckTop: [number, number, number];
  skull: [number, number, number];
  muzzle: [number, number, number];
  muzzleTip: [number, number, number];
  /** Head-down (grazing / sniffing) targets. */
  graze: { neckTop: [number, number, number]; skull: [number, number, number]; muzzle: [number, number, number] };
  legs: Record<LegId, { x: number; z: number; hipY: number; thigh: number; shin: number; kneeSign: 1 | -1; ankleZ: number }>;
  legRadius: [number, number, number]; // upper, lower, pastern
  neckR: [number, number];
  tailBase: [number, number, number];
  tailMid: [number, number, number];
  tailTip: [number, number, number];
  /** Gait stride/lift in metres. */
  stride: number;
  lift: number;
  height: number;
}

const OX: SpeciesSpec = {
  sections: [[0.62, 0.24, 1.1, 0.3], [0.3, 0.29, 1.17, 0.36], [-0.05, 0.33, 1.08, 0.36], [-0.5, 0.29, 1.05, 0.34], [-0.68, 0.2, 1.06, 0.27]],
  neckBase: [0, 1.28, 0.5], neckTop: [0, 1.52, 0.72],
  skull: [0, 1.56, 0.86], muzzle: [0, 1.46, 1.0], muzzleTip: [0, 1.42, 1.1],
  graze: { neckTop: [0, 1.06, 0.8], skull: [0, 1.0, 0.94], muzzle: [0, 0.92, 1.06] },
  legs: {
    FL: { x: 0.2, z: 0.4, hipY: 1.0, thigh: 0.44, shin: 0.42, kneeSign: -1, ankleZ: -0.02 },
    FR: { x: -0.2, z: 0.4, hipY: 1.0, thigh: 0.44, shin: 0.42, kneeSign: -1, ankleZ: -0.02 },
    RL: { x: 0.22, z: -0.6, hipY: 0.92, thigh: 0.44, shin: 0.42, kneeSign: 1, ankleZ: -0.08 },
    RR: { x: -0.22, z: -0.6, hipY: 0.92, thigh: 0.44, shin: 0.42, kneeSign: 1, ankleZ: -0.08 },
  },
  legRadius: [0.105, 0.07, 0.055],
  neckR: [0.15, 0.12],
  tailBase: [0, 1.16, -0.66], tailMid: [0, 0.86, -0.76], tailTip: [0, 0.52, -0.78],
  stride: 0.14, lift: 0.05, height: 1.5,
};

const HORSE: SpeciesSpec = {
  sections: [[0.6, 0.22, 1.12, 0.3], [0.24, 0.27, 1.19, 0.34], [-0.18, 0.3, 1.09, 0.34], [-0.56, 0.25, 1.06, 0.33], [-0.72, 0.16, 1.07, 0.26]],
  neckBase: [0, 1.32, 0.46], neckTop: [0, 1.62, 0.7],
  skull: [0, 1.68, 0.8], muzzle: [0, 1.54, 0.96], muzzleTip: [0, 1.5, 1.06],
  graze: { neckTop: [0, 1.08, 0.8], skull: [0, 1.0, 0.92], muzzle: [0, 0.9, 1.04] },
  legs: {
    FL: { x: 0.17, z: 0.36, hipY: 1.04, thigh: 0.42, shin: 0.4, kneeSign: -1, ankleZ: -0.02 },
    FR: { x: -0.17, z: 0.36, hipY: 1.04, thigh: 0.42, shin: 0.4, kneeSign: -1, ankleZ: -0.02 },
    RL: { x: 0.18, z: -0.58, hipY: 0.98, thigh: 0.42, shin: 0.4, kneeSign: 1, ankleZ: -0.1 },
    RR: { x: -0.18, z: -0.58, hipY: 0.98, thigh: 0.42, shin: 0.4, kneeSign: 1, ankleZ: -0.1 },
  },
  legRadius: [0.092, 0.05, 0.04],
  neckR: [0.13, 0.095],
  tailBase: [0, 1.18, -0.7], tailMid: [0, 0.86, -0.82], tailTip: [0, 0.46, -0.86],
  stride: 0.17, lift: 0.06, height: 1.78,
};

export const QUAD_SPECS: Record<QuadSpecies, SpeciesSpec> = { ox: OX, horse: HORSE };

export interface QuadRig {
  group: THREE.Group;
  bones: Record<QuadBoneName, THREE.Bone>;
  skeleton: THREE.Skeleton;
  bindPos: Record<QuadBoneName, THREE.Vector3>;
  species: QuadSpecies;
  spec: SpeciesSpec;
  height: number;
}

function ikKnee(hip: THREE.Vector3, foot: THREE.Vector3, l1: number, l2: number, sign: 1 | -1): THREE.Vector3 {
  const dy = foot.y - hip.y, dz = foot.z - hip.z;
  let d = Math.hypot(dy, dz);
  const maxD = l1 + l2 - 1e-4;
  if (d > maxD) d = maxD;
  d = Math.max(d, 1e-4);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const uy = dy / d, uz = dz / d;
  return new THREE.Vector3(hip.x, hip.y + a * uy + h * uz * sign, hip.z + a * uz - h * uy * sign);
}

export function buildQuadrupedRig(species: QuadSpecies): QuadRig {
  const spec = QUAD_SPECS[species];
  const bindPos = {} as Record<QuadBoneName, THREE.Vector3>;
  const v = (t: [number, number, number]) => new THREE.Vector3(...t);
  bindPos.Hips = v(spec.sections[2] ? [0, spec.sections[2][2], spec.sections[2][0]] : [0, 1.05, -0.05]);
  bindPos.Chest = v([0, spec.sections[1][2], spec.sections[1][0]]);
  bindPos.Neck = v(spec.neckBase);
  bindPos.Head = v(spec.neckTop);
  bindPos.Tail1 = v(spec.tailBase);
  bindPos.Tail2 = v(spec.tailMid);
  for (const leg of LEG_IDS) {
    const L = spec.legs[leg];
    const hip = new THREE.Vector3(L.x, L.hipY, L.z);
    const foot = new THREE.Vector3(L.x, 0.07, L.z + L.ankleZ * 0.4);
    const knee = ikKnee(hip, foot, L.thigh, L.shin, L.kneeSign);
    bindPos[`UpperLeg${leg}` as QuadBoneName] = hip;
    bindPos[`LowerLeg${leg}` as QuadBoneName] = knee;
    bindPos[`Foot${leg}` as QuadBoneName] = new THREE.Vector3(L.x, 0.09, L.z + L.ankleZ);
  }
  bindPos.Root = new THREE.Vector3(0, 0, 0);
  const PARENT: Partial<Record<QuadBoneName, QuadBoneName>> = {
    Hips: 'Root',
    Chest: 'Hips', Neck: 'Chest', Head: 'Neck', Tail1: 'Hips', Tail2: 'Tail1',
    UpperLegFL: 'Chest', UpperLegFR: 'Chest', UpperLegRL: 'Hips', UpperLegRR: 'Hips',
    LowerLegFL: 'UpperLegFL', LowerLegFR: 'UpperLegFR', LowerLegRL: 'UpperLegRL', LowerLegRR: 'UpperLegRR',
    FootFL: 'LowerLegFL', FootFR: 'LowerLegFR', FootRL: 'LowerLegRL', FootRR: 'LowerLegRR',
  };
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
    if (!parent) { bone_position(bones[name], bindPos[name]); group.add(bones[name]); }
    else { bone_position(bones[name], bindPos[name].clone().sub(bindPos[parent])); bones[parent].add(bones[name]); }
  }
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(QUAD_BONES.map(n => bones[n]));
  return { group, bones, skeleton, bindPos, species, spec, height: spec.height };
}
function bone_position(bone: THREE.Bone, p: THREE.Vector3): void {
  bone.position.copy(p);
}

/** Two-bone knee solve reused by the body builder and the gait model. */
export function kneeFor(spec: SpeciesSpec, leg: LegId): THREE.Vector3 {
  const L = spec.legs[leg];
  const hip = new THREE.Vector3(L.x, L.hipY, L.z);
  const foot = new THREE.Vector3(L.x, 0.07, L.z + L.ankleZ * 0.4);
  return ikKnee(hip, foot, L.thigh, L.shin, L.kneeSign);
}
