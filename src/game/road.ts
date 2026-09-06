import { ROAD, clamp } from '../engine/landscape';
export const JOURNEY_START_X = -32;
export const JOURNEY_END_X = -1.85;
export function roadPoseAtX(x: number) {
  x = clamp(x, ROAD[0].x, ROAD[ROAD.length - 1].x);
  let a = ROAD[0], b = ROAD[1], segment = 0;
  for (let i = 0; i < ROAD.length - 1; i++) if (x >= ROAD[i].x && x <= ROAD[i + 1].x) { a = ROAD[i]; b = ROAD[i + 1]; segment = i; break; }
  const t = (x - a.x) / (b.x - a.x || 1);
  const z = a.z + (b.z - a.z) * t;
  const before = ROAD[Math.max(0, segment - 1)], after = ROAD[Math.min(ROAD.length - 1, segment + 2)];
  const dx = (b.x - before.x) * (1 - t) + (after.x - a.x) * t;
  const dz = (b.z - before.z) * (1 - t) + (after.z - a.z) * t;
  const yaw = Math.atan2(-dx, -dz);
  return { x, z, yaw };
}
export function journeyPose(progress: number) { return roadPoseAtX(JOURNEY_START_X + (JOURNEY_END_X - JOURNEY_START_X) * clamp(progress, 0, 1)); }
