import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CollisionField, ROAD, TRAIL, STREAM, SPAWN, ROAD_CORRIDOR, TRAIL_CORRIDOR,
  clamp, fbm, noise, pathAmount, pathDistanceFast,
  distanceToPath, distanceToStream, distanceToStreamFast, streamAmount,
  seededRandom, terrainHeight, terrainSlope, WORLD_EXTENT,
  TRAIL_WIDTH, STREAM_WIDTH, STREAM_BANK_WIDTH
} from './landscape';
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

const smoothstep01 = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

export function createTerrain(scene: THREE.Scene, mat: Materials) {
  // Photorealistic ground fix: terrain centered at origin, flat at spawn, gently undulating.
  // Size covers 2 miles forest (3218m) easily, plus main trail 10 miles east and 10 miles south.
  // Optimized for performance: 20000m size with 200 segments ~100m per quad (40k verts), plus high-detail inset.
  // Reduced from 20000/300 (90k verts) to 20000/200 (40k verts) to allow browser reload in @sparticuz/chromium
  // while still covering full 20-mile L-shaped main trail.
  const size = 20000;
  const seg = 200;
  const geometry = new THREE.PlaneGeometry(size, size, seg, seg);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;

  const blend: number[] = []; // x=road, y=stone, z=stream
  const colors: number[] = [];
  const color = new THREE.Color();

  // First pass: set heights
  const heights = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const y = terrainHeight(x, z);
    heights[i] = y;
    positions.setY(i, y);
    uv.setXY(i, x / 3.2, z / 3.2);
  }

  // Second pass: compute blend and colors using neighbor slopes (fast)
  // Precompute index grid for slope: seg+1 vertices per row
  const vertsPerRow = seg + 1;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const ix = i % vertsPerRow;
    const iz = Math.floor(i / vertsPerRow);

    // Slope via neighbor height differences
    let slope = 0;
    if (ix > 0 && ix < seg && iz > 0 && iz < seg) {
      const left = heights[i - 1];
      const right = heights[i + 1];
      const up = heights[i - vertsPerRow];
      const down = heights[i + vertsPerRow];
      const dx = (right - left) / (2 * (size / seg));
      const dz = (down - up) / (2 * (size / seg));
      slope = Math.hypot(dx, dz);
    } else {
      slope = fbm(x * 0.08, z * 0.08) * 0.6;
    }

    const amount = pathAmount(x, z);
    const sAmount = streamAmount(x, z);
    const stone = smoothstep01((slope - 0.35) / 0.28) * (0.55 + fbm(x * 0.12, z * 0.12) * 0.4);
    blend.push(amount, clamp(stone, 0, 0.72), clamp(sAmount * 1.1, 0, 1));

    const variation = 0.72 + fbm(x * 0.23, z * 0.23) * 0.42;
    const litter = 0.94 + fbm(x * 0.055 + 9, z * 0.055 + 3) * 0.14;
    // Slightly darker near stream, warmer near road
    const streamDarken = sAmount * 0.18;
    const roadWarm = amount * 0.08;
    color.setRGB(
      variation * litter * (1 - streamDarken) + roadWarm,
      variation * litter * (0.98 + (1 - amount) * 0.025) * (1 - streamDarken * 0.5),
      variation * litter * 0.91 * (1 - streamDarken * 0.3)
    );
    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute('aBlend', new THREE.Float32BufferAttribute(blend, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const ground = new THREE.Mesh(geometry, mat.ground);
  ground.receiveShadow = true;
  ground.name = 'Continuous sculpted woodland terrain - fixed ground placement';
  scene.add(ground);

  // Add high-detail inset near spawn for photorealism (2 miles = 3218m)
  // Small 300m plane with 50 segments for crisp road ruts near player start
  const detailSize = 300;
  const detailSeg = 50;
  const detailGeo = new THREE.PlaneGeometry(detailSize, detailSize, detailSeg, detailSeg);
  detailGeo.rotateX(-Math.PI / 2);
  const dPos = detailGeo.getAttribute('position') as THREE.BufferAttribute;
  const dUv = detailGeo.getAttribute('uv') as THREE.BufferAttribute;
  const dBlend: number[] = [];
  const dColors: number[] = [];
  for (let i = 0; i < dPos.count; i++) {
    const x = dPos.getX(i) + SPAWN.x;
    const z = dPos.getZ(i) + SPAWN.z;
    const y = terrainHeight(x, z);
    dPos.setXYZ(i, x, y + 0.015, z); // slight offset to avoid z-fighting
    dUv.setXY(i, x / 3.2, z / 3.2);
    const amount = pathAmount(x, z);
    const sAmount = streamAmount(x, z);
    const slope = terrainSlope(x, z);
    const stone = smoothstep01((slope - 0.40) / 0.22) * (0.62 + fbm(x * 0.12, z * 0.12) * 0.45);
    dBlend.push(amount, clamp(stone, 0, 0.72), clamp(sAmount, 0, 1));
    const variation = 0.72 + fbm(x * 0.23, z * 0.23) * 0.42;
    const litter = 0.94 + fbm(x * 0.055 + 9, z * 0.055 + 3) * 0.14;
    color.setRGB(variation * litter, variation * litter * (0.98 + (1 - amount) * 0.025), variation * litter * 0.91);
    dColors.push(color.r, color.g, color.b);
  }
  detailGeo.setAttribute('aBlend', new THREE.Float32BufferAttribute(dBlend, 3));
  detailGeo.setAttribute('color', new THREE.Float32BufferAttribute(dColors, 3));
  detailGeo.computeVertexNormals();
  const detailGround = new THREE.Mesh(detailGeo, mat.ground);
  detailGround.receiveShadow = true;
  detailGround.name = 'High-detail spawn terrain';
  scene.add(detailGround);

  // Create photorealistic stream with running water
  createStream(scene, mat);
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
  for (let branch = 0; branch < (detailed ? 10 : 7); branch++) {
    const a = branch * 2.3999 + phase;
    const level = .35 + branch / (detailed ? 10 : 7) * .41;
    const reach = spread * (.88 + rng() * .32) * (branch > (detailed ? 7 : 5) ? .7 : 1);
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

function buildConifer(seed: number, detailed = true) {
  const rng = seededRandom(seed), trunk = new Builder(), foliage = new Builder();
  const h = 9 + rng() * 5, radius = .16 + rng() * .12, crown = 2.1 + rng() * 1.1;
  const leanX = (rng() - .5) * .5, leanZ = (rng() - .5) * .5;
  tube(trunk, [new THREE.Vector3(0, -.1, 0), new THREE.Vector3(leanX * .3, h * .4, leanZ * .3), new THREE.Vector3(leanX * .7, h * .75, leanZ * .6), new THREE.Vector3(leanX, h * .9, leanZ)], radius, .03, detailed ? 8 : 6, detailed ? 10 : 7);
  const tiers = detailed ? 6 : 4;
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / tiers, y = h * (.34 + t * .58), r = crown * (1 - t * .78);
    const layers = detailed ? 3 : 2;
    for (let l = 0; l < layers; l++) {
      const ly = y + l * h * .055;
      for (let c = 0; c < (detailed ? 7 : 4); c++) {
        const a = c / (detailed ? 7 : 4) * Math.PI * 2 + rng() * .5;
        const tint = new THREE.Color().setHSL(.29 + rng() * .02, .3 + rng() * .12, .3 + rng() * .16 + t * .08);
        leafCard(foliage, new THREE.Vector3(leanX * t + Math.cos(a) * r * .8, ly, leanZ * t + Math.sin(a) * r * .8), r * (.62 + rng() * .3), rng, tint);
      }
    }
    leafCard(foliage, new THREE.Vector3(leanX * t, y + h * .1, leanZ * t), r * .5, rng, new THREE.Color().setHSL(.29, .3, .36 + rng() * .12));
  }
  return { trunk: trunk.geometry(), leaf: foliage.geometry(), radius, h };
}

export interface Nature { grass: THREE.InstancedMesh; ferns: THREE.InstancedMesh; detailCounts: number[]; trees: number }

interface TreeSpot { x: number; z: number; scale: number; angle: number; type: number; conifer: boolean }

export function placeForest(collisions: CollisionField, densityScale = 1) {
  const rng = seededRandom(41721);
  const ring0: TreeSpot[] = [], ring1: TreeSpot[] = [], ring2: TreeSpot[] = [], ring3: TreeSpot[] = [];

  // Hero trees near ambush to frame the scene - keep clear of 15ft main road (ROAD_CORRIDOR ~4.1m)
  // Stream moved to -4200 to avoid crossing main road
  const heroes: [number, number][] = [
    [-14, -8], [-8, -9], [-2, -10], [2.5, -12], [5, -15],
    [13.2, -12], [15, 11], [-4, 14], [-15, 15], [-0.8, -18],
    [4, 15], [-28, -8], [32, -9], [-32, 12],
    [-4200, 100], [-4220, -100], [-4180, 300] // near stream for photorealistic framing, west side of both trails
  ];
  for (const [x, z] of heroes) {
    if (pathDistanceFast(x, z) < ROAD_CORRIDOR + 1) continue;
    if (distanceToPath(x, z, TRAIL) - TRAIL_WIDTH < TRAIL_CORRIDOR + 0.5) continue;
    ring0.push({ x, z, scale: .92 + rng() * .24, angle: rng() * 6.28, type: Math.floor(rng() * 4), conifer: false });
  }

  const trySpot = (spots: TreeSpot[], count: number, minR: number, maxR: number, boxW: number, boxH: number, spacing: number, coniferChance: number, scaleMin: number, scaleMax: number, avoidStream = true) => {
    let attempts = 0;
    const maxAttempts = count * 80;
    while (spots.length < count && attempts < maxAttempts) {
      attempts++;
      let x: number, z: number;
      if (minR > 0 && maxR > 0 && boxW === 0) {
        const a = rng() * Math.PI * 2, r = minR + Math.sqrt(rng()) * (maxR - minR);
        x = Math.cos(a) * r + SPAWN.x;
        z = Math.sin(a) * r + SPAWN.z;
      } else {
        x = (rng() - .5) * boxW;
        z = (rng() - .5) * boxH;
      }

      // Keep within world
      if (Math.abs(x) > WORLD_EXTENT * 0.9 || Math.abs(z) > WORLD_EXTENT * 0.9) continue;

      // Avoid roads
      if (pathDistanceFast(x, z) < ROAD_CORRIDOR) continue;
      if (distanceToPath(x, z, TRAIL) - TRAIL_WIDTH < TRAIL_CORRIDOR) continue;

      // Avoid stream
      if (avoidStream && distanceToStreamFast(x, z) < STREAM_WIDTH + 3.5) continue;

      // Avoid spawn and ambush clearing
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 5.5) continue;
      if (Math.hypot(x - 9.7, z - 0) < 6.5) continue;

      // Avoid other trees in same ring (coarse)
      let tooClose = false;
      for (let j = Math.max(0, spots.length - 30); j < spots.length; j++) {
        const p = spots[j];
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < spacing ** 2) { tooClose = true; break; }
      }
      if (tooClose) continue;

      spots.push({ x, z, scale: scaleMin + rng() * (scaleMax - scaleMin), angle: rng() * Math.PI * 2, type: Math.floor(rng() * 4), conifer: rng() < coniferChance });
    }
  };

  // 2 miles of forest = 3218m radius - fill densely but optimized for browser reload
  // Increased density for photorealism: 200+350+1200 = 1750 trees within 2 miles (was 1200), plus 1200 distant = 2950 total
  // Performance mode reduces via setQuality: ring1 0.5, ring2 0.4, ring3 0.35 → ~200+175+480+420=1275 instanced in performance (passes browser smoke)
  // Ring0: 0-80m dense near spawn (old growth)
  trySpot(ring0, Math.floor(200 * densityScale), 0, 0, 120, 120, 3.0, 0.12, 0.76, 1.35, true);
  // Ring1: 80-400m mid woodland
  trySpot(ring1, Math.floor(350 * densityScale), 80, 400, 0, 0, 4.2, 0.28, 0.85, 1.55, true);
  // Ring2: 400m to 2 miles (3218m) - dense forest requirement
  trySpot(ring2, Math.floor(1200 * densityScale), 400, 3218, 0, 0, 6.5, 0.45, 0.9, 2.2, true);
  // Ring3: 2 miles to 8 miles - sparse but covering entire open world
  trySpot(ring3, Math.floor(1200 * densityScale), 3218, 10000, 0, 0, 12, 0.68, 1.2, 2.8, false);

  // Add colliders for near trees only (performance)
  for (const t of [...ring0, ...ring1]) {
    collisions.add({ x: t.x, z: t.z, radius: .42 * t.scale * 1.17, bottom: terrainHeight(t.x, t.z), top: terrainHeight(t.x, t.z) + 14 * t.scale });
  }

  return { ring0, ring1, ring2, ring3, rng };
}

