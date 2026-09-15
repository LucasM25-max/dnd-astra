import * as THREE from 'three';
import type { AdventureMaterials } from '../materials';
import { buildQuadrupedRig, QUAD_SPECS, type QuadSpecies } from './QuadrupedRig';
import { buildQuadrupedBody, type QuadBody, type QuadMats } from './QuadrupedBody';
import { buildQuadClips, type QuadClipName } from './QuadrupedClips';

/**
 * A living quadruped: procedural rig + skinned body + animation mixer, the
 * animal counterpart of SkeletalHero. The rig faces +Z in bind space and the
 * assembly is rotated π about Y here so the world convention matches the
 * player avatar (forward = −Z at yaw 0).
 */

export type QuadGait = 'idle' | 'walk' | 'sniff' | 'tied';
export type QuadOneShot = 'startle' | 'tie_react';

export class SkeletalQuadruped {
  readonly root = new THREE.Group();
  readonly species: QuadSpecies;
  readonly height: number;
  private readonly rig;
  private readonly body: QuadBody;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<QuadClipName, THREE.AnimationAction>();
  private readonly materials: QuadMats;
  private gait: QuadGait = 'idle';
  private oneShot: QuadClipName | null = null;

  constructor(base: AdventureMaterials, species: QuadSpecies, tint: string, seed: number) {
    this.species = species;
    const spec = QUAD_SPECS[species];
    this.height = spec.height;
    const color = new THREE.Color(tint);
    const coat = new THREE.MeshStandardMaterial({
      map: base.coat, normalMap: base.coatNormal, color, roughness: .96,
      normalScale: new THREE.Vector2(.55, .55),
    });
    const dark = new THREE.MeshStandardMaterial({
      map: base.coat, normalMap: base.coatNormal, color: color.clone().multiplyScalar(.34), roughness: .94,
      normalScale: new THREE.Vector2(.4, .4),
    });
    const hair = new THREE.MeshStandardMaterial({
      color: color.clone().lerp(new THREE.Color('#1d1712'), .72), roughness: .98,
    });
    this.materials = { coat, dark, hair, hoof: base.hoof, eye: base.eye, horn: base.horn };

    this.rig = buildQuadrupedRig(species);
    this.body = buildQuadrupedBody(this.rig, this.materials);
    const inner = new THREE.Group();
    inner.rotation.y = Math.PI;
    inner.add(this.rig.group, this.body.group);
    this.root.add(inner);
    this.root.name = `${species}_${seed}`;
    // Bone inverses and bind matrices must be captured with the π yaw flip in
    // place, otherwise the skin solves against the un-flipped bind pose.
    this.root.updateMatrixWorld(true);
    this.rig.skeleton.calculateInverses();
    for (const m of this.body.skinned) m.bind(this.rig.skeleton);

    this.mixer = new THREE.AnimationMixer(this.rig.group);
    const clips = buildQuadClips(species, spec);
    for (const [name, clip] of Object.entries(clips)) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.actions.set(name as QuadClipName, action);
    }
    this.mixer.addEventListener('finished', e => {
      if (this.oneShot && e.action.getClip().name === this.oneShot) {
        this.oneShot = null;
        e.action.fadeOut(.3);
        this.actions.get(this.gait)?.reset().fadeIn(.3).play();
      }
    });
    this.actions.get('idle')?.play();
  }

  get bit(): THREE.Object3D { return this.body.bit; }

  setGait(gait: QuadGait, fade = 0.32): void {
    if (gait === this.gait && !this.oneShot) return;
    this.gait = gait;
    if (this.oneShot) return; // let the one-shot finish first
    const next = this.actions.get(gait);
    const current = [...this.actions.values()].find(a => a.isRunning() && a.getEffectiveWeight() > 0.01);
    if (!next) return;
    next.reset().fadeIn(fade).play();
    current?.fadeOut(fade);
  }

  playOneShot(name: QuadOneShot): void {
    const action = this.actions.get(name);
    if (!action) return;
    this.oneShot = name;
    for (const a of this.actions.values()) if (a !== action) a.fadeOut(.18);
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(.18).play();
    action.clampWhenFinished = false;
  }

  /** Diagnostic helper: hold a gait frozen at time `t`. */
  freezeAt(name: QuadClipName, t: number): void {
    this.mixer.stopAllAction();
    this.oneShot = null;
    const action = this.actions.get(name);
    if (!action) return;
    action.reset();
    action.paused = true;
    action.play();
    action.time = t;
    this.mixer.setTime(0);
    this.mixer.update(0);
    action.time = t;
    this.mixer.update(0);
  }

  bitPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.body.bit.getWorldPosition(target);
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  /** World-space hoof centre of one foot, for ground checks/tests. */
  footPosition(leg: 'FL' | 'FR' | 'RL' | 'RR', target = new THREE.Vector3()): THREE.Vector3 {
    return this.rig.bones[`Foot${leg}`].getWorldPosition(target);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.body.dispose();
    this.materials.coat.dispose();
    this.materials.dark.dispose();
    this.materials.hair.dispose();
    this.root.clear();
  }
}
