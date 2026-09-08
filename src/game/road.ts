import { ROAD, clamp, roadPointAtDistance } from '../engine/landscape';

// Journey now follows the main trail by distance along its winding length, not by X.
// This supports the new 10-mile east + 10-mile south design while keeping the cinematic
// approach near spawn.

export const JOURNEY_START_DISTANCE = 7200; // west of spawn: X ~ -846
export const JOURNEY_END_DISTANCE = 8060; // ambush at X=14, Z=0 - just east of spawn on 15ft main trail

// Legacy X-based values kept for any external callers that still use them
export const JOURNEY_START_X = -800;
export const JOURNEY_END_X = 100;

export function roadPoseAtDistance(dist: number) {
  const p = roadPointAtDistance(dist);
  // Estimate yaw from neighboring points
  const ahead = roadPointAtDistance(dist + 2);
  const behind = roadPointAtDistance(dist - 2);
  const dx = ahead.x - behind.x;
  const dz = ahead.z - behind.z;
  const yaw = Math.atan2(-dx, -dz);
  return { x: p.x, z: p.z, yaw };
}

export function roadPoseAtX(x: number) {
  // Fallback: find closest point on ROAD to given X (for backward compat)
  // Now we search by X proximity along first leg only
  let best = ROAD[0], bestD = Infinity;
  for (const p of ROAD) {
    const d = Math.abs(p.x - x);
    if (d < bestD) { bestD = d; best = p; }
  }
  const idx = ROAD.indexOf(best);
  const before = ROAD[Math.max(0, idx - 1)];
  const after = ROAD[Math.min(ROAD.length - 1, idx + 1)];
  const dx = after.x - before.x;
  const dz = after.z - before.z;
  const yaw = Math.atan2(-dx, -dz);
  return { x: best.x, z: best.z, yaw };
}

export function journeyPose(progress: number) {
  const clamped = clamp(progress, 0, 1);
  const dist = JOURNEY_START_DISTANCE + (JOURNEY_END_DISTANCE - JOURNEY_START_DISTANCE) * clamped;
  return roadPoseAtDistance(dist);
}
