import { describe, expect, it } from 'vitest';
import { CollisionField, distanceToPath, ROAD, terrainHeight } from '../src/engine/landscape';
import { placeForest, placeRocks } from '../src/engine/nature';
import { roadPoseAtX } from '../src/game/road';

/**
 * Drivable-corridor guarantee (plan §B, acceptance B1):
 * from the arrival pose the player must be able to drive the wagon east along
 * the road for at least 25 m without hitting anything. The check mirrors the
 * six probe points AdventureModel.canDriveAt runs under the wagon body.
 */

// Same probe offsets as AdventureModel.canDriveAt (wagon local metres).
const WAGON_PROBES: [number, number][] = [[-.98, -1.2], [.98, -1.2], [-.98, 1.2], [.98, 1.2], [-.72, -4.95], [.72, -4.95]];

/** Build the static collision field exactly the way the world does. */
function buildWorldColliders() {
  const field = new CollisionField();
  placeForest(field);
  for (const p of placeRocks()) {
    const y = terrainHeight(p.x, p.z);
    field.add({ x: p.x, z: p.z, radius: p.s * .64, bottom: y - .2, top: y + p.s * .55 });
  }
  return field;
}

/** First collider/terrain that would stop a wagon centred at (x, z, yaw), or null. */
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

describe('drivable corridor', () => {
  const field = buildWorldColliders();

  it('is clear driving east from the arrival pose for at least 25 m', () => {
    const start = roadPoseAtX(-1.85);
    for (let x = start.x; x <= start.x + 26; x += .5) {
      const pose = roadPoseAtX(x);
      const blocker = firstBlocker(field, pose.x, pose.z, pose.yaw);
      expect(blocker, `wagon blocked ${ (x - start.x).toFixed(1) } m east: ${blocker}`).toBeNull();
    }
  });

  it('is clear driving west from the arrival pose back to the reference map edge', () => {
    const start = roadPoseAtX(-1.85);
    for (let x = start.x; x >= -16; x -= .5) {
      const pose = roadPoseAtX(x);
      const blocker = firstBlocker(field, pose.x, pose.z, pose.yaw);
      expect(blocker, `wagon blocked ${ (start.x - x).toFixed(1) } m west: ${blocker}`).toBeNull();
    }
  });

  it('never lets a tree or rock collider intrude on the road centre', () => {
    const WAGON_ENVELOPE = 1.3; // half of the drivable lane, incl. probe margin
    const intrusions: string[] = [];
    for (const c of field.query(0, 0, 200)) {
      const standoff = distanceToPath(c.x, c.z, ROAD) - c.radius;
      if (standoff < WAGON_ENVELOPE) intrusions.push(`${c.group ?? 'static'} @ ${c.x.toFixed(1)},${c.z.toFixed(1)} r${c.radius.toFixed(2)} (standoff ${standoff.toFixed(2)})`);
    }
    expect(intrusions).toEqual([]);
  });
});
