// Map-space is continuous, in metres. North is negative Z, South positive Z, East positive X.
// Reference: the supplied Goblin Ambush map, approximately 1.524 m per square.
// Redesigned to match new spec:
// - Single pair of trails: main trail (ROAD) 15ft wide, winding 10 miles then turning right for another 10 miles.
// - Thin trail (TRAIL) 5ft wide, 0.5 miles with traps.
// - At least 2 miles of forest with singular stream on either side.
// - Photorealistic ground placement fixed: road is flat at Y~0, forest gently undulates, no artificial north rise.
export type Point2 = { x: number; z: number };

export const FEET_TO_METRES = 0.3048;
export const MILE_TO_METRES = 1609.344;

// Widths: total width in metres, half-width stored for distance field.
export const ROAD_TOTAL_WIDTH_FT = 15;
export const TRAIL_TOTAL_WIDTH_FT = 5;
export const ROAD_WIDTH = (ROAD_TOTAL_WIDTH_FT * FEET_TO_METRES) / 2; // ~2.286m half
export const TRAIL_WIDTH = (TRAIL_TOTAL_WIDTH_FT * FEET_TO_METRES) / 2; // ~0.762m half

// Corridor to keep clear for wagon/character
export const ROAD_CORRIDOR = ROAD_WIDTH + 1.8;
export const TRAIL_CORRIDOR = TRAIL_WIDTH + 0.6;

// World extents - large enough for 10+10 mile road (32km) but clamped for performance.
// We use 18000m radius (~11 miles) which covers 10 miles east + 10 miles south from spawn.
// Actual road length will be ~ 16km + 16km = 32km.
export const WORLD_EXTENT = 18000;
export const WORLD_LIMIT = WORLD_EXTENT; // legacy compat
export const MAP_BOUNDS = { minX: -9000, maxX: 18000, minZ: -4000, maxZ: 18000 };

export const TRAIL_PLAYABLE_LENGTH_METRES = 804; // 0.5 mile
export const ROAD_PLAYABLE_LENGTH_METRES = 32186; // 20 miles total

// Spawn on main trail, near origin, facing east along main trail.
export const SPAWN = { x: 0, z: 0, yaw: -Math.PI / 2 }; // yaw -90deg = facing east (+X)

