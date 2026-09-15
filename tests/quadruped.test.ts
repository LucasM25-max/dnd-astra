import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  LEG_IDS, QUAD_BONES, QUAD_SPECS, SPINE_STOPS, bellyClearance, buildQuadrupedRig, fetlockHeight, isForeLeg,
  type QuadSpecies,
} from '../src/engine/actors/quadruped/QuadrupedRig';
import {
  QUAD_CLIP_NAMES, QUAD_LOOP_CLIPS, buildQuadClips, footAngles, plantedCount, swingWindow,
} from '../src/engine/actors/quadruped/QuadrupedClips';
import { buildQuadrupedBody, loftGeometry } from '../src/engine/actors/quadruped/QuadrupedBody';
import { quadPalette, createQuadTextures, QUAD_MAP_SIZE, type QuadPaint } from '../src/engine/actors/quadruped/QuadTextures';
import { hexToRgb } from '../src/character/skeletal/HeroTextures';
import { buildQuadMaterials } from '../src/engine/actors/quadruped/QuadMaterials';
import { SkeletalQuadruped } from '../src/engine/actors/quadruped/SkeletalQuadruped';

/**
 * Node has no canvas, so the painters are exercised against a recording stub:
 * the point is structure (which calls happen, that nothing throws, that pixel
 * relief is skipped when `getImageData` is unavailable), not pixel colours.
 * Actual coat appearance is covered by the browser smoke run.
 */
function stubCanvas(w: number, h: number): HTMLCanvasElement {
  const calls: string[] = [];
  const grad = { addColorStop: (o: number, c: string) => calls.push(`stop:${o}:${c}`) };
  const ctx = {
    canvas: { width: w, height: h },
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', globalAlpha: 1, globalCompositeOperation: 'source-over',
    beginPath: () => calls.push('beginPath'), closePath: () => {}, moveTo: () => {}, lineTo: () => {},
    quadraticCurveTo: () => {}, bezierCurveTo: () => {}, arc: () => {}, ellipse: () => {}, rect: () => {},
    fill: () => calls.push('fill'), stroke: () => calls.push('stroke'), clip: () => {},
    save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {}, scale: () => {},
    fillRect: () => calls.push('fillRect'), strokeRect: () => {}, clearRect: () => {}, setLineDash: () => {},
    drawImage: () => calls.push('drawImage'),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
  };
  return {
    width: w, height: h,
    getContext: () => ctx,
    __calls: calls,
  } as unknown as HTMLCanvasElement;
}
const stubFactory = (w: number, h: number) => stubCanvas(w, h);

const PAINTS: Record<QuadSpecies, QuadPaint> = {
  ox: { species: 'ox', base: '#8d7a5e', mane: '#5e5040', points: '#43382b', marking: 'plain', seed: 3 },
  horse: { species: 'horse', base: '#765339', mane: '#3b2c1f', points: '#241b13', marking: 'blaze', seed: 2 },
};

