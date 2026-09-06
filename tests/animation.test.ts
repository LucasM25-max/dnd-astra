import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LivingAnimal, NEUTRAL_HEAD } from '../src/engine/actors/animals';
import { HorseBrain, OxController } from '../src/engine/actors/behaviour';
import { terrainHeight } from '../src/engine/landscape';
import type { AdventureMaterials } from '../src/engine/actors/materials';

function materials(): AdventureMaterials {
  const base = new THREE.MeshStandardMaterial();
  return { coat: new THREE.Texture(), coatNormal: new THREE.Texture(), hoof: base, eye: new THREE.MeshPhysicalMaterial(), leather: base, iron: base, horn: base } as AdventureMaterials;
}
const flat = (x: number, z: number) => terrainHeight(x, z);

describe('procedural quadruped rig', () => {
  it('has 16 bones with normalized skin weights and valid indices', () => {
    const animal = new LivingAnimal('horse', '#765339', materials(), 3, 1);
    const bones = animal.mesh.skeleton.bones;
    expect(bones).toHaveLength(16);
    const index = animal.mesh.geometry.getAttribute('skinIndex'), weight = animal.mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < weight.count; i++) {
      const sum = weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i);
      expect(sum).toBeCloseTo(1, 5);
      expect(index.getX(i)).toBeGreaterThanOrEqual(0);
      expect(index.getX(i)).toBeLessThan(bones.length);
      expect(weight.getX(i)).toBeGreaterThanOrEqual(0); expect(weight.getX(i)).toBeLessThanOrEqual(1);
      expect(weight.getY(i)).toBeGreaterThanOrEqual(0); expect(weight.getY(i)).toBeLessThanOrEqual(1);
    }
    animal.mesh.skeleton.dispose(); animal.mesh.geometry.dispose();
  });

  it('keeps every bone finite and bounded over five simulated minutes of mixed gaits', () => {
    const animal = new LivingAnimal('ox', '#cfbfa0', materials(), 1, 1);
    animal.update(-5, { speed: 0, head: { pitch: 1.2, yaw: 1.2 }, alert: 1, strain: 1 }); // hostile first frame
    const frames = 5 * 60 * 60; // 5 min @ 60 fps
    for (let f = 0; f < frames; f++) {
      const t = f / 60;
      const speed = Math.sin(t * .21) * 1.3; // walk -> trot -> reverse -> stop
      animal.update(1 / 60, { speed, head: { pitch: Math.sin(t * .7) * .9, yaw: Math.cos(t * .4) * 1.1 }, alert: Math.max(0, Math.sin(t * .13)), strain: Math.max(0, Math.sin(t * .3)) });
    }
    for (const bone of animal.mesh.skeleton.bones) {
      expect(Number.isFinite(bone.rotation.x) && Number.isFinite(bone.rotation.y) && Number.isFinite(bone.rotation.z)).toBe(true);
      expect(Number.isFinite(bone.position.y)).toBe(true);
      expect(Math.abs(bone.rotation.x)).toBeLessThan(1.6);
      expect(Math.abs(bone.rotation.z)).toBeLessThan(.6);
    }
    animal.mesh.skeleton.dispose(); animal.mesh.geometry.dispose();
  });

  it('plants hooves on the ground when standing, including on a bank', () => {
    const animal = new LivingAnimal('horse', '#765339', materials(), 7, 1);
    // Flat ground first (root sits on the terrain, as in-game).
    animal.root.position.set(-2, flat(-2, 3.4), 3.4); animal.root.updateMatrixWorld(true);
    for (let i = 0; i < 40; i++) animal.update(1 / 60, { speed: 0, head: NEUTRAL_HEAD, alert: 0, strain: 0 });
    const feet = animal.legs; // private, but reachable for a white-box test
    for (const leg of feet) {
      const p = leg.foot.getWorldPosition(new THREE.Vector3());
      expect(Math.abs(p.y - (flat(p.x, p.z) + .144))).toBeLessThan(.03);
    }
    // Then on a real bank, where the old rig sank or floated.
    animal.root.position.set(-20, flat(-20, -14), -14); animal.root.rotation.y = -Math.PI / 4; animal.root.updateMatrixWorld(true);
    for (let i = 0; i < 60; i++) animal.update(1 / 60, { speed: 0, head: NEUTRAL_HEAD, alert: 0, strain: 0 });
    for (const leg of feet) {
      const p = leg.foot.getWorldPosition(new THREE.Vector3());
      // 28-degree bank: a few centimetres of residual is the body-tilt budget.
      expect(Math.abs(p.y - (flat(p.x, p.z) + .144))).toBeLessThan(.05);
    }
    animal.mesh.skeleton.dispose(); animal.mesh.geometry.dispose();
  });

  it('advances the gait in step with actual travel (stride integrity)', () => {
    const animal = new LivingAnimal('horse', '#765339', materials(), 4, 1);
    animal.root.position.set(-30, flat(-30, -8), -8);
    animal.root.updateMatrixWorld(true);
    for (let i = 0; i < 300; i++) { // ~5 s of trotting along -Z
      animal.update(1 / 60, { speed: 1.3, head: NEUTRAL_HEAD, alert: 0, strain: 0 });
      animal.root.position.z -= 1.3 / 60;
    }
    // The first front foot has completed ~3 full stance/swing cycles and must be in a
    // sane contact state: its planted point sits on the terrain it last stepped on.
    const leg = animal.legs[0];
    const p = leg.foot.getWorldPosition(new THREE.Vector3());
    expect(Math.abs(p.y - (flat(p.x, p.z) + .144))).toBeLessThan(.06);
    animal.mesh.skeleton.dispose(); animal.mesh.geometry.dispose();
  });
});

