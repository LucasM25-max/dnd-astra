import { describe, expect, it } from 'vitest';
import { CollisionField, LANDMARKS, ROAD, ROAD_POINTS, SPAWN, TRAIL, TRAIL_POINTS, WORLD_LIMIT, distanceToPath, pathAmount, pathDistance, sampleCurve, seededRandom, terrainHeight } from '../src/engine/landscape';

describe('map-derived continuous landscape', () => {
  it('preserves the reference road and northern trail endpoints', () => {
    expect(ROAD[0]).toEqual(ROAD_POINTS[0]); expect(ROAD.at(-1)).toEqual(ROAD_POINTS.at(-1));
    expect(TRAIL[0]).toEqual(TRAIL_POINTS[0]); expect(TRAIL.at(-1)).toEqual(TRAIL_POINTS.at(-1));
    expect(distanceToPath(TRAIL[0].x, TRAIL[0].z, ROAD)).toBeLessThan(.1);
    expect(TRAIL.at(-1)!.z).toBeLessThan(TRAIL[0].z);
  });
  it('puts the player and both ambush props on the main road', () => {
    expect(pathAmount(SPAWN.x, SPAWN.z)).toBe(1);
    expect(pathDistance(5.9, .7)).toBeLessThan(0);
    expect(pathDistance(6.9, 3.2)).toBeLessThan(0);
    expect(distanceToPath(LANDMARKS[0].x, LANDMARKS[0].z, ROAD)).toBeLessThan(2.35);
  });
  it('raises the forest banks instead of drawing a visible grid', () => {
    expect(terrainHeight(-9, -3) - terrainHeight(-9, 4.5)).toBeGreaterThan(1.5);
    expect(pathAmount(-9, -3)).toBe(0);
  });
  it('has continuous finite heights and material blending across the explorable world', () => {
    const rng = seededRandom(192);
    for (let i = 0; i < 400; i++) {
      const x = (rng() - .5) * 96, z = (rng() - .5) * 96;
      const height = terrainHeight(x, z), blend = pathAmount(x, z);
      expect(Number.isFinite(height)).toBe(true);
      expect(Math.abs(height - terrainHeight(x + .01, z))).toBeLessThan(.06);
      expect(blend).toBeGreaterThanOrEqual(0); expect(blend).toBeLessThanOrEqual(1);
    }
  });
  it('creates repeatable variation without a random world on every reload', () => {
    const a = seededRandom(987), b = seededRandom(987);
    expect(Array.from({ length: 20 }, a)).toEqual(Array.from({ length: 20 }, b));
    expect(sampleCurve([{ x: 0, z: 0 }, { x: 10, z: 10 }], 10)).toHaveLength(11);
  });
});

describe('capsule and camera collision field', () => {
  it('slides the capsule out of a tree trunk, including exact-centre overlap', () => {
    const field = new CollisionField(); field.add({ x: 0, z: 0, radius: .6, bottom: 0, top: 12 });
    const near = field.resolve(.5, 0, 0); expect(Math.hypot(near.x, near.z)).toBeCloseTo(.92, 5);
    const centre = field.resolve(0, 0, 0); expect(Number.isFinite(centre.x)).toBe(true); expect(centre.x).toBeCloseTo(.92, 5);
  });
  it('allows jumping over a low prop rather than colliding at every height', () => {
    const field = new CollisionField(); field.add({ x: 2, z: 3, radius: .6, bottom: 0, top: .4 });
    expect(field.resolve(2, 3, .7)).toEqual({ x: 2, z: 3 });
  });
  it('queries colliders across spatial-cell boundaries', () => {
    const field = new CollisionField(); field.add({ x: 4.1, z: -4.1, radius: .5, bottom: 0, top: 2 });
    expect(field.query(3.9, -3.9).size).toBe(1);
    expect(field.query(20, 20).size).toBe(0);
  });
  it('keeps the camera above the ground and outside tree trunks', () => {
    const field = new CollisionField(); field.add({ x: 0, z: 0, radius: .5, bottom: 0, top: 10 });
    expect(field.cameraBlocked(0, 6, 0)).toBe(true);
    expect(field.cameraBlocked(SPAWN.x, -5, SPAWN.z)).toBe(true);
    expect(field.cameraBlocked(0, 25, 0)).toBe(false);
  });
  it('keeps movement within the supported woodland', () => {
    const field = new CollisionField(); expect(field.resolve(100, -100, 0)).toEqual({ x: WORLD_LIMIT, z: -WORLD_LIMIT });
  });
});
