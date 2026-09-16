import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySkinWeights, blendRange, type WeightRule } from '../../../character/skeletal/Skinning';
import {
  LEG_IDS, LEG_ROOT, QUAD_BONES, SPINE_STOPS, isForeLeg,
  type LegId, type LoftSection, type QuadBoneName, type QuadRig, type SpeciesSpec,
} from './QuadrupedRig';
import type { QuadMats } from './QuadMaterials';

/**
 * Skeletally skinned quadruped body for horses and oxen.
 *
 * Constructed using the player character's skeletal architecture:
 * all organic body parts (trunk, neck, head, jaw, shoulders, haunches,
 * upper and lower limbs, hooves, tail, and crest) are skinned with continuous
 * joint blend weights, overlapping geometry transitions, and merged per
 * material slot into unified skinned meshes.
 *
 * Preserves all procedural textures and material maps from QuadTextures.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface LoftOptions {
  /** Radial segments around each section. */
  seg?: number;
  /** Dome the front/back end by this fraction of its radius (0 = flat cap). */
  capFront?: number;
  capBack?: number;
  /** uv scale + offset, so one texture serves several regions. */
  uv?: [number, number, number, number];
  /** Intermediate rings generated per authored span. */
  sub?: number;
}

/**
 * Resample authored cross-sections into a smooth path using Catmull-Rom.
 */
function smoothSections(sections: LoftSection[], sub: number): LoftSection[] {
  if (sub <= 1 || sections.length < 3) return sections;
  const at = (i: number): THREE.Vector3 => {
    const s = sections[Math.max(0, Math.min(sections.length - 1, i))];
    return V(s.at[0] + (s.off?.[0] ?? 0), s.at[1] + (s.off?.[1] ?? 0), s.at[2]);
  };
  const mix = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number): THREE.Vector3 => {
    const t2 = t * t, t3 = t2 * t;
    const out = new THREE.Vector3();
    for (const k of ['x', 'y', 'z'] as const) {
      out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t
        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
        + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    }
    return out;
  };
  const out: LoftSection[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const c = mix(at(i - 1), at(i), at(i + 1), at(i + 2), t);
      const e = t * t * (3 - 2 * t);
      out.push({
        at: [c.x, c.y, c.z],
        hw: a.hw + (b.hw - a.hw) * e,
        hh: a.hh + (b.hh - a.hh) * e,
        roll: (a.roll ?? 0) + ((b.roll ?? 0) - (a.roll ?? 0)) * e,
      });
    }
  }
  const end = at(sections.length - 1);
  const last = sections[sections.length - 1];
  out.push({ at: [end.x, end.y, end.z], hw: last.hw, hh: last.hh, roll: last.roll });
  return out;
}

/**
 * Loft elliptical sections into one mesh (position, normal, uv).
 */
export function loftGeometry(input: LoftSection[], opts: LoftOptions = {}): THREE.BufferGeometry {
  let sections = input;
  const SEG = Math.max(8, opts.seg ?? 20);
  sections = smoothSections(sections, opts.sub ?? 2);
  const [su, sv, ou, ov] = opts.uv ?? [1, 1, 0, 0];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];
  const centres = sections.map(s => V(s.at[0] + (s.off?.[0] ?? 0), s.at[1] + (s.off?.[1] ?? 0), s.at[2]));
  const arcs = [0];
  for (let i = 1; i < sections.length; i++) arcs.push(arcs[i - 1] + centres[i].distanceTo(centres[i - 1]));
  const total = Math.max(1e-4, arcs[arcs.length - 1]);
  const tangent = (i: number): THREE.Vector3 => {
    const a = centres[Math.max(0, i - 1)], b = centres[Math.min(centres.length - 1, i + 1)];
    return b.clone().sub(a).normalize();
  };
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const up = tangent(i);
    const frame = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), up);
    const roll = s.roll ?? 0;
    ringStart.push(positions.length / 3);
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const ex = Math.cos(a) * s.hw, ey = Math.sin(a) * s.hh;
      const rx = ex * Math.cos(roll) - ey * Math.sin(roll);
      const ry = ex * Math.sin(roll) + ey * Math.cos(roll);
      const local = V(rx, ry, 0).applyQuaternion(frame);
      positions.push(centres[i].x + local.x, centres[i].y + local.y, centres[i].z + local.z);
      uvs.push((j / SEG) * su + ou, (arcs[i] / total) * sv + ov);
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      const a = ringStart[i] + j, b = ringStart[i] + j2, c = ringStart[i + 1] + j2, d = ringStart[i + 1] + j;
      indices.push(a, b, c, a, c, d);
    }
  }
  const cap = (index: number, dir: 1 | -1, softness: number): void => {
    const s = sections[index];
    const tip = centres[index].clone().addScaledVector(tangent(index), dir * Math.max(s.hw, s.hh) * softness);
    const at = positions.length / 3;
    positions.push(tip.x, tip.y, tip.z);
    uvs.push(0.5 * su + ou, (index === 0 ? 0 : 1) * sv + ov);
    const ring = ringStart[index];
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      if (dir > 0) indices.push(at, ring + j, ring + j2);
      else indices.push(at, ring + j2, ring + j);
    }
  };
  if (opts.capFront) cap(0, 1, opts.capFront);
  if (opts.capBack) cap(sections.length - 1, -1, opts.capBack);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Push a loft's end sections outward so neighbouring segments overlap. */
function skirted(sections: LoftSection[], front: number, back: number): LoftSection[] {
  const out = sections.slice();
  const dir = (a: number, b: number) => V(...out[b].at).sub(V(...out[a].at)).normalize();
  if (out.length < 2) return out;
  if (front > 0) {
    const d = dir(1, 0).multiplyScalar(front);
    out[0] = { ...out[0], at: [out[0].at[0] + d.x, out[0].at[1] + d.y, out[0].at[2] + d.z] };
  }
  if (back > 0) {
    const i = out.length - 1;
    const d = dir(i - 1, i).multiplyScalar(back);
    out[i] = { ...out[i], at: [out[i].at[0] + d.x, out[i].at[1] + d.y, out[i].at[2] + d.z] };
  }
  return out;
}

/** Spine weights: the two nearest spine bones, blended along z. */
function spineRule(idx: (n: QuadBoneName) => number): WeightRule {
  return (p: THREE.Vector3) => {
    for (let i = 0; i < SPINE_STOPS.length - 1; i++) {
      if (p.z >= SPINE_STOPS[i + 1][1]) {
        const w = blendRange(p.z, SPINE_STOPS[i + 1][1], SPINE_STOPS[i][1]);
        return [idx(SPINE_STOPS[i][0]), idx(SPINE_STOPS[i + 1][0]), w];
      }
    }
    const last = idx(SPINE_STOPS[SPINE_STOPS.length - 1][0]);
    return [last, last, 1];
  };
}

