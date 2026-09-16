import * as THREE from 'three';
import type { CanvasFactory } from '../../../character/skeletal/HeroTextures';
import { seededRandom } from '../../../character/skeletal/HeroTextures';
import { buildQuadrupedRig, type QuadBoneName, type QuadRig, type QuadSpecies } from './QuadrupedRig';
import { buildQuadrupedBody, type QuadBody } from './QuadrupedBody';
import { buildQuadClips, QUAD_CLIP_NAMES, QUAD_LOOP_CLIPS, type QuadClipName } from './QuadrupedClips';
import { quadPalette, type QuadMarking } from './QuadTextures';
import { buildQuadMaterials, type QuadMats } from './QuadMaterials';

/**
 * A living quadruped: procedural rig, skinned body, animated with the gait
 * library — the animal counterpart of `SkeletalHero`.
 *
 * Two layers make it feel alive:
 *   • the mixer plays a clip (walk, trot, graze, tied…) and the clip's
 *     `timeScale` is coupled to the animal's real ground speed, so a hoof that
 *     looks planted *is* planted instead of skating;
 *   • an additive procedural layer runs after every mixer update: breathing,
 *     ear swivels and flicks, scheduled blinks, a tail that hunts flies, and a
 *     head that turns to watch the player. The layer is deterministic from the
 *     animal's seed, so screenshots and tests stay stable.
 *
 * The rig is authored facing +Z in bind space and the whole assembly is
 * squared by π about Y here, exactly like the hero, so forward travel is −Z.
 */

export type QuadGait = 'idle' | 'walk' | 'trot' | 'sniff' | 'graze' | 'tied';
export type QuadOneShot = 'startle' | 'tie_react' | 'paw' | 'shake' | 'swat' | 'bugbite';

export const QUAD_GAITS: QuadGait[] = ['idle', 'walk', 'trot', 'sniff', 'graze', 'tied'];

export interface QuadActorOptions {
  canvasFactory: CanvasFactory;
  tint: string;
  seed: number;
  marking?: QuadMarking;
  /** 1 for high/balanced, 0.5 for the performance tier (half-res maps). */
  textureScale?: number;
}

const D2R = Math.PI / 180;
const damp = (current: number, target: number, lambda: number, dt: number): number =>
  THREE.MathUtils.damp(current, target, lambda, dt);

interface Schedule { at: number; len: number; }

/** Evenly spread but jittered repeat times — deterministic, never a visible tick. */
function schedule(seed: number, period: number, count: number): Schedule[] {
  const rand = seededRandom(seed);
  const out: Schedule[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ at: (i + rand() * 0.72) * (period / count), len: 0.16 + rand() * 0.3 });
  }
  return out;
}

function pulse(t: number, list: Schedule[], period: number, peak = 1): number {
  const u = ((t % period) + period) % period;
  let v = 0;
  for (const s of list) {
    const start = s.at, end = s.at + s.len;
    const inWindow = u >= start && u <= end ? (u - start) / Math.max(1e-3, s.len) : -1;
    if (inWindow < 0) continue;
    v = Math.max(v, Math.sin(inWindow * Math.PI) * peak);
  }
  return v;
}

export class SkeletalQuadruped {
  readonly root = new THREE.Group();
  readonly species: QuadSpecies;
  readonly height: number;
  readonly rig: QuadRig;
  readonly body: QuadBody;
  readonly materials: QuadMats;
  readonly triangles: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<QuadClipName, THREE.AnimationAction>();
  private gait: QuadGait = 'idle';
  private oneShot: QuadOneShot | null = null;
  private clock = 0;
  private speed = 0;
  private frozen = false;
  private seed: number;
  private readonly blinks: Schedule[];
  private readonly earFlicks: Schedule[];
  private readonly swats: Schedule[];
  private readonly breathRate: number;
  private readonly lookTarget = new THREE.Vector3();
  private lookWeight = 0;
  private lookWant = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpE = new THREE.Euler();

