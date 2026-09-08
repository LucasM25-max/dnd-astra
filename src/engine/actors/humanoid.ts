import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom, terrainHeight } from '../landscape';
import { smoothNormals } from './geometry';
import type { CombatMaterials } from './combat-materials';

/**
 * Skinned bipedal creatures — goblins, and the hero who fights them.
 *
 * Bodies are lofted from anatomically-placed elliptical cross-sections (hip
 * flare, waist pinch, ribcage, chest, shoulder slope) so the silhouette reads
 * as a creature rather than a stack of capsules. Heads are sculpted from a
 * modified sphere: brow ridge, eye sockets, cheekbones, jaw and chin, with a
 * separate nose, ears, teeth and eyes parented to the head bone. Clothing and
 * armour are real geometry — vests, robes, pauldrons, bracers — so every
 * character reads at a glance even before the texture set lands.
 *
 * Faces -Z, up is +Y, metres. Rig: 18 bones, two-bone limbs, terrain IK.
 */

export type HumanoidPose = 'idle' | 'crouch' | 'walk' | 'run' | 'attack' | 'shoot' | 'cast' | 'hurt' | 'down' | 'dead';

const BONES = {
  root: 0, pelvis: 1, spine: 2, chest: 3, neck: 4, head: 5,
  shoulderL: 6, elbowL: 7, handL: 8,
  shoulderR: 9, elbowR: 10, handR: 11,
  hipL: 12, kneeL: 13, footL: 14,
  hipR: 15, kneeR: 16, footR: 17,
} as const;
const BONE_COUNT = 18;

interface Section { y: number; z: number; halfWidth: number; halfDepth: number }

