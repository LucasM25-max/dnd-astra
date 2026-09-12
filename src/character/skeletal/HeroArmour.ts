import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BoneName } from './HeroRig';

/**
 * Separate armour meshes for the skeletal hero. Each builder returns a mesh
 * (or group) authored in rig bind space plus the bone it rides on — the
 * assembler parents it with `bone.attach()` so bind alignment is preserved.
 * Armour is rigid (real plate doesn't bend); only the body underneath is
 * skinned. Every piece carries its own PBR-canvas material.
 */

export interface ArmourPiece {
  object: THREE.Object3D;
  bone: BoneName;
}

export interface ArmourMats {
  mail: THREE.Material;
  plate: THREE.Material;
  leather: THREE.Material;
  brass: THREE.Material;
  hair: THREE.Material;
}

/**
 * Nasal helm: dome, brow band, nose guard. Sits high enough that the eyes
 * (painted at ~1.70) clear the brim; the nasal floats just off the face.
 */
export function buildHelmet(mats: ArmourMats): ArmourPiece {
  const group = new THREE.Group();
  group.name = 'helm';
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.117, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), mats.plate);
  dome.scale.set(0.96, 1.02, 1.03);
  dome.position.set(0, 1.722, 0.006);
  group.add(dome);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.118, 0.032, 24, 1, true), mats.plate);
  band.scale.set(0.96, 1, 1.03);
  band.position.set(0, 1.716, 0.006);
  group.add(band);
  // Brow ridge + nasal guard.
  const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.008, 8, 24, Math.PI * 0.7), mats.brass);
  ridge.position.set(0, 1.706, 0.012);
  ridge.rotation.z = Math.PI * 0.15;
  ridge.scale.set(0.96, 1, 1.03);
  group.add(ridge);
  const nasal = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.075, 0.012), mats.plate);
  nasal.position.set(0, 1.682, 0.112);
  nasal.rotation.x = 0.06;
  group.add(nasal);
  // Dome rivets.
  const rivetGeo = new THREE.SphereGeometry(0.007, 8, 6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rivet = new THREE.Mesh(rivetGeo, mats.brass);
    rivet.position.set(Math.cos(a) * 0.112, 1.732, 0.006 + Math.sin(a) * 0.115);
    group.add(rivet);
  }
  return { object: group, bone: 'Head' };
}

/** Mail coif drape under the helm, flaring onto the shoulders. */
export function buildCoif(mats: ArmourMats): ArmourPiece {
  const profile: [number, number][] = [
    [0.098, 1.62],
    [0.112, 1.56],
    [0.14, 1.5],
    [0.175, 1.45],
    [0.2, 1.4],
    [0.205, 1.375],
  ];
  const geo = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 20);
  geo.scale(1, 1, 0.94);
  const mesh = new THREE.Mesh(geo, mats.mail);
  mesh.name = 'coif';
  return { object: mesh, bone: 'Chest' };
}

/** Riveted mail shirt: torso shell, skirt flare, collar, short sleeves. */
export function buildMailShirt(mats: ArmourMats): ArmourPiece[] {
  const pieces: ArmourPiece[] = [];
  const profile: [number, number][] = [
    [0.165, 0.9],
    [0.168, 0.96],
    [0.162, 1.0],
    [0.15, 1.1],
    [0.154, 1.18],
    [0.166, 1.28],
    [0.177, 1.37],
    [0.166, 1.44],
    [0.12, 1.495],
    [0.078, 1.515],
  ];
  const shellGeo = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 22);
  shellGeo.scale(1.26, 1, 0.86);
  const shell = new THREE.Mesh(shellGeo, mats.mail);
  shell.name = 'mail_shirt';
  pieces.push({ object: shell, bone: 'Chest' });
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 10, 20), mats.mail);
  collar.position.set(0, 1.52, 0.004);
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(1.15, 0.95, 1);
  pieces.push({ object: collar, bone: 'Chest' });
  // Sleeves over the deltoids, riding the upper arms.
  for (const side of [-1, 1] as const) {
    const sx = side * 0.25;
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.088, 0.17, 14, 1, true), mats.mail);
    sleeve.position.set(sx + side * 0.028, 1.365, 0.002);
    sleeve.rotation.z = side * -0.18;
    sleeve.name = side < 0 ? 'mail_sleeve_R' : 'mail_sleeve_L';
    pieces.push({ object: sleeve, bone: side < 0 ? 'UpperArmR' : 'UpperArmL' });
  }
  return pieces;
}

