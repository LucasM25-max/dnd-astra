import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BONE_NAMES, segmentParam, type BoneName, type HeroRig } from './HeroRig';
import { applySkinWeights, blendRange, rigidRule, type WeightRule } from './Skinning';

/**
 * Procedural hero body, authored in rig bind space (metres, faces +Z).
 *
 * One merged SkinnedMesh geometry with a group per material slot:
 * skin / head(face) / gambeson / trouser / foot. Joints overlap generously
 * and carry smooth two-bone blends so elbows, knees, shoulders, and hips
 * bend without gaps. Armour and weapons are separate rigid meshes parented
 * to bones (see HeroArmour / HeroWeapons) — only the body is skinned.
 */

export const BODY_MATERIAL_SLOTS = ['skin', 'head', 'gambeson', 'trouser', 'foot'] as const;
export type BodyMaterialSlot = (typeof BODY_MATERIAL_SLOTS)[number];

const boneIndex = (name: BoneName): number => BONE_NAMES.indexOf(name);

// --- Small geometry helpers ---

/**
 * Merge parts that may mix indexed and non-indexed geometry
 * (RoundedBoxGeometry is non-indexed; primitives are indexed).
 */
function mergeParts(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map(g => (g.getIndex() ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);
  if (!merged) throw new Error('body part merge failed');
  return merged;
}

/** Tapered capsule from a to b (radii r0→r1), with round caps. */
function capsuleBetween(
  a: THREE.Vector3,
  b: THREE.Vector3,
  r0: number,
  r1: number,
  radial = 14,
  segs = 5,
): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const parts: THREE.BufferGeometry[] = [];
  const tube = new THREE.CylinderGeometry(r1, r0, len, radial, segs, true);
  tube.applyQuaternion(quat);
  tube.translate(mid.x, mid.y, mid.z);
  parts.push(tube);
  const capA = new THREE.SphereGeometry(r0, radial, Math.max(3, segs - 1));
  capA.translate(a.x, a.y, a.z);
  parts.push(capA);
  const capB = new THREE.SphereGeometry(r1, radial, Math.max(3, segs - 1));
  capB.translate(b.x, b.y, b.z);
  parts.push(capB);
  return mergeParts(parts);
}

function ball(r: number, scale: [number, number, number], w = 16, h = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, w, h);
  g.scale(...scale);
  return g;
}

function extend(a: THREE.Vector3, b: THREE.Vector3, extA: number, extB: number): [THREE.Vector3, THREE.Vector3] {
  const dir = b.clone().sub(a).normalize();
  return [a.clone().addScaledVector(dir, -extA), b.clone().addScaledVector(dir, extB)];
}

// --- Part builders (geometry in bind space; weights assigned at merge) ---

interface PartBuild {
  geo: THREE.BufferGeometry;
  slot: BodyMaterialSlot;
  rule: WeightRule;
}

function buildPelvis(rig: HeroRig): PartBuild {
  void rig;
  const profile: [number, number][] = [
    [0.02, 0.855],
    [0.115, 0.865],
    [0.145, 0.92],
    [0.15, 0.98],
    [0.142, 1.04],
    [0.132, 1.09],
  ];
  const geo = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 20);
  geo.scale(1.12, 1, 0.88);
  const hips = boneIndex('Hips');
  const legL = boneIndex('UpperLegL');
  const legR = boneIndex('UpperLegR');
  const rule: WeightRule = p => {
    const leg = p.x < 0 ? legR : legL;
    const legW = (1 - blendRange(p.y, 0.99, 0.9)) * blendRange(Math.abs(p.x), 0.03, 0.1);
    return [hips, leg, 1 - legW];
  };
  return { geo, slot: 'trouser', rule };
}

