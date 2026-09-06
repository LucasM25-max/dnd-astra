// Map-space is continuous, in metres. North is negative Z.
// Reference: the supplied Goblin Ambush map, approximately 1.524 m per square.
// The reference footprint is extended with woodland beyond its edges, not tiled.
export type Point2 = { x: number; z: number };
export const SPAWN = { x: -12.8, z: 4.02, yaw: -1.68 };
export const WORLD_LIMIT = 70;
export const MAP_BOUNDS = { minX: -17, maxX: 19, minZ: -22, maxZ: 16 };
export const ROAD_WIDTH = 2.35;
export const TRAIL_WIDTH = 0.82;
// Keep a clear drivable corridor: nothing obstructive inside this pathDistance.
export const ROAD_CORRIDOR = 3.0;

export const ROAD_POINTS: Point2[] = [
  { x: -80, z: 1 }, { x: -29, z: 2 }, { x: -17, z: 3.1 },
  { x: -9, z: 4.5 }, { x: -4, z: 3.8 }, { x: 2, z: 1.7 },
  { x: 7.5, z: 1.45 }, { x: 16, z: 2.0 }, { x: 30, z: 1.3 }, { x: 80, z: -1 },
];
export const TRAIL_POINTS: Point2[] = [
  { x: 7.9, z: 1.5 }, { x: 9.2, z: -1.1 }, { x: 9.6, z: -4.7 },
  { x: 8.4, z: -8.1 }, { x: 6.1, z: -10.2 }, { x: 4.9, z: -13.7 },
  { x: 1.5, z: -17.1 }, { x: -1.4, z: -19.4 }, { x: -2.7, z: -27 },
  { x: -5, z: -43 }, { x: -9, z: -78 },
];
export const LANDMARKS = [
  { id: 'ambush', name: 'The ambush clearing', x: 6, z: 2.2, radius: 4 },
  { id: 'cragmaw', name: 'Cragmaw trail', x: 7.8, z: -9, radius: 3 },
  { id: 'phandalin', name: 'The road to Phandalin', x: 22, z: 1.8, radius: 4 },
] as const;

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
export const ROAD = sampleCurve(ROAD_POINTS);
export const TRAIL = sampleCurve(TRAIL_POINTS);

export function distanceToPath(x: number, z: number, path: Point2[]) {
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
    if (d < min) min = d;
  }
  return Math.sqrt(min);
}
export function pathDistance(x: number, z: number) {
  return Math.min(distanceToPath(x, z, ROAD) - ROAD_WIDTH, distanceToPath(x, z, TRAIL) - TRAIL_WIDTH);
}
export function pathAmount(x: number, z: number) {
  const irregular = (noise(x * 2.3, z * 2.3) - .5) * .38 + (noise(x * 6, z * 6) - .5) * .12;
  return 1 - smoothstep(-.24, .44, pathDistance(x, z) + irregular);
}
export function terrainHeight(x: number, z: number) {
  const distance = pathDistance(x, z);
  const northRise = Math.max(0, -z) * .026;
  const roadUndulation = (noise(x * .14, z * .14) - .5) * .19 + northRise;
  const groundDetail = (fbm(x * 2.2, z * 2.2) - .5) * .08;
  const bank = smoothstep(.35, 2.6, distance) * (1.52 + fbm(x * .26, z * .26) * 1.05);
  const forest = smoothstep(2, 10, distance) * ((fbm(x * .09, z * .09) - .35) * 3.1);
  const distantHills = smoothstep(29, 66, Math.hypot(x, z)) * (3 + fbm(x * .055, z * .055) * 10);
  return roadUndulation + groundDetail + bank + forest + distantHills;
}
export function terrainSlope(x: number, z: number) {
  const e = .16;
  return Math.hypot((terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e), (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e));
}
export interface Collider { x: number; z: number; radius: number; bottom: number; top: number; group?: string }
export class CollisionField {
  private cells = new Map<string, Collider[]>();
  private cellSize = 4;
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
    return { x: clamp(x, -WORLD_LIMIT, WORLD_LIMIT), z: clamp(z, -WORLD_LIMIT, WORLD_LIMIT) };
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
