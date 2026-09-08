import { describe, expect, it } from 'vitest';
import { CollisionField, LANDMARKS, ROAD, ROAD_POINTS, SPAWN, TRAIL, TRAIL_POINTS, STREAM, STREAM_POINTS, WORLD_LIMIT, distanceToPath, pathAmount, pathDistance, sampleCurve, seededRandom, terrainHeight, ROAD_WIDTH, TRAIL_WIDTH, STREAM_WIDTH } from '../src/engine/landscape';

describe('map-derived continuous landscape - new 10+10 mile main trail, 0.5 mile thin trail, stream', () => {
  it('preserves the reference road and thin trail endpoints with new scale', () => {
    expect(ROAD[0]).toEqual(ROAD_POINTS[0]); expect(ROAD.at(-1)).toEqual(ROAD_POINTS.at(-1));
    expect(TRAIL[0]).toEqual(TRAIL_POINTS[0]); expect(TRAIL.at(-1)).toEqual(TRAIL_POINTS.at(-1));
    expect(STREAM[0]).toEqual(STREAM_POINTS[0]); expect(STREAM.at(-1)).toEqual(STREAM_POINTS.at(-1));
    // Main trail should be ~20 miles total (32186m) with winding
    expect(ROAD.length).toBeGreaterThan(500);
    // Thin trail should be ~0.5 mile (804m)
    expect(TRAIL.length).toBeGreaterThan(100);
    expect(TRAIL.length).toBeLessThan(300);
  });
  it('puts the player and ambush on the main 15ft road', () => {
    expect(pathAmount(SPAWN.x, SPAWN.z)).toBe(1);
    // Main road is 15ft wide = 4.572m total, half 2.286
    expect(ROAD_WIDTH).toBeCloseTo(2.286, 1);
    expect(TRAIL_WIDTH).toBeCloseTo(0.762, 1);
    expect(STREAM_WIDTH).toBeGreaterThan(2);
    // Ambush at 14,0 should be on road
    expect(pathDistance(14, 0)).toBeLessThan(0);
    expect(distanceToPath(LANDMARKS[0].x, LANDMARKS[0].z, ROAD)).toBeLessThan(ROAD_WIDTH + 1);
  });
  it('has stream somewhere in forest on either side of paths', () => {
    // Stream should be west of main trail, not on road
    const streamX = STREAM[0].x;
    expect(Math.abs(streamX)).toBeGreaterThan(500);
    expect(pathDistance(streamX, STREAM[0].z)).toBeGreaterThan(2);
    // Stream landmark should exist
    expect(LANDMARKS.find(l => l.id === 'stream')).toBeDefined();
  });
  it('has continuous finite heights and material blending across the explorable world', () => {
    const rng = seededRandom(192);
    for (let i = 0; i < 400; i++) {
      const x = (rng() - .5) * 600, z = (rng() - .5) * 600;
      const height = terrainHeight(x, z), blend = pathAmount(x, z);
      expect(Number.isFinite(height)).toBe(true);
      expect(Math.abs(height - terrainHeight(x + .01, z))).toBeLessThan(.25);
      expect(blend).toBeGreaterThanOrEqual(0); expect(blend).toBeLessThanOrEqual(1);
    }
  });
  it('fixes ground placement - road at spawn near 0', () => {
    // Ground should be at correct place, not floating
    const h = terrainHeight(SPAWN.x, SPAWN.z);
    expect(Math.abs(h)).toBeLessThan(0.5);
    // Off-road should be only slightly higher, not 1.5m wall
    const offRoad = terrainHeight(SPAWN.x, SPAWN.z + 10);
    expect(offRoad - h).toBeLessThan(2.5);
    expect(offRoad - h).toBeGreaterThan(-1);
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
    const field = new CollisionField(); expect(field.resolve(WORLD_LIMIT + 100, -WORLD_LIMIT - 100, 0)).toEqual({ x: WORLD_LIMIT, z: -WORLD_LIMIT });
  });
});