function buildTorso(rig: HeroRig): PartBuild {
  void rig;
  const profile: [number, number][] = [
    [0.02, 0.985],
    [0.148, 1.0],
    [0.136, 1.1],
    [0.14, 1.18],
    [0.152, 1.28],
    [0.163, 1.37],
    [0.152, 1.44],
    [0.105, 1.485],
    [0.058, 1.5],
  ];
  const geo = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 22);
  geo.scale(1.26, 1, 0.86);
  const hips = boneIndex('Hips');
  const spine = boneIndex('Spine');
  const chest = boneIndex('Chest');
  const shL = boneIndex('ShoulderL');
  const shR = boneIndex('ShoulderR');
  const rule: WeightRule = p => {
    // Shoulder cap: ease onto the clavicle bones near the traps.
    if (p.y > 1.38 && Math.abs(p.x) > 0.08) {
      const sh = p.x < 0 ? shR : shL;
      const w = blendRange(Math.abs(p.x), 0.08, 0.17) * blendRange(p.y, 1.38, 1.46);
      return [chest, sh, 1 - w * 0.85];
    }
    if (p.y < 1.1) return [hips, spine, 1 - blendRange(p.y, 1.0, 1.1)];
    if (p.y < 1.3) return [spine, chest, 1 - blendRange(p.y, 1.14, 1.28)];
    return [chest, chest, 1];
  };
  return { geo, slot: 'gambeson', rule };
}

function buildNeck(rig: HeroRig): PartBuild {
  void rig;
  const geo = new THREE.CylinderGeometry(0.052, 0.06, 0.15, 14, 3, false);
  geo.translate(0, 1.51, 0.004);
  const chest = boneIndex('Chest');
  const neck = boneIndex('Neck');
  const head = boneIndex('Head');
  const rule: WeightRule = p => {
    if (p.y < 1.5) return [chest, neck, 1 - blendRange(p.y, 1.435, 1.5)];
    return [neck, head, 1 - blendRange(p.y, 1.53, 1.585)];
  };
  return { geo, slot: 'skin', rule };
}

