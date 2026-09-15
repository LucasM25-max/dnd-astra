import * as THREE from 'three';

/**
 * Keeping the die inside the picture.
 *
 * The tray is simulated in world units while the player sees it through a
 * camera, so "inside the tray" and "inside the frame" are two different
 * promises — and a hardcoded wall only satisfies the first. These helpers derive
 * the tray walls from the *camera frustum* instead: the visible region of the
 * floor plane, inset by the die's own radius, plus a ceiling at the height where
 * the die would start clipping out of the top of the frame.
 *
 * Pure math (no renderer, no DOM) so the containment can be unit-tested.
 */

export interface DiceBounds {
  /** Centre-position limits: the die's *middle* may not pass these. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of the die's centre when it is sitting on the tray floor. */
  restY: number;
  /** Highest the centre may climb before the die starts clipping out of shot. */
  ceilingY: number;
  /** Die radius the bounds were inset by, kept for the per-frame guard. */
  radius: number;
}

export interface TrayBoundsOptions {
  /** Height of the tray surface. */
  floorY?: number;
  /**
   * Die-centre height at rest. Defaults to `floorY + radius`; a real d20 sits
   * lower than its circumradius because a face touches the leather, and getting
   * this wrong makes the shadow hover.
   */
  restY?: number;
  /** Die circumradius: the frame must hold the whole solid, not its centre. */
  radius: number;
  /** Extra breathing room as a fraction of the half-extent (0..0.5). */
  margin?: number;
  /** Half-size of the search area when no tray limits are given. */
  span?: number;
  /**
   * Search only over this rectangle — the leather tray itself. Without it the
   * "visible" region extends into the void behind the tray and the die rolls on
   * nothing.
   */
  limit?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const NDC = new THREE.Vector3();

function ndcInside(camera: THREE.Camera, point: THREE.Vector3): boolean {
  NDC.copy(point).project(camera);
  return Number.isFinite(NDC.x) && Number.isFinite(NDC.y) && Math.abs(NDC.x) <= 1 && Math.abs(NDC.y) <= 1
    && NDC.z <= 1 && NDC.z >= -1;
}

/**
 * Does the world point — and, when a radius is given, the whole axis-aligned
 * box around it — land inside the frame? A die is a solid: half of it hanging
 * off the edge is precisely the complaint, so the corners are tested too.
 */
/** Frame test for an axis-aligned solid: the whole box must land inside. */
function projectsInsideBox(
  camera: THREE.Camera, point: THREE.Vector3, radius: number, below = radius,
): boolean {
  camera.updateMatrixWorld();
  if (!ndcInside(camera, point)) return false;
  if (radius <= 0) return true;
  const corner = new THREE.Vector3();
  for (const dx of [-radius, radius]) {
    for (const dy of [point.y - below, point.y + radius]) {
      for (const dz of [-radius, radius]) {
        corner.set(point.x + dx, dy, point.z + dz);
        if (!ndcInside(camera, corner)) return false;
      }
    }
  }
  return true;
}

function projectsInside(camera: THREE.Camera, point: THREE.Vector3, radius = 0): boolean {
  return projectsInsideBox(camera, point, radius);
}

/**
 * The rectangle a die centre may occupy above the tray: the largest axis-aligned
 * box that is both on the leather and fully inside the camera frame. The visible
 * floor is a trapezoid (it widens with distance), so a rectangle's width has to
 * be decided by its *narrowest* row — taking the widest row instead is how a die
 * ends up half out of shot at the near edge.
 */
export function trayBounds(camera: THREE.PerspectiveCamera, opts: TrayBoundsOptions): DiceBounds {
  const floorY = opts.floorY ?? 0;
  const { radius } = opts;
  const margin = Math.min(0.5, Math.max(0, opts.margin ?? 0.04));
  const restY = opts.restY ?? floorY + radius;
  // The resting die never dips below the leather, so neither does the box that
  // has to fit in frame — testing its full radius would carve usable tray away.
  const below = Math.min(radius, Math.max(0, restY - floorY));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const limit = opts.limit ?? { minX: -(opts.span ?? 5.5), maxX: opts.span ?? 5.5, minZ: -(opts.span ?? 5.5), maxZ: opts.span ?? 5.5 };
  const rows = 32;
  const cols = 40;
  const cellZ = (limit.maxZ - limit.minZ) / rows;
  const cellX = (limit.maxX - limit.minX) / cols;
  // Per row: the x-range that fits in frame at the die's resting height. The
  // search inflates the die slightly so the accepted region keeps a visible gap
  // to the frame edge rather than grazing it.
  const halo = radius * 1.12;
  const probe = new THREE.Vector3();
  const fitsInFrame = (p: THREE.Vector3): boolean => projectsInsideBox(camera, p, radius * 1.12, below);
  const lefts: number[] = [];
  const rights: number[] = [];
  for (let iz = 0; iz <= rows; iz++) {
    const z = limit.minZ + iz * cellZ;
    let left = Infinity;
    let right = -Infinity;
    for (let ix = 0; ix <= cols; ix++) {
      const x = limit.minX + ix * cellX;
      probe.set(x, restY, z);
      if (!fitsInFrame(probe)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    lefts.push(left);
    rights.push(right);
  }
  const usable = lefts.some(v => Number.isFinite(v));
  if (!usable) {
    // Degenerate camera (or a die larger than the viewport): a tight box in
    // front of the camera beats letting physics run loose.
    const centre = new THREE.Vector3(0, restY, 0);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    centre.addScaledVector(dir, 3.2);
    return {
      minX: centre.x - 0.9, maxX: centre.x + 0.9, minZ: centre.z - 0.9, maxZ: centre.z + 0.9,
      restY, ceilingY: restY + 1.2, radius,
    };
  }

  // Largest inscribed rectangle: sweep every row span, width limited by the
  // narrowest row inside it.
  let minX = -Infinity, maxX = Infinity, minZ = limit.minZ, maxZ = limit.maxZ;
  let bestArea = -1;
  for (let a = 0; a <= rows; a++) {
    let left = -Infinity;
    let right = Infinity;
    for (let b = a; b <= rows; b++) {
      if (!Number.isFinite(lefts[b]) || !Number.isFinite(rights[b])) break;
      left = Math.max(left, lefts[b]);
      right = Math.min(right, rights[b]);
      if (right - left <= 0) break;
      const area = (right - left) * (cellZ * (b - a));
      if (area > bestArea) {
        bestArea = area;
        minX = left; maxX = right; minZ = limit.minZ + a * cellZ; maxZ = limit.minZ + b * cellZ;
      }
    }
  }
  if (bestArea <= 0) {
    const mid = (limit.minZ + limit.maxZ) / 2;
    minX = -0.9; maxX = 0.9; minZ = mid - 0.9; maxZ = mid + 0.9;
  }

  const padX = (maxX - minX) * margin;
  const padZ = (maxZ - minZ) * margin;
  minX += padX; maxX -= padX; minZ += padZ; maxZ -= padZ;
  // A die may never be wider than the box it is confined to.
  if (maxX - minX < radius * 2.4) { const c = (maxX + minX) / 2; minX = c - radius * 1.2; maxX = c + radius * 1.2; }
  if (maxZ - minZ < radius * 2.4) { const c = (maxZ + minZ) / 2; minZ = c - radius * 1.2; maxZ = c + radius * 1.2; }

  // Ceiling: the highest the die can get anywhere over the tray while still
  // fitting in frame. Deliberately generous — the exact per-frame guarantee is
  // `keepInView`, which knows where the die actually is. A tight ceiling here
  // would flatten the toss for no benefit.
  let ceilingY = restY;
  for (const z of [minZ, (minZ + maxZ) / 2, maxZ]) {
    let best = restY;
    for (let i = 0; i <= 44; i++) {
      probe.set((minX + maxX) / 2, restY + (i / 44) * 5.5, z);
      if (projectsInside(camera, probe, halo)) best = probe.y;
    }
    ceilingY = Math.max(ceilingY, best);
  }
  if (ceilingY < restY + 0.8) ceilingY = restY + 1.5;

  return { minX, maxX, minZ, maxZ, restY, ceilingY, radius };
}

/** Public frame test: the die solid, at this centre height, fully inside the shot? */
export function dieInFrame(camera: THREE.Camera, pos: THREE.Vector3, radius: number, below = radius): boolean {
  return projectsInsideBox(camera, pos, radius, below);
}

/**
 * The highest the die's centre may sit *at this spot* before it starts leaving
 * the shot. Searched rather than assumed, because the visible height above the
 * tray changes with depth: a die near the camera hits the top of the frame far
 * sooner than one at the back of the tray, and a single global ceiling cannot
 * express that.
 */
export function ceilingAt(
  camera: THREE.Camera, pos: THREE.Vector3, bounds: DiceBounds, below = bounds.radius,
): number {
  const high = bounds.ceilingY;
  const low = Math.min(bounds.restY, pos.y);
  if (pos.y <= low) return low;
  if (projectsInsideBox(camera, new THREE.Vector3(pos.x, Math.min(pos.y, high), pos.z), bounds.radius, below)) {
    // Already fine below the global ceiling: nothing to clamp.
    return high;
  }
  let lo = low, hi = Math.min(pos.y, high);
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (projectsInsideBox(camera, new THREE.Vector3(pos.x, mid, pos.z), bounds.radius, below)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Where to drop a die so it is in frame, resting on the tray, before the toss. */
export function armedSpot(bounds: DiceBounds, rnd: () => number): THREE.Vector3 {
  const spreadX = Math.max(0.001, (bounds.maxX - bounds.minX) * 0.18);
  const spreadZ = Math.max(0.001, (bounds.maxZ - bounds.minZ) * 0.18);
  const rise = Math.min(0.9, Math.max(0.25, (bounds.ceilingY - bounds.restY) * 0.55));
  return new THREE.Vector3(
    (bounds.minX + bounds.maxX) / 2 + (rnd() - 0.5) * spreadX,
    bounds.restY + rise,
    (bounds.minZ + bounds.maxZ) / 2 + (rnd() - 0.5) * spreadZ,
  );
}

/**
 * Reflect a centre position off the visible bounds, killing outward velocity.
 * Returns the axes that were hit so callers can play a wall clack.
 */
export function collideBounds(
  pos: THREE.Vector3, vel: THREE.Vector3, bounds: DiceBounds, restitution = 0.55,
): { x: boolean; z: boolean; y: boolean } {
  const hit = { x: false, z: false, y: false };
  if (pos.x < bounds.minX) { pos.x = bounds.minX; if (vel.x < 0) { vel.x = -vel.x * restitution; hit.x = true; } }
  else if (pos.x > bounds.maxX) { pos.x = bounds.maxX; if (vel.x > 0) { vel.x = -vel.x * restitution; hit.x = true; } }
  if (pos.z < bounds.minZ) { pos.z = bounds.minZ; if (vel.z < 0) { vel.z = -vel.z * restitution; hit.z = true; } }
  else if (pos.z > bounds.maxZ) { pos.z = bounds.maxZ; if (vel.z > 0) { vel.z = -vel.z * restitution; hit.z = true; } }
  if (pos.y > bounds.ceilingY) {
    pos.y = bounds.ceilingY;
    if (vel.y > 0) { vel.y = -vel.y * 0.25; hit.y = true; }
  }
  return hit;
}

/**
 * Last-resort guard, run after every step: if the die has somehow left the
 * frame (a huge velocity, an aspect ratio nobody tested), drag it back to the
 * nearest in-frame spot and take its energy away. Containment must be a
 * guarantee, not a probability.
 */
export function keepInView(
  pos: THREE.Vector3, vel: THREE.Vector3, camera: THREE.Camera, bounds: DiceBounds,
): boolean {
  if (projectsInside(camera, pos, bounds.radius)) return false;
  // The box, not the centre, is what the player sees; the pull-back below is
  // written against the centre so it stays predictable near the frame edges.
  const target = new THREE.Vector3(
    THREE.MathUtils.clamp(pos.x, bounds.minX, bounds.maxX),
    Math.min(pos.y, bounds.restY + 0.35),
    THREE.MathUtils.clamp(pos.z, bounds.minZ, bounds.maxZ),
  );
  pos.lerp(target, 0.6);
  if (!projectsInside(camera, pos, bounds.radius)) pos.copy(target);
  // Still out of frame (a wild depth, an extreme aspect ratio): the middle of
  // the tray is by construction visible, so land there instead of arguing.
  if (!projectsInside(camera, pos, bounds.radius)) {
    pos.set((bounds.minX + bounds.maxX) / 2, bounds.restY, (bounds.minZ + bounds.maxZ) / 2);
  }
  vel.multiplyScalar(0.08);
  return true;
}

/** A toss that is guaranteed to stay inside `bounds` (velocity magnitude only). */
/**
 * Trim a throw so its arc fits the tray it is thrown into. `headroom` is the
 * rise the frame allows at the die's current spot (`ceilingAt` minus the resting
 * height) — without it the die would scrape an invisible ceiling every frame,
 * which reads as bad physics rather than as a safety rail.
 */
export function cappedToss(
  velocity: THREE.Vector3, bounds: DiceBounds, gravity: number, headroom?: number,
): THREE.Vector3 {
  // Horizontal reach of a ballistic hop: v/g * (v/g)*g/2 … bounded by the tray.
  const roomX = Math.max(0.4, (bounds.maxX - bounds.minX) * 0.42);
  const roomZ = Math.max(0.4, (bounds.maxZ - bounds.minZ) * 0.42);
  const out = velocity.clone();
  // Time to fall back to the tray from the current upward speed: t = 2|vy|/g.
  const t = (2 * Math.abs(out.y)) / Math.max(1, Math.abs(gravity));
  const maxVx = roomX / Math.max(0.2, t);
  const maxVz = roomZ / Math.max(0.2, t);
  out.x = Math.sign(out.x) * Math.min(Math.abs(out.x), maxVx);
  out.z = Math.sign(out.z) * Math.min(Math.abs(out.z), maxVz);
  // And never higher than the ceiling allows: rise = vy²/2g must fit the room.
  const room = Math.max(0.35, headroom ?? bounds.ceilingY - bounds.restY);
  const rise = (out.y * out.y) / (2 * Math.max(1, Math.abs(gravity)));
  // A little slack: the frame-aware ceiling in `advanceDie` is the real rail.
  if (rise > room * 1.25) out.y = Math.sqrt(2 * Math.abs(gravity) * room * 1.25);
  return out;
}

/** Where the die integration keeps its state. */
export interface DieBody { pos: THREE.Vector3; vel: THREE.Vector3 }

export interface AdvanceResult {
  /** Speed of a floor impact this step (0 when the die stayed airborne/quiet). */
  impact: number;
  /** The die came to rest on the tray this step. */
  landed: boolean;
  /** A tray wall took the hit. */
  wall: boolean;
  /** The top of the shot took the hit — the die would have left the frame. */
  ceiling: boolean;
}

/**
 * One physics step: gravity, the tray floor, and the view-derived walls.
 *
 * Kept separate from the renderer so the containment can be replayed headlessly
 * — "the die never leaves the frame" is the kind of promise you cannot verify
 * by eyeballing a live roll frame by frame, and a software-GL screenshot costs
 * forty seconds a pop.
 */
export function advanceDie(
  body: DieBody, dt: number,
  o: { gravity: number; restitution: number; bounds: DiceBounds; camera?: THREE.Camera; below?: number },
): AdvanceResult {
  const { pos, vel } = body;
  const out: AdvanceResult = { impact: 0, landed: false, wall: false, ceiling: false };
  vel.y += o.gravity * dt;
  pos.addScaledVector(vel, dt);

  const restY = o.bounds.restY;
  if (pos.y < restY) {
    pos.y = restY;
    if (vel.y < 0) {
      const impact = Math.abs(vel.y);
      vel.y *= -o.restitution;
      vel.x *= 0.88;
      vel.z *= 0.88;
      if (impact > 0.9) out.impact = impact;
      if (Math.abs(vel.y) < 0.35) { vel.y = 0; out.landed = true; }
    }
  }
  const hit = collideBounds(pos, vel, o.bounds);
  // The frame-aware ceiling replaces the box ceiling when a camera is supplied:
  // the honest limit is "as high as this die can be *here* without clipping out".
  if (o.camera) {
    const cap = ceilingAt(o.camera, pos, o.bounds, o.below ?? o.bounds.radius);
    if (pos.y > cap) {
      pos.y = cap;
      if (vel.y > 0) { vel.y = -vel.y * 0.2; out.ceiling = true; }
    }
  }
  out.wall = hit.x || hit.z || hit.y;
  return out;
}

/** Trajectory replay used by the tests: does any frame of the flight escape? */
export function flightEscapes(
  start: THREE.Vector3, velocity: THREE.Vector3, bounds: DiceBounds,
  opts: { gravity: number; restitution: number; frames?: number; dt?: number; drag?: number; camera?: THREE.Camera; below?: number; radius?: number },
): { escaped: boolean; worst: { x: number; y: number; z: number }; frames: number; outOfFrame: number } {
  const dt = opts.dt ?? 1 / 60;
  const frames = opts.frames ?? 420;
  const body: DieBody = { pos: start.clone(), vel: velocity.clone() };
  let worst = { x: 0, y: 0, z: 0 };
  let outOfFrame = 0;
  for (let i = 0; i < frames; i++) {
    if (opts.drag) body.vel.multiplyScalar(Math.max(0, 1 - opts.drag * dt));
    advanceDie(body, dt, {
      gravity: opts.gravity, restitution: opts.restitution, bounds, camera: opts.camera, below: opts.below,
    });
    if (opts.camera && !dieInFrame(opts.camera, body.pos, opts.radius ?? bounds.radius, opts.below ?? bounds.radius)) {
      outOfFrame++;
      // No tolerance: a single frame with part of the die past the edge is the
      // exact defect this whole module exists to prevent.
      return { escaped: true, worst, frames: i, outOfFrame };
    }
    worst = {
      x: Math.max(worst.x, Math.abs(body.pos.x) - Math.max(bounds.maxX, -bounds.minX)),
      y: Math.max(worst.y, body.pos.y - bounds.ceilingY),
      z: Math.max(worst.z, Math.abs(body.pos.z) - Math.max(bounds.maxZ, -bounds.minZ)),
    };
    if (worst.x > 1e-6 || worst.y > 1e-6 || worst.z > 1e-6) return { escaped: true, worst, frames: i, outOfFrame };
    // Once it is sitting still there is nothing left to test.
    if (body.vel.lengthSq() < 1e-4 && body.pos.y <= bounds.restY + 1e-3) {
      return { escaped: false, worst, frames: i, outOfFrame };
    }
  }
  return { escaped: false, worst, frames, outOfFrame };
}
