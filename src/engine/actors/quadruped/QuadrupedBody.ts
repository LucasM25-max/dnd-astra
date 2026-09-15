import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySkinWeights, axisBlendRule } from '../../../character/skeletal/Skinning';
import { LEG_IDS, QUAD_BONES, kneeFor, type QuadBoneName, type QuadRig } from './QuadrupedRig';

/**
 * Hand-built, skinned quadruped body: blended skinned meshes for the barrel
 * and neck (the only places weights need to blend) plus rigid meshes
 * parented straight to bones for skull, limbs, tail, mane and hooves.
 * Everything is authored in bind space and re-parented with inverse bone
 * matrices, so one builder serves both oxen and horses.
 */

export interface QuadMats {
  coat: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  hoof: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  horn: THREE.MeshStandardMaterial;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function capsuleBetween(a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number, seg = 9): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = Math.max(1e-4, dir.length());
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const parts: THREE.BufferGeometry[] = [];
  const cyl = new THREE.CylinderGeometry(r2, r1, len, seg, 1, false);
  cyl.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
  cyl.translate(mid.x, mid.y, mid.z);
  parts.push(cyl);
  const s1 = new THREE.SphereGeometry(r1, seg, Math.max(4, seg >> 1));
  s1.translate(a.x, a.y, a.z);
  const s2 = new THREE.SphereGeometry(r2, seg, Math.max(4, seg >> 1));
  s2.translate(b.x, b.y, b.z);
  parts.push(s1, s2);
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return merged ?? new THREE.BufferGeometry();
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Elliptical barrel: rings from the species sections, capped at both ends. */
function barrelGeometry(rig: QuadRig): THREE.BufferGeometry {
  const sections = rig.spec.sections;
  const SEG = 14;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];
  for (let s = 0; s < sections.length; s++) {
    const [z, hw, cy, hh] = sections[s];
    ringStart.push(positions.length / 3);
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      positions.push(Math.cos(a) * hw, cy + Math.sin(a) * hh, z);
      uvs.push((j / SEG) * 2.4, z * 1.4);
    }
  }
  for (let s = 0; s < sections.length - 1; s++) {
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      const a = ringStart[s] + j, b = ringStart[s] + j2, c = ringStart[s + 1] + j2, d = ringStart[s + 1] + j;
      indices.push(a, b, c, a, c, d);
    }
  }
  const front = sections[0], back = sections[sections.length - 1];
  const cf = positions.length / 3;
  positions.push(0, front[2], front[0] + front[1] * 0.55); uvs.push(0.5, 0.5);
  for (let j = 0; j < SEG; j++) indices.push(cf, ringStart[0] + ((j + 1) % SEG), ringStart[0] + j);
  const cb = positions.length / 3;
  positions.push(0, back[2], back[0] - back[1] * 0.55); uvs.push(0.5, 0.5);
  const lb = ringStart[sections.length - 1];
  for (let j = 0; j < SEG; j++) indices.push(cb, lb + j, lb + ((j + 1) % SEG));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export interface QuadBody {
  group: THREE.Group;
  skinned: THREE.SkinnedMesh[];
  bit: THREE.Object3D;
  nose: THREE.Object3D;
  dispose(): void;
}