describe('behaviour', () => {
  it('keeps a horse inside the clearing, away from a parked wagon, with bounded output', () => {
    const brain = new HorseBrain(2);
    brain.place(9.3, 2.9, -.6);
    const out = { speed: 0, yaw: 0, head: { pitch: 0, yaw: 0 }, alert: 0, headDown: false };
    // The wagon drives in from the west, parks inside the clearing; the horse
    // must startle, retarget, and never pass through the wagon.
    const wagon = { x: -4, z: 4, yaw: 0, speed: 2 };
    let sawStartle = false;
    for (let f = 0; f < 60 * 40; f++) {
      const t = f / 60;
      if (t < 6) wagon.x += 2 / 60; else wagon.speed = 0;
      brain.update(1 / 60, { x: 99, z: 99 }, { time: t, player: new THREE.Vector3(0, 0, 0), wagon }, out);
      if (brain.state === 'startle') sawStartle = true;
      const c = Math.hypot(brain.x - 9.7, brain.z - 2);
      expect(c).toBeLessThanOrEqual(5.1);
      const wd = Math.hypot(brain.x - wagon.x, brain.z - wagon.z);
      if (brain.state !== 'startle' || brain.stateTime > .8) expect(wd).toBeGreaterThan(1.6);
      expect(out.speed).toBeGreaterThanOrEqual(0); expect(out.speed).toBeLessThanOrEqual(1.5);
      expect(Number.isFinite(out.head.pitch) && Number.isFinite(out.head.yaw)).toBe(true);
    }
    expect(sawStartle).toBe(true);
  });

  it('has the yoked pair settle within 0.3 m of the yoke anchors', () => {
    const a = new LivingAnimal('ox', '#cfbfa0', materials(), 1, 1);
    const b = new LivingAnimal('ox', '#a99676', materials(), 3, 1);
    const controller = new OxController([a, b]);
    const wagon = { x: -10, z: -10, yaw: 0, speed: 0, steering: 0, braking: false };
    controller.snap(wagon.x, wagon.z, wagon.yaw);
    // Jog the wagon and verify the pair tracks the yoke with a damped spring.
    for (let f = 0; f < 60 * 6; f++) {
      wagon.x += .5 / 60; wagon.yaw += .05 / 60;
      controller.update(1 / 60, { ...wagon }, false);
    }
    const cy = Math.cos(wagon.yaw), sy = Math.sin(wagon.yaw);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const ox = i === 0 ? a : b;
      const ax = wagon.x + side * .73 * cy + -5.46 * sy, az = wagon.z - side * .73 * sy + -5.46 * cy;
      const fx = -sy, fz = -cy;
      const tx = ax - fx * 1.2, tz = az - fz * 1.2;
      const err = Math.hypot(ox.root.position.x - tx, ox.root.position.z - tz);
      expect(err).toBeLessThan(.3);
      expect(Number.isFinite(ox.root.position.x) && Number.isFinite(ox.root.position.y)).toBe(true);
    }
  });
});