describe('quadruped rig', () => {
  it('has one unique, reachable bone per named joint', () => {
    for (const species of ['ox', 'horse'] as QuadSpecies[]) {
      const rig = buildQuadrupedRig(species);
      expect(new Set(QUAD_BONES).size).toBe(QUAD_BONES.length);
      for (const name of QUAD_BONES) {
        const bone = rig.bones[name];
        expect(bone, name).toBeInstanceOf(THREE.Bone);
        expect(Number.isFinite(bone.position.x + bone.position.y + bone.position.z), name).toBe(true);
      }
      // Every bone except the root hangs off another rig bone.
      for (const name of QUAD_BONES.slice(1)) {
        expect(rig.bones[name].parent, name).toBeTruthy();
      }
    }
  });

  it('binds the spine in order and runs the trunk loft front to rear', () => {
    for (const species of ['ox', 'horse'] as QuadSpecies[]) {
      const rig = buildQuadrupedRig(species);
      for (const [name] of SPINE_STOPS) expect(QUAD_BONES, name).toContain(name);
      // Withers → Chest → Loin → Hips must march toward the tail, at roughly
      // the heights the trunk loft expects. Positions are parent-relative, so
      // the comparison has to happen in bind space.
      rig.group.updateMatrixWorld(true);
      const at = SPINE_STOPS.map(([name]) => rig.bones[name].getWorldPosition(new THREE.Vector3()));
      at.slice(1).forEach((v, i) => expect(v.z < at[i].z, `${species} ${SPINE_STOPS[i + 1][0]}`).toBe(true));
      for (const p of at) expect(p.y).toBeGreaterThan(0.8);
      // Every trunk cross-section is narrower than it is tall or the reverse of
      // the one beside it — a barrel, not a stack of unrelated ellipses.
      let prevZ = Infinity;
      for (const stop of rig.spec.trunk) {
        expect(stop.at[2] < prevZ, species).toBe(true);
        expect(stop.hw).toBeGreaterThan(0.05);
        prevZ = stop.at[2];
      }
    }
  });

  it('stands its feet on the ground and clears its belly above the hooves', () => {
    for (const species of ['ox', 'horse'] as QuadSpecies[]) {
      const rig = buildQuadrupedRig(species);
      const clearance = bellyClearance(rig.spec);
      expect(clearance).toBeGreaterThan(0.1);
      for (const leg of LEG_IDS) {
        const raise = fetlockHeight(rig.spec, leg);
        expect(raise, leg).toBeGreaterThanOrEqual(0);
        expect(raise).toBeLessThan(clearance);
        expect(isForeLeg(leg)).toBe(leg[0] === 'F');
      }
      // Coronets must not sink under the terrain: all four sit above the hoof.
      const lowest = Math.min(...LEG_IDS.map(l => rig.spec.legs[l].chain[5][1]));
      expect(lowest).toBeGreaterThan(0.08);
    }
  });

  it('distinguishes the species that the silhouettes depend on', () => {
    expect(QUAD_SPECS.ox.horn).toBeTruthy();
    expect(QUAD_SPECS.ox.mane).toBeFalsy();
    expect(QUAD_SPECS.horse.mane).toBeTruthy();
    expect(QUAD_SPECS.horse.horn).toBeFalsy();
    // Cattle amble in two lateral couples — each forefoot lands right behind its
    // own hindfoot — while a horse's four beats are spread evenly apart.
    const ox = QUAD_SPECS.ox.gait.walk.phases, horse = QUAD_SPECS.horse.gait.walk.phases;
    expect(Math.abs(ox.FL - ox.RL)).toBeLessThan(0.2);
    expect(Math.abs(ox.FR - ox.RR)).toBeLessThan(0.2);
    expect(Math.abs(Math.abs(ox.FL - ox.FR) - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(horse.FL - horse.FR)).toBeCloseTo(0.5, 2);
    expect(Math.abs(horse.FL - horse.RL)).toBeCloseTo(0.25, 2);
    expect(QUAD_SPECS.horse.height).toBeGreaterThan(QUAD_SPECS.ox.height);
  });
});

describe('quadruped gait math', () => {
  it('keeps at least two feet planted through a walk', () => {
    for (const species of ['ox', 'horse'] as QuadSpecies[]) {
      const gait = QUAD_SPECS[species].gait.walk;
      for (let i = 0; i < 120; i++) {
        const planted = plantedCount(i / 120, gait);
        expect(planted, `${species} @${i / 120}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('lands a horse walk as four separate beats in lateral sequence', () => {
    const gait = QUAD_SPECS.horse.gait.walk;
    const order = LEG_IDS.slice().sort((a, b) => gait.phases[a] - gait.phases[b]);
    expect(order).toEqual(['RL', 'FL', 'RR', 'FR']);
    for (let i = 0; i < LEG_IDS.length; i++) {
      for (let j = i + 1; j < LEG_IDS.length; j++) {
        const gap = Math.abs(gait.phases[LEG_IDS[i]] - gait.phases[LEG_IDS[j]]);
        expect(Math.min(gap, 1 - gap), `${LEG_IDS[i]}/${LEG_IDS[j]}`).toBeGreaterThan(0.08);
      }
    }
  });

  it('trot lifts diagonal pairs together with a moment of suspension', () => {
    const gait = QUAD_SPECS.horse.gait.trot;
    const counts = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const u = i / 60;
      const angles = Object.fromEntries(LEG_IDS.map(l => [l, footAngles(u, l, gait, 'horse')])) as
        Record<typeof LEG_IDS[number], ReturnType<typeof footAngles>>;
      expect(angles.FL.planted).toBe(angles.RR.planted);
      expect(angles.FR.planted).toBe(angles.RL.planted);
      expect(plantedCount(u, gait) % 2).toBe(0);
      counts.add(plantedCount(u, gait));
    }
    // A working trot has both a grounded diagonal pair and a suspension phase.
    expect(counts.has(2)).toBe(true);
    expect(counts.has(0)).toBe(true);
    // Diagonals: a fore and the opposite hind move as one unit.
    const window = swingWindow(gait, 'FL');
    const mid = (window.from + 0.14) % 1;
    expect(footAngles(mid, 'FL', gait, 'horse').planted).toBe(false);
    expect(footAngles(mid, 'RR', gait, 'horse').planted).toBe(false);
    expect(footAngles(mid, 'FR', gait, 'horse').planted).toBe(true);
  });

  it('never lets a planted hoof rise, and lifts a swinging one', () => {
    const gait = QUAD_SPECS.horse.gait.walk;
    for (let i = 0; i < 200; i++) {
      for (const leg of LEG_IDS) {
        const f = footAngles(i / 200, leg, gait, 'horse');
        if (f.planted) expect(f.lift).toBe(0);
        expect(Number.isFinite(f.upper + f.flex + f.sole + f.splay), leg).toBe(true);
        expect(Math.abs(f.upper)).toBeLessThan(30);
      }
    }
    let peak = 0;
    for (let i = 0; i < 100; i++) peak = Math.max(peak, footAngles(i / 100, 'FL', gait, 'horse').lift);
    expect(peak).toBeGreaterThan(gait.lift * 0.85);
  });

  it('keeps stance retraction monotone so a planted foot cannot skate forward', () => {
    const gait = QUAD_SPECS.horse.gait.walk;
    for (const leg of LEG_IDS) {
      let prev = -Infinity;
      for (let i = 0; i < 40; i++) {
        // Sample the foot's own stance window, not the global cycle.
        const u = (i / 40) * gait.duty + gait.phases[leg];
        const f = footAngles(u, leg, gait, 'horse');
        expect(f.planted, `${leg}@${u.toFixed(2)}`).toBe(true);
        // The limb sweeps from protracted to retracted, never back again.
        expect(f.upper > prev - 1e-6, `${leg}@${u.toFixed(2)}`).toBe(true);
        prev = f.upper;
      }
    }
  });
});

describe('quadruped clips', () => {
  it('builds every named clip with normalised quaternion tracks', () => {
    for (const species of ['ox', 'horse'] as QuadSpecies[]) {
      const clips = buildQuadClips(species, QUAD_SPECS[species]);
      expect(Object.keys(clips).sort()).toEqual(QUAD_CLIP_NAMES.slice().sort());
      for (const name of QUAD_CLIP_NAMES) {
        const clip = clips[name];
        // Loops must move the spine and several joints; a small gesture (a tail
        // swat) is legitimately narrow, but still needs more than the tail.
        expect(clip.tracks.length, `${species}/${name}`).toBeGreaterThan(QUAD_LOOP_CLIPS.includes(name) ? 5 : 3);
        if (QUAD_LOOP_CLIPS.includes(name)) {
          expect(clip.tracks.some(t => t.name === 'Root.position'), `${species}/${name} has no root motion`).toBe(true);
        }
        const q = clip.tracks.find(t => t.name.endsWith('.quaternion'));
        expect(q, `${species}/${name} has no quaternion track`).toBeTruthy();
        const v = q!.values;
        for (let i = 0; i + 3 < v.length; i += 4) {
          const len = Math.hypot(v[i], v[i + 1], v[i + 2], v[i + 3]);
          expect(len, `${species}/${name} @${i}`).toBeGreaterThan(0.999);
          expect(len).toBeLessThan(1.001);
          expect(Number.isFinite(v[i])).toBe(true);
        }
      }
    }
  });

  it('loops seamlessly: the last baked frame repeats the first', () => {
    for (const species of ['ox', 'horse'] as QuadSpecies[]) {
      const clips = buildQuadClips(species, QUAD_SPECS[species]);
      for (const name of QUAD_LOOP_CLIPS) {
        const pos = clips[name].tracks.find(t => t.name === 'Root.position')!;
        const v = pos.values as unknown as number[];
        const n = v.length / 3;
        for (let c = 0; c < 3; c++) {
          // Linear interpolation across the loop point must not jump.
          expect(Math.abs(v[c] - v[(n - 1) * 3 + c]) < 0.02, `${species}/${name}`).toBe(true);
        }
        expect(clips[name].duration).toBeGreaterThan(0.2);
      }
    }
  });

  it('freezes a leg pose that keeps the sole level through the whole step', () => {
    // Chain-compensated ankles: the sum of X rotations at the Foot equals the
    // authored sole pitch for every foot at every phase.
    const gait = QUAD_SPECS.ox.gait.walk;
    for (const leg of LEG_IDS) {
      const f = footAngles(0.31, leg, gait, 'ox');
      const lower = isForeLeg(leg) ? f.flex : -f.flex;
      const chain = (isForeLeg(leg) ? -f.root + -f.upper : -f.root * 0.4 + -f.upper) + lower;
      const sole = f.sole;
      expect(Math.abs(sole)).toBeLessThan(45);
      expect(Number.isFinite(chain + sole)).toBe(true);
    }
  });
});

describe('quadruped body geometry', () => {
  it('lofts a closed, watertight-enough tube with finite attributes', () => {
    const geo = loftGeometry([
      { at: [0, 1, 0], hw: 0.2, hh: 0.3 },
      { at: [0, 1, 0.4], hw: 0.25, hh: 0.32 },
      { at: [0, 1, 0.8], hw: 0.18, hh: 0.24 },
    ], { seg: 12, capFront: 0.5, capBack: 0.5 });
    const pos = geo.getAttribute('position');
    const index = geo.getIndex()!;
    expect(index.count % 3).toBe(0);
    expect(pos.count).toBeGreaterThan(3 * 12);
    for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    expect(geo.getAttribute('uv').count).toBe(pos.count);
    expect(geo.getAttribute('normal').count).toBe(pos.count);
  });

  it('keeps every region\'s skin weights normalised', () => {
    for (const species of ['ox', 'horse'] as QuadSpecies[]) {
      const rig = buildQuadrupedRig(species);
      const mats = buildQuadMaterials(stubFactory, PAINTS[species], 0.25);
      const body = buildQuadrupedBody(rig, mats);
      // Trunk, neck, head and jaw are skinned; the legs stay rigid segments.
      expect(body.skinned.length).toBeGreaterThanOrEqual(3);
      expect(body.skinned.some(m => m.name.includes('trunk'))).toBe(true);
      for (const mesh of body.skinned) {
        const weight = mesh.geometry.getAttribute('skinWeight');
        const index = mesh.geometry.getAttribute('skinIndex');
        expect(weight, mesh.name).toBeTruthy();
        for (let i = 0; i < weight.count; i++) {
          const sum = weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i);
          expect(Math.abs(sum - 1), `${mesh.name} v${i}`).toBeLessThan(0.02);
          for (let b = 0; b < 4; b++) {
            expect(index.getX(i) + b).toBeLessThan(rig.skeleton.bones.length);
          }
        }
      }
      body.dispose();
      mats.dispose();
    }
  });

  it('stays inside a believable silhouette for its species', () => {
    for (const species of ['ox', 'horse'] as QuadSpecies[]) {
      const animal = new SkeletalQuadruped(species, {
        canvasFactory: stubFactory, tint: PAINTS[species].base, seed: 3, textureScale: 0.25,
      });
      animal.freezeAt('idle', 0);
      animal.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(animal.root);
      const spec = animal.rig.spec;
      // Feet on the floor, topline near the stated withers height, and never a
      // barrel wider than a legged animal can be.
      expect(box.min.y, species).toBeGreaterThan(-0.09);
      // Ears, and a yoke ox's horns, reach half a metre above the withers.
      expect(box.max.y, species).toBeLessThan(spec.height + 0.5);
      expect(box.max.y).toBeGreaterThan(spec.height - 0.35);
      expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), species).toBeLessThan(0.95);
      expect(box.max.z - box.min.z, species).toBeGreaterThan(1.35);
      expect(animal.triangles).toBeGreaterThan(4000);
      animal.dispose();
    }
  });

  it('exposes the hardware anchors the reins and traces follow', () => {
    for (const species of ['ox', 'horse'] as QuadSpecies[]) {
      const rig = buildQuadrupedRig(species);
      const mats = buildQuadMaterials(stubFactory, PAINTS[species], 0.25);
      const body = buildQuadrupedBody(rig, mats);
      expect(body.eyes.length).toBe(2);
      // Bind space faces +Z: the muzzle is ahead of the poll, the bit below it.
      const nose = body.nose.getWorldPosition(new THREE.Vector3());
      const bit = body.bit.getWorldPosition(new THREE.Vector3());
      const collar = body.collar.getWorldPosition(new THREE.Vector3());
      expect(nose.z).toBeGreaterThan(0.3);
      // The bit sits in the corners of the mouth: behind the muzzle, at its height.
      expect(bit.z).toBeLessThan(nose.z - 0.02);
      expect(Math.abs(bit.y - nose.y)).toBeLessThan(0.3);
      expect(collar.z).toBeLessThan(nose.z);
      expect(collar.y).toBeGreaterThan(0.8);
      body.dispose();
      mats.dispose();
    }
  });
});

describe('quadruped textures and materials', () => {
  it('paints one map per region, sized by tier', () => {
    const p = PAINTS.horse;
    const full = createQuadTextures(stubFactory, p, 1);
    const half = createQuadTextures(stubFactory, p, 0.5);
    expect((full.trunk.image as HTMLCanvasElement).width).toBe(QUAD_MAP_SIZE.trunk[0]);
    expect((full.leg.image as HTMLCanvasElement).width).toBe(QUAD_MAP_SIZE.leg[0]);
    expect((half.trunk.image as HTMLCanvasElement).width).toBe(QUAD_MAP_SIZE.trunk[0] / 2);
    // The tier is binary, and no map drops under the 64 px floor.
    expect((half.trunk.image as HTMLCanvasElement).width).toBe((createQuadTextures(stubFactory, p, 0.25).trunk.image as HTMLCanvasElement).width);
    expect((half.hoof.image as HTMLCanvasElement).width).toBeGreaterThanOrEqual(64);
    for (const t of full.all) {
      expect(t.wrapS, t.name).toBe(THREE.RepeatWrapping);
      expect(t.wrapT).toBe(THREE.RepeatWrapping);
      expect(t.colorSpace, t.name).toBe(t.name.endsWith('_normal') ? THREE.NoColorSpace : THREE.SRGBColorSpace);
    }
    // Eleven albedos plus a normal map for every region that got relief.
    expect(full.all.length).toBeGreaterThanOrEqual(11);
    expect(new Set(full.all.map(t => t.name)).size).toBe(full.all.length);
  });

  it('gives every region its own map instead of one shared coat', () => {
    const mats = buildQuadMaterials(stubFactory, PAINTS.ox, 0.25);
    const regions = ['trunk', 'neck', 'head', 'leg', 'hair', 'hide', 'hoof', 'horn', 'leather', 'felt'] as const;
    const seen = new Map<string, THREE.Texture>();
    for (const key of regions) {
      const mat = mats[key] as THREE.MeshStandardMaterial;
      expect(mat.map, key).toBeTruthy();
      expect(mats.textures.all).toContain(mat.map);
      // The whole point of the per-region pass: no two regions may share an
      // albedo, or the animal reads as one flat colour again. (`coat` is
      // deliberately the trunk map sampled through offset UVs, so it is not
      // in this list.)
      for (const [other, tex] of seen) expect(tex === mat.map, `${key} shares a map with ${other}`).toBe(false);
      seen.set(key, mat.map!);
      if (key !== 'hide') expect(mat.color.getHex(), key).toBe(0xffffff);
    }
    expect(mats.hoof.roughness).toBeLessThan(mats.trunk.roughness);
    expect(mats.horn.roughness).toBeLessThan(mats.trunk.roughness);
    expect(mats.eye.roughness).toBeLessThan(0.2);
    expect(mats.brass.metalness).toBeGreaterThan(0.7);
    mats.dispose();
  });

  it('lightens a grey coat mane but keeps a bay\'s points dark', () => {
    const bay = quadPalette('horse', '#765339', 2);
    const grey = quadPalette('horse', '#b0aca0', 7);
    const lightness = (hex: string): number => hexToRgb(hex).reduce((a, c) => a + c, 0);
    expect(lightness(grey.mane)).toBeGreaterThan(lightness(bay.mane));
    expect(lightness(bay.points)).toBeLessThan(lightness(bay.base));
    expect(['plain', 'blaze', 'stripe', 'star', 'snip']).toContain(bay.marking);
    expect(['plain', 'patched']).toContain(quadPalette('ox', '#cfbfa0', 4).marking);
  });
});

describe('skeletal quadruped actor', () => {
  function make(species: QuadSpecies = 'horse'): SkeletalQuadruped {
    return new SkeletalQuadruped(species, {
      canvasFactory: stubFactory, tint: species === 'ox' ? '#a99676' : '#765339', seed: 5, textureScale: 0.25,
    });
  }

  it('faces -Z so forward travel matches the hero', () => {
    const animal = make();
    animal.root.updateMatrixWorld(true);
    const nose = animal.nosePosition(new THREE.Vector3());
    const collar = animal.collarPosition(new THREE.Vector3());
    expect(nose.z).toBeLessThan(collar.z);
    expect(nose.y).toBeGreaterThan(0.9);
    animal.dispose();
  });

  it('selects a gait loop and couples its rate to real ground speed', () => {
    const animal = make();
    expect(animal.currentClip).toBe('idle');
    animal.setGait('walk');
    expect(animal.currentClip).toBe('walk');
    const slow = animal['actions'].get('walk')!.timeScale;
    animal.setSpeed(2.6);
    const fast = animal['actions'].get('walk')!.timeScale;
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeLessThanOrEqual(1.9);
    // A horse trotting at 2.6 m/s should not be forced into super-slow motion.
    animal.setGait('trot');
    animal.setSpeed(2.6);
    expect(animal['actions'].get('trot')!.timeScale).toBeGreaterThan(0.5);
    animal.dispose();
  });

  it('finishes one-shots and hands the skeleton back to the gait loop', () => {
    const animal = make('ox');
    animal.setGait('idle');
    animal.playOneShot('startle');
    expect(animal.currentClip).toBe('startle');
    for (let i = 0; i < 200; i++) animal.update(1 / 60);
    expect(animal.currentClip).toBe('idle');
    animal.dispose();
  });

  it('adds secondary motion on top of the clip without corrupting quaternions', () => {
    const animal = make();
    animal.setLookAt(new THREE.Vector3(2.2, 1.4, -3.4));
    const before = animal.rig.bones.EarL.quaternion.clone();
    for (let i = 0; i < 40; i++) animal.update(1 / 60);
    const after = animal.rig.bones.EarL.quaternion.clone();
    expect(after.angleTo(before)).toBeGreaterThan(0.0005);
    for (const name of QUAD_BONES) {
      const q = animal.rig.bones[name].quaternion;
      expect(Number.isFinite(q.x + q.y + q.z + q.w), name).toBe(true);
      expect(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1)).toBeLessThan(1e-3);
    }
    animal.dispose();
  });

  it('holds a frozen pose deterministically for screenshots', () => {
    const a = make('ox'), b = make('ox');
    a.freezeAt('walk', 0.66);
    b.freezeAt('walk', 0.66);
    for (const name of QUAD_BONES) {
      expect(a.rig.bones[name].quaternion.dot(b.rig.bones[name].quaternion)).toBeCloseTo(1, 6);
    }
    a.update(1 / 60);
    expect(a.rig.bones.Head.quaternion.dot(b.rig.bones.Head.quaternion)).toBeCloseTo(1, 6);
    a.dispose();
    b.dispose();
  });

  it('tracks feet through a full cycle and disposes cleanly', () => {
    const animal = make();
    animal.setGait('walk');
    const heights: number[] = [];
    for (let i = 0; i < 64; i++) {
      animal.update(1 / 60);
      animal.root.updateMatrixWorld(true);
      heights.push(animal.footPosition('FL', new THREE.Vector3()).y);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.01);
    expect(animal.triangles).toBeGreaterThan(4000);
    animal.dispose();
    expect(animal.root.children.length).toBe(0);
  });
});
