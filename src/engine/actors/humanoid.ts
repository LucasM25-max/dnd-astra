import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom, terrainHeight } from '../landscape';
import { smoothNormals } from './geometry';
import type { CombatMaterials } from './combat-materials';

/**
 * Skinned bipedal creatures (goblins, and the larger goblinoids that use the
 * same skeleton). The body is lofted from elliptical cross-sections so the
 * silhouette is continuous rather than a stack of boxes, then bound to a
 * fifteen-bone rig with procedural locomotion, per-foot terrain contact, and
 * layered idle life.
 *
 * Faces -Z, up is +Y, metres.
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
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const a = i * sides + j, b = i * sides + j2, c = (i + 1) * sides + j, d = (i + 1) * sides + j2;
      indices.push(a, c, b, b, c, d);
    }
  }
  if (capBottom) {
    const centre = positions.length / 3;
    positions.push(0, sections[0].y, sections[0].z); uvs.push(.5, 0);
    for (let j = 0; j < sides; j++) indices.push(centre, (j + 1) % sides, j);
  }
  if (capTop) {
    const last = sections.length - 1, centre = positions.length / 3;
    positions.push(0, sections[last].y, sections[last].z); uvs.push(.5, 1);
    for (let j = 0; j < sides; j++) indices.push(centre, last * sides + j, last * sides + (j + 1) % sides);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

interface Piece { geometry: THREE.BufferGeometry; bone: number; secondary?: number; blend?: (v: THREE.Vector3) => number }

export interface HumanoidShape {
  height: number;
  /** Fraction of height: hip, chest, shoulder, head base. */
  build: 'lean' | 'stocky';
  earLength: number;
  noseLength: number;
}