export function createForest(scene: THREE.Scene, mat: Materials, collisions: CollisionField): Nature {
  const { ring0, ring1, ring2, ring3, rng } = placeForest(collisions);
  const geoCache = new Map<string, { trunk: THREE.BufferGeometry; leaf: THREE.BufferGeometry; radius: number; h: number }>();
  const treeGeo = (key: string, make: () => { trunk: THREE.BufferGeometry; leaf: THREE.BufferGeometry; radius: number; h: number }) => {
    let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g;
  };
  const dummy = new THREE.Object3D();

  const spawnRing = (spots: TreeSpot[], opts: { shadows: boolean; coniferDetail: boolean; bucket: number; tag: string; density?: { total: number; performance: number; balanced: number } }) => {
    const groups = new Map<string, TreeSpot[]>();
    for (const p of spots) {
      const key = `${p.conifer ? 'c' : 'o'}${p.type}:${Math.floor(p.x / opts.bucket)},${Math.floor(p.z / opts.bucket)}`;
      const arr = groups.get(key) ?? []; arr.push(p); groups.set(key, arr);
    }
    let total = 0;
    for (const [key, pts] of groups) {
      const [kindType, ] = key.split(':');
      const conifer = kindType.startsWith('c'), type = Number(kindType.slice(1));
      const g = treeGeo(`${kindType}-${type}-${opts.coniferDetail ? 1 : 0}`, () => conifer ? buildConifer(type * 641 + 17, opts.coniferDetail) : buildTree(type * 913 + 529, opts.coniferDetail));
      const trunks = new THREE.InstancedMesh(g.trunk, mat.bark, pts.length);
      const leaves = new THREE.InstancedMesh(g.leaf, conifer && !opts.shadows ? (mat.coniferDark ?? mat.leaves) : mat.leaves, pts.length);
      pts.forEach((p, i) => {
        const y = terrainHeight(p.x, p.z) - .07;
        dummy.position.set(p.x, y, p.z); dummy.rotation.set(0, p.angle, (rng() - .5) * .035); dummy.scale.setScalar(p.scale); dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix); leaves.setMatrixAt(i, dummy.matrix);
      });
      trunks.castShadow = opts.shadows; trunks.receiveShadow = true;
      leaves.castShadow = opts.shadows; leaves.receiveShadow = true; leaves.customDepthMaterial = mat.leafDepth;
      trunks.name = `${opts.tag} trunks ${key}`; leaves.name = `${opts.tag} canopy ${key}`;
      if (opts.density) for (const mesh of [trunks, leaves]) mesh.userData.density = opts.density;
      trunks.computeBoundingSphere(); leaves.computeBoundingSphere();
      scene.add(trunks, leaves); total += pts.length;
    }
    return total;
  };

  const near0 = spawnRing(ring0, { shadows: true, coniferDetail: true, bucket: 24, tag: 'Old-growth oak near' });
  spawnRing(ring1, { shadows: true, coniferDetail: true, bucket: 48, tag: 'Mid woodland', density: { total: 1, performance: .5, balanced: .85 } });
  spawnRing(ring2, { shadows: true, coniferDetail: false, bucket: 96, tag: '2-mile forest', density: { total: 1, performance: .4, balanced: .8 } });
  spawnRing(ring3, { shadows: false, coniferDetail: false, bucket: 180, tag: 'Distant treeline', density: { total: 1, performance: .35, balanced: .7 } });

  createRocks(scene, mat, collisions);
  const grass = createGrass(scene, mat, rng);
  const ferns = createFerns(scene, mat, rng);
  createShrubs(scene, mat, rng);
  createDeadwood(scene, mat, collisions, rng);
  createUndergrowth(scene, mat, rng);
  return { grass, ferns, detailCounts: [grass.count, ferns.count], trees: near0 + ring1.length + ring2.length };
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

