import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Separate weapon meshes for the skeletal hero, one builder per weapon id in
 * `weapons.json`. Each is authored in socket-local space: the grip centred on
 * the origin along Y, the blade/edge pointing +Y (up) with the cutting edge
 * toward +Z — matching the fist (knuckles forward) and the carrier's facing.
 * Sockets supply the final offset/rotation per item (see SkeletalHero).
 */

export type WeaponId = 'longsword' | 'battleaxe' | 'warhammer' | 'shortsword' | 'longbow' | 'quiver' | 'shield';

export interface WeaponMats {
  blade: THREE.Material;
  steelDark: THREE.Material;
  wood: THREE.Material;
  bowWood: THREE.Material;
  leather: THREE.Material;
  brass: THREE.Material;
  iron: THREE.Material;
  string: THREE.Material;
  fletch: THREE.Material;
  shieldFace: THREE.Material;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function buildLongsword(m: WeaponMats, scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.name = 'longsword';
  const guardY = 0.055 * scale;
  const bladeLen = 0.8 * scale;
  const blade = mesh(new THREE.BoxGeometry(0.058 * scale, bladeLen, 0.016 * scale), m.blade, 0, guardY + bladeLen / 2, 0);
  g.add(blade);
  const tip = mesh(new THREE.ConeGeometry(0.041 * scale, 0.12 * scale, 4), m.blade, 0, guardY + bladeLen + 0.06 * scale, 0);
  tip.rotation.y = Math.PI / 4;
  tip.scale.z = 0.28;
  g.add(tip);
  const guard = mesh(new RoundedBoxGeometry(0.17 * scale, 0.024 * scale, 0.032 * scale, 2, 0.008 * scale), m.steelDark, 0, guardY, 0);
  g.add(guard);
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(0.014 * scale, 10, 8), m.brass, s * 0.085 * scale, guardY, 0));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.015 * scale, 0.017 * scale, 0.11 * scale, 10), m.leather, 0, -0.005 * scale, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.027 * scale, 0.027 * scale, 0.022 * scale, 14), m.brass, 0, -0.068 * scale, 0));
  g.add(mesh(new THREE.SphereGeometry(0.01 * scale, 8, 6), m.brass, 0, -0.082 * scale, 0));
  return g;
}

function buildBattleaxe(m: WeaponMats): THREE.Group {
  const g = new THREE.Group();
  g.name = 'battleaxe';
  g.add(mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.78, 10), m.wood, 0, 0.44, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.09, 10), m.leather, 0, 0.0, 0));
  g.add(mesh(new THREE.SphereGeometry(0.02, 10, 8), m.iron, 0, -0.05, 0));
  // Bearded head in the Y-Z plane (edge forward +Z): crescent + back spike.
  const head = new THREE.Group();
  head.position.set(0, 0.8, 0);
  const crescent = new THREE.Shape();
  crescent.absarc(0.1, 0, 0.17, -Math.PI * 0.32, Math.PI * 0.32, false);
  crescent.absarc(0.1, 0, 0.125, Math.PI * 0.3, -Math.PI * 0.3, true);
  const bladeGeo = new THREE.ExtrudeGeometry(crescent, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 20 });
  bladeGeo.translate(0, 0, -0.012);
  const blade = new THREE.Mesh(bladeGeo, m.blade);
  blade.rotation.y = Math.PI / 2; // shape-X (out from haft) → +Z (forward edge)
  head.add(blade);
  const eye = mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 10), m.iron, 0, 0, 0);
  eye.rotation.x = Math.PI / 2;
  head.add(eye);
  const spike = mesh(new THREE.ConeGeometry(0.02, 0.13, 10), m.steelDark, 0, 0.01, -0.085);
  spike.rotation.x = -Math.PI / 2;
  head.add(spike);
  head.add(mesh(new THREE.ConeGeometry(0.016, 0.09, 10), m.steelDark, 0, 0.075, 0));
  for (const y of [-0.06, -0.11]) {
    head.add(mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.018, 10), m.brass, 0, y, 0));
  }
  g.add(head);
  return g;
}

function buildWarhammer(m: WeaponMats): THREE.Group {
  const g = new THREE.Group();
  g.name = 'warhammer';
  g.add(mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.66, 10), m.wood, 0, 0.38, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.1, 10), m.leather, 0, 0.0, 0));
  g.add(mesh(new THREE.SphereGeometry(0.021, 10, 8), m.brass, 0, -0.055, 0));
  const head = new THREE.Group();
  head.position.set(0, 0.7, 0);
  head.add(mesh(new RoundedBoxGeometry(0.075, 0.075, 0.15, 2, 0.012), m.iron, 0, 0, 0));
  const face = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.025, 14), m.steelDark, 0, 0, 0.082);
  face.rotation.x = Math.PI / 2;
  head.add(face);
  const peen = mesh(new THREE.ConeGeometry(0.026, 0.15, 4), m.steelDark, 0, 0, -0.14);
  peen.rotation.x = -Math.PI / 2;
  peen.rotation.y = Math.PI / 4;
  head.add(peen);
  head.add(mesh(new THREE.ConeGeometry(0.015, 0.07, 10), m.steelDark, 0, 0.07, 0));
  for (const z of [0.045, -0.045]) {
    const band = mesh(new THREE.BoxGeometry(0.08, 0.08, 0.014), m.brass, 0, 0, z);
    head.add(band);
  }
  g.add(head);
  return g;
}

