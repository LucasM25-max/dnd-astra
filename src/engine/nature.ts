import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionField, ROAD, TRAIL, SPAWN, clamp, fbm, noise, pathAmount, pathDistance, seededRandom, terrainHeight, terrainSlope } from './landscape';
import type { Materials } from './materials';

type Rng = () => number;
class Builder {
  p: number[] = []; uv: number[] = []; c: number[] = []; indices: number[] = [];
  vertex(v: THREE.Vector3, u: number, w: number, color = new THREE.Color(1, 1, 1)) {
    this.p.push(v.x, v.y, v.z); this.uv.push(u, w); this.c.push(color.r, color.g, color.b);
    return this.p.length / 3 - 1;
  }
  quad(points: THREE.Vector3[], color: THREE.Color) {
    const n = this.p.length / 3;
    points.forEach((v, i) => this.vertex(v, i === 1 || i === 2 ? 1 : 0, i > 1 ? 1 : 0, color));
    this.indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.indices); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}
function tube(b: Builder, points: THREE.Vector3[], radius: number, end: number, sides = 8, segments = 9) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segments, false), length = curve.getLength();
  const first = b.p.length / 3;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, center = curve.getPoint(t);
    let r = end + (radius - end) * Math.pow(1 - t, .85);
    if (i === 0 && points[0].y < .2) r *= 1.4;
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2;
      const irregular = 1 + Math.sin(angle * 3 + t * 6) * .075 + Math.cos(angle * 5 + t * 11) * .035;
      const p = center.clone().addScaledVector(frames.normals[i], Math.cos(angle) * r * irregular).addScaledVector(frames.binormals[i], Math.sin(angle) * r * irregular);
      b.vertex(p, j / sides, t * length * .11);
      if (i < segments && j < sides) {
        const n = first + i * (sides + 1) + j;
        b.indices.push(n, n + sides + 1, n + 1, n + 1, n + sides + 1, n + sides + 2);
      }
    }
  }
  return curve;
}
function leafCard(b: Builder, center: THREE.Vector3, size: number, rng: Rng, tint: THREE.Color) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - .5) * Math.PI, rng() * Math.PI * 2, rng() * Math.PI * 2));
  const w = size * (.8 + rng() * .25), h = size;
  const verts = [new THREE.Vector3(-w / 2, -h / 2, 0), new THREE.Vector3(w / 2, -h / 2, .015), new THREE.Vector3(w / 2, h / 2, 0), new THREE.Vector3(-w / 2, h / 2, .03)];
  b.quad(verts.map(v => v.applyQuaternion(q).add(center)), tint);
}