/** Loft a vertical stack of ellipses into a closed tube. */
function loft(sections: Section[], sides: number, capTop: boolean, capBottom: boolean) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      positions.push(Math.cos(a) * s.halfWidth, s.y, s.z + Math.sin(a) * s.halfDepth);
      uvs.push(j / sides, i / Math.max(1, sections.length - 1));
    }
  }
  // The torso is authored feet-to-head, but limbs hang downwards: their
  // sections run from the shoulder or hip to the hand or ankle. Winding is
  // only "outward" relative to the direction the rings travel, so a downwards
  // stack has to be wound the other way round.
  const flip = sections.length > 1 && sections[sections.length - 1].y < sections[0].y;
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const a = i * sides + j, b = i * sides + j2, c = (i + 1) * sides + j, d = (i + 1) * sides + j2;
      if (flip) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }
  // Caps wind the other way round from the sides: the ring is generated
  // counter-clockwise about +Y, so the bottom cap has to run (centre, j, j+1)
  // to face down and the top cap (centre, j+1, j) to face up.
  if (capBottom) {
    const centre = positions.length / 3;
    positions.push(0, sections[0].y, sections[0].z); uvs.push(.5, 0);
    for (let j = 0; j < sides; j++) {
      if (flip) indices.push(centre, (j + 1) % sides, j);     // stack runs down: this end faces up
      else indices.push(centre, j, (j + 1) % sides);
    }
  }
  if (capTop) {
    const last = sections.length - 1, centre = positions.length / 3;
    positions.push(0, sections[last].y, sections[last].z); uvs.push(.5, 1);
    for (let j = 0; j < sides; j++) {
      if (flip) indices.push(centre, last * sides + j, last * sides + (j + 1) % sides);
      else indices.push(centre, last * sides + (j + 1) % sides, last * sides + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** A squashed ellipsoid, used for joint caps, pauldrons and skulls. */
function blob(radiusX: number, radiusY: number, radiusZ: number, segments = 14) {
  const g = new THREE.SphereGeometry(1, segments, Math.max(8, Math.round(segments * 0.7)));
  g.scale(radiusX, radiusY, radiusZ);
  return g;
}

/** Catmull-Rom resample of sparse limb profiles into smooth muscle curves. */
function resample(profile: { y: number; r: number }[], count: number) {
  const curve = new THREE.CatmullRomCurve3(profile.map(p => new THREE.Vector3(p.r, p.y, 0)));
  const out: { y: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const p = curve.getPoint(i / (count - 1));
    out.push({ y: p.y, r: Math.max(0.001, p.x) });
  }
  return out;
}

interface Piece { geometry: THREE.BufferGeometry; bone: number; secondary?: number; blend?: (v: THREE.Vector3) => number }

export interface HumanoidShape {
  height: number;
  /** Fraction of height: hip, chest, shoulder, head base. */
  build: 'lean' | 'stocky';
  earLength: number;
  noseLength: number;
  /** Which texture family and detail set to use. Defaults to goblin. */
  species?: 'goblin' | 'human';
  /** Hero outfits are cut per class; goblins wear rags. */
  classId?: 'fighter' | 'wizard' | 'rogue' | 'cleric' | 'ranger' | null;
  hair?: string;
}

interface Anatomy {
  h: number; w: number; d: number;
  hipY: number; waistY: number; chestY: number; shoulderY: number; neckY: number; headY: number;
  thigh: number; shin: number; upperArm: number; foreArm: number; footY: number;
  hipX: number; shoulderX: number; skullR: number; headCentreY: number;
}

function anatomyOf(shape: HumanoidShape): Anatomy {
  const h = shape.height;
  const stocky = shape.build === 'stocky';
  const w = h * (stocky ? 0.155 : 0.125);   // torso half width
  const d = h * (stocky ? 0.115 : 0.085);   // torso half depth
  const thigh = h * 0.225, shin = h * 0.205;
  const upperArm = h * 0.16, foreArm = h * 0.15;
  const hipY = thigh + shin + h * 0.055;    // legs meet the pelvis honestly
  return {
    h, w, d,
    hipY, waistY: hipY + h * 0.085, chestY: hipY + h * 0.21, shoulderY: hipY + h * 0.30,
    neckY: hipY + h * 0.335, headY: hipY + h * 0.36,
    thigh, shin, upperArm, foreArm, footY: 0,
    hipX: w * 0.52, shoulderX: w * 1.04 + h * 0.035,
    skullR: h * (shape.species === 'human' ? 0.086 : 0.092),
    headCentreY: hipY + h * 0.415,
  };
}

/**
 * Where every joint sits, in the model's own space.
 *
 * The rig is a real skeleton: a bone's rest position is the joint it turns
 * around. Leaving them all at the origin makes every limb swing about the
 * creature's ankles, which looks correct only in the rest pose.
 */
function jointPositions(shape: HumanoidShape): THREE.Vector3[] {
  const a = anatomyOf(shape);
  const h = a.h;
  const goblin = (shape.species ?? 'goblin') === 'goblin';
  const hunch = goblin ? h * 0.045 : 0;
  const neckRake = goblin ? h * 0.02 : h * 0.008;
  /** The torso drifts forward with height; the spine has to drift with it. */
  const lean = (y: number) => ((y - a.hipY) / h) * hunch * 1.6;
  const shoulderY = a.shoulderY + h * 0.015;
  const headZ = h * 0.018 + neckRake;

  const layout = new Array<THREE.Vector3>(BONE_COUNT);
  layout[BONES.root] = new THREE.Vector3(0, 0, 0);
  layout[BONES.pelvis] = new THREE.Vector3(0, a.hipY, lean(a.hipY));
  layout[BONES.spine] = new THREE.Vector3(0, a.waistY - a.hipY, lean(a.waistY) - lean(a.hipY));
  layout[BONES.chest] = new THREE.Vector3(0, a.chestY - a.waistY, lean(a.chestY) - lean(a.waistY));
  layout[BONES.neck] = new THREE.Vector3(0, a.neckY - a.chestY, lean(a.neckY) - lean(a.chestY));
  layout[BONES.head] = new THREE.Vector3(0, a.headCentreY - a.skullR * 0.55 - a.neckY, headZ - lean(a.neckY));
  for (const [shoulder, elbow, hand, side] of [[BONES.shoulderL, BONES.elbowL, BONES.handL, -1], [BONES.shoulderR, BONES.elbowR, BONES.handR, 1]] as const) {
    layout[shoulder] = new THREE.Vector3(side * a.shoulderX, shoulderY - a.chestY, lean(shoulderY) - lean(a.chestY));
    layout[elbow] = new THREE.Vector3(0, -a.upperArm, 0);
    layout[hand] = new THREE.Vector3(0, -a.foreArm, 0);
  }
  for (const [hip, knee, foot, side] of [[BONES.hipL, BONES.kneeL, BONES.footL, -1], [BONES.hipR, BONES.kneeR, BONES.footR, 1]] as const) {
    layout[hip] = new THREE.Vector3(side * a.hipX, 0, 0);
    layout[knee] = new THREE.Vector3(0, -a.thigh, 0);
    layout[foot] = new THREE.Vector3(0, -a.shin, 0);
  }
  return layout;
}

function buildGeometry(shape: HumanoidShape, detail: number) {
  const a = anatomyOf(shape);
  const { h, w, d } = a;
  const sides = Math.max(9, Math.round(15 * detail));
  const limbSides = Math.max(7, Math.round(11 * detail));
  const goblin = (shape.species ?? 'goblin') === 'goblin';
  const hunch = goblin ? h * 0.045 : 0;   // goblins carry themselves hunched forward
  const pieces: Piece[] = [];

  // --- torso: hips -> waist -> ribcage -> chest -> shoulders ---------------
  const T = (y: number, zf: number, wf: number, df: number): Section =>
    ({ y, z: zf + ((y - a.hipY) / h) * hunch * 1.6, halfWidth: w * wf, halfDepth: d * df });
  const torso = loft([
    T(a.hipY - h * 0.055, 0, 0.86, 0.84),          // under-pelvis
    T(a.hipY, 0, 1.02, 0.96),                      // hip flare
    T(a.waistY - h * 0.035, -h * 0.004, 0.87, 0.86),
    T(a.waistY, -h * 0.006, 0.80, 0.80),           // waist pinch
    T(a.chestY - h * 0.075, -h * 0.004, 0.93, 0.96),
    T(a.chestY - h * 0.02, -h * 0.001, 0.99, 1.02),// ribcage
    T(a.chestY, h * 0.002, 1.0, 1.07),             // chest, pecs forward
    T(a.shoulderY - h * 0.045, 0, 0.95, 0.94),
    T(a.shoulderY, h * 0.004, 0.80, 0.80),         // shoulder slope
    T(a.shoulderY + h * 0.028, h * 0.006, 0.46, 0.55), // trapezius
  ], sides, true, true);
  pieces.push({
    geometry: torso, bone: BONES.spine, secondary: BONES.pelvis,
    blend: v => THREE.MathUtils.clamp((v.y - a.hipY) / Math.max(0.001, a.chestY - a.hipY), 0, 1),
  });

  // Neck: a thick confident column, raked forward.
  const neckRake = goblin ? h * 0.02 : h * 0.008;
  const neck = loft([
    { y: a.shoulderY + h * 0.022, z: h * 0.010 + neckRake * 0.4, halfWidth: w * 0.36, halfDepth: d * 0.44 },
    { y: a.neckY, z: h * 0.014 + neckRake * 0.8, halfWidth: w * 0.30, halfDepth: d * 0.37 },
    { y: a.headCentreY - a.skullR * 0.75, z: h * 0.016 + neckRake, halfWidth: w * 0.27, halfDepth: d * 0.34 },
  ], Math.max(7, sides - 3), false, false);
  pieces.push({
    geometry: neck, bone: BONES.neck, secondary: BONES.chest,
    blend: v => THREE.MathUtils.clamp((v.y - a.shoulderY - h * 0.02) / (h * 0.05), 0, 1),
  });

  // --- skull: a sphere sculpted into brow, sockets, cheekbones and jaw -----
  const skull = blob(a.skullR, a.skullR * 1.08, a.skullR * 0.98, Math.max(12, Math.round(18 * detail)));
  skull.translate(0, a.headCentreY, h * 0.018 + neckRake);
  const sp = skull.getAttribute('position') as THREE.BufferAttribute;
  const jawForward = goblin ? 0.34 : 0.16;       // how far the jaw juts
  const jawDrop = goblin ? 1.28 : 1.06;          // how deep the jaw hangs
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i) - a.headCentreY, z = sp.getZ(i) - (h * 0.018 + neckRake);
    const lat = Math.asin(THREE.MathUtils.clamp(y / (a.skullR * 1.08), -1, 1));   // + up
    const lon = Math.atan2(x, -z);                                                 // 0 = facing forward
    let px = x, py = y, pz = z;
    // Brow ridge above the eyes.
    const brow = Math.exp(-Math.pow((lat - 0.18) / 0.16, 2)) * Math.exp(-Math.pow(lon / 1.1, 2));
    pz -= brow * a.skullR * (goblin ? 0.22 : 0.10);
    // Eye sockets: a soft inward dimple so the eyes sit in shadow.
    for (const side of [-1, 1]) {
      const el = Math.exp(-Math.pow((lat - 0.02) / 0.12, 2)) * Math.exp(-Math.pow((lon - side * 0.52) / 0.34, 2));
      pz += el * a.skullR * 0.10;
    }
    // Cheekbones.
    const cheek = Math.exp(-Math.pow((lat + 0.10) / 0.14, 2)) * Math.exp(-Math.pow((Math.abs(lon) - 0.75) / 0.30, 2));
    px += Math.sign(x || 1) * cheek * a.skullR * 0.10;
    // Jaw and chin: heavy below and ahead, tapering to a rounded chin.
    const jawZone = THREE.MathUtils.clamp(-lat / 1.1, 0, 1) * Math.exp(-Math.pow(lon / 1.35, 2));
    pz -= jawZone * a.skullR * jawForward * 0.5;
    py -= jawZone * a.skullR * (jawDrop - 1) * 0.55;
    const chin = Math.exp(-Math.pow((lat + 0.62) / 0.20, 2)) * Math.exp(-Math.pow(lon / 0.5, 2));
    pz -= chin * a.skullR * jawForward * 0.42;
    // Flatten the back of a goblin skull slightly; crown the human rounder.
    if (lon > 1.9 || lon < -1.9) px *= goblin ? 0.97 : 1.0;
    sp.setXYZ(i, px, py + a.headCentreY, pz + h * 0.018 + neckRake);
  }
  pieces.push({ geometry: skull, bone: BONES.head });

  // Nose: bridge to tip, broader and longer on a goblin.
  const noseBase = a.headCentreY + a.skullR * 0.05;
  const noseLen = shape.noseLength;
  const nose = loft([
    { y: noseBase + a.skullR * 0.16, z: -a.skullR * 0.62, halfWidth: a.skullR * 0.16, halfDepth: a.skullR * 0.10 },
    { y: noseBase, z: -a.skullR * 0.78 - noseLen * 0.35, halfWidth: a.skullR * 0.20, halfDepth: a.skullR * 0.13 },
    { y: noseBase - a.skullR * 0.10, z: -a.skullR * 0.82 - noseLen * 0.8, halfWidth: a.skullR * 0.23, halfDepth: a.skullR * 0.15 },
    { y: noseBase - a.skullR * 0.20, z: -a.skullR * 0.72 - noseLen, halfWidth: a.skullR * 0.12, halfDepth: a.skullR * 0.09 },
  ], Math.max(6, sides - 4), true, false);
  pieces.push({ geometry: nose, bone: BONES.head });

  // Ears: a flattened cone with a darker inner leaf. Goblin ears sweep long.
  for (const side of [-1, 1]) {
    const earLen = shape.earLength;
    const earProfile: [number, number][] = [
      [0.001, 0], [a.skullR * 0.16, a.skullR * 0.10], [a.skullR * 0.13, a.skullR * 0.38],
      [a.skullR * 0.08, a.skullR * 0.72], [0.012, earLen], [0.001, earLen + a.skullR * 0.04],
    ];
    const ear = new THREE.LatheGeometry(earProfile.map(([r, y]) => new THREE.Vector2(r, y)), Math.max(5, sides - 5));
    ear.scale(1, 1, 0.42);
    ear.rotateZ(side * -0.35);
    ear.rotateY(Math.PI / 2);
    ear.translate(side * a.skullR * 0.86, a.headCentreY + a.skullR * 0.06, h * 0.018 + neckRake + a.skullR * 0.08);
    pieces.push({ geometry: ear, bone: BONES.head });
  }

  // --- arms: deltoid cap, bicep swell, forearm taper, real hands ----------
  const armProfiles = resample([
    { y: a.shoulderY + h * 0.015, r: w * 0.30 },
    { y: a.shoulderY - a.upperArm * 0.18, r: w * 0.27 },
    { y: a.shoulderY - a.upperArm * 0.62, r: w * 0.215 },
    { y: a.shoulderY - a.upperArm, r: w * 0.175 },
  ], Math.max(4, Math.round(5 * detail)));
  const foreProfiles = resample([
    { y: a.shoulderY - a.upperArm, r: w * 0.185 },
    { y: a.shoulderY - a.upperArm - a.foreArm * 0.30, r: w * 0.16 },
    { y: a.shoulderY - a.upperArm - a.foreArm * 0.72, r: w * 0.135 },
    { y: a.shoulderY - a.upperArm - a.foreArm, r: w * 0.115 },
  ], Math.max(4, Math.round(5 * detail)));
  for (const side of [-1, 1]) {
    const shoulder = side < 0 ? BONES.shoulderL : BONES.shoulderR;
    const elbow = side < 0 ? BONES.elbowL : BONES.elbowR;
    const hand = side < 0 ? BONES.handL : BONES.handR;
    const sx = side * a.shoulderX;
    const y0 = a.shoulderY;

    const upper = loft(armProfiles.map(p => ({ y: p.y, z: 0, halfWidth: p.r, halfDepth: p.r })), limbSides, false, true)
      .translate(sx, 0, 0);
    pieces.push({ geometry: upper, bone: shoulder });

    const lower = loft(foreProfiles.map(p => ({ y: p.y, z: 0, halfWidth: p.r, halfDepth: p.r })), limbSides, false, false)
      .translate(sx, 0, 0);
    pieces.push({ geometry: lower, bone: elbow });

    // A mitt with a palm, knuckles and an opposable thumb.
    const handY = y0 - a.upperArm - a.foreArm;
    const palm = loft([
      { y: handY + h * 0.008, z: -h * 0.004, halfWidth: w * 0.145, halfDepth: w * 0.115 },
      { y: handY - h * 0.020, z: -h * 0.012, halfWidth: w * 0.155, halfDepth: w * 0.105 },
      { y: handY - h * 0.046, z: -h * 0.016, halfWidth: w * 0.115, halfDepth: w * 0.085 },
    ], Math.max(6, limbSides - 2), true, false).translate(side * a.shoulderX, 0, 0);
    pieces.push({ geometry: palm, bone: hand });
    const thumb = blob(w * 0.055, w * 0.075, w * 0.055, 8);
    thumb.translate(side * (a.shoulderX + w * 0.10), handY - h * 0.012, -h * 0.018);
    pieces.push({ geometry: thumb, bone: hand });
  }

  // --- legs: quad bulge, calf, wedge foot ----------------------------------
  const hipX = a.hipX;
  const kneeY = a.hipY - a.thigh, ankleY = kneeY - a.shin;
  const thighProfiles = resample([
    { y: a.hipY - h * 0.01, r: w * 0.42 },
    { y: a.hipY - a.thigh * 0.30, r: w * 0.37 },
    { y: a.hipY - a.thigh * 0.68, r: w * 0.28 },
    { y: kneeY, r: w * 0.215 },
  ], Math.max(4, Math.round(6 * detail)));
  const shinProfiles = resample([
    { y: kneeY, r: w * 0.225 },
    { y: kneeY - a.shin * 0.28, r: w * 0.19 },
    { y: kneeY - a.shin * 0.66, r: w * 0.12 },
    { y: ankleY, r: w * 0.095 },
  ], Math.max(4, Math.round(5 * detail)));
  for (const side of [-1, 1]) {
    const hip = side < 0 ? BONES.hipL : BONES.hipR;
    const knee = side < 0 ? BONES.kneeL : BONES.kneeR;
    const foot = side < 0 ? BONES.footL : BONES.footR;
    const sx = side * hipX;

    const upper = loft(thighProfiles.map(p => ({ y: p.y, z: 0, halfWidth: p.r, halfDepth: p.r * 1.06 })), limbSides, false, true)
      .translate(sx, 0, 0);
    pieces.push({ geometry: upper, bone: hip });

    // The calf kicks backward below the knee.
    const lower = loft(shinProfiles.map((p, i) => ({
      y: p.y, z: i === 1 ? h * 0.012 : i === 2 ? h * 0.006 : 0, halfWidth: p.r, halfDepth: p.r * (i === 1 ? 1.22 : 1.0),
    })), limbSides, false, false).translate(sx, 0, 0);
    pieces.push({ geometry: lower, bone: knee });

    // A real foot: heel, arch, toes.
    const footGeo = loft([
      { y: h * 0.002, z: -h * 0.026, halfWidth: w * 0.16, halfDepth: w * 0.30 },
      { y: h * 0.016, z: -h * 0.028, halfWidth: w * 0.165, halfDepth: w * 0.28 },
      { y: h * 0.030, z: -h * 0.010, halfWidth: w * 0.135, halfDepth: w * 0.17 },
      { y: h * 0.046, z: h * 0.002, halfWidth: w * 0.11, halfDepth: w * 0.12 },
    ], Math.max(6, limbSides - 2), true, false).translate(sx, 0, 0);
    pieces.push({ geometry: footGeo, bone: foot });
  }

  // --- bind ----------------------------------------------------------------
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const g = pieces[i].geometry;
    g.setAttribute('piece', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(i), 1));
    geometries.push(g);
  }
  const merged = mergeGeometries(geometries, false)!;
  geometries.forEach(g => g.dispose());

  const position = merged.getAttribute('position');
  const pieceAttr = merged.getAttribute('piece');
  const count = position.count;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const colour = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const piece = pieces[pieceAttr.getX(i)];
    v.fromBufferAttribute(position, i);
    const blend = piece.blend && piece.secondary !== undefined ? THREE.MathUtils.clamp(piece.blend(v), 0, 1) : 1;
    skinIndex[i * 4] = piece.bone;
    skinIndex[i * 4 + 1] = piece.secondary ?? piece.bone;
    skinWeight[i * 4] = blend;
    skinWeight[i * 4 + 1] = 1 - blend;
    // Subtle vertex-colour variation breaks up a tiling skin texture.
    const n = Math.sin(v.x * 47.3 + v.y * 21.7 + v.z * 33.1) * 43758.5453;
    const shade = 0.90 + (n - Math.floor(n) - 0.5) * 0.13 + (v.y / h - 0.5) * 0.06;
    colour[i * 3] = colour[i * 3 + 1] = colour[i * 3 + 2] = THREE.MathUtils.clamp(shade, 0.72, 1.06);
  }
  merged.deleteAttribute('piece');
  merged.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  merged.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  merged.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  smoothNormals(merged);
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return { geometry: merged, metrics: a };
}

