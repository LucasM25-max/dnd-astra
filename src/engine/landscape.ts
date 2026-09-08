// Map-space is continuous, in metres. North is negative Z.
// Reference: the supplied Goblin Ambush map, approximately 1.524 m per square.
// The reference footprint is extended with woodland beyond its edges, not tiled.
export type Point2 = { x: number; z: number };
export const SPAWN = { x: -12.8, z: 4.02, yaw: -1.68 };
/**
 * The local ambush is only the first clearing in a much larger woodland.
 * Keep the simulation bounds generous enough for the five-mile trail to feel
 * like a destination rather than a painted backdrop. The renderer uses a
 * finite terrain tile, while the collision field clamps actors to this limit.
 */
/** Legacy local-map limit retained for callers that use this as a 100 m probe. */
export const WORLD_LIMIT = 100;
/** Actual explorable simulation extent, including the long northern trail. */
export const WORLD_EXTENT = 1900;
export const MAP_BOUNDS = { minX: -220, maxX: 220, minZ: -1870, maxZ: 18 };
export const ROAD_WIDTH = 2.35;
export const TRAIL_WIDTH = 0.82;
/** The playable trail segment reaches beyond the two staged traps. */
export const TRAIL_PLAYABLE_LENGTH_METRES = 1820;
// Keep a clear drivable corridor: nothing obstructive inside this pathDistance.
export const ROAD_CORRIDOR = 3.0;

export const ROAD_POINTS: Point2[] = [
  { x: -420, z: 1 }, { x: -80, z: 1 }, { x: -29, z: 2 }, { x: -17, z: 3.1 },
  { x: -9, z: 4.5 }, { x: -4, z: 3.8 }, { x: 2, z: 1.7 },
  { x: 7.5, z: 1.45 }, { x: 16, z: 2.0 }, { x: 30, z: 1.3 }, { x: 80, z: -1 }, { x: 420, z: -4 },
];
/**
 * A continuous north-west track. The first point is the visible mouth behind
 * the ambush thickets; the last point is the beginning of the five-mile
 * Cragmaw approach. It is deliberately much longer than the opening scene so
 * players can leave the clearing, find both traps, and keep exploring.
 */
export const TRAIL_POINTS: Point2[] = [
  { x: 7.9, z: 1.5 }, { x: 9.5, z: -1.5 }, { x: 12.4, z: -6.8 },
  { x: 11.0, z: -28 }, { x: 8.7, z: -64 },
  { x: 5.8, z: -112 }, { x: 1.9, z: -168 }, { x: -2.5, z: -226 },
  { x: -7.8, z: -290 }, { x: -4.1, z: -356 }, { x: -15.5, z: -426 },
  { x: -8.8, z: -505 }, { x: -25, z: -590 }, { x: -12, z: -690 },
  { x: -37, z: -805 }, { x: -20, z: -930 }, { x: -53, z: -1060 },
  { x: -38, z: -1200 }, { x: -72, z: -1350 }, { x: -52, z: -1505 },
  { x: -86, z: -1660 }, { x: -60, z: -1825 },
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

/** Cumulative distance along a sampled path, used by trail encounters. */
const cumulativeTrail = (() => {
  const values = [0];
  for (let i = 1; i < TRAIL.length; i++) {
    values.push(values[i - 1] + Math.hypot(TRAIL[i].x - TRAIL[i - 1].x, TRAIL[i].z - TRAIL[i - 1].z));
  }
  return values;
})();

/**
 * Return progress from the trail mouth in metres, or Infinity when the point
 * is not close enough to count as following the trail. This keeps traps from
 * firing because someone happened to walk north through the forest.
 */
export function trailDistanceAlong(x: number, z: number) {
  let best = Infinity, progress = Infinity;
  for (let i = 0; i < TRAIL.length - 1; i++) {
    const a = TRAIL[i], b = TRAIL[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; progress = cumulativeTrail[i] + Math.sqrt(len2) * t; }
  }
  return best <= TRAIL_WIDTH + 1.45 ? progress : Infinity;
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
  // Leave a shallow shoulder beside the road so a full wagon can negotiate
  // the older western bends without treating the edge of the lane as a cliff.
  const bank = smoothstep(1.0, 2.9, distance) * (1.52 + fbm(x * .26, z * .26) * 1.05);
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