function buildLongbow(m: WeaponMats): THREE.Group {
  const g = new THREE.Group();
  g.name = 'longbow';
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.74, 0.09),
    new THREE.Vector3(0, -0.42, -0.015),
    new THREE.Vector3(0, 0, -0.055),
    new THREE.Vector3(0, 0.42, -0.015),
    new THREE.Vector3(0, 0.74, 0.09),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.016, 8), m.bowWood));
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.ConeGeometry(0.013, 0.06, 8), m.iron, 0, s * 0.76, 0.093));
  }
  // String: straight nock to nock.
  const stringGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 1.5, 6);
  g.add(mesh(stringGeo, m.string, 0, 0, 0.093));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), m.leather, 0, 0, -0.055));
  return g;
}

function buildQuiver(m: WeaponMats): THREE.Group {
  const g = new THREE.Group();
  g.name = 'quiver';
  g.add(mesh(new THREE.CylinderGeometry(0.052, 0.042, 0.6, 14), m.leather, 0, 0, 0));
  const lip = mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 16), m.leather, 0, 0.3, 0);
  lip.rotation.x = Math.PI / 2;
  g.add(lip);
  g.add(mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.02, 14), m.iron, 0, -0.3, 0));
  // Six arrows at varied heights, fletching up.
  const heights = [0.42, 0.47, 0.39, 0.45, 0.5, 0.43];
  const ring: [number, number][] = [[0.02, 0.01], [-0.015, 0.02], [0.005, -0.022], [-0.024, -0.008], [0.024, -0.016], [-0.002, 0.026]];
  for (let i = 0; i < 6; i++) {
    const [ax, az] = ring[i];
    const top = heights[i];
    // Each arrow pivots low inside the tube and splays a few degrees, as real
    // shafts do; this also keeps the fan from stacking into one bright bar
    // in exact side views.
    const arrow = new THREE.Group();
    arrow.position.set(ax, -0.12, az);
    arrow.rotation.set(((i * 2.3) % 1) * 0.1 - 0.05, 0, ((i * 3.7) % 1) * 0.1 - 0.05);
    arrow.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 6), m.wood, 0, top - 0.13, 0));
    const fletch = mesh(new THREE.ConeGeometry(0.014, 0.07, 6), i % 2 ? m.fletch : m.string, 0, top + 0.155, 0);
    fletch.scale.z = 0.45;
    arrow.add(fletch);
    g.add(arrow);
  }
  return g;
}

function buildShield(m: WeaponMats): THREE.Group {
  const g = new THREE.Group();
  g.name = 'shield';
  const profile: [number, number][] = [
    [0.001, 0.032],
    [0.1, 0.03],
    [0.2, 0.022],
    [0.26, 0.01],
    [0.275, 0.0],
  ];
  const shellGeo = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 28);
  shellGeo.rotateX(Math.PI / 2); // dome axis → +Z (faces forward)
  g.add(new THREE.Mesh(shellGeo, m.wood));
  const face = mesh(new THREE.CircleGeometry(0.262, 28), m.shieldFace, 0, 0, 0.02);
  g.add(face);
  const rim = mesh(new THREE.TorusGeometry(0.27, 0.018, 10, 32), m.iron, 0, 0, 0.004);
  g.add(rim);
  const boss = mesh(new THREE.SphereGeometry(0.056, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.steelDark, 0, 0, 0.028);
  boss.rotation.x = Math.PI / 2;
  g.add(boss);
  // Rear grip: horizontal bar through the fist + arm pad.
  g.add(mesh(new THREE.BoxGeometry(0.17, 0.032, 0.03), m.wood, 0, 0, -0.035));
  g.add(mesh(new RoundedBoxGeometry(0.09, 0.12, 0.025, 2, 0.01), m.leather, 0, -0.02, -0.015));
  return g;
}

export function buildWeapon(id: WeaponId, mats: WeaponMats): THREE.Group {
  switch (id) {
    case 'longsword':
      return buildLongsword(mats, 1);
    case 'shortsword':
      return buildLongsword(mats, 0.66);
    case 'battleaxe':
      return buildBattleaxe(mats);
    case 'warhammer':
      return buildWarhammer(mats);
    case 'longbow':
      return buildLongbow(mats);
    case 'quiver':
      return buildQuiver(mats);
    case 'shield':
      return buildShield(mats);
  }
}