/** Neck skinning: smooth continuous blend across Withers -> Neck1 -> Neck2 -> Head. */
function neckWeightRule(p: THREE.Vector3, spec: SpeciesSpec, idx: (n: QuadBoneName) => number): [number, number, number] {
  const withers = idx('Withers');
  const neck1 = idx('Neck1');
  const neck2 = idx('Neck2');
  const head = idx('Head');

  const z0 = spec.neck1[0].at[2] - 0.08;
  const z1 = spec.neck1[spec.neck1.length - 1].at[2];
  const z2 = spec.neck2[spec.neck2.length - 1].at[2];
  const z = p.z;

  if (z <= z1) {
    const w = blendRange(z, z0, z1);
    return [withers, neck1, 1 - w];
  } else if (z <= z2) {
    const w = blendRange(z, z1, z2);
    return [neck1, neck2, 1 - w];
  } else {
    const w = blendRange(z, z2, z2 + 0.1);
    return [neck2, head, 1 - w];
  }
}

/** Head skinning: poll blends from Neck2, rest weights to Head. */
function headWeightRule(p: THREE.Vector3, spec: SpeciesSpec, idx: (n: QuadBoneName) => number): [number, number, number] {
  const neck2 = idx('Neck2');
  const head = idx('Head');
  const pollZ = spec.head[0].at[2];
  if (p.z < pollZ + 0.05) {
    const w = blendRange(p.z, pollZ - 0.04, pollZ + 0.05);
    return [neck2, head, 1 - w];
  }
  return [head, head, 1];
}

/** Jaw skinning: hinge blends from Head, chin weights to Jaw. */
function jawWeightRule(p: THREE.Vector3, spec: SpeciesSpec, idx: (n: QuadBoneName) => number): [number, number, number] {
  const head = idx('Head');
  const jaw = idx('Jaw');
  const hingeZ = spec.jaw.hinge[1];
  if (p.z < hingeZ + 0.05) {
    const w = blendRange(p.z, hingeZ - 0.03, hingeZ + 0.05);
    return [head, jaw, 1 - w];
  }
  return [head, jaw, 1 - blendRange(p.z, hingeZ + 0.05, hingeZ + 0.16)];
}

/** Foreleg skinning: smooth continuous blend across Withers -> Shoulder -> UpperLeg -> LowerLeg -> Foot. */
function forelegWeightRule(p: THREE.Vector3, P: THREE.Vector3[], idx: (n: QuadBoneName) => number, leg: LegId): [number, number, number] {
  const withers = idx('Withers');
  const sh = idx(LEG_ROOT[leg]);
  const upper = idx(`UpperLeg${leg}` as QuadBoneName);
  const lower = idx(`LowerLeg${leg}` as QuadBoneName);
  const foot = idx(`Foot${leg}` as QuadBoneName);

  const y = p.y;
  if (y >= P[1].y) {
    if (y > P[0].y - 0.08) {
      const w = blendRange(y, P[0].y + 0.04, P[0].y - 0.08);
      return [withers, sh, w];
    }
    const w = blendRange(y, P[0].y - 0.08, P[1].y);
    return [sh, upper, w];
  } else if (y >= P[2].y) {
    const w = blendRange(y, P[1].y, P[2].y);
    return [upper, lower, w];
  } else if (y >= P[4].y) {
    if (y > P[2].y - 0.08) {
      const w = blendRange(y, P[2].y + 0.04, P[2].y - 0.08);
      return [upper, lower, w];
    }
    const w = blendRange(y, P[3].y + 0.08, P[4].y);
    return [lower, foot, w];
  } else {
    if (y > P[4].y - 0.06) {
      const w = blendRange(y, P[4].y + 0.03, P[4].y - 0.06);
      return [lower, foot, w];
    }
    return [foot, foot, 1];
  }
}

/** Hindleg skinning: smooth continuous blend across Hips -> Pelvis -> UpperLeg -> LowerLeg -> Foot. */
function hindlegWeightRule(p: THREE.Vector3, P: THREE.Vector3[], idx: (n: QuadBoneName) => number, leg: LegId): [number, number, number] {
  const hips = idx('Hips');
  const pelvis = idx(LEG_ROOT[leg]);
  const upper = idx(`UpperLeg${leg}` as QuadBoneName);
  const lower = idx(`LowerLeg${leg}` as QuadBoneName);
  const foot = idx(`Foot${leg}` as QuadBoneName);

  const y = p.y;
  if (y >= P[1].y) {
    if (y > P[0].y - 0.08) {
      const w = blendRange(y, P[0].y + 0.06, P[0].y - 0.08);
      return [hips, pelvis, w];
    }
    if (y > P[0].y - 0.18) {
      const w = blendRange(y, P[0].y - 0.08, P[0].y - 0.18);
      return [pelvis, upper, w];
    }
    const w = blendRange(y, P[0].y - 0.18, P[1].y);
    return [upper, lower, w];
  } else if (y >= P[2].y) {
    if (y > P[1].y - 0.08) {
      const w = blendRange(y, P[1].y + 0.04, P[1].y - 0.08);
      return [upper, lower, w];
    }
    const w = blendRange(y, P[1].y - 0.08, P[2].y);
    return [lower, foot, w];
  } else if (y >= P[3].y) {
    const w = blendRange(y, P[2].y, P[3].y);
    return [lower, foot, w];
  } else {
    if (y > P[3].y - 0.06) {
      const w = blendRange(y, P[3].y, P[3].y - 0.06);
      return [lower, foot, w];
    }
    return [foot, foot, 1];
  }
}

/** Tail skinning: smooth continuous blend across Tail1 -> Tail2 -> Tail3. */
function tailWeightRule(p: THREE.Vector3, spec: SpeciesSpec, idx: (n: QuadBoneName) => number): [number, number, number] {
  const t1 = idx('Tail1');
  const t2 = idx('Tail2');
  const t3 = idx('Tail3');
  const z0 = spec.tail[0].at[2];
  const z1 = spec.tail[1].at[2];
  const z2 = spec.tail[2].at[2];
  const z = p.z;
  if (z >= z1) {
    const w = blendRange(z, z0, z1);
    return [t1, t2, w];
  } else {
    const w = blendRange(z, z1, z2);
    return [t2, t3, w];
  }
}