  constructor(species: QuadSpecies, opts: QuadActorOptions) {
    this.species = species;
    this.seed = opts.seed;
    const palette = quadPalette(species, opts.tint, opts.seed);
    if (opts.marking) palette.marking = opts.marking;
    this.materials = buildQuadMaterials(opts.canvasFactory, {
      species, base: palette.base, mane: palette.mane, points: palette.points,
      marking: palette.marking, seed: opts.seed,
    }, opts.textureScale ?? 1);

    this.rig = buildQuadrupedRig(species);
    this.body = buildQuadrupedBody(this.rig, this.materials);
    this.triangles = this.body.triangles;
    this.height = this.rig.height;
    const inner = new THREE.Group();
    inner.rotation.y = Math.PI;
    inner.add(this.rig.group, this.body.group);
    this.root.add(inner);
    this.root.name = `${species}_${opts.seed}`;
    // Bone inverses and bind matrices must be captured with the π yaw flip in
    // place, otherwise the skin solves against the un-flipped bind pose.
    this.root.updateMatrixWorld(true);
    this.rig.skeleton.calculateInverses();
    for (const m of this.body.skinned) m.bind(this.rig.skeleton);

    this.mixer = new THREE.AnimationMixer(this.rig.group);
    const clips = buildQuadClips(species, this.rig.spec);
    for (const name of QUAD_CLIP_NAMES) {
      const action = this.mixer.clipAction(clips[name]);
      action.enabled = true;
      if (!QUAD_LOOP_CLIPS.includes(name)) action.setLoop(THREE.LoopOnce, 1);
      this.actions.set(name, action);
    }
    this.mixer.addEventListener('finished', e => {
      const name = e.action.getClip().name as QuadOneShot;
      if (this.oneShot !== name) return;
      this.oneShot = null;
      e.action.fadeOut(0.3);
      this.actions.get(this.gait)?.reset().fadeIn(0.3).play();
    });
    const period = clips[this.gait].duration;
    this.breathRate = species === 'ox' ? 0.42 : 0.5;
    this.blinks = schedule(opts.seed * 3 + 11, period, species === 'ox' ? 5 : 4);
    this.earFlicks = schedule(opts.seed * 7 + 23, period * 0.5, 7);
    this.swats = schedule(opts.seed * 13 + 41, 9.5, 4);
    this.actions.get('idle')?.play();
  }

  get bit(): THREE.Object3D { return this.body.bit; }
  get hitchPoint(): THREE.Object3D | null { return this.body.hitch; }
  get currentGait(): QuadGait { return this.gait; }
  get currentClip(): QuadClipName { return this.oneShot ?? this.gait; }

  /** Switch the standing/moving loop. One-shots always finish first. */
  setGait(gait: QuadGait, fade = 0.3): void {
    if (gait === this.gait && !this.oneShot) return;
    this.gait = gait;
    if (this.oneShot || this.frozen) return;
    const next = this.actions.get(gait);
    if (!next) return;
    const current = [...this.actions.values()].find(a => a !== next && a.isRunning() && a.getEffectiveWeight() > 0.01);
    this.applySpeed(next);
    next.reset().fadeIn(fade).play();
    current?.fadeOut(fade);
  }

  playOneShot(name: QuadOneShot, fade = 0.18): void {
    const action = this.actions.get(name);
    if (!action || this.frozen) return;
    this.oneShot = name;
    for (const a of this.actions.values()) if (a !== action) a.fadeOut(fade);
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(fade).play();
    action.clampWhenFinished = false;
  }

  /**
   * Ground speed in m/s. Coupling the gait clips' playback rate to the speed
   * the code actually moved the animal by is what stops hooves skating on the
   * trail, and it makes a walk slow down into a step when the team halts.
   */
  setSpeed(v: number): void {
    this.speed = v;
    const action = this.actions.get(this.gait);
    if (action && (this.gait === 'walk' || this.gait === 'trot')) this.applySpeed(action);
  }