function buildGeometry(shape: HumanoidShape, detail: number) {
  const h = shape.height;
  const sides = Math.max(7, Math.round(11 * detail));
  const stocky = shape.build === 'stocky';
  const w = h * (stocky ? 0.16 : 0.135);       // torso half width
  const d = h * (stocky ? 0.11 : 0.095);       // torso half depth

  const hipY = h * 0.46, chestY = h * 0.70, shoulderY = h * 0.78, neckY = h * 0.82, headY = h * 0.88;
  const pieces: Piece[] = [];

  // --- torso: hips -> chest -> shoulders, with a real waist ----------------
  const torso = loft([
    { y: hipY - h * 0.06, z: 0, halfWidth: w * 0.86, halfDepth: d * 0.88 },
    { y: hipY, z: 0, halfWidth: w * 0.95, halfDepth: d * 0.95 },
    { y: hipY + (chestY - hipY) * 0.35, z: -h * 0.006, halfWidth: w * 0.80, halfDepth: d * 0.80 },
    { y: hipY + (chestY - hipY) * 0.70, z: -h * 0.004, halfWidth: w * 0.93, halfDepth: d * 0.92 },
    { y: chestY, z: 0, halfWidth: w, halfDepth: d },
    { y: shoulderY, z: 0, halfWidth: w * 0.94, halfDepth: d * 0.86 },
    { y: neckY, z: 0, halfWidth: w * 0.50, halfDepth: d * 0.55 },
  ], sides, true, true);
  pieces.push({
    geometry: torso, bone: BONES.spine, secondary: BONES.pelvis,
    blend: v => THREE.MathUtils.clamp((v.y - hipY) / Math.max(0.001, chestY - hipY), 0, 1),
  });

  // --- neck and head -------------------------------------------------------
  const neck = loft([
    { y: neckY - h * 0.02, z: 0, halfWidth: w * 0.34, halfDepth: d * 0.40 },
    { y: headY - h * 0.03, z: -h * 0.004, halfWidth: w * 0.30, halfDepth: d * 0.36 },
  ], sides, false, false);
  pieces.push({ geometry: neck, bone: BONES.neck, secondary: BONES.chest, blend: v => THREE.MathUtils.clamp((v.y - neckY) / (h * 0.04), 0, 1) });

  // A goblin skull: wide at the jaw hinge, tapering to a long snout.
  const skull = loft([
    { y: headY - h * 0.035, z: 0, halfWidth: w * 0.38, halfDepth: d * 0.44 },
    { y: headY, z: -h * 0.005, halfWidth: w * 0.56, halfDepth: d * 0.64 },
    { y: headY + h * 0.032, z: -h * 0.010, halfWidth: w * 0.60, halfDepth: d * 0.66 },
    { y: headY + h * 0.058, z: -h * 0.004, halfWidth: w * 0.48, halfDepth: d * 0.54 },
    { y: headY + h * 0.074, z: h * 0.006, halfWidth: w * 0.26, halfDepth: d * 0.30 },
  ], sides, true, false);
  pieces.push({ geometry: skull, bone: BONES.head });

  // Snout / muzzle, pushed forward from the face.
  const snout = loft([
    { y: headY + h * 0.014, z: -d * 0.55, halfWidth: w * 0.26, halfDepth: d * 0.18 },
    { y: headY + h * 0.006, z: -d * 0.55 - shape.noseLength * 0.55, halfWidth: w * 0.17, halfDepth: d * 0.13 },
    { y: headY - h * 0.004, z: -d * 0.55 - shape.noseLength, halfWidth: w * 0.08, halfDepth: d * 0.07 },
  ], Math.max(6, sides - 3), true, false);
  pieces.push({ geometry: snout, bone: BONES.head });

  // Long swept-back ears — the goblin read at a glance.
  for (const side of [-1, 1]) {
    const ear = new THREE.BufferGeometry();
    const tipY = headY + h * 0.075, tipX = side * (w * 0.55 + shape.earLength);
    const verts = new Float32Array([
      side * w * 0.50, headY + h * 0.030, -d * 0.10,
      side * w * 0.48, headY - h * 0.005, d * 0.06,
      tipX, tipY, d * 0.22,
      side * w * 0.52, headY + h * 0.014, d * 0.02,
    ]);
    ear.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    ear.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, .5, .5], 2));
    ear.setIndex(side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    ear.computeVertexNormals();
    pieces.push({ geometry: ear, bone: BONES.head });
  }

  // --- limbs ---------------------------------------------------------------
  const armSides = Math.max(6, sides - 3);
  const upperArm = h * 0.155, foreArm = h * 0.145;
  for (const side of [-1, 1]) {
    const shoulder = side < 0 ? BONES.shoulderL : BONES.shoulderR;
    const elbow = side < 0 ? BONES.elbowL : BONES.elbowR;
    const hand = side < 0 ? BONES.handL : BONES.handR;
    const sx = side * w * 0.92;

    const upper = loft([
      { y: shoulderY, z: 0, halfWidth: w * 0.26, halfDepth: w * 0.26 },
      { y: shoulderY - upperArm * 0.5, z: 0, halfWidth: w * 0.21, halfDepth: w * 0.21 },
      { y: shoulderY - upperArm, z: 0, halfWidth: w * 0.18, halfDepth: w * 0.18 },
    ], armSides, false, true).translate(sx, 0, 0);
    pieces.push({ geometry: upper, bone: shoulder });

    const lower = loft([
      { y: shoulderY - upperArm, z: 0, halfWidth: w * 0.18, halfDepth: w * 0.18 },
      { y: shoulderY - upperArm - foreArm * 0.6, z: 0, halfWidth: w * 0.15, halfDepth: w * 0.15 },
      { y: shoulderY - upperArm - foreArm, z: 0, halfWidth: w * 0.13, halfDepth: w * 0.13 },
    ], armSides, false, false).translate(sx, 0, 0);
    pieces.push({ geometry: lower, bone: elbow });

    // A blunt three-finger fist rather than a sphere.
    const fist = loft([
      { y: shoulderY - upperArm - foreArm, z: 0, halfWidth: w * 0.15, halfDepth: w * 0.14 },
      { y: shoulderY - upperArm - foreArm - h * 0.030, z: -w * 0.05, halfWidth: w * 0.17, halfDepth: w * 0.17 },
      { y: shoulderY - upperArm - foreArm - h * 0.055, z: -w * 0.07, halfWidth: w * 0.10, halfDepth: w * 0.12 },
    ], armSides, true, false).translate(sx, 0, 0);
    pieces.push({ geometry: fist, bone: hand });
  }

  const thigh = h * 0.215, shin = h * 0.195;
  for (const side of [-1, 1]) {
    const hip = side < 0 ? BONES.hipL : BONES.hipR;
    const knee = side < 0 ? BONES.kneeL : BONES.kneeR;
    const foot = side < 0 ? BONES.footL : BONES.footR;
    const sx = side * w * 0.46;

    const upperLeg = loft([
      { y: hipY - h * 0.02, z: 0, halfWidth: w * 0.34, halfDepth: w * 0.34 },
      { y: hipY - h * 0.02 - thigh * 0.5, z: 0, halfWidth: w * 0.27, halfDepth: w * 0.28 },
      { y: hipY - h * 0.02 - thigh, z: 0, halfWidth: w * 0.21, halfDepth: w * 0.22 },
    ], armSides, false, true).translate(sx, 0, 0);
    pieces.push({ geometry: upperLeg, bone: hip });

    // A digitigrade calf: heavy at the top, thin at the ankle.
    const lowerLeg = loft([
      { y: hipY - h * 0.02 - thigh, z: 0, halfWidth: w * 0.22, halfDepth: w * 0.24 },
      { y: hipY - h * 0.02 - thigh - shin * 0.4, z: -w * 0.02, halfWidth: w * 0.18, halfDepth: w * 0.20 },
      { y: hipY - h * 0.02 - thigh - shin, z: 0, halfWidth: w * 0.11, halfDepth: w * 0.12 },
    ], armSides, false, false).translate(sx, 0, 0);
    pieces.push({ geometry: lowerLeg, bone: knee });

    const footY = hipY - h * 0.02 - thigh - shin;
    const footGeo = loft([
      { y: footY, z: 0, halfWidth: w * 0.12, halfDepth: w * 0.14 },
      { y: footY - h * 0.030, z: -w * 0.14, halfWidth: w * 0.15, halfDepth: w * 0.32 },
      { y: footY - h * 0.048, z: -w * 0.18, halfWidth: w * 0.14, halfDepth: w * 0.36 },
    ], armSides, true, false).translate(sx, 0, 0);
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
  return { geometry: merged, metrics: { hipY, chestY, shoulderY, neckY, headY, thigh, shin, upperArm, foreArm, w, d } };
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
}