export function buildQuadrupedBody(rig: QuadRig, mats: QuadMats): QuadBody {
  const spec = rig.spec;
  const bones = rig.bones;
  const idx = (n: QuadBoneName) => QUAD_BONES.indexOf(n);
  const group = new THREE.Group();
  group.name = `${rig.species}_body`;
  const rigid: { bone: QuadBoneName; mesh: THREE.Mesh }[] = [];
  const skinned: THREE.SkinnedMesh[] = [];
  const add = (bone: QuadBoneName, m: THREE.Mesh) => rigid.push({ bone, mesh: m });

  /* Barrel + neck: blended skins (Hips↔Chest and Chest↔Neck). */
  const hipsOrigin = rig.bindPos.Hips.clone();
  const neckBase = rig.bindPos.Neck.clone();
  const neckAxis = rig.bindPos.Head.clone().sub(neckBase).normalize();
  const barrel = barrelGeometry(rig);
  applySkinWeights(barrel, axisBlendRule(idx('Hips'), idx('Chest'), hipsOrigin, V(0, 0, 1), -0.34, 0.16));
  const neck = capsuleBetween(neckBase, rig.bindPos.Head, spec.neckR[0], spec.neckR[1]);
  applySkinWeights(neck, axisBlendRule(idx('Chest'), idx('Neck'), neckBase, neckAxis, -0.12, 0.14));
  for (const [geo, name] of [[barrel, 'barrel'], [neck, 'neck']] as const) {
    const m = new THREE.SkinnedMesh(geo, mats.coat);
    m.name = `${rig.species}_${name}`;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    skinned.push(m);
  }

  // Shoulder / chest mass blending the neck base into the barrel.
  const chest = capsuleBetween(V(0, spec.neckBase[1] - 0.16, spec.neckBase[2] - 0.16), V(0, spec.neckBase[1] + 0.02, spec.neckBase[2] - 0.02), rig.species === 'ox' ? 0.2 : 0.17, spec.neckR[0] * 0.95);
  applySkinWeights(chest, axisBlendRule(idx('Chest'), idx('Neck'), neckBase, neckAxis, -0.24, -0.02));
  const chestMesh = new THREE.SkinnedMesh(chest, mats.coat);
  chestMesh.name = `${rig.species}_chest`;
  chestMesh.castShadow = true; chestMesh.receiveShadow = true; chestMesh.frustumCulled = false;
  skinned.push(chestMesh);

  /* Head. */
  const skullR = rig.species === 'ox' ? 0.13 : 0.105;
  const skull = mesh(new THREE.SphereGeometry(skullR, 12, 10), mats.coat, 'skull');
  skull.scale.set(0.82, 1, 1.05);
  skull.position.set(0, spec.skull[1], spec.skull[2]);
  add('Head', skull);
  // Muzzle starts inside the skull so head + nose read as one tapered form.
  add('Head', mesh(
    capsuleBetween(V(0, spec.skull[1] - 0.06, spec.skull[2] + 0.04), V(0, spec.muzzleTip[1], spec.muzzleTip[2]),
      rig.species === 'ox' ? 0.095 : 0.075, rig.species === 'ox' ? 0.08 : 0.055),
    mats.dark, 'muzzle',
  ));
  for (const side of [1, -1]) {
    const ear = mesh(new THREE.ConeGeometry(rig.species === 'ox' ? 0.045 : 0.032, rig.species === 'ox' ? 0.1 : 0.12, 7), mats.coat, 'ear');
    ear.position.set(side * skullR * 0.7, spec.skull[1] + 0.06, spec.skull[2] - 0.05);
    ear.rotation.set(-0.45, 0, side * 0.5);
    add('Head', ear);
    const eye = mesh(new THREE.SphereGeometry(0.026, 8, 6), mats.eye, 'eye');
    eye.position.set(side * skullR * 0.74, spec.skull[1] + 0.02, spec.skull[2] + 0.03);
    add('Head', eye);
  }
  if (rig.species === 'ox') {
    for (const side of [1, -1]) {
      const horn = mesh(new THREE.ConeGeometry(0.035, 0.34, 8), mats.horn, 'horn');
      horn.position.set(side * 0.13, spec.skull[1] + 0.07, spec.skull[2] - 0.04);
      horn.rotation.set(-0.35, 0, side * 1.25);
      add('Head', horn);
    }
    const forelock = mesh(new THREE.SphereGeometry(0.075, 8, 6), mats.hair, 'forelock');
    forelock.position.set(0, spec.skull[1] + 0.09, spec.skull[2] + 0.02);
    forelock.scale.set(1, 0.7, 0.8);
    add('Head', forelock);
  } else {
    const forelock = mesh(new THREE.ConeGeometry(0.045, 0.15, 7), mats.hair, 'forelock');
    forelock.position.set(0, spec.skull[1] + 0.05, spec.skull[2] + 0.07);
    forelock.rotation.x = 2.4;
    add('Head', forelock);
    const mane = mesh(
      capsuleBetween(V(0, spec.neckBase[1] + 0.1, spec.neckBase[2] - 0.08), V(0, spec.neckTop[1] + 0.09, spec.neckTop[2] + 0.04), 0.06, 0.04),
      mats.hair, 'mane',
    );
    mane.scale.set(0.55, 1, 1);
    add('Neck', mane);
  }

  /* Tail. */
  add('Tail1', mesh(capsuleBetween(V(...spec.tailBase), V(...spec.tailMid), 0.05, 0.04), rig.species === 'horse' ? mats.hair : mats.coat, 'tail1'));
  add('Tail2', mesh(capsuleBetween(V(...spec.tailMid), V(...spec.tailTip), 0.04, rig.species === 'horse' ? 0.055 : 0.06), mats.hair, 'tail2'));

  /* Legs. */
  for (const leg of LEG_IDS) {
    const L = spec.legs[leg];
    const hip = V(L.x, L.hipY, L.z);
    const knee = kneeFor(spec, leg);
    const ankle = V(L.x, 0.09, L.z + L.ankleZ);
    const upperR = spec.legRadius[0] * (leg[0] === 'R' ? 1.4 : 1.12);
    add(`UpperLeg${leg}` as QuadBoneName, mesh(capsuleBetween(hip, knee, upperR, spec.legRadius[1] * 1.15), mats.coat, `thigh_${leg}`));
    add(`LowerLeg${leg}` as QuadBoneName, mesh(capsuleBetween(knee, ankle, spec.legRadius[1], spec.legRadius[2]), mats.dark, `shin_${leg}`));
    const hoof = mesh(new THREE.CylinderGeometry(spec.legRadius[2] * 1.05, spec.legRadius[2] * 1.28, 0.1, 9), mats.hoof, `hoof_${leg}`);
    hoof.position.set(ankle.x, ankle.y - 0.045, ankle.z + 0.02);
    hoof.rotation.x = 0.12;
    add(`Foot${leg}` as QuadBoneName, hoof);
  }

  /* Halter straps; bit + nose anchors for reins and lead ropes. */
  const bit = new THREE.Object3D();
  bit.name = 'bit';
  bit.position.set(0, spec.muzzle[1] - 0.01, spec.muzzle[2] - 0.02);
  const nose = new THREE.Object3D();
  nose.name = 'nose';
  nose.position.set(0, spec.muzzleTip[1], spec.muzzleTip[2]);
  if (rig.species === 'horse') {
    const crown = mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 14), mats.dark, 'halter_crown');
    crown.position.set(0, spec.skull[1] - 0.02, spec.skull[2] - 0.08);
    crown.rotation.y = Math.PI / 2;
    add('Head', crown);
    const noseband = mesh(new THREE.TorusGeometry(0.062, 0.012, 6, 14), mats.dark, 'halter_nose');
    noseband.position.set(0, spec.muzzle[1] - 0.01, spec.muzzle[2] + 0.03);
    noseband.rotation.y = Math.PI / 2;
    add('Head', noseband);
  }

  /* Parent rigid meshes to bones via inverse bind matrices. */
  rig.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4();
  for (const { bone, mesh: part } of rigid) {
    part.updateMatrix();
    inv.copy(bones[bone].matrixWorld).invert();
    part.applyMatrix4(inv);
    bones[bone].add(part);
  }
  bones.Head.add(bit, nose);
  for (const m of skinned) group.add(m);
  return {
    group,
    skinned,
    bit,
    nose,
    dispose() {
      for (const m of skinned) m.geometry.dispose();
      for (const { mesh: part } of rigid) part.geometry.dispose();
    },
  };
}
