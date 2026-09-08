import * as THREE from 'three';
import { seededRandom, terrainHeight } from '../landscape';
import { NEUTRAL_HEAD, type AnimalCommand, type LivingAnimal } from './animals';

/**
 * Behaviour for the two wild horses (goal-driven clearing wander) and the
 * yoked oxen (soft-spring followers of the yoke anchors). Driven every frame
 * by Adventure; movement is applied to the animal roots there.
 */
const CLEARING = { x: 14, z: 0, r: 6.2 };
const WAYPOINTS = [
  { x: 14, z: 0.2, w: .42 },   // ransacked belongings - ambush centre on 15ft main trail
  { x: 12.5, z: 0.5, w: .22 },   // road edge
  { x: 15, z: -2.5, w: .16 }, // trail edge - mouth of 5ft thin trail
  { x: 10, z: 2.5, w: .12 },   // open grass south
  { x: 16, z: 1.5, w: .08 },  // clearing fringe east
];

export interface WorldSnapshot {
  time: number;
  player: THREE.Vector3;
  wagon: { x: number; z: number; yaw: number; speed: number };
}
export interface HorseOutput {
  speed: number;
  yaw: number;
  head: { pitch: number; yaw: number };
  alert: number;
  headDown: boolean;
}

export class HorseBrain {
  state: 'idle' | 'walk' | 'sniff' | 'graze' | 'look' | 'startle' | 'come' = 'idle';
  x = 0; z = 0; yaw = 0;
  private stateTime = 0;
  private until = 4;
  private startleCooldown = 0;
  private comeCooldown = 0;
  private startleDir = new THREE.Vector2();
  private startleFromWagon = false;
  private target = new THREE.Vector3();
  private rng: () => number;
  /** world-clock stamps for one-shot sounds; Adventure consumes + clears. */
  snortAt = -1;
  whinnyAt = -1;
  constructor(seed: number) { this.rng = seededRandom(5000 + seed * 97); }
  place(x: number, z: number, yaw: number) { this.x = x; this.z = z; this.yaw = yaw; }
  /** The `Call` verb (Workstream E) invokes this on the nearest horse. */
  call() {
    if (this.state === 'come' || this.comeCooldown > 0) return false;
    this.setState('come'); this.until = 20;
    this.snortAt = 1; // Adventure re-stamps with its clock
    return true;
  }
  private setState(s: HorseBrain['state']) { this.state = s; this.stateTime = 0; }
  private pickTarget(wagon: WorldSnapshot['wagon'], other: { x: number; z: number } | null) {
    let best: THREE.Vector3 | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      let total = 0; for (const w of WAYPOINTS) total += w.w;
      let roll = this.rng() * total, wp = WAYPOINTS[0];
      for (const w of WAYPOINTS) { roll -= w.w; if (roll <= 0) { wp = w; break; } }
      const p = new THREE.Vector3(wp.x + (this.rng() - .5) * 2.2, 0, wp.z + (this.rng() - .5) * 2.2);
      if (p.distanceTo(new THREE.Vector3(CLEARING.x, 0, CLEARING.z)) > CLEARING.r - .4) continue;
      const fx = -Math.sin(wagon.yaw), fz = -Math.cos(wagon.yaw);
      const wagonFront = new THREE.Vector3(wagon.x + fx * 2.6, 0, wagon.z + fz * 2.6);
      if (p.distanceTo(new THREE.Vector3(wagon.x, 0, wagon.z)) < 3.4) continue;
      if (p.distanceTo(wagonFront) < 4.2) continue;
      if (other && Math.hypot(p.x - other.x, p.z - other.z) < 2.2) continue;
      this.target.copy(p); best = p; break;
    }
    if (!best) { // wagon parked in the clearing: aim for the far side
      let bestScore2 = -Infinity;
      for (const wp of WAYPOINTS) {
        const p = new THREE.Vector3(wp.x, 0, wp.z);
        const d = p.distanceTo(new THREE.Vector3(wagon.x, 0, wagon.z));
        if (d > bestScore2) { bestScore2 = d; best = p; }
      }
      if (best) this.target.copy(best);
      else this.target.set(CLEARING.x, 0, CLEARING.z);
    }
  }
  update(dt: number, other: { x: number; z: number } | null, w: WorldSnapshot, out: HorseOutput) {
    dt = Math.max(0, Math.min(.1, dt));
    this.stateTime += dt;
    this.startleCooldown = Math.max(0, this.startleCooldown - dt);
    this.comeCooldown = Math.max(0, this.comeCooldown - dt);
    const playerD = Math.hypot(w.player.x - this.x, w.player.z - this.z);
    const wagonD = Math.hypot(w.wagon.x - this.x, w.wagon.z - this.z);
    let speed = 0, headPitch = .06, headYaw = Math.sin(w.time * .5 + this.x) * .18, alert = 0;
    const setState = this.setState.bind(this);
    // Reactions (suppressed while called over).
    if (this.state !== 'come' && this.state !== 'startle') {
      if (playerD < 2.5 && this.startleCooldown <= 0) {
        setState('startle'); this.startleFromWagon = false; this.startleCooldown = 9;
        this.startleDir.set(this.x - w.player.x, this.z - w.player.z).normalize();
        this.pickTarget(w.wagon, other); this.until = 3.2;
      } else if (wagonD < 6 && Math.abs(w.wagon.speed) > .35 && this.startleCooldown <= 0) {
        setState('startle'); this.startleFromWagon = true; this.startleCooldown = 20;
        this.whinnyAt = 1;
        this.startleDir.set(this.x - w.wagon.x, this.z - w.wagon.z).normalize();
        this.pickTarget(w.wagon, other); this.until = 4;
      }
    }
    switch (this.state) {
      case 'idle':
        headYaw = Math.sin(w.time * .45 + this.x * 2) * .3 + Math.sin(w.time * 1.7) * .05;
        if (this.stateTime > this.until) {
          this.pickTarget(w.wagon, other);
          const next: HorseBrain['state'] = this.target.distanceTo(new THREE.Vector3(WAYPOINTS[0].x, 0, WAYPOINTS[0].z)) < 1.6 && this.rng() > .45 ? 'sniff' : 'walk';
          setState(next);
          if (next === 'walk' && this.rng() > .7) this.snortAt = 1;
          this.until = 3 + this.rng() * 4;
        }
        break;
      case 'walk': {
        speed = .45;
        this.yaw = this.steerTo(this.target, dt);
        if (this.x === 0 && this.z === 0) void 0;
        if (this.target.distanceTo(new THREE.Vector3(this.x, 0, this.z)) < .45) {
          setState(this.rng() > .45 ? 'graze' : 'sniff');
          this.until = 4 + this.rng() * 5;
        } else if (this.stateTime > 14) { setState('idle'); this.until = 2 + this.rng() * 3; }
        break;
      }
      case 'sniff':
        headPitch = .62 + Math.sin(w.time * 2.6) * .05;
        headYaw = Math.sin(w.time * 1.1) * .25;
        if (this.stateTime > this.until) { setState('idle'); this.until = 2 + this.rng() * 3; }
        break;
      case 'graze':
        headPitch = .85 + Math.sin(w.time * 2.2 + 1) * .03;
        headYaw = Math.sin(w.time * .55) * .5;
        speed = Math.abs(Math.sin(w.time * .55)) * .06; // slow foot shuffles while cropping
        if (this.stateTime > this.until) {
          const next: HorseBrain['state'] = this.rng() > .5 ? 'idle' : 'walk';
          setState(next);
          if (next === 'walk') this.pickTarget(w.wagon, other);
          this.until = 6 + this.rng() * 8;
        }
        break;
      case 'look':
        headPitch = -.12; headYaw = this.stateTime * .8;
        if (this.stateTime > this.until) { setState('idle'); this.until = 2 + this.rng() * 4; }
        break;
      case 'startle': {
        alert = 1; headPitch = -.22; headYaw = 0;
        if (this.stateTime < .75) {
          speed = .55; this.yaw = Math.atan2(-this.startleDir.x, -this.startleDir.y);
        } else {
          speed = this.startleFromWagon ? 1.4 : .8;
          this.yaw = this.steerTo(this.target, dt);
          if (this.target.distanceTo(new THREE.Vector3(this.x, 0, this.z)) < .6) { setState('idle'); this.until = 4 + this.rng() * 5; }
        }
        break;
      }
      case 'come': {
        const dx = w.player.x - this.x, dz = w.player.z - this.z, d = Math.hypot(dx, dz);
        if (d > 1.7) {
          speed = 1.2; this.yaw = Math.atan2(-dx, -dz);
        } else {
          speed = 0; headPitch = .7 + Math.sin(w.time * 2.2) * .04;
          if (this.stateTime > 5.5) {
            setState('idle'); this.until = 3; this.comeCooldown = 25;
            this.pickTarget(w.wagon, other);
          }
        }
        break;
      }
    }
    // Never walk through the player: nudge the point of interest wide.
    if ((this.state === 'walk' || this.state === 'come') && playerD < 1.5) {
      const away = Math.hypot(this.target.x - w.player.x, this.target.z - w.player.z) || 1;
      this.target.x += (this.target.x - w.player.x) / away * 1.6 * dt * 10;
      this.target.z += (this.target.z - w.player.z) / away * 1.6 * dt * 10;
      if (this.target.distanceTo(new THREE.Vector3(CLEARING.x, 0, CLEARING.z)) > CLEARING.r - .4) this.target.set(CLEARING.x, 0, CLEARING.z);
    }
    // Random 'look' flickers while idle.
    if (this.state === 'idle' && this.rng() < dt / 22) { setState('look'); this.until = 1.5 + this.rng() * 2.5; }
    out.speed = speed;
    out.yaw = this.yaw;
    out.head = { pitch: headPitch, yaw: headYaw };
    out.alert = alert;
    out.headDown = headPitch > .4;
    // Integrate position (called before the animal root is written by Adventure).
    if (speed > .001) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      this.x += fx * speed * dt; this.z += fz * speed * dt;
      const c = Math.hypot(this.x - CLEARING.x, this.z - CLEARING.z);
      if (c > CLEARING.r) { this.x = CLEARING.x + (this.x - CLEARING.x) / c * CLEARING.r; this.z = CLEARING.z + (this.z - CLEARING.z) / c * CLEARING.r; }
    }
  }
  private steerTo(target: THREE.Vector3, dt: number) {
    const want = Math.atan2(-(target.x - this.x), -(target.z - this.z));
    const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
    this.yaw += d * Math.min(1, dt * 2.4);
    return this.yaw;
  }
}

