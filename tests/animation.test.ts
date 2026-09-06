import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LivingAnimal } from '../src/engine/actors/animals';
import type { AdventureMaterials } from '../src/engine/actors/materials';
describe('skeletal animal animation safety', () => {
  it('keeps skin weights normalized and handles a negative first frame without exploding the rig', () => {
    const base = new THREE.MeshStandardMaterial();
    const mat = { coat: new THREE.Texture(), coatNormal: new THREE.Texture(), hoof: base, eye: new THREE.MeshPhysicalMaterial(), leather: base, iron: base, horn: base } as AdventureMaterials;
    const geo = new THREE.CapsuleGeometry(.3, .6, 5, 8).translate(0, 1, 0);
    const animal = new LivingAnimal(geo, 'horse', '#765339', mat, 3);
    animal.update(-5, .012, false);
    for (const bone of animal.mesh.skeleton.bones) {
      expect(Math.abs(bone.rotation.x)).toBeLessThan(1.1); expect(Math.abs(bone.rotation.y)).toBeLessThan(.2);
      expect(Number.isFinite(bone.position.y)).toBe(true);
    }
    for (let i = 0; i < 150; i++) animal.update(.016, .013, i > 80);
    for (const bone of animal.mesh.skeleton.bones) expect(Math.abs(bone.rotation.x)).toBeLessThan(1.1);
    const weights = animal.mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < weights.count; i++) expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1, 5);
    expect(animal.mesh.skeleton.bones).toHaveLength(15);
    animal.mesh.skeleton.dispose(); animal.mesh.geometry.dispose();
  });
});