// --- Utility math ---
export function seededRandom(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(a: number, b: number, v: number) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smoothstep(0, 1, x - ix), fy = smoothstep(0, 1, y - iy);
  return lerp(lerp(hash(ix, iy), hash(ix + 1, iy), fx), lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
}
export function fbm(x: number, z: number) {
  return noise(x, z) * .57 + noise(x * 2.03 + 7.3, z * 2.03 + 3.8) * .28 + noise(x * 4.07 + 2.1, z * 4.07) * .15;
}
export function sampleCurve(points: Point2[], steps = 8): Point2[] {
  const result: Point2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < steps; j++) {
      const t = j / steps, t2 = t * t, t3 = t2 * t;
      const component = (a: number, b: number, c: number, d: number) => .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      result.push({ x: component(p0.x, p1.x, p2.x, p3.x), z: component(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

// --- Road generation ---
// Main trail: 10 miles east winding, then 10 miles south (right turn when heading east).
function generateMainRoad(): Point2[] {
  const points: Point2[] = [];
  const firstLegMiles = 10;
  const secondLegMiles = 10;
  const firstLegMetres = firstLegMiles * MILE_TO_METRES; // 16093
  const secondLegMetres = secondLegMiles * MILE_TO_METRES;

  // First leg: west (-firstLeg/2) to east (+firstLeg/2) winding.
  // Spawn at 0,0 lies on this leg - force road through origin for correct ground placement.
  const startX = -firstLegMetres / 2; // -8046
  const endX = firstLegMetres / 2; // +8046
  const segments1 = 48;
  // Compute offset at X=0 to force road through (0,0)
  const offsetAtZero = Math.sin(0 * 0.0011) * 85 + Math.sin(0 * 0.0027 + 1.3) * 38 + Math.sin(0 * 0.00055 + 0.7) * 55 + Math.cos(0 * 0.0009) * 22;
  for (let i = 0; i <= segments1; i++) {
    const t = i / segments1;
    const x = lerp(startX, endX, t);
    const w1 = Math.sin(x * 0.0011) * 85;
    const w2 = Math.sin(x * 0.0027 + 1.3) * 38;
    const w3 = Math.sin(x * 0.00055 + 0.7) * 55;
    const w4 = Math.cos(x * 0.0009) * 22;
    const z = w1 + w2 + w3 + w4 - offsetAtZero; // now at X=0, Z=0
    points.push({ x, z });
  }

  // Second leg: turn right (south). Heading east, right is south (+Z).
  const turnX = endX;
  const turnZ = points[points.length - 1].z;
  const segments2 = 48;
  for (let i = 1; i <= segments2; i++) {
    const t = i / segments2;
    const z = turnZ + t * secondLegMetres;
    const w1 = Math.sin(z * 0.0010 + 2.1) * 95;
    const w2 = Math.sin(z * 0.0025 + 0.4) * 42;
    const w3 = Math.cos(z * 0.0007) * 60;
    const x = turnX + w1 + w2 + w3;
    points.push({ x, z });
  }
  return points;
}

// Thin trail: 0.5 mile north from main trail near spawn, with traps.
function generateThinTrail(): Point2[] {
  const points: Point2[] = [];
  const mouthX = 12; // just east of spawn, north side of main trail
  const mouthZ = -6; // north is negative Z
  const length = 0.5 * MILE_TO_METRES; // 804m
  const segments = 18;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const z = mouthZ - t * length; // go north (negative)
    // Winding westward slightly as it goes deeper
    const x = mouthX + Math.sin(t * Math.PI * 2.2) * 18 + Math.sin(t * Math.PI * 4.5) * 8 - t * 35;
    points.push({ x, z });
  }
  return points;
}

// Stream: singular stream somewhere in middle of forest, either side of both paths.
// Place it clearly off both trails, running roughly north-south but meandering, with 2 miles forest around.
// Stream should be photorealistic with running water. Must NOT cross main 15ft road.
// Previous baseX -1800 intersected road at X -1800 Z~-173, so move to -4200 west side.
function generateStream(): Point2[] {
  const points: Point2[] = [];
  // Place stream west of spawn, at X ~ -4200, winding north-south for ~2.5 miles, safely west of main road (-8046 to +8046)
  const streamLength = 2.5 * MILE_TO_METRES; // ~4023m
  const startZ = -1500;
  const endZ = startZ + streamLength;
  const baseX = -4200; // west of main trail, in forest, clear of both trails (main at ~-173 Z at this X, thin at X 12 to -23)
  const segments = 36;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const z = lerp(startZ, endZ, t);
    const x = baseX + Math.sin(z * 0.0013) * 120 + Math.sin(z * 0.0031 + 1.1) * 55 + Math.cos(z * 0.0008) * 70;
    points.push({ x, z });
  }
  return points;
}

export const ROAD_POINTS: Point2[] = generateMainRoad();
export const TRAIL_POINTS: Point2[] = generateThinTrail();
export const STREAM_POINTS: Point2[] = generateStream();

export const STREAM_WIDTH = 2.8; // half-width? total ~5.6m wide stream
export const STREAM_BANK_WIDTH = 4.5;
export const STREAM_DEPTH = 1.2;

export const ROAD = sampleCurve(ROAD_POINTS, 10);
export const TRAIL = sampleCurve(TRAIL_POINTS, 10);
export const STREAM = sampleCurve(STREAM_POINTS, 10);

export const LANDMARKS = [
  { id: 'ambush', name: 'The ambush clearing', x: 6, z: 0, radius: 6 },
  { id: 'cragmaw', name: 'Cragmaw trail', x: 12, z: -12, radius: 4 },
  { id: 'stream', name: 'Forest stream', x: -4200, z: 500, radius: 25 },
  { id: 'main-east', name: 'Eastern stretch', x: 4000, z: 0, radius: 12 },
  { id: 'main-south', name: 'Southern turn', x: 8046, z: 8000, radius: 20 },
  { id: 'phandalin', name: 'The road to Phandalin', x: 8000, z: 16000, radius: 15 },
] as const;

// Cumulative distances for trail logic
const cumulativeTrail = (() => {
  const values = [0];
  for (let i = 1; i < TRAIL.length; i++) {
    values.push(values[i - 1] + Math.hypot(TRAIL[i].x - TRAIL[i - 1].x, TRAIL[i].z - TRAIL[i - 1].z));
  }
  return values;
})();
const cumulativeRoad = (() => {
  const values = [0];
  for (let i = 1; i < ROAD.length; i++) {
    values.push(values[i - 1] + Math.hypot(ROAD[i].x - ROAD[i - 1].x, ROAD[i].z - ROAD[i - 1].z));
  }
  return values;
})();
const cumulativeStream = (() => {
  const values = [0];
  for (let i = 1; i < STREAM.length; i++) {
    values.push(values[i - 1] + Math.hypot(STREAM[i].x - STREAM[i - 1].x, STREAM[i].z - STREAM[i - 1].z));
  }
  return values;
})();

export function trailDistanceAlong(x: number, z: number) {
  let best = Infinity, progress = Infinity;
  for (let i = 0; i < TRAIL.length - 1; i++) {
    const a = TRAIL[i], b = TRAIL[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; progress = cumulativeTrail[i] + Math.sqrt(len2) * t; }
  }
  return best <= TRAIL_WIDTH + 1.8 ? progress : Infinity;
}

export function trailPointAtDistance(distance: number): Point2 {
  const target = clamp(distance, 0, cumulativeTrail[cumulativeTrail.length - 1]);
  for (let i = 1; i < cumulativeTrail.length; i++) {
    if (target <= cumulativeTrail[i]) {
      const span = cumulativeTrail[i] - cumulativeTrail[i - 1] || 1;
      const t = (target - cumulativeTrail[i - 1]) / span;
      return { x: lerp(TRAIL[i - 1].x, TRAIL[i].x, t), z: lerp(TRAIL[i - 1].z, TRAIL[i].z, t) };
    }
  }
  return { ...TRAIL[TRAIL.length - 1] };
}

export function roadDistanceAlong(x: number, z: number) {
  let best = Infinity, progress = Infinity;
  for (let i = 0; i < ROAD.length - 1; i++) {
    const a = ROAD[i], b = ROAD[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; progress = cumulativeRoad[i] + Math.sqrt(len2) * t; }
  }
  return best <= ROAD_WIDTH + 2.5 ? progress : Infinity;
}

export function distanceToPath(x: number, z: number, path: Point2[]) {
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
    const d = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
    if (d < min) min = d;
  }
  return Math.sqrt(min);
}

// Fast approximate distance using control points first, then exact if close
export function distanceToPathFast(x: number, z: number, path: Point2[], control: Point2[], threshold = 80) {
  // Coarse check against control points
  let coarseMin = Infinity;
  for (let i = 0; i < control.length; i++) {
    const dx = x - control[i].x, dz = z - control[i].z;
    const d2 = dx * dx + dz * dz;
    if (d2 < coarseMin) coarseMin = d2;
  }
  const coarse = Math.sqrt(coarseMin);
  if (coarse > threshold) return coarse; // far, approximate is enough
  return distanceToPath(x, z, path);
}

export function distanceToStream(x: number, z: number) {
  return distanceToPath(x, z, STREAM);
}
export function distanceToStreamFast(x: number, z: number) {
  return distanceToPathFast(x, z, STREAM, STREAM_POINTS, 120);
}

export function pathDistance(x: number, z: number) {
  // Main trail and thin trail only - stream is not a walkable path, it's a hazard/landmark
  return Math.min(distanceToPath(x, z, ROAD) - ROAD_WIDTH, distanceToPath(x, z, TRAIL) - TRAIL_WIDTH);
}
export function pathDistanceFast(x: number, z: number) {
  const dRoad = distanceToPathFast(x, z, ROAD, ROAD_POINTS, 100) - ROAD_WIDTH;
  const dTrail = distanceToPathFast(x, z, TRAIL, TRAIL_POINTS, 60) - TRAIL_WIDTH;
  return Math.min(dRoad, dTrail);
}

export function pathAmount(x: number, z: number) {
  const irregular = (noise(x * 2.3, z * 2.3) - .5) * .38 + (noise(x * 6, z * 6) - .5) * .12;
  return 1 - smoothstep(-.24, .44, pathDistance(x, z) + irregular);
}

export function streamAmount(x: number, z: number) {
  const d = distanceToStream(x, z);
  return 1 - smoothstep(STREAM_WIDTH * 0.8, STREAM_WIDTH * 2.2, d);
}

export function terrainHeight(x: number, z: number) {
  // Gentle photorealistic hills - reduced amplitude to keep quadruped rig stable and ground placement correct
  const largeHill = fbm(x * 0.0035, z * 0.0035) * 3.2;
  const mediumHill = fbm(x * 0.015, z * 0.015) * 0.9;
  const detail = (fbm(x * 0.12, z * 0.12) - 0.5) * 0.28;
  const micro = (noise(x * 0.8, z * 0.8) - 0.5) * 0.08;

  let height = largeHill + mediumHill + detail + micro;

  const dRoad = distanceToPathFast(x, z, ROAD, ROAD_POINTS, 100);
  const roadFactor = 1 - smoothstep(ROAD_WIDTH - 0.3, ROAD_WIDTH + 2.2, dRoad);
  if (roadFactor > 0.001) {
    const roadLevel = 0;
    const camber = (1 - Math.abs(dRoad) / ROAD_WIDTH) * 0.03;
    height = lerp(height, roadLevel + camber, roadFactor * 0.92);
    const shoulder = smoothstep(ROAD_WIDTH, ROAD_WIDTH + 3.5, dRoad) * smoothstep(ROAD_WIDTH + 8, ROAD_WIDTH + 2, dRoad);
    height += shoulder * 0.18;
  }

  const dTrail = distanceToPathFast(x, z, TRAIL, TRAIL_POINTS, 60);
  const trailFactor = 1 - smoothstep(TRAIL_WIDTH - 0.1, TRAIL_WIDTH + 1.1, dTrail);
  if (trailFactor > 0.001) {
    height = lerp(height, 0, trailFactor * 0.85);
  }

  const dStream = distanceToStreamFast(x, z);
  if (dStream < STREAM_BANK_WIDTH + 8) {
    const bankFactor = 1 - smoothstep(STREAM_WIDTH, STREAM_BANK_WIDTH + 6, dStream);
    const channelFactor = 1 - smoothstep(0, STREAM_WIDTH * 1.2, dStream);
    height += bankFactor * 0.45;
    height -= channelFactor * STREAM_DEPTH * 0.9;
    if (dStream < STREAM_WIDTH) {
      height -= (1 - dStream / STREAM_WIDTH) * 0.3;
    }
  }

  const spawnDist = Math.hypot(x - SPAWN.x, z - SPAWN.z);
  if (spawnDist < 50) {
    const spawnBlend = 1 - smoothstep(0, 50, spawnDist);
    height = lerp(height, 0, spawnBlend * 0.75);
  }

  return height;
}

export function terrainHeightAccurate(x: number, z: number) {
  const largeHill = fbm(x * 0.0035, z * 0.0035) * 3.2;
  const mediumHill = fbm(x * 0.015, z * 0.015) * 0.9;
  const detail = (fbm(x * 0.12, z * 0.12) - 0.5) * 0.28;
  const micro = (noise(x * 0.8, z * 0.8) - 0.5) * 0.08;
  let height = largeHill + mediumHill + detail + micro;
  const dRoad = distanceToPath(x, z, ROAD);
  const roadFactor = 1 - smoothstep(ROAD_WIDTH - 0.3, ROAD_WIDTH + 2.2, dRoad);
  if (roadFactor > 0.001) {
    const roadLevel = 0;
    const camber = (1 - Math.abs(dRoad) / ROAD_WIDTH) * 0.03;
    height = lerp(height, roadLevel + camber, roadFactor * 0.92);
    const shoulder = smoothstep(ROAD_WIDTH, ROAD_WIDTH + 3.5, dRoad) * smoothstep(ROAD_WIDTH + 8, ROAD_WIDTH + 2, dRoad);
    height += shoulder * 0.18;
  }
  const dTrail = distanceToPath(x, z, TRAIL);
  const trailFactor = 1 - smoothstep(TRAIL_WIDTH - 0.1, TRAIL_WIDTH + 1.1, dTrail);
  if (trailFactor > 0.001) {
    height = lerp(height, 0, trailFactor * 0.85);
  }
  const dStream = distanceToStream(x, z);
  if (dStream < STREAM_BANK_WIDTH + 8) {
    const bankFactor = 1 - smoothstep(STREAM_WIDTH, STREAM_BANK_WIDTH + 6, dStream);
    const channelFactor = 1 - smoothstep(0, STREAM_WIDTH * 1.2, dStream);
    height += bankFactor * 0.45;
    height -= channelFactor * STREAM_DEPTH * 0.9;
    if (dStream < STREAM_WIDTH) {
      height -= (1 - dStream / STREAM_WIDTH) * 0.3;
    }
  }
  const spawnDist = Math.hypot(x - SPAWN.x, z - SPAWN.z);
  if (spawnDist < 50) {
    const spawnBlend = 1 - smoothstep(0, 50, spawnDist);
    height = lerp(height, 0, spawnBlend * 0.75);
  }
  return height;
}

export function terrainSlope(x: number, z: number) {
  const e = .22;
  return Math.hypot((terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e), (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e));
}

export interface Collider { x: number; z: number; radius: number; bottom: number; top: number; group?: string }
export class CollisionField {
  private cells = new Map<string, Collider[]>();
  private cellSize = 6; // larger cell for larger world
  private dynamic = new Map<string, Collider[]>();
  setDynamic(id: string, colliders: Collider[]) { this.dynamic.set(id, colliders); }
  removeDynamic(id: string) { this.dynamic.delete(id); }
  add(c: Collider) {
    const s = this.cellSize;
    for (let x = Math.floor((c.x - c.radius) / s); x <= Math.floor((c.x + c.radius) / s); x++)
      for (let z = Math.floor((c.z - c.radius) / s); z <= Math.floor((c.z + c.radius) / s); z++) {
        const key = `${x},${z}`;
        const cell = this.cells.get(key) ?? [];
        cell.push(c); this.cells.set(key, cell);
      }
  }
  query(x: number, z: number, radius = .35) {
    const found = new Set<Collider>(), s = this.cellSize;
    for (let a = Math.floor((x - radius) / s); a <= Math.floor((x + radius) / s); a++)
      for (let b = Math.floor((z - radius) / s); b <= Math.floor((z + radius) / s); b++)
        for (const c of this.cells.get(`${a},${b}`) ?? []) found.add(c);
    for (const group of this.dynamic.values()) for (const c of group) {
      if (Math.abs(c.x - x) <= c.radius + radius && Math.abs(c.z - z) <= c.radius + radius) found.add(c);
    }
    return found;
  }
  resolve(x: number, z: number, feet: number, radius = .32): Point2 {
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.query(x, z, radius)) {
        if (feet >= c.top - .03 || feet + 1.55 <= c.bottom) continue;
        const dx = x - c.x, dz = z - c.z, dist = Math.hypot(dx, dz), limit = c.radius + radius;
        if (dist < limit) {
          if (dist < .0001) x += limit;
          else { x += dx / dist * (limit - dist); z += dz / dist * (limit - dist); }
        }
      }
    }
    return { x: clamp(x, -WORLD_EXTENT, WORLD_EXTENT), z: clamp(z, -WORLD_EXTENT, WORLD_EXTENT) };
  }
  cameraBlocked(x: number, y: number, z: number, ignoreGroup?: string) {
    if (y < terrainHeight(x, z) + .24) return true;
    for (const c of this.query(x, z, .18)) {
      if (ignoreGroup && c.group === ignoreGroup) continue;
      if (y > c.bottom && y < c.top && Math.hypot(x - c.x, z - c.z) < c.radius + .2) return true;
    }
    return false;
  }
}