function blob(r: number, scale: [number, number, number], at: THREE.Vector3, seg = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3));
  g.scale(...scale);
  g.translate(at.x, at.y, at.z);
  return g.toNonIndexed();
}

function hangOn(rig: QuadRig, bone: THREE.Bone | undefined, obj: THREE.Object3D, abs: [number, number, number]): THREE.Object3D {
  rig.group.updateMatrixWorld(true);
  const p = new THREE.Vector3(abs[0], abs[1], abs[2]);
  if (bone) { obj.position.copy(bone.worldToLocal(p)); bone.add(obj); }
  else { obj.position.copy(p); rig.group.add(obj); }
  return obj;
}

/* ------------------------------------------------------------------ */
/* Rigid part collection: tack, horns, eyelids                        */
/* ------------------------------------------------------------------ */

type Bucket = { bone: QuadBoneName; mat: THREE.Material; geos: THREE.BufferGeometry[] };

class Rigidity {
  private buckets: Bucket[] = [];
  triangles = 0;
  add(bone: QuadBoneName, mat: THREE.Material, geo: THREE.BufferGeometry): void {
    let bucket = this.buckets.find(b => b.bone === bone && b.mat === mat);
    if (!bucket) { bucket = { bone, mat, geos: [] }; this.buckets.push(bucket); }
    bucket.geos.push(geo);
    const count = geo.getIndex()?.count ?? geo.getAttribute('position').count;
    this.triangles += count / 3;
  }
  attach(rig: QuadRig): THREE.Mesh[] {
    rig.group.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    const inv = new THREE.Matrix4();
    for (const { bone, mat, geos } of this.buckets) {
      const flat = geos.map(g => (g.getIndex() ? g.toNonIndexed() : g));
      const merged = mergeGeometries(flat, false);
      flat.forEach(g => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${bone}.${mat.name ?? 'part'}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.updateMatrix();
      inv.copy(rig.bones[bone].matrixWorld).invert();
      mesh.applyMatrix4(inv);
      rig.bones[bone].add(mesh);
      meshes.push(mesh);
    }
    this.buckets = [];
    return meshes;
  }
}

/* ------------------------------------------------------------------ */
/* Public QuadBody interface                                          */
/* ------------------------------------------------------------------ */

export interface QuadBody {
  group: THREE.Group;
  skinned: THREE.SkinnedMesh[];
  bit: THREE.Object3D;
  nose: THREE.Object3D;
  collar: THREE.Object3D;
  hitch: THREE.Object3D | null;
  eyes: THREE.Mesh[];
  meshes: THREE.Mesh[];
  triangles: number;
  dispose(): void;
}

interface SkinnedPart {
  geo: THREE.BufferGeometry;
  rule: WeightRule;
}

export function buildQuadrupedBody(rig: QuadRig, mats: QuadMats): QuadBody {
  const spec = rig.spec;
  const idx = (n: QuadBoneName): number => QUAD_BONES.indexOf(n);
  const group = new THREE.Group();
  group.name = `${rig.species}_body`;
  const hard = new Rigidity();
  const skinned: THREE.SkinnedMesh[] = [];

  // Categorize skinned parts by material slot to merge them into unified skinned meshes
  const slotParts = new Map<THREE.Material, { slotName: string; parts: SkinnedPart[] }>();
  const addPart = (slotName: string, mat: THREE.Material, geo: THREE.BufferGeometry, rule: WeightRule): void => {
    let entry = slotParts.get(mat);
    if (!entry) {
      entry = { slotName, parts: [] };
      slotParts.set(mat, entry);
    }
    entry.parts.push({ geo, rule });
  };

  // --- 1. Trunk (Skinned) ---
  const trunkSections: LoftSection[] = spec.trunk.map((s, i) => ({
    ...s,
    off: i === 0 || i === spec.trunk.length - 1 ? s.off : [0, -0.014],
  }));
  const trunkGeo = loftGeometry(trunkSections, { seg: 26, sub: 3, capFront: 0.28, capBack: 0.22 });
  addPart('trunk', mats.trunk, trunkGeo, spineRule(idx));

  // --- 2. Neck (Skinned continuous) ---
  const neckAllSections = [...spec.neck1, ...spec.neck2];
  const neckGeo = loftGeometry(skirted(neckAllSections, 0.06, 0.03), { seg: 24, sub: 3, capFront: 0.38, capBack: 0.42 });
  addPart('neck', mats.neck, neckGeo, p => neckWeightRule(p, spec, idx));

  // --- 3. Mane / Crest (Skinned) ---
  if (spec.mane) {
    const crest = spec.mane.crest;
    const along = [...spec.neck2.slice().reverse(), ...spec.neck1.slice()];
    const strip: LoftSection[] = along.map((s, i) => ({
      at: [0, s.at[1] + s.hh * 0.74, s.at[2] - 0.006],
      hw: crest * (0.86 - (i / along.length) * 0.3),
      hh: crest * 0.4,
    }));
    const crestGeo = loftGeometry(strip, { seg: 12, capFront: 0.3, capBack: 0.3, sub: 3 });
    addPart('mane_crest', mats.hair, crestGeo, p => neckWeightRule(p, spec, idx));

    const fallGeo = loftGeometry(strip.map((s, i) => ({
      at: [crest * 0.34, s.at[1] - crest * (0.3 + (i % 4) * 0.5), s.at[2] - 0.012],
      hw: crest * 0.6,
      hh: crest * (0.95 + (i % 3) * 0.5),
    })), { seg: 10, capFront: 0.36, capBack: 0.42, uv: [1, 0.7, 0, 0.15] });
    addPart('mane_fall', mats.hair, fallGeo, p => neckWeightRule(p, spec, idx));
  }

  // --- 4. Dewlap (Skinned ox throat fold) ---
  if (spec.dewlap) {
    const throat = spec.neck2[0].at;
    const dewlapGeo = loftGeometry([
      { at: [0, throat[1] - 0.14, throat[2] + 0.03], hw: 0.085, hh: 0.03 },
      { at: [0, throat[1] - 0.28, throat[2] - 0.06], hw: 0.095, hh: 0.03 },
      { at: [0, throat[1] - 0.4, throat[2] - 0.22], hw: 0.08, hh: 0.026 },
      { at: [0, throat[1] - 0.34, throat[2] - 0.38], hw: 0.06, hh: 0.022 },
    ], { seg: 12, capFront: 0.4, capBack: 0.4 });
    addPart('dewlap', mats.hide, dewlapGeo, p => neckWeightRule(p, spec, idx));
  }

  // --- 5. Head & Skull & Jaw (Skinned) ---
  const skullGeo = loftGeometry(skirted(spec.head, 0.06, 0.02), { seg: 24, capFront: 0.42, capBack: 0.7, sub: 3 });
  addPart('head', mats.head, skullGeo, p => headWeightRule(p, spec, idx));

  const hinge = V(0, spec.jaw.hinge[0], spec.jaw.hinge[1]);
  const jawSections: LoftSection[] = [
    { at: [0, hinge.y - 0.012, hinge.z - 0.03], hw: spec.jaw.wide * 0.95, hh: spec.jaw.wide * 0.6 },
    { at: [0, hinge.y - spec.jaw.drop * 0.8, hinge.z + spec.jaw.len * 0.45], hw: spec.jaw.wide * 0.88, hh: spec.jaw.wide * 0.54 },
    { at: [0, hinge.y - spec.jaw.drop * 1.8, hinge.z + spec.jaw.len * 0.82], hw: spec.jaw.wide * 0.72, hh: spec.jaw.wide * 0.44 },
    { at: [0, hinge.y - spec.jaw.drop * 2.2, hinge.z + spec.jaw.len], hw: spec.jaw.wide * 0.54, hh: spec.jaw.wide * 0.34 },
  ];
  const jawGeo = loftGeometry(jawSections, { seg: 14, capFront: 0.4, capBack: 0.55 });
  addPart('jaw', mats.hide, jawGeo, p => jawWeightRule(p, spec, idx));

  // Cheeks
  for (const side of [1, -1] as const) {
    const cheek = loftGeometry([
      { at: [side * spec.jaw.wide * 0.86, hinge.y + spec.jaw.wide * 0.36, hinge.z + 0.01], hw: spec.jaw.wide * 0.5, hh: spec.jaw.wide * 0.42 },
      { at: [side * spec.jaw.wide * 0.8, hinge.y - spec.jaw.drop * 0.9, hinge.z + spec.jaw.len * 0.52], hw: spec.jaw.wide * 0.42, hh: spec.jaw.wide * 0.34 },
    ], { seg: 10, capFront: 0.45, capBack: 0.4 });
    addPart('cheeks', mats.coat, cheek, p => jawWeightRule(p, spec, idx));
  }

  // --- 6. Forelock & Horns & Ears & Eyes ---
  const eyes: THREE.Mesh[] = [];
  const poll = V(...spec.head[0].at);
  if (rig.species === 'horse') {
    hard.add('Head', mats.hair, loftGeometry([
      { at: [0, poll.y + 0.03, poll.z - 0.02], hw: 0.058, hh: 0.05 },
      { at: [0, poll.y + 0.02, poll.z + 0.08], hw: 0.05, hh: 0.042 },
      { at: [0, poll.y - 0.03, poll.z + 0.16], hw: 0.036, hh: 0.03 },
    ], { seg: 11, capFront: 0.55, capBack: 0.5 }));
  } else {
    hard.add('Head', mats.hair, loftGeometry([
      { at: [0, poll.y + 0.035, poll.z - 0.02], hw: 0.08, hh: 0.06 },
      { at: [0, poll.y + 0.02, poll.z + 0.07], hw: 0.065, hh: 0.05 },
    ], { seg: 13, capFront: 0.65, capBack: 0.55 }));
    const horn = spec.horn!;
    for (const side of [1, -1] as const) {
      const root = V(side * horn.root[0], horn.root[1], horn.root[2]);
      const mid = V(root.x + side * horn.r * 1.5, root.y + horn.rise * 0.5, root.z - horn.r * 0.5);
      const out = V(root.x + side * (horn.r * 2.6 + horn.spread * 0.06), root.y + horn.rise, root.z + horn.reach * 0.22);
      const tip = V(out.x + side * horn.r * 0.4, out.y + horn.rise * 0.5, out.z + horn.reach * 0.3 + horn.curl * 0.05);
      const curve = new THREE.CatmullRomCurve3([root, mid, out, tip]);
      const tube = new THREE.TubeGeometry(curve, 18, horn.r, 12, false);
      const pos = tube.getAttribute('position');
      for (let i = 0; i <= 18; i++) {
        const t = i / 18;
        const centre = curve.getPointAt(Math.min(1, t));
        const shrink = 1 - t * 0.87;
        for (let j = 0; j <= 12; j++) {
          const k = i * 13 + j;
          if (k >= pos.count) break;
          const p = V(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(centre).multiplyScalar(shrink);
          pos.setXYZ(k, centre.x + p.x, centre.y + p.y, centre.z + p.z);
        }
      }
      tube.computeVertexNormals();
      hard.add('Head', mats.horn, tube.toNonIndexed());
      hard.add('Head', mats.hide, blob(horn.r * 1.5, [1, 0.85, 1.05], root.clone().add(V(side * -0.004, -horn.r * 0.3, -horn.r * 0.2))));
    }
  }

  // Ears
  for (const side of [1, -1] as const) {
    const bone: QuadBoneName = side > 0 ? 'EarL' : 'EarR';
    const base = V(side * spec.ear.wide * 1.02, spec.ear.y, spec.ear.z);
    const tip = base.clone().add(V(side * spec.ear.spread * 0.1, spec.ear.len, -0.03));
    const mid = base.clone().lerp(tip, 0.5);
    const outer: LoftSection[] = [
      { at: [base.x, base.y - spec.ear.wide * 0.2, base.z], hw: spec.ear.wide, hh: spec.ear.wide * 0.78 },
      { at: [mid.x, mid.y, mid.z], hw: spec.ear.wide * 0.9, hh: spec.ear.wide * 0.66 },
      { at: [tip.x, tip.y, tip.z], hw: spec.ear.wide * 0.52, hh: spec.ear.wide * 0.36 },
    ];
    hard.add(bone, mats.coat, loftGeometry(outer, { seg: 12, capFront: 0.4, capBack: 0.3, uv: [1, 0.45, 0.2, 0.4] }));
    hard.add(bone, mats.hide, loftGeometry(outer.map((s, i) => ({
      at: [s.at[0] - side * spec.ear.wide * 0.16, s.at[1] - s.hh * 0.08, s.at[2] + 0.004] as [number, number, number],
      hw: s.hw * (0.74 - i * 0.09), hh: s.hh * (0.72 - i * 0.09),
    })), { seg: 10, capFront: 0.25, capBack: 0.3 }));
    if (rig.species === 'horse') {
      hard.add(bone, mats.hair, loftGeometry([
        { at: [base.x, base.y + spec.ear.wide * 0.24, base.z - 0.004], hw: spec.ear.wide * 1.24, hh: spec.ear.wide * 0.72 },
        { at: [tip.x, tip.y - spec.ear.len * 0.16, tip.z + 0.004], hw: spec.ear.wide * 0.66, hh: spec.ear.wide * 0.46 },
      ], { seg: 9, capFront: 0.45, capBack: 0.5 }));
    }
  }

  // Eyes and eyelids
  const { x: ex, y: ey, z: ez, r } = spec.eye;
  for (const side of [1, -1] as const) {
    const globe = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mats.eye);
    globe.name = `eye_${side > 0 ? 'l' : 'r'}`;
    globe.rotation.set(0.05, side * 0.62, side * 0.08);
    globe.scale.set(1, 1, 0.74);
    globe.receiveShadow = true;
    hangOn(rig, rig.bones.Head, globe, [side * ex, ey, ez + r * 0.36]);
    eyes.push(globe);

    const lid: QuadBoneName = side > 0 ? 'EyelidL' : 'EyelidR';
    const lidGeo = new THREE.SphereGeometry(r * 1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4);
    lidGeo.scale(1, 0.72, 0.92);
    lidGeo.rotateY(side * 0.62);
    lidGeo.translate(side * ex * 0.99, ey + r * 0.02, ez + r * 0.3);
    hard.add(lid, mats.coat, lidGeo.toNonIndexed());
    hard.add(lid, mats.hide, loftGeometry([
      { at: [side * ex * 0.92, ey - r * 0.04, ez + r * 1.06], hw: r * 0.92, hh: r * 0.3 },
      { at: [side * ex * 1.06, ey - r * 0.7, ez + r * 0.78], hw: r * 0.6, hh: r * 0.24 },
    ], { seg: 8, capFront: 0.4, capBack: 0.4 }));
  }

  // --- 7. Legs (Fully Skinned) ---
  for (const leg of LEG_IDS) {
    buildSkinnedLeg(rig, mats, leg, addPart);
  }

  // --- 8. Tail (Skinned) ---
  const [t0, t1, t2, t3] = spec.tail;
  const horse = rig.species === 'horse';
  const pairs: LoftSection[][] = [[t0, t1], [t1, t2], [t2, t3]];

  pairs.forEach((pair, i) => {
    const coat = loftGeometry(skirted(pair, 0.02, 0.02).map(s => ({
      ...s, hw: s.hw * (horse ? 1.3 : 1.1), hh: s.hh * (horse ? 1.3 : 1.1),
    })), { seg: 12, capFront: 0.3, capBack: 0.3, uv: [1, 0.13, 0.3, 0.5 + i * 0.13] });
    addPart('tail_coat', mats.coat, coat, p => tailWeightRule(p, spec, idx));

    const flare = horse ? [2.1, 2.4, 2.2][i] : [1.05, 1.2, 1.35][i];
    const drop = horse ? [0.01, 0.07, 0.17][i] : [0.01, 0.05, 0.11][i];
    const [a, b] = pair;
    const hairSections: LoftSection[] = [
      { at: [a.at[0], a.at[1] - drop * 0.35, a.at[2] - 0.008], hw: a.hw * flare, hh: a.hh * flare * 0.8 },
      { at: [b.at[0], b.at[1] - drop, b.at[2] - 0.014], hw: b.hw * flare * 0.94, hh: b.hh * flare * 0.78 },
    ];
    if (i === pairs.length - 1) {
      hairSections.push({ at: [b.at[0], b.at[1] - spec.tuft.len * 0.75, b.at[2] - 0.006], hw: spec.tuft.r * 1.4, hh: spec.tuft.r * 1.4 });
    }
    const hair = loftGeometry(hairSections, { seg: 12, capFront: 0.34, capBack: 0.4, uv: [1, 0.16, 0, 0.5 + i * 0.15] });
    addPart('tail_hair', mats.hair, hair, p => tailWeightRule(p, spec, idx));
  });
  const tuft = blob(spec.tuft.r, [1, 1 + (horse ? 0.7 : 0.3), 1], V(t3.at[0], t3.at[1] - spec.tuft.len * 0.4, t3.at[2] - 0.006));
  addPart('tail_tuft', mats.hair, tuft, p => tailWeightRule(p, spec, idx));

  // --- 9. Sheath / Flank fold (Skinned) ---
  const groin = spec.trunk[5].at;
  const sheathGeo = loftGeometry([
    { at: [0, groin[1] - 0.26, groin[2] + 0.18], hw: 0.062, hh: 0.05 },
    { at: [0, groin[1] - 0.31, groin[2] + 0.02], hw: 0.05, hh: 0.044 },
  ], { seg: 10, capFront: 0.5, capBack: 0.4 });
  addPart('sheath', mats.hide, sheathGeo, () => [idx('Hips'), idx('Loin'), 0.8]);

  // --- 10. Merge and build SkinnedMeshes per material slot (like player) ---
  for (const [mat, { slotName, parts }] of slotParts) {
    for (const p of parts) applySkinWeights(p.geo, p.rule);
    const nonIndexed = parts.map(p => (p.geo.getIndex() ? p.geo.toNonIndexed() : p.geo));
    const merged = mergeGeometries(nonIndexed, false)!;
    nonIndexed.forEach(g => g.dispose());
    merged.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(merged, mat);
    mesh.name = `${rig.species}_${slotName}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    skinned.push(mesh);
  }

  // --- 11. Tack (Harness, Bridle, Pads) ---
  const anchors = buildTack(rig, mats, hard);

  const meshes = hard.attach(rig);
  for (const m of skinned) group.add(m);

  // Hardware anchors
  const bit = new THREE.Object3D();
  bit.name = 'bit';
  hangOn(rig, rig.bones.Jaw, bit, [0, spec.jaw.hinge[0] - 0.024, spec.jaw.hinge[1] + spec.jaw.len * 0.72]);
  const nose = new THREE.Object3D();
  nose.name = 'nose';
  hangOn(rig, rig.bones.Head, nose, spec.nose);

  let triangles = hard.triangles;
  for (const m of skinned) triangles += (m.geometry.getIndex()?.count ?? 0) / 3;
  for (const e of eyes) triangles += (e.geometry.getIndex()?.count ?? 0) / 3;

  const dispose = (): void => {
    for (const m of skinned) m.geometry.dispose();
    for (const m of meshes) m.geometry.dispose();
    for (const e of eyes) e.geometry.dispose();
  };
  const collar = anchors.collar ?? hangOn(rig, rig.bones.Chest, new THREE.Object3D(), [0, 1.1, 0.4]);
  return { group, skinned, bit, nose, collar, hitch: anchors.hitch ?? null, eyes, meshes, triangles, dispose };
}

/* ------------------------------------------------------------------ */
/* Leg Builder (Fully Skinned)                                        */
/* ------------------------------------------------------------------ */

function buildSkinnedLeg(
  rig: QuadRig,
  mats: QuadMats,
  leg: LegId,
  addPart: (slotName: string, mat: THREE.Material, geo: THREE.BufferGeometry, rule: WeightRule) => void,
): void {
  const spec = rig.spec;
  const idx = (n: QuadBoneName): number => QUAD_BONES.indexOf(n);
  const L = spec.legs[leg];
  const fore = isForeLeg(leg);
  const P = L.chain.map(p => V(...p));

  const R = L.radii.map((r, i) => {
    if (i === 0 || i === L.radii.length - 1) return r;
    const a = L.radii[i - 1], b = L.radii[i + 1];
    return [(a[0] + r[0] * 2 + b[0]) / 4, (a[1] + r[1] * 2 + b[1]) / 4] as [number, number];
  });

  const sec = (from: number, to: number): LoftSection[] => {
    const out: LoftSection[] = [];
    for (let i = from; i <= to; i++) {
      const [hw, hh] = R[Math.min(i, R.length - 1)];
      out.push({ at: [P[i].x, P[i].y, P[i].z], hw, hh });
    }
    return out;
  };

  const uOff = (fore ? 0 : 0.25) + (leg === 'FL' || leg === 'RL' ? 0 : 0.12);
  const legUv = (from: number, to: number, su = 1): [number, number, number, number] =>
    [su, (to - from) / (P.length - 1), uOff, from / (P.length - 1)];

  const crestAt = (z: number): number => {
    const stops = spec.trunk.map(s => ({ z: s.at[2], y: s.at[1] + s.hh }));
    if (z >= stops[0].z) return stops[0].y;
    for (let i = 1; i < stops.length; i++) {
      if (z <= stops[i].z) {
        const a = stops[i - 1], b = stops[i];
        const span = b.z - a.z;
        const t = Math.abs(span) < 1e-5 ? 0 : (z - a.z) / span;
        return a.y + (b.y - a.y) * t;
      }
    }
    return stops[stops.length - 1].y;
  };
  const underCrest = (z: number, hh: number, floor: number): number =>
    Math.min(floor, crestAt(z) - hh * 1.5);

  const rule: WeightRule = p =>
    fore ? forelegWeightRule(p, P, idx, leg) : hindlegWeightRule(p, P, idx, leg);

  if (fore) {
    // Shoulder mass (triceps & scapula column)
    addPart('coat', mats.coat, loftGeometry(skirted([
      { at: [P[1].x * 0.82, underCrest(P[0].z - 0.05, R[1][1] * 1.3, P[1].y + (P[0].y - P[1].y) * 0.66), P[0].z - 0.02], hw: R[1][0] * 1.16, hh: R[1][1] * 1.3 },
      { at: [P[1].x * 0.92, underCrest(P[1].z + 0.06, R[1][1] * 1.18, P[1].y + 0.05), P[1].z + 0.06], hw: R[1][0] * 1.14, hh: R[1][1] * 1.18 },
      { at: [P[2].x, P[2].y + (P[1].y - P[2].y) * 0.42, P[2].z - 0.012], hw: R[1][0] * 1.02, hh: R[1][1] * 1.05 },
    ], 0.05, 0.03), { seg: 16, capFront: 0.3, capBack: 0.28, sub: 3 }), rule);

    // Humerus (arm down to elbow)
    addPart('coat', mats.coat, loftGeometry(skirted(sec(1, 2), 0.03, 0.04), { seg: 14, capFront: 0.3, capBack: 0.3, uv: legUv(1, 2), sub: 2 }), rule);

    // Forearm down past knee to fetlock
    addPart('leg', mats.leg, loftGeometry(skirted(sec(2, 4), 0.04, 0.03), { seg: 14, capFront: 0.3, capBack: 0.25, uv: legUv(2, 4), sub: 2 }), rule);

    // Barrel filler and elbow point
    addPart('coat', mats.coat, blob(R[1][0] * 1.05, [1, 0.9, 1.05], V(P[1].x * 0.62, P[1].y + (P[0].y - P[1].y) * 0.55, P[1].z + R[1][0] * 0.5), 10), rule);
    addPart('coat', mats.coat, blob(R[1][0] * 0.7, [0.8, 1, 0.85], V(P[1].x, P[1].y + 0.01, P[1].z - R[1][0] * 0.62), 10), rule);
    addPart('hide', mats.hide, blob(R[2][0] * 0.92, [0.85, 0.9, 0.8], V(P[2].x, P[2].y - R[2][1] * 0.1, P[2].z + R[2][0] * 0.4), 10), rule);
    addPart('hide', mats.hide, blob(R[3][0] * 0.8, [1.5, 0.9, 0.85], V(P[3].x, P[3].y, P[3].z + R[3][0] * 0.25), 10), rule);
  } else {
    // Haunch and quarter
    const hipTop = underCrest(P[0].z, R[0][1], P[0].y + R[0][1] * 0.3);
    addPart('coat', mats.coat, loftGeometry(skirted([
      { at: [P[0].x, hipTop, P[0].z - 0.05], hw: R[0][0] * 0.94, hh: R[0][1] * 1.02 },
      ...sec(0, 1).slice(1),
    ], 0.03, 0.03), { seg: 18, capFront: 0.5, capBack: 0.34, sub: 2 }), rule);

    addPart('coat', mats.coat, loftGeometry([
      { at: [P[0].x + Math.sign(P[0].x) * 0.01, hipTop, P[0].z - 0.03], hw: R[0][0] * 1.08, hh: R[0][1] * 0.98 },
      { at: [P[1].x, Math.min(P[1].y + 0.04, underCrest(P[1].z, R[1][1] * 1.1, P[1].y + 0.04)), P[1].z + 0.05], hw: R[1][0] * 1.14, hh: R[1][1] * 1.1 },
      { at: [P[2].x, P[2].y + R[2][1] * 0.24, P[2].z - R[2][0] * 0.22], hw: R[2][0] * 1.14, hh: R[2][1] * 1.08 },
    ], { seg: 16, capFront: 0.26, capBack: 0.38, sub: 3 }), rule);

    // Thigh
    addPart('coat', mats.coat, loftGeometry(skirted(sec(1, 2), 0.04, 0.04), { seg: 14, capFront: 0.3, capBack: 0.3, uv: legUv(1, 2), sub: 2 }), rule);

    // Hock & Metatarsus
    addPart('hide', mats.hide, blob(R[2][0] * 1.05, [0.85, 1.05, 0.9], V(P[2].x, P[2].y + R[2][1] * 0.2, P[2].z - R[2][0] * 0.62), 10), rule);
    addPart('leg', mats.leg, loftGeometry(skirted(sec(2, 4), 0.06, 0.03), { seg: 14, capFront: 0.35, capBack: 0.25, uv: legUv(2, 4), sub: 2 }), rule);
  }

  // Pastern
  addPart('leg', mats.leg, loftGeometry(skirted(sec(4, 5), 0.02, 0.01), { seg: 12, capFront: 0.25, capBack: 0.18, uv: legUv(4, 5), sub: 2 }), rule);

  // Ox feathering
  if (rig.species === 'ox') {
    const hairGeo = loftGeometry([
      { at: [P[4].x, P[4].y + 0.035, P[4].z - 0.004], hw: R[4][0] * 1.55, hh: R[4][1] * 1.2 },
      { at: [P[4].x, P[4].y - 0.03, P[4].z - 0.008], hw: R[4][0] * 1.2, hh: R[4][1] * 0.95 },
    ], { seg: 12, capFront: 0.5, capBack: 0.4, uv: [1, 0.3, 0.1, 0.55] });
    addPart('hair', mats.hair, hairGeo, rule);
  }

  // Foot and Hoof
  const [halfW, , hgt] = spec.legs[leg].hoof;
  const base = P[5];
  const dir = P[5].clone().sub(P[4]);
  const pitch = -Math.atan2(dir.z, -dir.y) * 0.35;

  const band = new THREE.CylinderGeometry(R[5][0] * 1.22, R[5][0] * 1.34, hgt * 0.34, 16, 1, true);
  band.rotateX(pitch);
  band.translate(base.x, base.y + hgt * 0.12, base.z);
  addPart('hide', mats.hide, band.toNonIndexed(), rule);

  if (rig.species === 'horse') {
    const wall = new THREE.CylinderGeometry(halfW * 1.0, halfW * 1.14, hgt, 18, 3, false);
    const pos = wall.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), z = pos.getZ(i);
      const t = (y + hgt / 2) / hgt;
      pos.setZ(i, z * (1 + (1 - t) * 0.1) + (1 - t) * halfW * 0.12);
      pos.setY(i, y - Math.max(0, z) * 0.05);
    }
    wall.computeVertexNormals();
    wall.rotateX(pitch - 0.1);
    wall.translate(base.x, base.y - hgt * 0.44, base.z + halfW * 0.05);
    addPart('hoof', mats.hoof, wall.toNonIndexed(), rule);
    addPart('hoof', mats.hoof, blob(halfW * 0.62, [1.5, 0.35, 1.15], V(base.x, base.y - hgt * 0.8, base.z + halfW * 0.5), 12), rule);
  } else {
    for (const claw of [-1, 1] as const) {
      const g = new THREE.SphereGeometry(halfW * 0.92, 14, 10);
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        pos.setXYZ(i,
          x * (1 + Math.max(0, y) * 0.35),
          (y / 1.25) * (hgt / halfW) * 1.15,
          z * (z > 0 ? 1.3 : 0.92) - Math.min(0, y) * 0.2,
        );
      }
      g.computeVertexNormals();
      g.rotateX(pitch);
      g.rotateY(claw * 0.2);
      g.translate(base.x + claw * halfW * 0.4, base.y - hgt * 0.4, base.z + halfW * 0.2);
      addPart('hoof', mats.hoof, g.toNonIndexed(), rule);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tack (Yoke boss, Bridle, Straps)                                   */
/* ------------------------------------------------------------------ */

function buildTack(rig: QuadRig, mats: QuadMats, hard: Rigidity): Record<string, THREE.Object3D> {
  const spec = rig.spec;
  const anchors: Record<string, THREE.Object3D> = {};
  const strap = (bone: QuadBoneName, points: [number, number, number][], r = 0.014, uv?: [number, number, number, number]): void => {
    const sections = points.map(at => ({ at, hw: r * 1.25, hh: r }));
    hard.add(bone, mats.leather, loftGeometry(sections, { seg: 8, capFront: 0.4, capBack: 0.4, uv, sub: 1 }));
  };

  if (rig.species === 'ox') {
    const y = spec.tack.collarY, z = spec.tack.collarZ;
    const neckRings = spec.neck1;
    const pad: LoftSection[] = [neckRings[1], neckRings[0]].map((t, i) => ({
      at: [0, t.at[1] - 0.045 - i * 0.008, t.at[2] - 0.015 + i * 0.03] as [number, number, number],
      hw: t.hw + 0.022,
      hh: t.hh * (i === 0 ? 0.9 : 0.78),
    }));
    pad.push({ at: [0, neckRings[0].at[1] + neckRings[0].hh * 0.34, neckRings[0].at[2] - 0.13], hw: 0.15, hh: 0.055 });
    hard.add('Withers', mats.leather, loftGeometry(pad, { seg: 20, capFront: 0.3, capBack: 0.34, uv: [1.5, 0.9, 0, 0.05] }));

    for (const side of [1, -1] as const) {
      strap('Withers', pad.map((s, i) => [side * (s.hw + 0.005), s.at[1] - s.hh * (0.1 + i * 0.04), s.at[2]]), 0.017);
      const ring = new THREE.TorusGeometry(0.045, 0.011, 8, 16);
      ring.rotateY(Math.PI / 2);
      ring.translate(side * (pad[1].hw + 0.03), pad[1].at[1] - 0.01, pad[1].at[2]);
      hard.add('Withers', mats.iron, ring.toNonIndexed());
    }

    const gy = spec.tack.chestY, gz = spec.tack.chestZ;
    strap('Chest', [
      [0.2, gy + 0.12, gz - 0.06], [0.26, gy - 0.14, gz - 0.2], [0.24, gy - 0.3, gz - 0.62],
      [0.2, gy - 0.24, gz - 1.0], [0.14, gy + 0.02, gz - 1.18], [-0.14, gy + 0.02, gz - 1.18],
      [-0.2, gy - 0.24, gz - 1.0], [-0.24, gy - 0.3, gz - 0.62], [-0.26, gy - 0.14, gz - 0.2], [-0.2, gy + 0.12, gz - 0.06],
    ], 0.018);

    strap('Withers', [[0.14, y - 0.14, z + 0.24], [0.05, y - 0.24, z + 0.26], [-0.05, y - 0.24, z + 0.26], [-0.14, y - 0.14, z + 0.24]], 0.016);
    hard.add('Withers', mats.brass, blob(0.058, [1, 1.15, 1], V(0, y - 0.3, z + 0.27), 14));
    hard.add('Withers', mats.iron, blob(0.017, [1, 1.4, 1], V(0, y - 0.37, z + 0.275), 8));

    const pollPos = spec.head[0].at, nosePos = spec.head[spec.head.length - 1].at;
    const crown = new THREE.TorusGeometry(0.165, 0.014, 8, 20, Math.PI * 1.12);
    crown.rotateX(Math.PI / 2 - 0.3);
    crown.rotateZ(Math.PI * 0.44);
    crown.translate(0, pollPos[1] + 0.02, pollPos[2] + 0.03);
    hard.add('Head', mats.leather, crown.toNonIndexed());

    const band = new THREE.TorusGeometry(0.12, 0.015, 8, 20, Math.PI * 1.3);
    band.rotateX(Math.PI / 2 - 0.22);
    band.rotateZ(Math.PI * 0.35);
    band.translate(0, nosePos[1] + 0.05, nosePos[2] - 0.06);
    hard.add('Head', mats.leather, band.toNonIndexed());

    for (const side of [1, -1] as const) {
      strap('Head', [
        [side * 0.155, pollPos[1] + 0.005, pollPos[2] + 0.035],
        [side * 0.145, (pollPos[1] + nosePos[1]) / 2 + 0.02, (pollPos[2] + nosePos[2]) / 2],
        [side * 0.125, nosePos[1] + 0.055, nosePos[2] - 0.05],
      ], 0.013);
    }
    const hitch = new THREE.Object3D();
    hitch.name = 'hitch';
    hangOn(rig, rig.bones.Head, hitch, [-0.13, nosePos[1] + 0.02, nosePos[2] - 0.02]);
    anchors.hitch = hitch;

    const collar = new THREE.Object3D();
    collar.name = 'collar';
    hangOn(rig, rig.bones.Withers, collar, [-(pad[1].hw + 0.03), pad[1].at[1] - 0.01, pad[1].at[2]]);
    anchors.collar = collar;
  } else {
    // Horse bridle
    const pollPos = spec.head[0].at, nosePos = spec.head[spec.head.length - 1].at;
    const crown = new THREE.TorusGeometry(0.115, 0.011, 8, 20, Math.PI * 1.15);
    crown.rotateX(Math.PI / 2 - 0.28);
    crown.rotateZ(Math.PI * 0.42);
    crown.translate(0, pollPos[1] + 0.015, pollPos[2] - 0.015);
    hard.add('Head', mats.leather, crown.toNonIndexed());

    const brow = new THREE.TorusGeometry(0.101, 0.0085, 8, 20, Math.PI * 1.05);
    brow.rotateX(Math.PI / 2 - 0.14);
    brow.rotateZ(Math.PI * 0.47);
    brow.translate(0, pollPos[1] - 0.035, pollPos[2] + 0.06);
    hard.add('Head', mats.leather, brow.toNonIndexed());

    const noseband = new THREE.TorusGeometry(0.079, 0.011, 8, 20, Math.PI * 1.22);
    noseband.rotateX(Math.PI / 2 - 0.2);
    noseband.rotateZ(Math.PI * 0.4);
    noseband.translate(0, nosePos[1] + 0.082, nosePos[2] - 0.062);
    hard.add('Head', mats.leather, noseband.toNonIndexed());

    for (const side of [1, -1] as const) {
      strap('Head', [
        [side * 0.104, pollPos[1] - 0.01, pollPos[2] - 0.01],
        [side * 0.096, spec.jaw.hinge[0] - 0.005, spec.jaw.hinge[1] + 0.03],
        [side * 0.08, nosePos[1] + 0.08, nosePos[2] - 0.062],
      ], 0.011);
      const ring = new THREE.TorusGeometry(0.027, 0.0055, 7, 14);
      ring.rotateY(Math.PI / 2);
      ring.translate(side * 0.078, spec.jaw.hinge[0] - 0.022, spec.jaw.hinge[1] + spec.jaw.len * 0.7);
      hard.add('Head', mats.iron, ring.toNonIndexed());
    }

    const mouth = V(0, spec.jaw.hinge[0] - 0.024, spec.jaw.hinge[1] + spec.jaw.len * 0.7);
    const snaffle = new THREE.CylinderGeometry(0.0075, 0.0075, 0.135, 9);
    snaffle.rotateZ(Math.PI / 2);
    snaffle.translate(mouth.x, mouth.y, mouth.z);
    hard.add('Jaw', mats.iron, snaffle.toNonIndexed());

    const padSections = spec.trunk.slice(1, 4).map(t => ({
      at: [0, t.at[1] + t.hh * 1.0, t.at[2]] as [number, number, number],
      hw: t.hw * 0.74, hh: 0.026,
    }));
    hard.add('Withers', mats.felt, loftGeometry(padSections, { seg: 18, capFront: 0.24, capBack: 0.24, sub: 2, uv: [1.4, 1, 0.1, 0] }));

    const surcingle = new THREE.TorusGeometry(0.235, 0.013, 8, 20, Math.PI * 1.4);
    surcingle.rotateX(Math.PI / 2);
    surcingle.rotateZ(Math.PI * 0.8);
    surcingle.scale(1, 1.28, 1);
    surcingle.translate(0, spec.trunk[2].at[1] - 0.03, spec.trunk[2].at[2]);
    hard.add('Chest', mats.leather, surcingle.toNonIndexed());

    const leadRing = new THREE.Object3D();
    leadRing.name = 'hitch';
    hangOn(rig, rig.bones.Head, leadRing, [-0.08, spec.jaw.hinge[0] - 0.024, spec.jaw.hinge[1] + spec.jaw.len * 0.7]);
    anchors.hitch = leadRing;

    const collar = new THREE.Object3D();
    collar.name = 'collar';
    hangOn(rig, rig.bones.Withers, collar, [0, spec.trunk[1].at[1] - 0.06, spec.trunk[1].at[2] + 0.2]);
    anchors.collar = collar;
  }
  return anchors;
}