export function createTerrain(scene: THREE.Scene, mat: Materials) {
  const size = 170, seg = 252;
  const geometry = new THREE.PlaneGeometry(size, size, seg, seg);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  const blend: number[] = [], colors: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const y = terrainHeight(x, z);
    positions.setY(i, y); uv.setXY(i, x / 2.7, z / 2.7);
    const amount = pathAmount(x, z), slope = terrainSlope(x, z);
    // Soft, low-frequency stone-on-bank blend; the fragment shader dithers the
    // per-vertex edges so the old checker pattern cannot alias.
    const t = clamp((slope - .40) / .22, 0, 1);
    const stone = t * t * (3 - 2 * t) * (.62 + fbm(x * .12, z * .12) * .45);
    blend.push(amount, clamp(stone, 0, .72));
    // The bare-soil ground sheet carries its own colour; vertex tint only
    // breathes gentle large-scale variation (damp hollows, dry rises) over it.
    const variation = .86 + fbm(x * .19, z * .19) * .24;
    const damp = .96 + fbm(x * .05 + 9, z * .05 + 3) * .07;
    color.setRGB(variation, variation * (.985 + (1 - amount) * .02) * damp, variation * .97 * damp);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('aBlend', new THREE.Float32BufferAttribute(blend, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, mat.ground);
  ground.receiveShadow = true; ground.name = 'Continuous sculpted woodland terrain'; scene.add(ground);
}
function buildTree(seed: number, detailed = true) {
  const rng = seededRandom(seed), trunk = new Builder(), foliage = new Builder();
  const h = 10.7 + rng() * 3.9, radius = .26 + rng() * .18, spread = 2.9 + rng() * 1.0;
  const leanX = (rng() - .5) * 1.4, leanZ = (rng() - .5) * 1.3;
  tube(trunk, [new THREE.Vector3(0, -.12, 0), new THREE.Vector3(leanX * .24, h * .31, leanZ * .2), new THREE.Vector3(leanX * .75, h * .66, leanZ * .7), new THREE.Vector3(leanX, h * .96, leanZ)], radius, .035, detailed ? 9 : 7, detailed ? 12 : 8);
  for (let i = 0; i < (detailed ? 5 : 0); i++) {
    const a = i / 5 * Math.PI * 2 + rng() * .4;
    tube(trunk, [new THREE.Vector3(Math.cos(a) * radius * .45, .9, Math.sin(a) * radius * .45), new THREE.Vector3(Math.cos(a) * .55, .19, Math.sin(a) * .55), new THREE.Vector3(Math.cos(a) * (1.0 + rng() * .45), -.03, Math.sin(a) * (1.0 + rng() * .45))], radius * .35, .035, 5, 4);
  }
  const phase = rng() * Math.PI * 2;
  for (let branch = 0; branch < 10; branch++) {
    const a = branch * 2.3999 + phase;
    const level = .35 + branch / 10 * .41;
    const reach = spread * (.88 + rng() * .32) * (branch > 7 ? .7 : 1);
    const bx = Math.cos(a), bz = Math.sin(a);
    const start = new THREE.Vector3(leanX * level, h * level, leanZ * level);
    const mid = new THREE.Vector3(bx * reach * .48 + start.x, h * level + .85, bz * reach * .48 + start.z);
    const tip = new THREE.Vector3(bx * reach + leanX, h * (level + .18) + rng() * .65, bz * reach + leanZ);
    const curve = tube(trunk, [start, mid, tip], radius * (.32 + (1 - level) * .25), .013, detailed ? 6 : 5, detailed ? 6 : 4);
    for (let shoot = 0; shoot < 4; shoot++) {
      const t = .38 + shoot * .19, p = curve.getPoint(Math.min(1, t));
      const sa = a + (shoot % 2 ? -1 : 1) * (.5 + rng() * .8);
      const target = p.clone().add(new THREE.Vector3(Math.cos(sa) * (.5 + rng() * .9), .38 + rng() * .8, Math.sin(sa) * (.5 + rng() * .9)));
      if (detailed) tube(trunk, [p, p.clone().lerp(target, .55).add(new THREE.Vector3(0, .1, 0)), target], .025, .005, 4, 2);
      for (let l = 0; l < (detailed ? 9 : 5); l++) {
        const center = target.clone().add(new THREE.Vector3((rng() - .5) * 1.3, (rng() - .45) * .95, (rng() - .5) * 1.3));
        const tint = new THREE.Color().setHSL(.215 + rng() * .035, .25 + rng() * .2, .51 + rng() * .24);
        leafCard(foliage, center, .8 + rng() * .38, rng, tint);
      }
    }
  }
  for (let i = 0; i < (detailed ? 70 : 30); i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 1.65;
    leafCard(foliage, new THREE.Vector3(leanX + Math.cos(a) * r, h * .88 + rng() * 1.3, leanZ + Math.sin(a) * r), .86 + rng() * .3, rng, new THREE.Color().setHSL(.24, .32, .61 + rng() * .15));
  }
  return { trunk: trunk.geometry(), leaf: foliage.geometry(), radius, h };
}
export interface Nature { grass: THREE.InstancedMesh; ferns: THREE.InstancedMesh; detailCounts: number[]; trees: number }
export function createForest(scene: THREE.Scene, mat: Materials, collisions: CollisionField): Nature {
  const rng = seededRandom(41721), dummy = new THREE.Object3D();
  const positions: { x: number; z: number; scale: number; angle: number; type: number }[] = [];
  const heroes = [[-14, -.2], [-8, -1.1], [-2, -.9], [2.5, -4], [5, -7], [13.2, -4.4], [15, 6.9], [-4, 9.3], [-15, 10], [-.8, -10], [4, 9.1], [-22, -.8]];
  for (const [x, z] of heroes) positions.push({ x, z, scale: .92 + rng() * .24, angle: rng() * 6.28, type: Math.floor(rng() * 4) });
  for (let tries = 0; tries < 18000 && positions.length < 315; tries++) {
    const near = positions.length < 145;
    const x = (rng() - .5) * (near ? 72 : 147), z = (rng() - .57) * (near ? 74 : 150);
    if (pathDistance(x, z) < 1.8 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 3.8) continue;
    const spacing = near ? 3.15 : 3.9;
    if (positions.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < spacing ** 2)) continue;
    positions.push({ x, z, scale: .76 + rng() * .56, angle: rng() * Math.PI * 2, type: Math.floor(rng() * 4) });
  }
  for (let type = 0; type < 4; type++) {
    for (const near of [true, false]) {
      const geo = buildTree(type * 913 + 529, near);
      // Spatial batches retain instancing while letting the frustum discard whole forest patches.
      const buckets = new Map<string, typeof positions>();
      for (const p of positions.filter(p => p.type === type && (Math.hypot(p.x + 4, p.z) < 29) === near)) {
        const key = `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
        const points = buckets.get(key) ?? []; points.push(p); buckets.set(key, points);
      }
      for (const pts of buckets.values()) {
      const trunks = new THREE.InstancedMesh(geo.trunk, mat.bark, pts.length);
      const leaves = new THREE.InstancedMesh(geo.leaf, mat.leaves, pts.length);
      pts.forEach((p, i) => {
        const y = terrainHeight(p.x, p.z) - .07;
        dummy.position.set(p.x, y, p.z); dummy.rotation.set(0, p.angle, (rng() - .5) * .035); dummy.scale.setScalar(p.scale); dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix); leaves.setMatrixAt(i, dummy.matrix);
        collisions.add({ x: p.x, z: p.z, radius: geo.radius * p.scale * 1.17, bottom: y, top: y + geo.h * p.scale });
      });
      const roadShadows = near || pts.some(p => Math.abs(p.x) < 49 && pathDistance(p.x, p.z) < 6);
      trunks.castShadow = roadShadows; trunks.receiveShadow = true;
      leaves.castShadow = roadShadows; leaves.receiveShadow = true; leaves.customDepthMaterial = mat.leafDepth;
      trunks.name = `Old-growth oak trunks ${type}`; leaves.name = `Wind-stirred oak canopy ${type}`;
      for (const mesh of [trunks, leaves]) mesh.userData.density = { total: pts.length, performance: near ? .42 : .18, balanced: near ? .85 : .7 };
      trunks.computeBoundingSphere(); leaves.computeBoundingSphere();
      scene.add(trunks, leaves);
      }
    }
  }
  createRocks(scene, mat, collisions);
  const grass = createGrass(scene, mat, rng);
  const ferns = createFerns(scene, mat, rng);
  createShrubs(scene, mat, rng);
  createDeadwood(scene, mat, collisions, rng);
  return { grass, ferns, detailCounts: [grass.count, ferns.count], trees: positions.length };
}
function rockGeometry(seed: number) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 3);
  const p = g.getAttribute('position'), colors: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = .78 + noise(x * 3.2 + seed, z * 3.1 + y * 3) * .32;
    p.setXYZ(i, x * n * 1.1, y * n * .69, z * n);
    const moss = clamp((y - .08) * 1.3 + noise(x * 6 + seed, z * 6) * .9 - .3, 0, .9);
    const c = new THREE.Color().setRGB(.85, .80, .69).lerp(new THREE.Color().setRGB(.28, .38, .13), moss * .75);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.deleteAttribute('normal'); g = mergeVertices(g, .0001); g.computeVertexNormals();
  return g;
}
function createRocks(scene: THREE.Scene, mat: Materials, collision: CollisionField) {
  const rng = seededRandom(112), dummy = new THREE.Object3D();
  const points: {x: number; z: number; s: number}[] = [];
  for (const path of [ROAD, TRAIL]) {
    for (let i = 3; i < path.length - 3; i++) {
      const p = path[i];
      if (Math.abs(p.x) > 42 || Math.abs(p.z) > 43) continue;
      const next = path[i + 1], length = Math.hypot(next.x - p.x, next.z - p.z);
      const nx = -(next.z - p.z) / length, nz = (next.x - p.x) / length;
      for (const sign of [-1, 1]) {
        if (rng() > .74) continue;
        const w = (path === ROAD ? 3.1 : 1.5) + rng() * .5;
        const x = p.x + nx * w * sign + (rng() - .5) * .45, z = p.z + nz * w * sign + (rng() - .5) * .45;
        if (pathDistance(x, z) > .3) points.push({ x, z, s: .30 + rng() * .83 });
      }
    }
  }
  for (let i = 0; i < 105; i++) {
    const x = (rng() - .5) * 95, z = (rng() - .5) * 98;
    if (pathDistance(x, z) < .2) continue;
    points.push({ x, z, s: .3 + rng() * 1.18 });
  }
  for (let type = 0; type < 3; type++) {
    const pts = points.filter((_, i) => i % 3 === type);
    const mesh = new THREE.InstancedMesh(rockGeometry(type * 13), mat.stone, pts.length);
    pts.forEach((p, i) => {
      const y = terrainHeight(p.x, p.z);
      dummy.position.set(p.x, y + p.s * .08, p.z); dummy.rotation.set((rng() - .5) * .45, rng() * 6.28, (rng() - .5) * .3); dummy.scale.set(p.s, p.s * (.65 + rng() * .5), p.s * (.7 + rng() * .65)); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      collision.add({ x: p.x, z: p.z, radius: p.s * .64, bottom: y - .2, top: y + p.s * .55 });
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); scene.add(mesh);
  }
  const pebbleGeo = new THREE.IcosahedronGeometry(1, 0);
  pebbleGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pebbleGeo.getAttribute('position').count * 3).fill(.72), 3));
  const pebbles = new THREE.InstancedMesh(pebbleGeo, mat.stone, 900);
  let n = 0;
  for (let i = 0; i < 12000 && n < 900; i++) {
    const x = (rng() - .5) * 75, z = (rng() - .5) * 67;
    if (pathDistance(x, z) > 1.5) continue;
    const s = .014 + rng() ** 2 * .066;
    dummy.position.set(x, terrainHeight(x, z) + s * .2, z); dummy.rotation.set(rng(), rng() * 6.28, rng()); dummy.scale.set(s * 1.2, s * .7, s); dummy.updateMatrix(); pebbles.setMatrixAt(n++, dummy.matrix);
  }
  pebbles.userData.density = { total: n, performance: .35, balanced: .75 };
  pebbles.count = n; pebbles.receiveShadow = true; pebbles.computeBoundingSphere(); scene.add(pebbles);
}
function grassGeometry() {
  const b = new Builder(), rng = seededRandom(9901);
  for (let blade = 0; blade < 6; blade++) {
    const angle = rng() * Math.PI * 2, height = .20 + rng() * .25, width = .008 + rng() * .012;
    const base = new THREE.Vector3((rng() - .5) * .17, 0, (rng() - .5) * .17);
    const side = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), lean = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const index = b.p.length / 3;
    for (let segment = 0; segment <= 3; segment++) {
      const t = segment / 3, w = width * (1 - t) + .0005;
      const p = base.clone().addScaledVector(lean, t * t * height * .46); p.y = t * height;
      const c = new THREE.Color('#334326').lerp(new THREE.Color(blade % 3 === 0 ? '#99a05f' : '#788746'), t);
      b.vertex(p.clone().addScaledVector(side, -w), 0, t, c); b.vertex(p.clone().addScaledVector(side, w), 1, t, c);
      if (segment < 3) { const i = index + segment * 2; b.indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
  }
  return b.geometry();
}
function createGrass(scene: THREE.Scene, mat: Materials, rng: Rng) {
  const points: {x: number; z: number; s: number}[] = [];
  for (let i = 0; i < 65000 && points.length < 10500; i++) {
    const x = (rng() - .5) * 93, z = (rng() - .5) * 86;
    const d = pathDistance(x, z);
    if (d < -.1 || d > 19 || terrainSlope(x, z) > 1.45) continue;
    if (rng() > (.46 + noise(x * .4, z * .4) * .45) * (d > 6 ? .55 : 1)) continue;
    points.push({ x, z, s: .55 + rng() * 1.3 });
  }
  points.sort((a, b) => pathDistance(a.x, a.z) - pathDistance(b.x, b.z));
  const mesh = new THREE.InstancedMesh(grassGeometry(), mat.grass, points.length), dummy = new THREE.Object3D();
  points.forEach((p, i) => {
    dummy.position.set(p.x, terrainHeight(p.x, p.z) - .025, p.z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.setScalar(p.s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.receiveShadow = true; mesh.computeBoundingSphere(); mesh.name = 'Individual windblown grass blades'; scene.add(mesh); return mesh;
}
function fernGeometry() {
  const b = new Builder(), rng = seededRandom(2092);
  for (let frond = 0; frond < 7; frond++) {
    const angle = frond / 7 * Math.PI * 2 + rng() * .3, len = .62 + rng() * .5;
    const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const point = (t: number) => radial.clone().multiplyScalar(t * len).add(new THREE.Vector3(0, Math.sin(t * 2.2) * len * .68 + .04, 0));
    for (let i = 1; i < 16; i++) {
      const t = i / 16, center = point(t), length = Math.sin(t * Math.PI) * len * .25;
      const col = new THREE.Color('#344e28').lerp(new THREE.Color('#8d9e53'), t * .65 + rng() * .12);
      for (const sign of [-1, 1]) {
        const tip = center.clone().addScaledVector(side, length * sign).addScaledVector(radial, len * .07);
        tip.y -= length * .18;
        const middle = center.clone().lerp(tip, .5); middle.y += .018;
        const w = len * .025 * (1 - t * .65);
        b.quad([center, middle.clone().addScaledVector(radial, -w), tip, middle.clone().addScaledVector(radial, w)], col);
      }
    }
  }
  return b.geometry();
}
function createFerns(scene: THREE.Scene, mat: Materials, rng: Rng) {
  const points: {x: number; z: number; s: number}[] = [];
  for (let i = 0; i < 10000 && points.length < 380; i++) {
    const x = (rng() - .5) * 80, z = (rng() - .52) * 73, d = pathDistance(x, z);
    if (d < .25 || d > 6 || terrainSlope(x, z) > 1.25) continue;
    points.push({ x, z, s: .42 + rng() * .68 });
  }
  points.sort((a, b) => pathDistance(a.x, a.z) - pathDistance(b.x, b.z));
  const mesh = new THREE.InstancedMesh(fernGeometry(), mat.fern, points.length), dummy = new THREE.Object3D();
  points.forEach((p, i) => {
    dummy.position.set(p.x, terrainHeight(p.x, p.z) - .025, p.z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.setScalar(p.s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.receiveShadow = true; mesh.castShadow = true; mesh.computeBoundingSphere(); mesh.name = 'Pinnate woodland ferns'; scene.add(mesh); return mesh;
}
function createShrubs(scene: THREE.Scene, mat: Materials, rng: Rng) {
  const b = new Builder();
  for (let i = 0; i < 95; i++) {
    const a = rng() * 6.28, r = Math.sqrt(rng()) * .6;
    const p = new THREE.Vector3(Math.cos(a) * r, .22 + rng() * .7 * (1 - r * .65), Math.sin(a) * r);
    leafCard(b, p, .35 + rng() * .3, rng, new THREE.Color().setHSL(.23 + rng() * .06, .33, .45 + rng() * .3));
  }
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < 9000 && points.length < 275; i++) {
    const x = (rng() - .5) * 100, z = (rng() - .55) * 94, d = pathDistance(x, z);
    if (d < .6 || d > 9) continue;
    points.push(new THREE.Vector3(x, terrainHeight(x, z), z));
  }
  const mesh = new THREE.InstancedMesh(b.geometry(), mat.leaves, points.length), dummy = new THREE.Object3D();
  points.forEach((p, i) => {
    dummy.position.copy(p); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.setScalar(.7 + rng() * 1.1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.userData.density = { total: points.length, performance: .45, balanced: .8 };
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = mat.leafDepth; mesh.computeBoundingSphere(); scene.add(mesh);
  // A little colour, never a carpet of identical flowers.
  const flowerGeo = new THREE.SphereGeometry(.027, 5, 4), flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ color: '#d3d2b1', roughness: .9 }), 220);
  let n = 0;
  for (let i = 0; i < 4000 && n < 220; i++) {
    const x = (rng() - .5) * 42, z = (rng() - .5) * 37, d = pathDistance(x, z);
    if (d < .35 || d > 2.1) continue;
    dummy.position.set(x, terrainHeight(x, z) + .15 + rng() * .2, z); dummy.scale.set(1, .5, 1); dummy.updateMatrix(); flowers.setMatrixAt(n++, dummy.matrix);
  }
  flowers.count = n; flowers.computeBoundingSphere(); scene.add(flowers);
}
function createDeadwood(scene: THREE.Scene, mat: Materials, collision: CollisionField, rng: Rng) {
  const locs = [[-5, -2.6, .4, 3.3], [1, 8.1, 1.6, 3], [13, -11.5, .8, 2.6], [-16, 9.3, 2, 2.8]];
  for (const [x, z, angle, length] of locs) {
    const group = new THREE.Group(); group.position.set(x, terrainHeight(x, z) + .18, z); group.rotation.y = angle;
    const builder = new Builder();
    tube(builder, [new THREE.Vector3(-length / 2, 0, 0), new THREE.Vector3(0, .02, .04), new THREE.Vector3(length / 2, -.04, .03)], .23, .16, 11, 9);
    tube(builder, [new THREE.Vector3(.3, .04, 0), new THREE.Vector3(.5, .3, .17), new THREE.Vector3(.62, .54, .28)], .07, .024, 7, 4);
    const mesh = new THREE.Mesh(builder.geometry(), mat.bark); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    for (const sign of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CircleGeometry(sign === 1 ? .15 : .22, 13), new THREE.MeshStandardMaterial({ color: rng() > .5 ? '#8b7956' : '#aa956d', roughness: 1 }));
      end.rotation.y = sign * Math.PI / 2; end.position.set(sign * length / 2, sign === 1 ? -.04 : 0, sign === 1 ? .03 : 0); group.add(end);
    }
    scene.add(group);
    for (let t = -length / 2; t <= length / 2; t += .5) {
      const px = x + Math.cos(angle) * t, pz = z - Math.sin(angle) * t;
      collision.add({ x: px, z: pz, radius: .2, bottom: group.position.y - .2, top: group.position.y + .2 });
    }
  }
}
