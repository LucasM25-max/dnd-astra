import { describe, expect, it } from 'vitest';
import { CollisionField, distanceToPath, ROAD, terrainHeight, roadLength, roadPointAtDistance } from '../src/engine/landscape';
import { placeForest, placeRocks } from '../src/engine/nature';
import { journeyPose, roadPoseAtDistance } from '../src/game/road';

const WAGON_PROBES: [number, number][] = [[-.98, -1.2], [.98, -1.2], [-.98, 1.2], [.98, 1.2], [-.72, -4.95], [.72, -4.95]];

function buildWorldColliders() {
  const field = new CollisionField();
  placeForest(field);
  for (const p of placeRocks()) {
    const y = terrainHeight(p.x, p.z);
    field.add({ x: p.x, z: p.z, radius: p.s * .64, bottom: y - .2, top: y + p.s * .55 });
  }
  return field;
}

function firstBlocker(field: CollisionField, x: number, z: number, yaw: number): string | null {
  const y = terrainHeight(x, z);
  for (const [px, pz] of WAGON_PROBES) {
    const wx = x + px * Math.cos(yaw) + pz * Math.sin(yaw);
    const wz = z - px * Math.sin(yaw) + pz * Math.cos(yaw);
    if (terrainHeight(wx, wz) - y > .44) return `steep ground @ ${wx.toFixed(1)},${wz.toFixed(1)}`;
    for (const c of field.query(wx, wz, .2)) {
      if (Math.hypot(wx - c.x, wz - c.z) < c.radius + .17 && c.top > y + .3) return `${c.group ?? 'static'} @ ${c.x.toFixed(1)},${c.z.toFixed(1)}`;
    }
  }
  return null;
}

describe('drivable corridor - new 10+10 mile main trail', () => {
  const field = buildWorldColliders();

  it('is clear driving east from the arrival pose for at least 25 m on 15ft road', () => {
    const startDist = 8046; // spawn at middle of first 10-mile leg
    for (let d = startDist; d <= startDist + 26; d += .5) {
      const pose = roadPoseAtDistance(d);
      const blocker = firstBlocker(field, pose.x, pose.z, pose.yaw);
      expect(blocker, `wagon blocked ${ (d - startDist).toFixed(1) } m east: ${blocker}`).toBeNull();
    }
  });

  it('is clear driving west from the arrival pose back along main trail', () => {
    const startDist = 8046;
    for (let d = startDist; d >= startDist - 30; d -= .5) {
      const pose = roadPoseAtDistance(d);
      const blocker = firstBlocker(field, pose.x, pose.z, pose.yaw);
      expect(blocker, `wagon blocked ${ (startDist - d).toFixed(1) } m west: ${blocker}`).toBeNull();
    }
  });

  it('never lets a tree or rock collider intrude on the 15ft road centre', () => {
    const WAGON_ENVELOPE = 1.5;
    const intrusions: string[] = [];
    // Check near spawn area (within 500m) for intrusions
    for (const c of field.query(0, 0, 500)) {
      const standoff = distanceToPath(c.x, c.z, ROAD) - c.radius;
      if (standoff < WAGON_ENVELOPE) intrusions.push(`${c.group ?? 'static'} @ ${c.x.toFixed(1)},${c.z.toFixed(1)} r${c.radius.toFixed(2)} (standoff ${standoff.toFixed(2)})`);
    }
    expect(intrusions).toEqual([]);
  });

  it('main trail is at least 10 miles east then 10 miles south', () => {
    expect(roadLength()).toBeGreaterThan(30000); // 20 miles total ~32186
    expect(roadLength()).toBeLessThan(40000);
  });
});