/** Yoked pair: each ox chases its yoke anchor with a critically-damped spring. */
export class OxController {
  private velA = new THREE.Vector3();
  private velB = new THREE.Vector3();
  private yawA = 0; private yawB = 0;
  private strain = 0;
  private moanCooldown = 0;
  onMoan?: (side: number, strength: number) => void;
  constructor(private oxen: [LivingAnimal, LivingAnimal]) {
    const a = oxen[0].root.position, b = oxen[1].root.position;
    this.yawA = oxen[0].root.rotation.y; this.yawB = oxen[1].root.rotation.y;
    void a; void b;
  }
  snap(x: number, z: number, yaw: number) {
    for (let i = 0; i < 2; i++) {
      const ox = this.oxen[i];
      ox.root.position.set(x + (i === 0 ? -.73 : .73) * Math.cos(yaw) + -5.46 * Math.sin(yaw), 0, z - (i === 0 ? -.73 : .73) * Math.sin(yaw) + -5.46 * Math.cos(yaw));
      ox.root.position.y = terrainHeight(ox.root.position.x, ox.root.position.z);
      ox.root.rotation.y = yaw;
      ox.root.updateMatrixWorld(true);
    }
    this.velA.set(0, 0, 0); this.velB.set(0, 0, 0);
  }
  update(dt: number, wagon: WorldSnapshot['wagon'] & { steering: number; braking: boolean }, journey: boolean) {
    dt = Math.max(0, Math.min(.1, dt));
    this.moanCooldown = Math.max(0, this.moanCooldown - dt);
    const cy = Math.cos(wagon.yaw), sy = Math.sin(wagon.yaw);
    const fx = -sy, fz = -cy;
    const prevSpeed = this.strain;
    this.strain = THREE.MathUtils.damp(this.strain, wagon.braking && Math.abs(wagon.speed) > .25 ? 1 : Math.min(1, Math.abs(wagon.speed) * 1.6), 4, dt);
    if (wagon.braking && Math.abs(wagon.speed) > .4 && this.moanCooldown <= 0 && prevSpeed < .5) { this.onMoan?.(Math.random() > .5 ? 0 : 1, 1); this.moanCooldown = 5; }
    for (let i = 0; i < 2; i++) {
      const ox = this.oxen[i], side = i === 0 ? -1 : 1;
      const vel = i === 0 ? this.velA : this.velB;
      const px = side * .73;
      // Yoke anchor: wagon-local (±.73, -5.46).
      const ax = wagon.x + px * cy + -5.46 * sy, az = wagon.z - px * sy + -5.46 * cy;
      // Ox root target: bit (≈1.42 m ahead of the root) sits 0.22 m ahead of the yoke.
      const tx = ax - fx * 1.2, tz = az - fz * 1.2;
      const pos = ox.root.position;
      if (journey) {
        pos.set(tx, 0, tz); vel.set(0, 0, 0);
      } else {
        const w0 = 4.5;
        vel.x += (w0 * w0 * (tx - pos.x) - 2 * w0 * vel.x) * dt;
        vel.z += (w0 * w0 * (tz - pos.z) - 2 * w0 * vel.z) * dt;
        pos.x += vel.x * dt; pos.z += vel.z * dt;
      }
      pos.y = terrainHeight(pos.x, pos.z);
      const moved = journey ? Math.abs(wagon.speed) : Math.hypot(vel.x, vel.z);
      // Yaw: follow the wagon with a lag, easing into turns.
      const yawTarget = wagon.yaw + THREE.MathUtils.clamp(wagon.steering * .3, -.28, .28) * (i === 0 ? .85 : 1);
      const yref = i === 0 ? this.yawA : this.yawB;
      const ny = journey ? yawTarget : yref + Math.atan2(Math.sin(yawTarget - yref), Math.cos(yawTarget - yref)) * Math.min(1, dt * (journey ? 10 : 5));
      ox.root.rotation.y = ny;
      if (i === 0) this.yawA = ny; else this.yawB = ny;
      ox.root.updateMatrixWorld(true);
      // Gait + head from the ox's real travel and the strain pose.
      const cmd: AnimalCommand = {
        speed: moved > .004 ? moved : 0,
        head: { pitch: -.10 + this.strain * .3, yaw: 0 },
        alert: 0,
        strain: this.strain * (1 - Math.min(1, moved * 2) * .5),
      };
      ox.update(dt, cmd);
    }
  }
}
export { NEUTRAL_HEAD };
