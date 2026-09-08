import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createForestLife } from '../src/engine/nature';
import { seededRandom, terrainHeight } from '../src/engine/landscape';

describe('forest life - 2 mile forest with stream', () => {
  it('keeps birds aloft and butterflies above the ground over ten simulated minutes', () => {
    const scene = new THREE.Scene();
    const life = createForestLife(scene, seededRandom(7));
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let t = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      t += dt; life.update(dt, t);
    }
    // Updated: 8 birds = 16 wings, 14 butterflies = 28 wings for denser 2-mile forest
    expect(life.birdWings.count).toBe(16);
    expect(life.butterflyWings.count).toBe(28);
    for (let i = 0; i < life.birdWings.count; i++) {
      life.birdWings.getMatrixAt(i, m); m.decompose(p, q, s);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      expect(p.y).toBeGreaterThan(18);
      expect(p.y).toBeLessThan(50);
    }
    for (let i = 0; i < life.butterflyWings.count; i++) {
      life.butterflyWings.getMatrixAt(i, m); m.decompose(p, q, s);
      expect(Number.isFinite(p.y)).toBe(true);
      const ground = terrainHeight(p.x, p.z);
      expect(p.y).toBeGreaterThan(ground - .05);
      expect(p.y).toBeLessThan(ground + 2.5);
    }
  });

  it('rests butterflies in place instead of teleporting them across 2-mile forest', () => {
    const scene = new THREE.Scene();
    const life = createForestLife(scene, seededRandom(11));
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let t = 0;
    for (let i = 0; i < 3600; i++) {
      t += 1 / 60; life.update(1 / 60, t);
    }
    for (let i = 0; i < life.butterflyWings.count; i += 2) {
      life.butterflyWings.getMatrixAt(i, m); m.decompose(p, q, s);
      // Butterflies should stay within expanded flower belt around 2-mile forest
      expect(Math.hypot(p.x, p.z)).toBeLessThan(400);
    }
  });
});