export class Humanoid {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  readonly shape: HumanoidShape;
  readonly weapon = new THREE.Group();
  /** Public so the encounter renderer can hang health bars at the right place. */
  readonly headHeight: number;

  private metrics: ReturnType<typeof buildGeometry>['metrics'];
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
  onFootfall?: (side: number, x: number, z: number, strength: number) => void;

  constructor(shape: HumanoidShape, materials: CombatMaterials, skinTint: string, clothTint: string, seed = 0, detail = 1) {
    this.shape = shape;
    this.rng = seededRandom(4200 + seed * 733);
    this.t = this.rng() * 8;
    this.breath = this.rng() * Math.PI * 2;
    this.nextBlink = 1 + this.rng() * 4;
    this.headHeight = shape.height * 0.96;

    const { geometry, metrics } = buildGeometry(shape, detail);
    this.metrics = metrics;

    const material = materials.creatureSkin.clone();
    material.color = new THREE.Color(skinTint);
    material.vertexColors = true;

    // --- skeleton ----------------------------------------------------------
    const bones: THREE.Bone[] = [];
    for (let i = 0; i < BONE_COUNT; i++) bones.push(new THREE.Bone());
    const B = BONES;
    bones[B.root].name = 'root';
    bones[B.pelvis].name = 'pelvis'; bones[B.pelvis].position.set(0, 0, 0);
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

    this.addClothing(materials, clothTint);
    this.addEyes(materials);

    // The weapon rides in the right hand; the encounter fills it in.
    bones[B.handR].add(this.weapon);
  }

  /** Loincloth, wraps and a shoulder strap, cut from the cloth material. */
  private addClothing(materials: CombatMaterials, tint: string) {
    const h = this.shape.height, m = this.metrics;
    const cloth = materials.creatureCloth.clone();
    cloth.color = new THREE.Color(tint);
    const group = new THREE.Group();

    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(m.w * 1.02, m.w * 1.26, h * 0.17, 12, 2, true), cloth);
    skirt.position.y = m.hipY - h * 0.055;
    skirt.castShadow = true;
    group.add(skirt);

    const belt = new THREE.Mesh(new THREE.TorusGeometry(m.w * 1.0, h * 0.014, 6, 16), materials.leather);
    belt.rotation.x = Math.PI / 2; belt.position.y = m.hipY + h * 0.012;
    group.add(belt);

    // A single strap across the chest reads instantly as "armed and equipped".
    const strap = new THREE.Mesh(new THREE.BoxGeometry(h * 0.030, h * 0.30, h * 0.012), materials.leather);
    strap.position.set(-m.w * 0.16, m.chestY - h * 0.01, -m.d * 0.86);
    strap.rotation.z = 0.46;
    group.add(strap);