export interface HumanoidCommand {
  /** Metres per second along facing. */
  speed: number;
  pose: HumanoidPose;
  /** 0..1 blend toward a crouched, hiding stance. */
  crouch: number;
  /** Where the head and torso look, in world space. */
  lookAt?: THREE.Vector3;
  /** 0..1 progress through a one-shot action, driven by the encounter. */
  actionPhase: number;
  /** Pose name only matters again when actionPhase < 0 (self-advancing). */
}

export class Humanoid {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  readonly shape: HumanoidShape;
  readonly weapon = new THREE.Group();
  /** Public so the encounter renderer can hang health bars at the right place. */
  readonly headHeight: number;

  private metrics: Anatomy;
  private rng: () => number;
  private t: number;
  private stride = 0;
  private moving = 0;
  private crouchBlend = 0;
  private actionBlend = 0;
  private currentPose: HumanoidPose = 'idle';
  private deathBlend = 0;
  private nextBlink: number;
  private blinkT = -1;
  private breath: number;
  private footPlant: [number, number] = [0, 0];
  private lookTarget = new THREE.Vector3();
  private hasLook = false;
  private eyeL: THREE.Mesh | null = null;
  private eyeR: THREE.Mesh | null = null;
  onFootfall?: (side: number, x: number, z: number, strength: number) => void;