  private applySpeed(action: THREE.AnimationAction): void {
    const gait = this.gait === 'trot' ? this.rig.spec.gait.trot : this.rig.spec.gait.walk;
    const moving = this.gait === 'walk' || this.gait === 'trot';
    if (!moving) { action.timeScale = 1; return; }
    const rate = (Math.max(0.12, this.speed) * gait.duration) / gait.cycleTravel;
    action.timeScale = THREE.MathUtils.clamp(rate, 0.55, 1.9);
  }

  /** Watch something (the player, a dog, a hanging branch). Null = relax. */
  setLookAt(target: THREE.Vector3 | null, weight = 1): void {
    if (target) { this.lookTarget.copy(target); this.lookWant = THREE.MathUtils.clamp(weight, 0, 1); }
    else this.lookWant = 0;
  }

  /** Diagnostic helper: hold a clip frozen at time `t` (screenshots, tests). */
  freezeAt(name: QuadClipName, t: number): void {
    this.frozen = true;
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

  unfreeze(): void {
    if (!this.frozen) return;
    this.frozen = false;
    const action = this.actions.get(this.gait);
    for (const a of this.actions.values()) a.stop();
    action?.reset().play();
  }

  bitPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.body.bit.getWorldPosition(target);
  }

  nosePosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.body.nose.getWorldPosition(target);
  }

  /** World point where a tug or trace line attaches. */
  collarPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.body.collar.getWorldPosition(target);
  }

  footPosition(leg: 'FL' | 'FR' | 'RL' | 'RR', target = new THREE.Vector3()): THREE.Vector3 {
    return this.rig.bones[`Foot${leg}` as QuadBoneName].getWorldPosition(target);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    this.mixer.update(dt);
    this.applySecondary(dt);
  }

  /**
   * Additive motion on top of the clip. Runs after `mixer.update`, which owns
   * the bone quaternions, so nothing accumulates between frames.
   */
  private applySecondary(dt: number): void {
    if (this.frozen) return;
    const bones = this.rig.bones;
    const spec = this.rig.spec;
    const t = this.clock;
    const standing = this.gait === 'idle' || this.gait === 'tied' || this.gait === 'graze' || this.gait === 'sniff';
    const amp = standing ? 1 : 0.45;
    // Breathing: the ribs expand sideways and the withers lift a touch.
    const breath = Math.sin(t * Math.PI * 2 * this.breathRate);
    const sniffing = this.gait === 'sniff' || this.gait === 'graze';
    const rate = sniffing ? 1.7 : 1;
    const br = Math.sin(t * Math.PI * 2 * this.breathRate * rate);
    void breath;
    bones.Chest.scale.setScalar(1 + br * 0.012 * (standing ? 1 : 0.4));
    bones.Withers.scale.setScalar(1 + br * 0.009);
    bones.Loin.scale.setScalar(1 - breath * 0.004);

    // Ear swivels: slow tracking plus an occasional sharp flick.
    const flickL = pulse(t, this.earFlicks, spec.gait.walk.duration * 0.5, 1);
    const flickR = pulse(t + 0.7, this.earFlicks, spec.gait.walk.duration * 0.5, 1);
    const trackYaw = standing && this.lookWeight > 0.02 ? -this.lookYaw * 0.55 : Math.sin(t * 0.42 + this.seed) * 0.06;
    this.rotate(bones.EarL, br * 0.9 * amp + flickL * 12, 0, 0.02 * amp + flickL * 16 + trackYaw);
    this.rotate(bones.EarR, br * 0.8 * amp + flickR * 11, 0, -0.02 * amp - flickR * 15 + trackYaw);

    // Blinks: quick, asymmetric by a hair, and more frequent while grazing.
    const blink = pulse(t, this.blinks, sniffing ? 2.6 : 4.4, 1) * (sniffing ? 0.55 : 1);
    this.rotate(bones.EyelidL, blink * 62, 0, 0);
    this.rotate(bones.EyelidR, blink * 60, 0, 0);

    // Tail: idle swish is in the clip; this is the fly response on top.
    const swat = pulse(t, this.swats, 9.5, 1);
    if (swat > 0.01) {
      const whip = Math.sin(t * 15) * swat;
      this.rotate(bones.Tail1, 0, 0, whip * 9);
      this.rotate(bones.Tail2, 0, 0, whip * 12);
      this.rotate(bones.Tail3, 0, 0, whip * 15);
    }

    // Hind leg weight shifting while standing: an animal never locks its hocks.
    if (standing) {
      const shift = Math.sin(t * 0.55 + this.seed * 0.7);
      this.rotate(bones.PelvisRL, shift * 1.6, 0, 0);
      this.rotate(bones.PelvisRR, -shift * 1.4, 0, 0);
      this.rotate(bones.UpperLegRL, -shift * 1.9, 0, 0);
      this.rotate(bones.UpperLegRR, shift * 1.7, 0, 0);

      // Bovine cud chewing when resting in place: gentle rhythmic jaw grinding
      if (this.species === 'ox' && this.gait !== 'tied') {
        const chew = Math.sin(t * 3.6 + this.seed);
        if (chew > 0.05) {
          this.rotate(bones.Jaw, chew * 2.2, Math.cos(t * 1.8) * 0.9, 0);
        }
      } else if (this.species === 'horse' && this.gait === 'idle') {
        const nuzzle = Math.sin(t * 0.7 + this.seed * 1.5);
        if (nuzzle > 0.88) {
          this.rotate(bones.Head, (nuzzle - 0.88) * 5, 0, (nuzzle - 0.88) * 2.5);
        }
      }
    }

    // Head tracking: yaw/pitch toward the target in animal local space, damped,
    // then split across the neck and head so the neck bends instead of the skull swivelling.
    this.lookWeight = damp(this.lookWeight, this.lookWant, 2.6, dt);
    if (this.lookWeight > 0.01) {
      this.root.updateMatrixWorld(true);
      const headWorld = bones.Head.getWorldPosition(this.tmpA);
      const headLocal = this.root.worldToLocal(headWorld);
      const targetLocal = this.root.worldToLocal(this.tmpB.copy(this.lookTarget));
      const toTarget = targetLocal.sub(headLocal);
      const flat = Math.hypot(toTarget.x, toTarget.z);
      // In avatar root space, forward is −Z.
      const yaw = Math.atan2(-toTarget.x, -toTarget.z);
      const pitch = -Math.atan2(toTarget.y - 0.1, Math.max(0.2, flat));
      const reach = THREE.MathUtils.clamp(1 - (flat - 1.2) / 7, 0.15, 1) * this.lookWeight;
      const lim = THREE.MathUtils.degToRad(speciesLimit(this.species));
      this.lookYaw = damp(this.lookYaw, THREE.MathUtils.clamp(yaw, -lim, lim) * reach, 4.5, dt);
      this.lookPitch = damp(this.lookPitch, THREE.MathUtils.clamp(pitch, -0.42, 0.5) * reach, 4.5, dt);
      const y = THREE.MathUtils.radToDeg(this.lookYaw);
      const p = THREE.MathUtils.radToDeg(this.lookPitch);
      this.rotate(bones.Neck1, p * 0.32, y * 0.25, 0);
      this.rotate(bones.Neck2, p * 0.38, y * 0.35, 0);
      this.rotate(bones.Head, p * 0.45, y * 0.45, p * 0.05);
      this.rotate(bones.Jaw, standing ? 3 + Math.abs(p) * 0.15 : 0, 0, 0);
    }
  }

  /** Extra degrees on top of whatever the clip left on the bone. */
  private rotate(bone: THREE.Bone, x: number, y: number, z: number): void {
    if (!bone || (x === 0 && y === 0 && z === 0)) return;
    this.tmpE.set(x * D2R, y * D2R, z * D2R, 'XYZ');
    this.tmpQ.setFromEuler(this.tmpE);
    bone.quaternion.multiply(this.tmpQ);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.body.dispose();
    this.materials.dispose();
    this.root.clear();
  }
}

/** How far an animal can turn its head to look at you (degrees, per species). */
function speciesLimit(species: QuadSpecies): number {
  return species === 'ox' ? 38 : 52;
}
