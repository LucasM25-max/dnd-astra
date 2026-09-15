import * as THREE from 'three';
import type { CanvasFactory } from '../../../character/skeletal/HeroTextures';
import { createQuadTextures, type QuadPaint, type QuadTextures } from './QuadTextures';

/**
 * Materials for one animal: every body region gets its own painted map, its own
 * relief scale and its own surface response, so a wet muzzle, a horny hoof wall
 * and a dusty coat never shade alike.
 *
 * Colour is baked into the maps by the painters (`QuadPaint` carries the
 * individual's base/mane/points), which is why `color` stays white here — the
 * tint is painted, not multiplied, so dapples and mud keep their own value.
 */

export interface QuadMats {
  trunk: THREE.MeshStandardMaterial;
  neck: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  leg: THREE.MeshStandardMaterial;
  coat: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  hide: THREE.MeshPhysicalMaterial;
  hoof: THREE.MeshStandardMaterial;
  horn: THREE.MeshStandardMaterial;
  eye: THREE.MeshPhysicalMaterial;
  leather: THREE.MeshStandardMaterial;
  felt: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  all: THREE.Material[];
  textures: QuadTextures;
  dispose(): void;
}

const nScale = (x: number): THREE.Vector2 => new THREE.Vector2(x, x);

export function createQuadMaterials(textures: QuadTextures): QuadMats {
  const t = textures;
  const coat = (name: string, map: THREE.Texture, bump: THREE.Texture | null, relief: number, roughness: number): THREE.MeshStandardMaterial =>
    // `normalMap` is only passed when a relief map exists: assigning undefined
    // makes three log a warning for every material on every animal.
    new THREE.MeshStandardMaterial({
      name, map, ...(bump ? { normalMap: bump, normalScale: nScale(relief) } : {}),
      roughness, metalness: 0, color: 0xffffff,
    });
  const trunk = coat('quad_trunk', t.trunk, t.trunkBump, 0.85, 0.95);
  const neck = coat('quad_neck', t.neck, t.neckBump, 0.8, 0.95);
  const head = coat('quad_head', t.head, t.headBump, 1.05, 0.9);
  const leg = coat('quad_leg', t.leg, t.legBump, 0.8, 0.96);
  // Generic coat for ears, tail root, tufts and crest: the trunk map, and the
  // loft UVs for these parts sample a different region of it.
  const coatMat = coat('quad_coat', t.trunk, t.trunkBump, 0.7, 0.97);
  const hair = coat('quad_hair', t.hair, t.hairBump, 0.75, 0.88);
  const hide = new THREE.MeshPhysicalMaterial({
    name: 'quad_hide', map: t.hide, ...(t.hideBump ? { normalMap: t.hideBump, normalScale: nScale(1.15) } : {}),
    roughness: 0.5, metalness: 0, clearcoat: 0.42, clearcoatRoughness: 0.35,
  });
  const hoof = coat('quad_hoof', t.hoof, t.hoofBump, 1.15, 0.62);
  const horn = coat('quad_horn', t.horn, t.hornBump, 1.0, 0.42);
  const eye = new THREE.MeshPhysicalMaterial({
    name: 'quad_eye', map: t.eye, roughness: 0.11, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.15,
  });
  const leather = coat('quad_leather', t.leather, t.leatherBump, 1.05, 0.7);
  const felt = coat('quad_felt', t.felt, t.feltBump, 1.3, 0.99);
  const brass = new THREE.MeshStandardMaterial({ name: 'quad_brass', color: '#a8823c', metalness: 0.86, roughness: 0.34 });
  const iron = new THREE.MeshStandardMaterial({ name: 'quad_iron', color: '#575a52', metalness: 0.84, roughness: 0.55 });
  const all: THREE.Material[] = [trunk, neck, head, leg, coatMat, hair, hide, hoof, horn, eye, leather, felt, brass, iron];
  return {
    trunk, neck, head, leg, coat: coatMat, hair, hide, hoof, horn, eye, leather, felt, brass, iron,
    all,
    textures: t,
    dispose() {
      for (const m of all) m.dispose();
      for (const tex of t.all) tex.dispose();
    },
  };
}

/** Paint every map an animal needs, then wrap it in materials. */
export function buildQuadMaterials(factory: CanvasFactory, paint: QuadPaint, sizeScale = 1): QuadMats {
  return createQuadMaterials(createQuadTextures(factory, paint, sizeScale));
}