  constructor(shape: HumanoidShape, materials: CombatMaterials, skinTint: string, clothTint: string, seed = 0, detail = 1) {
    this.shape = shape;
    this.rng = seededRandom(4200 + seed * 733);
    this.t = this.rng() * 8;
    this.breath = this.rng() * Math.PI * 2;
    this.nextBlink = 1 + this.rng() * 4;
    this.headHeight = shape.height * 0.99;

    const { geometry, metrics } = buildGeometry(shape, detail);
    this.metrics = metrics;

    const goblin = (shape.species ?? 'goblin') === 'goblin';
    const material = (goblin ? materials.creatureSkin : materials.humanSkin).clone();
    material.color = new THREE.Color(skinTint);
    material.vertexColors = true;

    // --- skeleton ----------------------------------------------------------
    const bones: THREE.Bone[] = [];
    for (let i = 0; i < BONE_COUNT; i++) bones.push(new THREE.Bone());
    const B = BONES;
    // Put every joint where the anatomy says it is. Without this the rest pose
    // is right and every animated pose tears its own limbs off.
    const joints = jointPositions(shape);
    for (let i = 0; i < BONE_COUNT; i++) bones[i].position.copy(joints[i]);
    bones[B.root].name = 'root';
    bones[B.pelvis].name = 'pelvis';
    bones[B.spine].name = 'spine'; bones[B.chest].name = 'chest';
    bones[B.neck].name = 'neck'; bones[B.head].name = 'head';
    bones[B.root].add(bones[B.pelvis]);
    bones[B.pelvis].add(bones[B.spine]);
    bones[B.spine].add(bones[B.chest]);
    bones[B.chest].add(bones[B.neck]);
    bones[B.neck].add(bones[B.head]);
    for (const [shoulder, elbow, hand, side] of [[B.shoulderL, B.elbowL, B.handL, -1], [B.shoulderR, B.elbowR, B.handR, 1]] as const) {
      bones[shoulder].name = `shoulder${side < 0 ? 'L' : 'R'}`;
      bones[elbow].name = `elbow${side < 0 ? 'L' : 'R'}`;
      bones[hand].name = `hand${side < 0 ? 'L' : 'R'}`;
      bones[B.chest].add(bones[shoulder]); bones[shoulder].add(bones[elbow]); bones[elbow].add(bones[hand]);
    }
    for (const [hip, knee, foot, side] of [[B.hipL, B.kneeL, B.footL, -1], [B.hipR, B.kneeR, B.footR, 1]] as const) {
      bones[hip].name = `hip${side < 0 ? 'L' : 'R'}`;
      bones[knee].name = `knee${side < 0 ? 'L' : 'R'}`;
      bones[foot].name = `foot${side < 0 ? 'L' : 'R'}`;
      bones[B.pelvis].add(bones[hip]); bones[hip].add(bones[knee]); bones[knee].add(bones[foot]);
    }
    for (const bone of bones) bone.rotation.order = 'YXZ';
    this.bones = bones;

    this.mesh = new THREE.SkinnedMesh(geometry, material);
    this.mesh.add(bones[B.root]);
    this.mesh.bind(new THREE.Skeleton(bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.root.rotation.order = 'YXZ';

    // From here on every attachment is authored in model space and folded into
    // whichever bone it rides on, so moving the joints never moves the props.
    this.root.updateMatrixWorld(true);
    this.addFace(materials, goblin);
    this.addOutfit(materials, clothTint, goblin);

    // The weapon rides in the right hand; the encounter fills it in.
    bones[B.handR].add(this.weapon);
  }

  /**
   * Parent objects to a bone without moving them.
   *
   * Attachments (eyes, teeth, garments, carried kit) are easiest to author in
   * the model's own coordinates. `attach` converts that world placement into
   * the bone's local frame, so the piece stays exactly where it was drawn no
   * matter where the joint ended up.
   */
  attach(bone: THREE.Bone, ...objects: THREE.Object3D[]) {
    bone.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().copy(bone.matrixWorld).invert();
    for (const object of objects) {
      object.applyMatrix4(inverse);
      bone.add(object);
    }
  }

  /** Same conversion for callers that address a bone by index. */
  attachToBone(index: number, ...objects: THREE.Object3D[]) {
    const bone = this.bones[index];
    if (bone) this.attach(bone, ...objects);
  }

  /** Eyes with depth, a mouth, teeth on a goblin, hair on a hero. */
  private addFace(materials: CombatMaterials, goblin: boolean) {
    const { h, skullR, headCentreY: hc } = this.metrics;
    const head = this.bones[BONES.head];
    const faceZ = -skullR * 0.80;
    const eyeY = hc + skullR * 0.02, eyeX = skullR * 0.42, eyeR = skullR * (goblin ? 0.155 : 0.13);

    const sclera = new THREE.MeshPhysicalMaterial({
      color: goblin ? '#c8b34a' : '#e8e2d2', roughness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.1,
    });
    const irisMat = new THREE.MeshStandardMaterial({ color: goblin ? '#2a1e08' : '#3a2a18', roughness: 0.25 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 12, 10), sclera);
      eye.scale.set(1, goblin ? 1.15 : 0.95, 0.72);
      eye.position.set(side * eyeX, eyeY, faceZ + skullR * 0.06);
      eye.rotation.y = side * -0.22;
      this.attach(head, eye);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.52, 10, 8), irisMat);
      iris.scale.set(1, 1, 0.5);
      iris.position.set(0, 0, -eyeR * 0.62);
      eye.add(iris);
      if (side < 0) this.eyeL = eye; else this.eyeR = eye;

      // A heavy brow shadows the socket — strongly on a goblin.
      const brow = new THREE.Mesh(new THREE.BoxGeometry(eyeR * 2.4, skullR * 0.10, skullR * 0.16), materials.creatureSkin);
      (brow.material as THREE.MeshStandardMaterial) = (brow.material as THREE.MeshStandardMaterial);
      brow.position.set(side * eyeX, eyeY + eyeR * 1.35, faceZ + skullR * 0.10);
      brow.rotation.set(0.25, side * -0.2, side * -0.10);
      brow.scale.z = goblin ? 1.5 : 1;
      this.attach(head, brow);
    }