export function placeRocks() {
  const rng = seededRandom(112);
  const points: { x: number; z: number; s: number }[] = [];
  // Roadside stones - keep clear of wagon
  for (const path of [ROAD, TRAIL]) {
    const isRoad = path === ROAD;
    for (let i = 3; i < path.length - 3; i += isRoad ? 4 : 8) {
      const p = path[i];
      if (Math.abs(p.x) > WORLD_EXTENT * 0.9 || Math.abs(p.z) > WORLD_EXTENT * 0.9) continue;
      const next = path[i + 1];
      const len = Math.hypot(next.x - p.x, next.z - p.z) || 1;
      const nx = -(next.z - p.z) / len, nz = (next.x - p.x) / len;
      for (const sign of [-1, 1]) {
        if (rng() > (isRoad ? 0.58 : 0.72)) continue;
        const w = (isRoad ? 4.6 : 2.2) + rng() * .7;
        const x = p.x + nx * w * sign + (rng() - .5) * .5;
        const z = p.z + nz * w * sign + (rng() - .5) * .5;
        if (pathDistanceFast(x, z) > .4 && distanceToStreamFast(x, z) > STREAM_WIDTH + 1) {
          points.push({ x, z, s: .30 + rng() * .83 });
        }
      }
    }
  }
  // Forest scatter
  for (let i = 0; i < 1200; i++) {
    const x = (rng() - .5) * 16000, z = (rng() - .5) * 16000;
    if (pathDistanceFast(x, z) < 2 || distanceToStreamFast(x, z) < STREAM_WIDTH + 2) continue;
    points.push({ x, z, s: .25 + rng() * 1.2 });
  }
  return points;
}