function buildHead(rig: HeroRig): PartBuild {
  void rig;
  const cy = 1.688;
  const cz = 0.008;
  const geo = new THREE.SphereGeometry(0.105, 26, 20);
  geo.scale(0.94, 1.12, 1.0);
  geo.translate(0, cy, cz);
  // Shape the skull: tapered jaw at the front, full cranium at the back.
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dy = v.y - cy;
    if (dy < -0.015) {
      const t = Math.min(1, (-dy - 0.015) / 0.095);
      const frontness = blendRange(v.z, cz - 0.07, cz + 0.03);
      v.x *= 1 - 0.3 * t * frontness;
      v.z -= 0.022 * t * frontness;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  // Ears ride the same face texture (painted skin at the sphere's sides),
  // hugging the skull so they read as one form with the head.
  const earL = ball(0.024, [0.45, 0.95, 0.7]);
  earL.translate(0.089, 1.672, -0.008);
  const earR = ball(0.024, [0.45, 0.95, 0.7]);
  earR.translate(-0.089, 1.672, -0.008);
  const merged = mergeParts([geo, earL, earR]);
  return { geo: merged, slot: 'head', rule: rigidRule(boneIndex('Head')) };
}

function buildUpperArm(rig: HeroRig, side: -1 | 1): PartBuild {
  const s = side < 0 ? 'R' : 'L';
  const top = rig.bindPos[`UpperArm${s}` as BoneName];
  const elbow = rig.bindPos[`LowerArm${s}` as BoneName];
  const [a, b] = extend(top, elbow, 0.07, 0.02);
  const geo = capsuleBetween(a, b, 0.08, 0.06);
  // Deltoid cap over the shoulder joint.
  const delt = ball(0.086, [1, 1.05, 1]);
  delt.translate(top.x + side * 0.012, top.y - 0.005, top.z);
  const merged = mergeParts([geo, delt]);
  const sh = boneIndex(`Shoulder${s}` as BoneName);
  const upper = boneIndex(`UpperArm${s}` as BoneName);
  const lower = boneIndex(`LowerArm${s}` as BoneName);
  const rule: WeightRule = p => {
    const t = segmentParam(p, a, b);
    if (t < 0.5) return [sh, upper, 1 - blendRange(t, 0.02, 0.32)];
    return [upper, lower, 1 - blendRange(t, 0.72, 0.97)];
  };
  return { geo: merged, slot: 'gambeson', rule };
}

function buildLowerArm(rig: HeroRig, side: -1 | 1): PartBuild {
  const s = side < 0 ? 'R' : 'L';
  const elbow = rig.bindPos[`LowerArm${s}` as BoneName];
  const wrist = rig.bindPos[`Hand${s}` as BoneName];
  const [a, b] = extend(elbow, wrist, 0.03, 0.01);
  const geo = capsuleBetween(a, b, 0.058, 0.046);
  const tip = ball(0.056, [1, 1, 1]);
  tip.translate(elbow.x, elbow.y, elbow.z);
  const merged = mergeParts([geo, tip]);
  const upper = boneIndex(`UpperArm${s}` as BoneName);
  const lower = boneIndex(`LowerArm${s}` as BoneName);
  const hand = boneIndex(`Hand${s}` as BoneName);
  const rule: WeightRule = p => {
    const t = segmentParam(p, a, b);
    if (t < 0.45) return [upper, lower, 1 - blendRange(t, 0.0, 0.22)];
    return [lower, hand, 1 - blendRange(t, 0.85, 1.0)];
  };
  return { geo: merged, slot: 'skin', rule };
}

/** Relaxed fist: rounded palm, knuckle row, curled fingers, opposed thumb. */
function buildHand(rig: HeroRig, side: -1 | 1): PartBuild {
  const s = side < 0 ? 'R' : 'L';
  const wrist = rig.bindPos[`Hand${s}` as BoneName];
  const hx = wrist.x;
  const parts: THREE.BufferGeometry[] = [];
  // Palm block.
  const palm = new RoundedBoxGeometry(0.062, 0.098, 0.06, 3, 0.02);
  palm.translate(hx, wrist.y - 0.055, wrist.z + 0.008);
  parts.push(palm);
  // Four curled fingers: knuckle knobs + curl segments sweeping back.
  for (let f = 0; f < 4; f++) {
    const fx = hx + (f - 1.5) * 0.0155;
    const knuckle = ball(0.0145, [1, 1, 1], 10, 8);
    knuckle.translate(fx, wrist.y - 0.1, wrist.z + 0.032);
    parts.push(knuckle);
    const seg = capsuleBetween(
      new THREE.Vector3(fx, wrist.y - 0.1, wrist.z + 0.032),
      new THREE.Vector3(fx, wrist.y - 0.118, wrist.z - 0.002),
      0.0135,
      0.012,
      10,
      3,
    );
    parts.push(seg);
  }
  // Thumb pressed along the inner side.
  const thumbSide = -side; // thumbs face inward in the bind pose
  const thumb = capsuleBetween(
    new THREE.Vector3(hx + thumbSide * 0.028, wrist.y - 0.045, wrist.z + 0.012),
    new THREE.Vector3(hx + thumbSide * 0.02, wrist.y - 0.095, wrist.z + 0.03),
    0.014,
    0.012,
    10,
    3,
  );
  parts.push(thumb);
  const geo = mergeParts(parts);
  return { geo, slot: 'skin', rule: rigidRule(boneIndex(`Hand${s}` as BoneName)) };
}

function buildThigh(rig: HeroRig, side: -1 | 1): PartBuild {
  const s = side < 0 ? 'R' : 'L';
  const hip = rig.bindPos[`UpperLeg${s}` as BoneName];
  const knee = rig.bindPos[`LowerLeg${s}` as BoneName];
  const [a, b] = extend(hip, knee, 0.075, 0.02);
  const geo = capsuleBetween(a, b, 0.099, 0.07);
  const hips = boneIndex('Hips');
  const upper = boneIndex(`UpperLeg${s}` as BoneName);
  const lower = boneIndex(`LowerLeg${s}` as BoneName);
  const rule: WeightRule = p => {
    const t = segmentParam(p, a, b);
    if (t < 0.45) return [hips, upper, 1 - blendRange(t, 0.0, 0.3)];
    return [upper, lower, 1 - blendRange(t, 0.72, 0.95)];
  };
  return { geo, slot: 'trouser', rule };
}

function buildShin(rig: HeroRig, side: -1 | 1): PartBuild {
  const s = side < 0 ? 'R' : 'L';
  const knee = rig.bindPos[`LowerLeg${s}` as BoneName];
  const ankle = rig.bindPos[`Foot${s}` as BoneName];
  const ankleTop = new THREE.Vector3(ankle.x, ankle.y + 0.03, ankle.z - 0.015);
  const [a, b] = extend(knee, ankleTop, 0.03, 0.03);
  const geo = capsuleBetween(a, b, 0.067, 0.048);
  const cap = ball(0.068, [1, 0.95, 1]);
  cap.translate(knee.x, knee.y, knee.z);
  const merged = mergeParts([geo, cap]);
  const upper = boneIndex(`UpperLeg${s}` as BoneName);
  const lower = boneIndex(`LowerLeg${s}` as BoneName);
  const foot = boneIndex(`Foot${s}` as BoneName);
  const rule: WeightRule = p => {
    const t = segmentParam(p, a, b);
    if (t < 0.4) return [upper, lower, 1 - blendRange(t, 0.0, 0.18)];
    return [lower, foot, 1 - blendRange(t, 0.82, 1.0)];
  };
  return { geo: merged, slot: 'trouser', rule };
}

function buildFoot(rig: HeroRig, side: -1 | 1): PartBuild {
  const s = side < 0 ? 'R' : 'L';
  const ankle = rig.bindPos[`Foot${s}` as BoneName];
  const parts: THREE.BufferGeometry[] = [];
  const wedge = new RoundedBoxGeometry(0.092, 0.078, 0.19, 3, 0.03);
  wedge.translate(ankle.x, 0.052, ankle.z + 0.055);
  parts.push(wedge);
  const toe = ball(0.046, [1, 0.72, 1.1]);
  toe.translate(ankle.x, 0.042, ankle.z + 0.155);
  parts.push(toe);
  const heel = ball(0.042, [1, 1, 1]);
  heel.translate(ankle.x, 0.055, ankle.z - 0.045);
  parts.push(heel);
  const geo = mergeParts(parts);
  return { geo, slot: 'foot', rule: rigidRule(boneIndex(`Foot${s}` as BoneName)) };
}

export interface BodyBuild {
  geometry: THREE.BufferGeometry;
  /** Material-array index per slot, in merge-group order. */
  slotIndex: Record<BodyMaterialSlot, number>;
  /** Triangle count (perf budget tracking). */
  triangles: number;
}

/** Merge every part into one grouped, weighted SkinnedMesh-ready geometry. */
export function buildBodyGeometry(rig: HeroRig): BodyBuild {
  const parts: PartBuild[] = [
    buildPelvis(rig),
    buildTorso(rig),
    buildNeck(rig),
    buildHead(rig),
    buildUpperArm(rig, -1),
    buildUpperArm(rig, 1),
    buildLowerArm(rig, -1),
    buildLowerArm(rig, 1),
    buildHand(rig, -1),
    buildHand(rig, 1),
    buildThigh(rig, -1),
    buildThigh(rig, 1),
    buildShin(rig, -1),
    buildShin(rig, 1),
    buildFoot(rig, -1),
    buildFoot(rig, 1),
  ];
  // One merged geometry per material slot, then one final merge with groups.
  const slotGeos: THREE.BufferGeometry[] = [];
  const slotIndex = {} as Record<BodyMaterialSlot, number>;
  BODY_MATERIAL_SLOTS.forEach((slot, i) => {
    slotIndex[slot] = i;
  });
  for (const slot of BODY_MATERIAL_SLOTS) {
    const group = parts.filter(p => p.slot === slot);
    for (const p of group) applySkinWeights(p.geo, p.rule);
    const merged = mergeGeometries(
      group.map(p => (p.geo.getIndex() ? p.geo.toNonIndexed() : p.geo)),
      false,
    )!;
    slotGeos.push(merged);
  }
  const geometry = mergeGeometries(slotGeos, true)!;
  const index = geometry.getIndex();
  const triangles = (index ? index.count : geometry.getAttribute('position').count) / 3;
  return { geometry, slotIndex, triangles: Math.round(triangles) };
}