    // Mouth: a dark slit; goblins get an underbite with real teeth.
    const mouthY = hc - skullR * 0.42;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(skullR * (goblin ? 0.62 : 0.5), skullR * 0.05, skullR * 0.10),
      new THREE.MeshStandardMaterial({ color: goblin ? '#3a1210' : '#7a4a40', roughness: 0.6 }));
    mouth.position.set(0, mouthY, faceZ - skullR * (goblin ? 0.28 : 0.16));
    this.attach(head, mouth);
    if (goblin) {
      const toothMat = new THREE.MeshStandardMaterial({ color: '#d8c98e', roughness: 0.45 });
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(skullR * 0.045, skullR * 0.16, 5), toothMat);
        tooth.position.set(i * skullR * 0.14, mouthY + skullR * 0.06, faceZ - skullR * 0.32);
        tooth.rotation.x = Math.PI;
        this.attach(head, tooth);
      }
      // Two lower tusks pushing up past the lip.
      for (const side of [-1, 1]) {
        const tusk = new THREE.Mesh(new THREE.ConeGeometry(skullR * 0.05, skullR * 0.20, 5), toothMat);
        tusk.position.set(side * skullR * 0.24, mouthY - skullR * 0.02, faceZ - skullR * 0.34);
        tusk.rotation.x = -0.25;
        this.attach(head, tusk);
      }
    }

    // Hair. Goblins sprout a few wiry tufts; the hero gets a short crop.
    if (goblin) {
      const tuftMat = new THREE.MeshStandardMaterial({ color: '#2e2a20', roughness: 1 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + this.rng();
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(skullR * 0.09, skullR * (0.3 + this.rng() * 0.25), 5), tuftMat);
        tuft.position.set(Math.cos(a) * skullR * 0.5, hc + skullR * 0.92, h * 0.018 + Math.sin(a) * skullR * 0.45 + skullR * 0.1);
        tuft.rotation.set(0.3 + Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
        this.attach(head, tuft);
      }
    } else if (this.shape.hair !== 'bald') {
      const crop = new THREE.Mesh(new THREE.SphereGeometry(skullR * 1.04, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
        new THREE.MeshStandardMaterial({ color: this.shape.hair ?? '#4a351f', roughness: 0.95 }));
      crop.position.set(0, hc + skullR * 0.02, h * 0.018);
      crop.rotation.x = -0.22;
      this.attach(head, crop);
    }
  }

  /** Real garments: goblin rags or a per-class kit, cut to the body. */
  private addOutfit(materials: CombatMaterials, tint: string, goblin: boolean) {
    const { h, w, d, hipY, chestY, shoulderY, thigh, shin, upperArm, foreArm, shoulderX } = this.metrics;
    const cloth = materials.creatureCloth.clone();
    cloth.color = new THREE.Color(tint);
    const group = new THREE.Group();

    if (goblin) {
      // Ragged vest hugging the ribcage, belted, one bracer, one shoulder pad.
      const vest = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.06, w * 1.12, h * 0.20, 12, 1, true), cloth);
      vest.position.y = hipY + (chestY - hipY) * 0.55;
      vest.castShadow = true;
      group.add(vest);
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.04, w * 1.30, h * 0.15, 12, 1, true), cloth);
      skirt.position.y = hipY - h * 0.045;
      skirt.castShadow = true;
      group.add(skirt);
      const belt = new THREE.Mesh(new THREE.TorusGeometry(w * 1.02, h * 0.013, 6, 16), materials.leather);
      belt.rotation.x = Math.PI / 2; belt.position.y = hipY + h * 0.012;
      group.add(belt);
      const pouch = new THREE.Mesh(new THREE.SphereGeometry(h * 0.032, 8, 6), materials.leather);
      pouch.scale.set(1, 1.1, 0.6); pouch.position.set(w * 0.9, hipY - h * 0.03, d * 0.7);
      group.add(pouch);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(h * 0.028, h * 0.26, h * 0.010), materials.leather);
      strap.position.set(-w * 0.14, chestY - h * 0.01, -d * 0.88);
      strap.rotation.z = 0.46;
      group.add(strap);
      // A studded bracer on the weapon forearm.
      const bracer = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.16, w * 0.19, h * 0.09, 9, 1, true), materials.leather);
      bracer.position.set(shoulderX, shoulderY - upperArm - foreArm * 0.45, 0);
      bracer.castShadow = true;
      group.add(bracer);
      // A scrap pauldron over the strap shoulder.
      const pad = new THREE.Mesh(new THREE.SphereGeometry(w * 0.30, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), materials.leather);
      pad.position.set(-shoulderX * 0.95, shoulderY + h * 0.01, 0);
      pad.rotation.z = -0.3;
      pad.castShadow = true;
      group.add(pad);

      this.attach(this.bones[BONES.pelvis], skirt, belt, pouch);
      this.attach(this.bones[BONES.chest], vest, strap);
      this.attach(this.bones[BONES.elbowR], bracer);
      this.attach(this.bones[BONES.shoulderL], pad);
    } else {
      // Hero kit, per class.
      const leather = materials.leather;
      const mail = materials.chainmail;
      switch (this.shape.classId) {
        case 'fighter': {
          const shirt = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.10, w * 1.02, h * 0.26, 14, 1, true), mail);
          shirt.position.y = hipY + (chestY - hipY) * 0.62;
          shirt.castShadow = true;
          const skirt = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.05, w * 1.22, h * 0.13, 12, 1, true), mail);
          skirt.position.y = hipY - h * 0.03;
          const belt = new THREE.Mesh(new THREE.TorusGeometry(w * 1.06, h * 0.014, 6, 16), leather);
          belt.rotation.x = Math.PI / 2; belt.position.y = hipY + h * 0.02;
          for (const side of [-1, 1]) {
            const pauldron = new THREE.Mesh(new THREE.SphereGeometry(w * 0.34, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.58), mail);
            pauldron.position.set(side * shoulderX * 0.96, shoulderY + h * 0.012, 0);
            pauldron.rotation.z = side * 0.35;
            pauldron.castShadow = true;
            this.attach(this.bones[side < 0 ? BONES.shoulderL : BONES.shoulderR], pauldron);
          }
          this.attach(this.bones[BONES.chest], shirt);
          this.attach(this.bones[BONES.pelvis], skirt, belt);
          break;
        }
        case 'wizard': {
          // A floor-length robe from chest to ankle, with a rope belt.
          const hemY = hipY - thigh - shin * 0.2, topY = chestY - h * 0.05;
          const robe = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.05, w * 1.85, topY - hemY, 16, 3, true), cloth);
          robe.position.y = (topY + hemY) / 2;
          robe.castShadow = true;
          const sash = new THREE.Mesh(new THREE.TorusGeometry(w * 0.98, h * 0.011, 6, 16), materials.leather);
          sash.rotation.x = Math.PI / 2; sash.position.y = hipY + h * 0.09;
          this.attach(this.bones[BONES.chest], robe, sash);
          break;
        }
        case 'rogue': {
          const vest = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.08, w * 1.0, h * 0.22, 12, 1, true), leather);
          vest.position.y = hipY + (chestY - hipY) * 0.6;
          vest.castShadow = true;
          const belt = new THREE.Mesh(new THREE.TorusGeometry(w * 1.02, h * 0.012, 6, 16), leather);
          belt.rotation.x = Math.PI / 2; belt.position.y = hipY + h * 0.015;
          this.attach(this.bones[BONES.chest], vest);
          this.attach(this.bones[BONES.pelvis], belt);
          break;
        }
        case 'cleric': {
          const robe = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.06, w * 1.6, (hipY - thigh - shin * 0.35) - (chestY + h * 0.02), 16, 3, true), cloth);
          robe.position.y = ((chestY + h * 0.02) + (hipY - thigh - shin * 0.35)) / 2;
          robe.castShadow = true;
          const mantle = new THREE.Mesh(new THREE.SphereGeometry(w * 0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), cloth);
          mantle.position.y = shoulderY + h * 0.005;
          mantle.castShadow = true;
          this.attach(this.bones[BONES.chest], robe, mantle);
          break;
        }
        case 'ranger': {
          const cuirass = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.05, w * 0.98, h * 0.20, 12, 1, true), leather);
          cuirass.position.y = hipY + (chestY - hipY) * 0.66;
          cuirass.castShadow = true;
          const belt = new THREE.Mesh(new THREE.TorusGeometry(w * 1.0, h * 0.012, 6, 16), leather);
          belt.rotation.x = Math.PI / 2; belt.position.y = hipY + h * 0.015;
          for (const side of [-1, 1]) {
            const bracer = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.15, w * 0.18, h * 0.085, 9, 1, true), leather);
            bracer.position.set(0, -foreArm * 0.45, 0);
            bracer.castShadow = true;
            this.attach(this.bones[side < 0 ? BONES.elbowL : BONES.elbowR], bracer);
          }
          this.attach(this.bones[BONES.chest], cuirass);
          this.attach(this.bones[BONES.pelvis], belt);
          break;
        }
        default: {
          // A simple travelling tunic so even the base body is dressed.
          const tunic = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.08, w * 1.15, h * 0.22, 12, 1, true), cloth);
          tunic.position.y = hipY + (chestY - hipY) * 0.55;
          tunic.castShadow = true;
          const belt = new THREE.Mesh(new THREE.TorusGeometry(w * 1.02, h * 0.012, 6, 16), leather);
          belt.rotation.x = Math.PI / 2; belt.position.y = hipY + h * 0.015;
          this.attach(this.bones[BONES.chest], tunic);
          this.attach(this.bones[BONES.pelvis], belt);
        }
      }
    }
    // `group` only staged the meshes; everything is bone-parented above.
    group.clear();
  }

  /** Place the creature; y is sampled from the terrain. */
  place(x: number, z: number, yaw: number) {
    this.root.position.set(x, terrainHeight(x, z), z);
    this.root.rotation.y = yaw;
  }

  setPose(pose: HumanoidPose) {
    if (pose !== this.currentPose) { this.currentPose = pose; this.actionBlend = 0; }
  }

  update(dt: number, command: HumanoidCommand) {
    this.t += dt;
    const h = this.shape.height, m = this.metrics, B = this.bones;
    const pose = command.pose;
    if (pose !== this.currentPose) { this.currentPose = pose; this.actionBlend = 0; }

    const speed = Math.abs(command.speed);
    const running = pose === 'run';
    this.moving = THREE.MathUtils.damp(this.moving, Math.min(1, speed / (running ? 4.8 : 2.2)), 8, dt);
    this.crouchBlend = THREE.MathUtils.damp(this.crouchBlend, command.crouch, 6, dt);
    const dying = pose === 'down' || pose === 'dead';
    this.deathBlend = THREE.MathUtils.damp(this.deathBlend, dying ? 1 : 0, dying ? 5 : 9, dt);

    // Stride frequency scales with speed so footfalls land where the feet are.
    const cadence = (running ? 2.25 : 1.6) + speed * (running ? 1.65 : 1.35);
    if (speed > 0.05) this.stride += dt * cadence * Math.PI * 2 * (command.speed < 0 ? -1 : 1);
    const swing = this.moving;

    // --- root: breathing, bob, crouch, collapse ------------------------------
    this.breath += dt * (1.1 + this.moving * 1.4);
    const breathe = Math.sin(this.breath) * h * 0.006 * (1 - this.moving * 0.5);
    const bob = Math.abs(Math.sin(this.stride)) * h * (running ? 0.030 : 0.022) * swing;
    const crouchDrop = this.crouchBlend * h * 0.16;

    // Falling is a rotation about the feet, not a translation: the body tips
    // over onto its side and then rides at half its own thickness so it lies
    // on the ground instead of through it.
    const fallen = this.deathBlend;
    B[BONES.root].position.y = breathe + bob - crouchDrop + fallen * (m.w * 0.95 + h * 0.015);
    B[BONES.root].rotation.z = Math.sin(this.stride) * 0.035 * swing + fallen * 1.45;
    B[BONES.root].rotation.x = fallen * 0.22;

    B[BONES.pelvis].rotation.y = -Math.sin(this.stride) * 0.13 * swing;
    B[BONES.pelvis].rotation.x = this.crouchBlend * 0.30;

    B[BONES.spine].rotation.x = 0.03 + this.moving * 0.10 + this.crouchBlend * 0.34 - this.deathBlend * 0.10;
    B[BONES.spine].rotation.y = Math.sin(this.stride) * 0.07 * swing;
    B[BONES.chest].rotation.x = this.moving * 0.05 + this.crouchBlend * 0.16;
    B[BONES.chest].rotation.y = Math.sin(this.stride) * 0.09 * swing;

    // --- head: look-at plus idle scanning ------------------------------------
    let headYaw = Math.sin(this.t * 0.42 + this.breath) * 0.16 * (1 - this.moving);
    let headPitch = -0.04 + this.crouchBlend * 0.10;
    if (command.lookAt) {
      this.lookTarget.copy(command.lookAt); this.hasLook = true;
    }
    if (this.hasLook && !dying) {
      const local = this.root.worldToLocal(this.lookTarget.clone());
      const desiredYaw = THREE.MathUtils.clamp(Math.atan2(local.x, -local.z), -1.1, 1.1);
      const flat = Math.hypot(local.x, local.z);
      const desiredPitch = THREE.MathUtils.clamp(-Math.atan2(local.y - this.headHeight, flat), -0.6, 0.6);
      headYaw = THREE.MathUtils.damp(B[BONES.head].rotation.y, desiredYaw * 0.62, 7, dt);
      headPitch = THREE.MathUtils.damp(B[BONES.head].rotation.x, desiredPitch, 7, dt);
      B[BONES.neck].rotation.y = THREE.MathUtils.damp(B[BONES.neck].rotation.y, desiredYaw * 0.38, 6, dt);
    } else {
      B[BONES.neck].rotation.y = THREE.MathUtils.damp(B[BONES.neck].rotation.y, 0, 4, dt);
    }
    B[BONES.head].rotation.y = headYaw;
    B[BONES.head].rotation.x = headPitch + this.deathBlend * 0.5;

    // Blink by squashing the eye sockets — cheap and reads well at distance.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkT < 0) { this.blinkT = 0; this.nextBlink = 2 + this.rng() * 5; }
    if (this.blinkT >= 0) { this.blinkT += dt * 9; if (this.blinkT > 1) this.blinkT = -1; }
    const squint = this.blinkT >= 0 ? Math.sin(Math.min(1, this.blinkT) * Math.PI) * 0.82 : 0;
    if (this.eyeL) this.eyeL.scale.y = (this.shape.species === 'goblin' ? 1.15 : 0.95) * (1 - squint);
    if (this.eyeR) this.eyeR.scale.y = (this.shape.species === 'goblin' ? 1.15 : 0.95) * (1 - squint);

    // --- one-shot action layer ----------------------------------------------
    const target = pose === 'attack' || pose === 'shoot' || pose === 'cast' || pose === 'hurt' ? 1 : 0;
    this.actionBlend = THREE.MathUtils.damp(this.actionBlend, target, 12, dt);
    const phase = THREE.MathUtils.clamp(command.actionPhase, 0, 1);
    // A wind-up then a snap: fast out, slow back. Big recoil follow-through.
    const windup = phase < 0.38 ? -(phase / 0.38) : -1 + (phase - 0.38) / 0.62;
    const swingCurve = phase < 0.38
      ? -Math.sin((phase / 0.38) * Math.PI * 0.5) * 0.85
      : Math.sin(((phase - 0.38) / 0.62) * Math.PI * 0.5) * 1.55 * (1 - Math.pow(Math.max(0, (phase - 0.72) / 0.28), 2) * 0.35);
    // Torso twist feeds the shoulders: wind up back, snap through.
    const twist = phase < 0.38 ? windup * 0.5 : Math.sin(((phase - 0.38) / 0.62) * Math.PI) * 0.85;

    // --- arms -----------------------------------------------------------------
    for (const [shoulder, elbow, hand, side] of [
      [BONES.shoulderL, BONES.elbowL, BONES.handL, -1],
      [BONES.shoulderR, BONES.elbowR, BONES.handR, 1],
    ] as const) {
      // Counter-swing against the legs.
      const gait = -Math.sin(this.stride + (side > 0 ? Math.PI : 0)) * 0.62 * swing;
      let sx = gait + 0.10 + this.crouchBlend * 0.30;
      let sz = side * (0.12 + this.crouchBlend * 0.10);
      let ex = -0.35 - Math.abs(gait) * 0.35 - this.crouchBlend * 0.50;
      let sy = 0;

      if (side > 0 && this.actionBlend > 0.01) {
        if (pose === 'attack') {
          sx = THREE.MathUtils.lerp(sx, -1.75 + swingCurve * 1.75, this.actionBlend);
          ex = THREE.MathUtils.lerp(ex, -2.1 + swingCurve * 1.45, this.actionBlend);
          sz = THREE.MathUtils.lerp(sz, 0.75 + windup * 0.3, this.actionBlend);
          sy = THREE.MathUtils.lerp(sy, twist * 0.6, this.actionBlend);
        } else if (pose === 'shoot') {
          // Draw across the body, elbow high.
          sx = THREE.MathUtils.lerp(sx, -1.30, this.actionBlend);
          sy = THREE.MathUtils.lerp(0, -0.75 + phase * 0.30, this.actionBlend);
          ex = THREE.MathUtils.lerp(ex, -1.55 + phase * 0.85, this.actionBlend);
        } else if (pose === 'cast') {
          sx = THREE.MathUtils.lerp(sx, -2.0, this.actionBlend);
          ex = THREE.MathUtils.lerp(ex, -0.5 - Math.sin(this.t * 9) * 0.25, this.actionBlend);
        } else if (pose === 'hurt') {
          sx = THREE.MathUtils.lerp(sx, -0.6, this.actionBlend);
          ex = THREE.MathUtils.lerp(ex, -1.7, this.actionBlend);
        }
      }
      if (side < 0 && pose === 'shoot' && this.actionBlend > 0.01) {
        // Bow arm out straight.
        sx = THREE.MathUtils.lerp(sx, -1.45, this.actionBlend);
        sz = THREE.MathUtils.lerp(sz, -0.25, this.actionBlend);
        ex = THREE.MathUtils.lerp(ex, -0.12, this.actionBlend);
      }
      if (side < 0 && pose === 'attack' && this.actionBlend > 0.01) {
        // The off-side arm chops across the chest for balance.
        sx = THREE.MathUtils.lerp(sx, -0.9 + windup * 0.4, this.actionBlend);
        ex = THREE.MathUtils.lerp(ex, -1.55, this.actionBlend);
        sz = THREE.MathUtils.lerp(sz, -0.45, this.actionBlend);
      }
      if (dying) {
        sx = THREE.MathUtils.lerp(sx, 0.55, this.deathBlend);
        ex = THREE.MathUtils.lerp(ex, -0.25, this.deathBlend);
        sz = THREE.MathUtils.lerp(sz, side * 0.85, this.deathBlend);
      }

      this.bones[shoulder].rotation.set(sx, sy, sz);
      this.bones[elbow].rotation.x = ex;
      this.bones[hand].rotation.x = -0.15;
    }
    // The chest counter-rotates the twist so the swing has real mass.
    if ((pose === 'attack') && this.actionBlend > 0.01) {
      B[BONES.chest].rotation.y += twist * 0.5 * this.actionBlend;
      B[BONES.spine].rotation.y += twist * 0.22 * this.actionBlend;
    }

    // --- legs: two-bone IK against the terrain --------------------------------
    const worldY = this.root.position.y;
    for (const [hip, knee, foot, side, index] of [
      [BONES.hipL, BONES.kneeL, BONES.footL, -1, 0],
      [BONES.hipR, BONES.kneeR, BONES.footR, 1, 1],
    ] as const) {
      const legPhase = this.stride + (side > 0 ? Math.PI : 0);
      const lift = Math.max(0, Math.sin(legPhase)) * swing;
      const reach = Math.cos(legPhase) * 0.55 * swing;

      // Terrain under this foot, so uneven ground bends the right knee.
      const footLocalX = side * m.hipX;
      const world = this.root.localToWorld(new THREE.Vector3(footLocalX, 0, -reach * 0.4));
      const ground = terrainHeight(world.x, world.z);
      const groundDelta = THREE.MathUtils.clamp(ground - worldY, -0.35, 0.35);

      let hipX = reach + 0.06 + this.crouchBlend * 0.95 - groundDelta * 0.9;
      let kneeX = -Math.max(0, -reach) * 0.7 - lift * 0.95 - this.crouchBlend * 1.55 + groundDelta * 0.5;
      let footX = -hipX * 0.45 - kneeX * 0.55 + this.crouchBlend * 0.55;

      // A lunge step into the strike.
      if (pose === 'attack' && this.actionBlend > 0.01) {
        const lunge = Math.sin(Math.min(1, phase) * Math.PI) * this.actionBlend;
        hipX = THREE.MathUtils.lerp(hipX, hipX + (side > 0 ? -0.45 : 0.2), lunge * 0.8);
        kneeX = THREE.MathUtils.lerp(kneeX, kneeX - 0.25, lunge * 0.6);
      }
      if (dying) {
        // The legs fold up as the body goes over, rather than staying straight.
        hipX = THREE.MathUtils.lerp(hipX, 0.62, this.deathBlend);
        kneeX = THREE.MathUtils.lerp(kneeX, -1.15, this.deathBlend);
        footX = THREE.MathUtils.lerp(footX, 0.25, this.deathBlend);
      }

      this.bones[hip].rotation.x = hipX;
      this.bones[hip].rotation.z = side * (0.03 + this.crouchBlend * 0.13);
      this.bones[knee].rotation.x = Math.min(0, kneeX);
      this.bones[foot].rotation.x = footX;

      // Footfall event on the downstroke, for audio and dust.
      const planted = Math.sin(legPhase) < 0;
      if (planted && !this.footPlant[index] && swing > 0.25) {
        this.onFootfall?.(side, world.x, world.z, Math.min(1, swing));
      }
      this.footPlant[index] = planted ? 1 : 0;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.skeleton.dispose();
  }
}