/** Layered pauldron: main dome + two lames + brass trim. */
export function buildPauldron(mats: ArmourMats, side: -1 | 1): ArmourPiece {
  const group = new THREE.Group();
  group.name = side < 0 ? 'pauldron_R' : 'pauldron_L';
  const cx = side * 0.262;
  const main = new THREE.Mesh(new THREE.SphereGeometry(0.098, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.plate);
  main.position.set(cx, 1.474, 0);
  main.scale.set(1, 0.9, 1);
  group.add(main);
  for (let i = 0; i < 2; i++) {
    const lame = new THREE.Mesh(new THREE.CylinderGeometry(0.098 - i * 0.004, 0.102 - i * 0.004, 0.035, 18, 1, true), mats.plate);
    lame.position.set(cx + side * (0.008 + i * 0.012), 1.452 - i * 0.034, 0);
    lame.rotation.z = side * -0.16;
    group.add(lame);
  }
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.096, 0.006, 8, 24, Math.PI), mats.brass);
  trim.position.set(cx, 1.472, 0);
  trim.rotation.y = Math.PI / 2;
  trim.rotation.z = 0;
  group.add(trim);
  return { object: group, bone: side < 0 ? 'UpperArmR' : 'UpperArmL' };
}

/** Gauntlet: flared cuff + metacarpal plate + knuckle ridge. */
export function buildGauntlet(mats: ArmourMats, side: -1 | 1): ArmourPiece {
  const group = new THREE.Group();
  group.name = side < 0 ? 'gauntlet_R' : 'gauntlet_L';
  const hx = side * 0.33;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.066, 0.1, 14, 1, true), mats.leather);
  cuff.position.set(hx - side * 0.008, 0.945, 0.018);
  cuff.rotation.z = side * 0.1;
  group.add(cuff);
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.075, 0.062, 2, 0.008), mats.plate);
  plate.position.set(hx + side * 0.033, 0.845, 0.028);
  group.add(plate);
  for (let k = 0; k < 3; k++) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.008, 0.06), mats.plate);
    ridge.position.set(hx + side * 0.033, 0.868 - k * 0.02, 0.028);
    group.add(ridge);
  }
  return { object: group, bone: side < 0 ? 'HandR' : 'HandL' };
}

/** Sword belt: ring, brass buckle, strap end. */
export function buildBelt(mats: ArmourMats): ArmourPiece {
  const group = new THREE.Group();
  group.name = 'belt';
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.155, 0.075, 22, 1, true), mats.leather);
  ring.scale.set(1.28, 1, 0.9);
  ring.position.set(0, 1.062, 0);
  group.add(ring);
  const buckle = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.055, 0.02, 2, 0.006), mats.brass);
  buckle.position.set(0, 1.062, 0.142);
  group.add(buckle);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.11, 0.008), mats.leather);
  strap.position.set(0.045, 1.0, 0.138);
  strap.rotation.x = 0.08;
  strap.rotation.z = -0.06;
  group.add(strap);
  return { object: group, bone: 'Spine' };
}