// Stream helpers for water mesh
export function streamPointAtDistance(distance: number): Point2 {
  const target = clamp(distance, 0, cumulativeStream[cumulativeStream.length - 1]);
  for (let i = 1; i < cumulativeStream.length; i++) {
    if (target <= cumulativeStream[i]) {
      const span = cumulativeStream[i] - cumulativeStream[i - 1] || 1;
      const t = (target - cumulativeStream[i - 1]) / span;
      return { x: lerp(STREAM[i - 1].x, STREAM[i].x, t), z: lerp(STREAM[i - 1].z, STREAM[i].z, t) };
    }
  }
  return { ...STREAM[STREAM.length - 1] };
}
export function roadPointAtDistance(distance: number): Point2 {
  const target = clamp(distance, 0, cumulativeRoad[cumulativeRoad.length - 1]);
  for (let i = 1; i < cumulativeRoad.length; i++) {
    if (target <= cumulativeRoad[i]) {
      const span = cumulativeRoad[i] - cumulativeRoad[i - 1] || 1;
      const t = (target - cumulativeRoad[i - 1]) / span;
      return { x: lerp(ROAD[i - 1].x, ROAD[i].x, t), z: lerp(ROAD[i - 1].z, ROAD[i].z, t) };
    }
  }
  return { ...ROAD[ROAD.length - 1] };
}
export function streamLength() { return cumulativeStream[cumulativeStream.length - 1]; }
export function roadLength() { return cumulativeRoad[cumulativeRoad.length - 1]; }
export function trailLength() { return cumulativeTrail[cumulativeTrail.length - 1]; }