function createRocks(scene: THREE.Scene, mat: Materials, collision: CollisionField) {
  const rng = seededRandom(112), dummy = new THREE.Object3D();
  const points = placeRocks();
  for (let type = 0; type < 3; type++) {
    const pts = points.filter((_, i) => i % 3 === type);
    const mesh = new THREE.InstancedMesh(rockGeometry(type * 13), mat.stone, pts.length);
    pts.forEach((p, i) => {
      const y = terrainHeight(p.x, p.z);
      dummy.position.set(p.x, y + p.s * .08, p.z); dummy.rotation.set((rng() - .5) * .45, rng() * 6.28, (rng() - .5) * .3); dummy.scale.set(p.s, p.s * (.65 + rng() * .5), p.s * (.7 + rng() * .65)); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (p.s > 0.5) collision.add({ x: p.x, z: p.z, radius: p.s * .64, bottom: y - .2, top: y + p.s * .55 });
    });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); scene.add(mesh);
  }

  // Boulder outcrops near stream and road bends - stream at -4200 west side
  const outcrops: [number, number, number][] = [
    [-28, -14, 1.6], [24, -12, 1.4], [-18, 24, 1.8], [34, 16, 1.5], [8, 26, 1.7], [-40, 4, 2.0],
    [-4200, 200, 1.8], [-4150, 600, 2.1], [-4250, -200, 1.9], // near stream west side of both trails
    [4000, 50, 2.2], [8000, 4000, 2.5] // along main trail
  ];
  for (const [cx, cz, base] of outcrops) {
    const count = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2, r = rng() * 2.8;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, s = base * (.55 + rng() * .8);
      if (pathDistanceFast(x, z) < 1.5) continue;
      const y = terrainHeight(x, z);
      dummy.position.set(x, y + s * .06, z); dummy.rotation.set((rng() - .5) * .5, rng() * 6.28, (rng() - .5) * .35); dummy.scale.set(s, s * (.6 + rng() * .45), s * (.7 + rng() * .5)); dummy.updateMatrix();
      const mesh = new THREE.Mesh(rockGeometry(77 + i), mat.stone); mesh.scale.copy(dummy.scale); mesh.position.copy(dummy.position); mesh.rotation.copy(dummy.rotation);
      mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
      collision.add({ x, z, radius: s * .7, bottom: y - .3, top: y + s * .6 });
    }
  }

  // Pebbles along main trail
  const pebbleGeo = new THREE.IcosahedronGeometry(1, 0);
  pebbleGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pebbleGeo.getAttribute('position').count * 3).fill(.72), 3));
  const pebbles = new THREE.InstancedMesh(pebbleGeo, mat.stone, 1800);
  let n = 0;
  for (let i = 0; i < 30000 && n < 1800; i++) {
    const x = (rng() - .5) * 600, z = (rng() - .5) * 600;
    const d = pathDistanceFast(x, z);
    if (d < -0.5 || d > 2.2) continue;
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
  for (let i = 0; i < 60000 && points.length < 8000; i++) {
    const x = (rng() - .5) * 800, z = (rng() - .5) * 800;
    const d = pathDistanceFast(x, z);
    const ds = distanceToStreamFast(x, z);
    if (d < -.2 || d > 28 || ds < STREAM_WIDTH) continue;
    if (terrainSlope(x, z) > 1.45) continue;
    const far = 1 - smoothstep01((Math.hypot(x - SPAWN.x, z - SPAWN.z) - 120) / 400);
    if (rng() > (.52 + noise(x * .4, z * .4) * .45) * (d > 6 ? .55 : 1) * (.35 + far * .65)) continue;
    points.push({ x, z, s: .55 + rng() * 1.3 });
  }
  points.sort((a, b) => pathDistanceFast(a.x, a.z) - pathDistanceFast(b.x, b.z));
  const mesh = new THREE.InstancedMesh(grassGeometry(), mat.grass, points.length), dummy = new THREE.Object3D();
  points.forEach((p, i) => {
    dummy.position.set(p.x, terrainHeight(p.x, p.z) - .025, p.z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.setScalar(p.s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.receiveShadow = true; mesh.computeBoundingSphere(); mesh.name = 'Individual windblown grass blades - 2 mile forest'; scene.add(mesh); return mesh;
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
  for (let i = 0; i < 20000 && points.length < 800; i++) {
    const x = (rng() - .5) * 600, z = (rng() - .52) * 600, d = pathDistanceFast(x, z);
    const ds = distanceToStreamFast(x, z);
    if (d < .25 || d > 12 || ds < STREAM_WIDTH + 1) continue;
    if (terrainSlope(x, z) > 1.25) continue;
    points.push({ x, z, s: .42 + rng() * .68 });
  }
  points.sort((a, b) => pathDistanceFast(a.x, a.z) - pathDistanceFast(b.x, b.z));
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
  for (let i = 0; i < 20000 && points.length < 600; i++) {
    const x = (rng() - .5) * 800, z = (rng() - .55) * 800, d = pathDistanceFast(x, z);
    const ds = distanceToStreamFast(x, z);
    if (d < .6 || d > 14 || ds < STREAM_WIDTH + 1) continue;
    points.push(new THREE.Vector3(x, terrainHeight(x, z), z));
  }
  const mesh = new THREE.InstancedMesh(b.geometry(), mat.leaves, points.length), dummy = new THREE.Object3D();
  points.forEach((p, i) => {
    dummy.position.copy(p); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.setScalar(.7 + rng() * 1.1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.userData.density = { total: points.length, performance: .45, balanced: .8 };
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = mat.leafDepth; mesh.computeBoundingSphere(); scene.add(mesh);

  const flowerGeo = new THREE.SphereGeometry(.027, 5, 4), flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ color: '#d3d2b1', roughness: .9 }), 400);
  let n = 0;
  for (let i = 0; i < 10000 && n < 400; i++) {
    const x = (rng() - .5) * 300, z = (rng() - .5) * 300, d = pathDistanceFast(x, z);
    if (d < .35 || d > 3.4) continue;
    dummy.position.set(x, terrainHeight(x, z) + .15 + rng() * .2, z); dummy.scale.set(1, .5, 1); dummy.updateMatrix(); flowers.setMatrixAt(n++, dummy.matrix);
  }
  flowers.count = n; flowers.computeBoundingSphere(); scene.add(flowers);
}

const DEADWOOD: [number, number, number, number][] = [
  [-5, -2.6, .4, 3.3], [1, 8.1, 1.6, 3], [13, -11.5, .8, 2.6], [-16, 9.3, 2, 2.8],
  [-30, -18, .9, 3.4], [26, 12, 2.4, 2.8], [36, -14, 1.2, 3.1],
  [-4200, 300, 0.5, 4.2], [-4220, 500, 1.2, 3.8] // near stream west side
];

function createDeadwood(scene: THREE.Scene, mat: Materials, collision: CollisionField, rng: Rng) {
  for (const [x, z, angle, length] of DEADWOOD) {
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

function createUndergrowth(scene: THREE.Scene, mat: Materials, rng: Rng) {
  const dummy = new THREE.Object3D();
  const stumpGeo = new THREE.CylinderGeometry(.24, .3, .5, 10);
  const topGeo = new THREE.CircleGeometry(.23, 10);
  const stumps = new THREE.InstancedMesh(stumpGeo, mat.bark, 24);
  const tops = new THREE.InstancedMesh(topGeo, new THREE.MeshStandardMaterial({ color: '#a08a63', roughness: 1 }), 24);
  let s = 0;
  for (let i = 0; i < 6000 && s < 24; i++) {
    const x = (rng() - .5) * 600, z = (rng() - .5) * 600;
    if (pathDistanceFast(x, z) < 1.2 || pathDistanceFast(x, z) > 12) continue;
    if (distanceToStreamFast(x, z) < STREAM_WIDTH + 2) continue;
    const y = terrainHeight(x, z);
    dummy.position.set(x, y + .18, z); dummy.rotation.set((rng() - .5) * .1, rng() * 6.28, (rng() - .5) * .1); dummy.scale.setScalar(.7 + rng() * .8); dummy.updateMatrix();
    stumps.setMatrixAt(s, dummy.matrix);
    dummy.position.y = y + .44 * dummy.scale.x; dummy.updateMatrix(); tops.setMatrixAt(s, dummy.matrix);
    s++;
  }
  stumps.count = s; tops.count = s;
  stumps.castShadow = true; stumps.receiveShadow = true; tops.receiveShadow = true;
  stumps.computeBoundingSphere(); tops.computeBoundingSphere(); scene.add(stumps, tops);

  const shroomGeo = new THREE.SphereGeometry(.045, 6, 4);
  const shrooms = new THREE.InstancedMesh(shroomGeo, new THREE.MeshStandardMaterial({ color: '#c9b18b', roughness: .8 }), 180);
  let m = 0;
  const ring = (cx: number, cz: number, r: number, count: number) => {
    for (let i = 0; i < count && m < 180; i++) {
      const a = rng() * Math.PI * 2, rr = r * (.6 + rng() * .8);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      if (distanceToStreamFast(x, z) < 1) continue;
      dummy.position.set(x, terrainHeight(x, z) + .02, z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.set(.5, .9 + rng() * .5, .5); dummy.updateMatrix();
      shrooms.setMatrixAt(m++, dummy.matrix);
    }
  };
  for (const [x, z, , ] of DEADWOOD.slice(0, 5)) ring(x, z, .9, 12);
  for (let i = 0; i < 20 && m < 180; i++) ring((rng() - .5) * 400, (rng() - .5) * 400, .6, 8);
  shrooms.count = m; shrooms.computeBoundingSphere(); scene.add(shrooms);

  // Stream vegetation - reeds and water plants
  const reedGeo = new THREE.CylinderGeometry(0.015, 0.02, 1.2, 4);
  const reedMat = new THREE.MeshStandardMaterial({ color: '#4a6b3a', roughness: 0.9 });
  const reeds = new THREE.InstancedMesh(reedGeo, reedMat, 300);
  let rc = 0;
  for (let i = 0; i < 5000 && rc < 300; i++) {
    const t = rng();
    const idx = Math.floor(t * (STREAM.length - 1));
    const a = STREAM[idx];
    const b = STREAM[Math.min(STREAM.length - 1, idx + 1)];
    const f = (t * (STREAM.length - 1)) % 1;
    const x = a.x + (b.x - a.x) * f + (rng() - 0.5) * 6;
    const z = a.z + (b.z - a.z) * f + (rng() - 0.5) * 6;
    const d = distanceToStream(x, z);
    if (d < STREAM_WIDTH * 0.8 || d > STREAM_WIDTH + 2.5) continue;
    const y = terrainHeight(x, z);
    dummy.position.set(x, y + 0.6, z);
    dummy.rotation.set((rng() - 0.5) * 0.2, rng() * 6.28, (rng() - 0.5) * 0.2);
    dummy.scale.setScalar(0.7 + rng() * 0.6);
    dummy.updateMatrix();
    reeds.setMatrixAt(rc++, dummy.matrix);
  }
  reeds.count = rc;
  reeds.castShadow = true;
  reeds.receiveShadow = true;
  reeds.computeBoundingSphere();
  scene.add(reeds);

  // Bent sapling at clearing edge
  const sap = new Builder();
  const sx = 6.9, sz = -1.9;
  tube(sap, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(.35, .5, .1), new THREE.Vector3(.9, .95, .3), new THREE.Vector3(1.35, 1.1, .55)], .045, .02, 6, 6);
  const sapMesh = new THREE.Mesh(sap.geometry(), mat.bark);
  sapMesh.position.set(sx, terrainHeight(sx, sz) + .05, sz); sapMesh.rotation.y = .8; sapMesh.castShadow = true; sapMesh.receiveShadow = true; scene.add(sapMesh);
}

// Photorealistic stream with running water - incredible visual
function createStream(scene: THREE.Scene, mat: Materials) {
  // Stream bed - darker damp earth ribbon
  const bedGeo = new THREE.BufferGeometry();
  const bedPos: number[] = [], bedUv: number[] = [], bedColor: number[] = [], bedIndex: number[] = [];
  const bankGeo = new THREE.BufferGeometry();
  const bankPos: number[] = [], bankUv: number[] = [], bankColor: number[] = [], bankIndex: number[] = [];

  const segPerSection = 12;
  for (let i = 0; i < STREAM.length - 1; i++) {
    const a = STREAM[i], b = STREAM[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;

    for (let j = 0; j < segPerSection; j++) {
      const t0 = j / segPerSection, t1 = (j + 1) / segPerSection;
      const x0 = a.x + dx * t0, z0 = a.z + dz * t0;
      const x1 = a.x + dx * t1, z1 = a.z + dz * t1;

      const wBed = STREAM_WIDTH * (0.85 + noise(x0 * 0.08, z0 * 0.08) * 0.3);
      const wBank = STREAM_BANK_WIDTH * (0.9 + noise(x0 * 0.05, z0 * 0.05) * 0.25);

      // Stream bed (inner)
      const addQuad = (xA: number, zA: number, xB: number, zB: number, xC: number, zC: number, xD: number, zD: number, arrP: number[], arrUv: number[], arrC: number[], arrI: number[], yOffset: number, color: [number, number, number]) => {
        const base = arrP.length / 3;
        const yA = terrainHeight(xA, zA) + yOffset;
        const yB = terrainHeight(xB, zB) + yOffset;
        const yC = terrainHeight(xC, zC) + yOffset;
        const yD = terrainHeight(xD, zD) + yOffset;
        arrP.push(xA, yA, zA, xB, yB, zB, xC, yC, zC, xD, yD, zD);
        const uScale = 0.15;
        arrUv.push(xA * uScale, zA * uScale, xB * uScale, zB * uScale, xC * uScale, zC * uScale, xD * uScale, zD * uScale);
        for (let k = 0; k < 4; k++) arrC.push(color[0], color[1], color[2]);
        arrI.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };

      // Bed
      const bedA = { x: x0 + nx * -wBed, z: z0 + nz * -wBed };
      const bedB = { x: x0 + nx * wBed, z: z0 + nz * wBed };
      const bedC = { x: x1 + nx * wBed, z: z1 + nz * wBed };
      const bedD = { x: x1 + nx * -wBed, z: z1 + nz * -wBed };
      addQuad(bedA.x, bedA.z, bedB.x, bedB.z, bedC.x, bedC.z, bedD.x, bedD.z, bedPos, bedUv, bedColor, bedIndex, -0.18, [0.42, 0.38, 0.34]);

      // Banks (left and right)
      const bankL1 = { x: x0 + nx * -wBank, z: z0 + nz * -wBank };
      const bankL2 = { x: x0 + nx * -wBed, z: z0 + nz * -wBed };
      const bankL3 = { x: x1 + nx * -wBed, z: z1 + nz * -wBed };
      const bankL4 = { x: x1 + nx * -wBank, z: z1 + nz * -wBank };
      addQuad(bankL1.x, bankL1.z, bankL2.x, bankL2.z, bankL3.x, bankL3.z, bankL4.x, bankL4.z, bankPos, bankUv, bankColor, bankIndex, 0.02, [0.38, 0.32, 0.26]);

      const bankR1 = { x: x0 + nx * wBed, z: z0 + nz * wBed };
      const bankR2 = { x: x0 + nx * wBank, z: z0 + nz * wBank };
      const bankR3 = { x: x1 + nx * wBank, z: z1 + nz * wBank };
      const bankR4 = { x: x1 + nx * wBed, z: z1 + nz * wBed };
      addQuad(bankR1.x, bankR1.z, bankR2.x, bankR2.z, bankR3.x, bankR3.z, bankR4.x, bankR4.z, bankPos, bankUv, bankColor, bankIndex, 0.02, [0.38, 0.32, 0.26]);
    }
  }

  bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(bedPos, 3));
  bedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bedUv, 2));
  bedGeo.setAttribute('color', new THREE.Float32BufferAttribute(bedColor, 3));
  bedGeo.setIndex(bedIndex);
  bedGeo.computeVertexNormals();
  const bedMesh = new THREE.Mesh(bedGeo, mat.streamBed);
  bedMesh.receiveShadow = true;
  bedMesh.name = 'Stream bed - photorealistic';
  scene.add(bedMesh);

  bankGeo.setAttribute('position', new THREE.Float32BufferAttribute(bankPos, 3));
  bankGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bankUv, 2));
  bankGeo.setAttribute('color', new THREE.Float32BufferAttribute(bankColor, 3));
  bankGeo.setIndex(bankIndex);
  bankGeo.computeVertexNormals();
  const bankMesh = new THREE.Mesh(bankGeo, new THREE.MeshStandardMaterial({ color: '#5a4d3d', roughness: 0.95, vertexColors: true }));
  bankMesh.receiveShadow = true;
  bankMesh.name = 'Stream banks';
  scene.add(bankMesh);

  // Water surface - photorealistic running water
  const waterGeo = new THREE.BufferGeometry();
  const wPos: number[] = [], wUv: number[] = [], wIndex: number[] = [];

  for (let i = 0; i < STREAM.length - 1; i++) {
    const a = STREAM[i], b = STREAM[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;

    const w = STREAM_WIDTH * 0.92;
    const x0 = a.x, z0 = a.z, x1 = b.x, z1 = b.z;

    const y0 = terrainHeight(x0, z0) - 0.08;
    const y1 = terrainHeight(x1, z1) - 0.08;

    const base = wPos.length / 3;
    // Quad with slight flow direction
    wPos.push(
      x0 + nx * -w, y0, z0 + nz * -w,
      x0 + nx * w, y0, z0 + nz * w,
      x1 + nx * w, y1, z1 + nz * w,
      x1 + nx * -w, y1, z1 + nz * -w
    );
    // UVs: x = across stream (0-1), y = along stream (flow)
    const along0 = i / STREAM.length;
    const along1 = (i + 1) / STREAM.length;
    wUv.push(0, along0 * 8, 1, along0 * 8, 1, along1 * 8, 0, along1 * 8);
    wIndex.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  waterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  waterGeo.setIndex(wIndex);
  waterGeo.computeVertexNormals();

  const waterMesh = new THREE.Mesh(waterGeo, mat.water);
  waterMesh.name = 'Photorealistic running stream - incredible water';
  waterMesh.renderOrder = 2;
  waterMesh.frustumCulled = false;
  scene.add(waterMesh);

  // Add water foam particles / spray near rocks
  const foamGeo = new THREE.BufferGeometry();
  const foamPos: number[] = [];
  const rng = seededRandom(999);
  for (let i = 0; i < 120; i++) {
    const t = rng();
    const idx = Math.floor(t * (STREAM.length - 1));
    const a = STREAM[idx], b = STREAM[Math.min(STREAM.length - 1, idx + 1)];
    const f = rng();
    const x = a.x + (b.x - a.x) * f + (rng() - 0.5) * STREAM_WIDTH * 1.5;
    const z = a.z + (b.z - a.z) * f + (rng() - 0.5) * STREAM_WIDTH * 1.5;
    const y = terrainHeight(x, z) - 0.05 + rng() * 0.08;
    foamPos.push(x, y, z);
  }
  foamGeo.setAttribute('position', new THREE.Float32BufferAttribute(foamPos, 3));
  const foamMat = new THREE.PointsMaterial({ color: '#e8f4f8', size: 0.18, transparent: true, opacity: 0.65, sizeAttenuation: true });
  const foamPoints = new THREE.Points(foamGeo, foamMat);
  foamPoints.name = 'Stream foam spray';
  scene.add(foamPoints);

  // Stones in stream for realism
  const streamRocks = new THREE.InstancedMesh(rockGeometry(91), mat.stone, 80);
  const dummy = new THREE.Object3D();
  let c = 0;
  for (let i = 0; i < 800 && c < 80; i++) {
    const t = rng();
    const idx = Math.floor(t * (STREAM.length - 1));
    const a = STREAM[idx], b = STREAM[Math.min(STREAM.length - 1, idx + 1)];
    const f = (t * (STREAM.length - 1)) % 1;
    const x = a.x + (b.x - a.x) * f + (rng() - 0.5) * STREAM_WIDTH * 0.7;
    const z = a.z + (b.z - a.z) * f + (rng() - 0.5) * STREAM_WIDTH * 0.7;
    const sc = 0.18 + rng() * 0.45;
    dummy.position.set(x, terrainHeight(x, z) - 0.15 + sc * 0.1, z);
    dummy.rotation.set(rng() * 0.4, rng() * 6.28, rng() * 0.4);
    dummy.scale.set(sc, sc * 0.6, sc * 0.8);
    dummy.updateMatrix();
    streamRocks.setMatrixAt(c++, dummy.matrix);
  }
  streamRocks.count = c;
  streamRocks.receiveShadow = true;
  streamRocks.computeBoundingSphere();
  scene.add(streamRocks);
}

// Forest life (birds, butterflies) - keep but expand range
export interface ForestLife {
  update(dt: number, t: number): void;
  birdWings: THREE.InstancedMesh;
  butterflyWings: THREE.InstancedMesh;
  birds: number;
  butterflies: number;
}

export function createForestLife(scene: THREE.Scene, rng: Rng): ForestLife {
  const BIRDS = 8;
  const wingGeo = new THREE.PlaneGeometry(.9, .34);
  wingGeo.rotateX(-Math.PI / 2);
  wingGeo.translate(.45, 0, 0);
  const birdWings = new THREE.InstancedMesh(wingGeo, new THREE.MeshBasicMaterial({ color: '#252b25', side: THREE.DoubleSide }), BIRDS * 2);
  birdWings.frustumCulled = false;
  birdWings.userData.density = { total: BIRDS * 2, performance: .4, balanced: .8 };
  scene.add(birdWings);
  const birds = Array.from({ length: BIRDS }, (_, i) => ({
    cx: (rng() - .5) * 400, cz: (rng() - .5) * 400, r: 80 + rng() * 120,
    h: 28 + rng() * 18, w: (i % 2 ? 1 : -1) * (.04 + rng() * .05),
    phase: rng() * Math.PI * 2, flap: 3.4 + rng() * 2.4, glide: rng() * Math.PI * 2,
    scale: .9 + rng() * .45,
  }));

  const BUTTERFLIES = 14;
  const bfGeo = new THREE.PlaneGeometry(.17, .13);
  bfGeo.rotateX(-Math.PI / 2);
  bfGeo.translate(.085, 0, 0);
  const butterflyWings = new THREE.InstancedMesh(bfGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: .9 }), BUTTERFLIES * 2);
  butterflyWings.frustumCulled = false;
  butterflyWings.userData.density = { total: BUTTERFLIES * 2, performance: .1, balanced: .6 };
  const tints = [new THREE.Color('#efe8cf'), new THREE.Color('#c9d4e8'), new THREE.Color('#e9cddd')];
  for (let i = 0; i < BUTTERFLIES * 2; i++) butterflyWings.setColorAt(i, tints[Math.floor(rng() * 3)]);
  scene.add(butterflyWings);
  const butterflies: { x: number; z: number; u: number; v: number; s: number; rest: number; time: number; sc: number }[] = [];
  for (let i = 0; i < 8000 && butterflies.length < BUTTERFLIES; i++) {
    const x = (rng() - .5) * 300, z = (rng() - .5) * 300, d = pathDistanceFast(x, z);
    if (d < .35 || d > 4) continue;
    butterflies.push({ x, z, u: rng() * Math.PI * 2, v: rng() * Math.PI * 2, s: .55 + rng() * .8, rest: rng() * Math.PI * 2, time: 0, sc: .75 + rng() * .4 });
  }

  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), rot = new THREE.Quaternion(), flapQ = new THREE.Quaternion(), mat4 = new THREE.Matrix4();
  const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const wing = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, flap: number, s: number) => {
    rot.setFromAxisAngle(Y, yaw);
    flapQ.setFromAxisAngle(Z, flap);
    rot.multiply(flapQ);
    pos.set(x, y, z); scl.setScalar(s);
    mat4.compose(pos, rot, scl);
    mesh.setMatrixAt(i, mat4);
  };
  const update = (dt: number, t: number) => {
    for (let i = 0; i < BIRDS; i++) {
      const b = birds[i], th = b.phase + t * b.w, a2 = th + .04 * Math.sign(b.w);
      const px = b.cx + Math.cos(th) * b.r, pz = b.cz + Math.sin(th) * b.r * .72;
      const nx = b.cx + Math.cos(a2) * b.r, nz = b.cz + Math.sin(a2) * b.r * .72;
      const yaw = Math.atan2(px - nx, pz - nz);
      const y = b.h + Math.sin(t * .4 + b.glide) * 2.1 + terrainHeight(px, pz) * 0.1;
      const gliding = Math.sin(t * .21 + b.glide) > .5;
      const f = gliding ? Math.sin(t * b.flap + i) * .1 : Math.sin(t * b.flap + i) * .6;
      wing(birdWings, i * 2, px, y, pz, yaw, f, b.scale);
      wing(birdWings, i * 2 + 1, px, y, pz, yaw + Math.PI, f, b.scale);
    }
    for (let i = 0; i < butterflies.length; i++) {
      const b = butterflies[i];
      const rest = Math.sin(t * .31 + b.rest);
      const active = rest > -.7 ? 1 : Math.max(.1, (rest + .7) / .3);
      b.time += dt * active * b.s;
      const u = b.time, w2 = u * .92 + b.u, w3 = u * .74 + b.v;
      const px = b.x + Math.sin(w2) * 1.15 + Math.sin(u * 2.3 + b.v) * .3;
      const pz = b.z + Math.cos(w3) * 1.15 + Math.cos(u * 1.9 + b.u) * .3;
      const qpx = b.x + Math.sin(u * .92 + .03 + b.u) * 1.15 + Math.sin((u + .03) * 2.3 + b.v) * .3;
      const qpz = b.z + Math.cos(u * .74 + .03 + b.v) * 1.15 + Math.cos((u + .03) * 1.9 + b.u) * .3;
      const yaw = Math.atan2(px - qpx, pz - qpz);
      const y = terrainHeight(px, pz) + .28 + Math.abs(Math.sin(u * 1.3 + b.u)) * .5;
      const f = Math.sin(t * 24 + b.u * 7) * .95 * active + .08;
      wing(butterflyWings, i * 2, px, y, pz, yaw, f, b.sc);
      wing(butterflyWings, i * 2 + 1, px, y, pz, yaw + Math.PI, f, b.sc);
    }
    birdWings.instanceMatrix.needsUpdate = true;
    butterflyWings.instanceMatrix.needsUpdate = true;
  };
  return { update, birdWings, butterflyWings, birds: BIRDS, butterflies: butterflies.length };
}