/** Greave: front shell + knee cop + ankle wings. */
export function buildGreave(mats: ArmourMats, side: -1 | 1): ArmourPiece {
  const group = new THREE.Group();
  group.name = side < 0 ? 'greave_R' : 'greave_L';
  const kx = side * 0.12;
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.076, 0.057, 0.36, 14, 1, true, -Math.PI / 2, Math.PI),
    mats.plate,
  );
  shell.position.set(kx, 0.31, 0.012);
  group.add(shell);
  const cop = new THREE.Mesh(new THREE.SphereGeometry(0.072, 14, 10), mats.plate);
  cop.scale.set(1, 0.9, 0.75);
  cop.position.set(kx, 0.5, 0.035);
  group.add(cop);
  for (const wing of [-1, 1]) {
    const lame = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.063, 0.05, 10, 1, true, -Math.PI / 2, Math.PI), mats.plate);
    lame.position.set(kx + wing * 0.004, 0.145, 0.01);
    group.add(lame);
  }
  return { object: group, bone: side < 0 ? 'LowerLegR' : 'LowerLegL' };
}

/** Marching boot: foot shell, toe cap, heel, cuff. */
export function buildBoot(mats: ArmourMats, side: -1 | 1): ArmourPiece {
  const group = new THREE.Group();
  group.name = side < 0 ? 'boot_R' : 'boot_L';
  const fx = side * 0.12;
  const shell = new THREE.Mesh(new RoundedBoxGeometry(0.104, 0.09, 0.21, 3, 0.035), mats.leather);
  shell.position.set(fx, 0.058, 0.115);
  group.add(shell);
  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), mats.leather);
  toe.scale.set(1, 0.66, 1.1);
  toe.position.set(fx, 0.045, 0.215);
  group.add(toe);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.06, 0.12, 14, 1, true), mats.leather);
  cuff.position.set(fx, 0.14, 0.045);
  group.add(cuff);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.008, 8, 18), mats.brass);
  strap.position.set(fx, 0.185, 0.045);
  strap.rotation.x = Math.PI / 2;
  group.add(strap);
  return { object: group, bone: side < 0 ? 'FootR' : 'FootL' };
}

export type HairStyle = 'short' | 'long' | 'braid' | 'bald';

/** Hair cap (+ drape / braid). Hidden when the helm is on. */
export function buildHair(mats: ArmourMats, style: Exclude<HairStyle, 'bald'>): ArmourPiece {
  const group = new THREE.Group();
  group.name = `hair_${style}`;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.112, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.56),
    mats.hair,
  );
  cap.scale.set(0.95, 1.1, 1.0);
  cap.position.set(0, 1.694, 0.002);
  cap.rotation.x = -0.2;
  group.add(cap);
  // Sideburns ground the cap rim at the temples (all styles).
  for (const s of [-1, 1]) {
    const burn = new THREE.Mesh(new RoundedBoxGeometry(0.028, 0.09, 0.045, 2, 0.012), mats.hair);
    burn.position.set(s * 0.093, 1.655, 0.012);
    group.add(burn);
  }
  if (style === 'long' || style === 'braid') {
    const drape = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.24, 0.05, 2, 0.02), mats.hair);
    drape.position.set(0, 1.52, -0.095);
    drape.rotation.x = 0.1;
    group.add(drape);
    // Face-framing locks.
    for (const s of [-1, 1]) {
      const lock = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.22, 0.055, 2, 0.02), mats.hair);
      lock.position.set(s * 0.092, 1.585, 0.015);
      lock.rotation.z = s * -0.06;
      group.add(lock);
    }
  }
  if (style === 'braid') {
    for (let i = 0; i < 5; i++) {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.026 - i * 0.002, 10, 8), mats.hair);
      knot.scale.set(1.15, 0.85, 0.9);
      knot.position.set((i % 2 ? 1 : -1) * 0.008, 1.44 - i * 0.04, -0.128 - i * 0.004);
      group.add(knot);
    }
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.006, 8, 12), mats.leather);
    tie.position.set(0, 1.26, -0.144);
    group.add(tie);
  }
  return { object: group, bone: 'Head' };
}