    this.bones[BONES.pelvis].add(skirt);
    this.bones[BONES.pelvis].add(belt);
    this.bones[BONES.chest].add(strap);
    // Nothing else is parented to `group`; it exists only to build the parts.
    group.clear();
  }

  private addEyes(materials: CombatMaterials) {
    const h = this.shape.height, m = this.metrics;
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(h * 0.0165, 10, 8), materials.eye);
      eye.position.set(side * m.w * 0.26, m.headY + h * 0.026, -m.d * 0.52);
      this.bones[BONES.head].add(eye);
    }
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
    this.moving = THREE.MathUtils.damp(this.moving, Math.min(1, speed / 2.2), 8, dt);
    this.crouchBlend = THREE.MathUtils.damp(this.crouchBlend, command.crouch, 6, dt);
    const dying = pose === 'down' || pose === 'dead';
    this.deathBlend = THREE.MathUtils.damp(this.deathBlend, dying ? 1 : 0, dying ? 5 : 9, dt);

    // Stride frequency scales with speed so footfalls land where the feet are.
    const cadence = 1.6 + speed * 1.35;
    if (speed > 0.05) this.stride += dt * cadence * Math.PI * 2 * (command.speed < 0 ? -1 : 1);
    const swing = this.moving;

    // --- root: breathing, bob, crouch, collapse ------------------------------
    this.breath += dt * (1.1 + this.moving * 1.4);
    const breathe = Math.sin(this.breath) * h * 0.006 * (1 - this.moving * 0.5);
    const bob = Math.abs(Math.sin(this.stride)) * h * 0.022 * swing;
    const crouchDrop = this.crouchBlend * h * 0.16;

    B[BONES.root].position.y = breathe + bob - crouchDrop - this.deathBlend * h * 0.40;
    B[BONES.root].rotation.z = Math.sin(this.stride) * 0.035 * swing + this.deathBlend * 1.35;
    B[BONES.root].rotation.x = this.deathBlend * 0.28;

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

    // --- one-shot action layer ----------------------------------------------
    const target = pose === 'attack' || pose === 'shoot' || pose === 'cast' || pose === 'hurt' ? 1 : 0;
    this.actionBlend = THREE.MathUtils.damp(this.actionBlend, target, 12, dt);
    const phase = THREE.MathUtils.clamp(command.actionPhase, 0, 1);
    // A wind-up then a snap: fast out, slow back.
    const swingCurve = phase < 0.35 ? -Math.sin(phase / 0.35 * Math.PI * 0.5) * 0.8 : Math.sin((phase - 0.35) / 0.65 * Math.PI) * 1.5;

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
          sx = THREE.MathUtils.lerp(sx, -1.5 + swingCurve * 1.5, this.actionBlend);
          ex = THREE.MathUtils.lerp(ex, -1.9 + swingCurve * 1.3, this.actionBlend);
          sz = THREE.MathUtils.lerp(sz, 0.55, this.actionBlend);
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
      if (dying) {
        sx = THREE.MathUtils.lerp(sx, 0.55, this.deathBlend);
        ex = THREE.MathUtils.lerp(ex, -0.25, this.deathBlend);
        sz = THREE.MathUtils.lerp(sz, side * 0.85, this.deathBlend);
      }

      this.bones[shoulder].rotation.set(sx, sy, sz);
      this.bones[elbow].rotation.x = ex;
      this.bones[hand].rotation.x = -0.15;
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
      const footLocalX = side * m.w * 0.46;
      const world = this.root.localToWorld(new THREE.Vector3(footLocalX, 0, -reach * 0.4));
      const ground = terrainHeight(world.x, world.z);
      const groundDelta = THREE.MathUtils.clamp(ground - worldY, -0.35, 0.35);

      let hipX = reach + 0.06 + this.crouchBlend * 0.95 - groundDelta * 0.9;
      let kneeX = -Math.max(0, -reach) * 0.7 - lift * 0.95 - this.crouchBlend * 1.55 + groundDelta * 0.5;
      let footX = -hipX * 0.45 - kneeX * 0.55 + this.crouchBlend * 0.55;

      if (dying) {
        hipX = THREE.MathUtils.lerp(hipX, -0.95, this.deathBlend);
        kneeX = THREE.MathUtils.lerp(kneeX, -1.25, this.deathBlend);
        footX = THREE.MathUtils.lerp(footX, 0.4, this.deathBlend);
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
