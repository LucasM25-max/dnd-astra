import * as THREE from 'three';
import {
  LEG_IDS, QUAD_BONES, isForeLeg,
  type GaitSpec, type LegId, type QuadBoneName, type QuadSpecies, type SpeciesSpec,
} from './QuadrupedRig';

/**
 * Procedural clip library for the quadruped rig.
 *
 * Poses are authored in degrees about each bone's local axes (identity at
 * bind, like the hero rig): +X pitches a segment forward/down, +Z swings it
 * sideways. Loops are sampled densely from functions rather than keyframes, so
 * a gait stays in step at any frame rate and never pops on the wrap.
 *
 * What makes these read as animals rather than rocking chairs:
 *   • true footfall sequences — cattle amble in ipsilateral pairs, a horse
 *     walks in a lateral sequence with overstep and trots on the diagonal;
 *   • a duty factor per gait, so the swing is a short, fast arc and the stance
 *     is slow and planted (hoof pitch is compensated through the whole chain,
 *     so the sole stays flat on the ground exactly like the hero's gait);
 *   • the scapula rotates with the stride, which is where most of the visible
 *     reach comes from;
 *   • the spine flexes and rolls per stride, the head counter-rotates to hold
 *     the gaze, and the tail answers the gait instead of looping blindly.
 */

export type QuadClipName =
  | 'idle' | 'walk' | 'trot' | 'sniff' | 'graze' | 'tied'
  | 'startle' | 'tie_react' | 'paw' | 'shake' | 'swat' | 'bugbite';
export const QUAD_CLIP_NAMES: QuadClipName[] = [
  'idle', 'walk', 'trot', 'sniff', 'graze', 'tied',
  'startle', 'tie_react', 'paw', 'shake', 'swat', 'bugbite',
];
export const QUAD_LOOP_CLIPS: QuadClipName[] = ['idle', 'walk', 'trot', 'sniff', 'graze', 'tied'];

type Pose = Partial<Record<QuadBoneName, [number, number, number]>>;
interface Frame { t: number; ease?: 'in' | 'out' | 'inout' | 'smooth'; pose: Pose; root?: [number, number, number] }
export interface QuadClipDef { name: QuadClipName; duration: number; loop: boolean; frames: Frame[] }

const D2R = Math.PI / 180;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeFn = (kind: 'in' | 'out' | 'inout' | 'smooth'): ((t: number) => number) => {
  if (kind === 'in') return t => t * t;
  if (kind === 'out') return t => 1 - (1 - t) * (1 - t);
  if (kind === 'smooth') return t => t * t * t * (t * (t * 6 - 15) + 10);
  return t => t * t * (3 - 2 * t);
};

/** Sparse keyframes → dense quaternion tracks (30 Hz, eased). */
function bakeKeys(def: QuadClipDef, hz = 30): Frame[] {
  const step = 1 / hz;
  const out: Frame[] = [];
  const keys = def.frames;
  for (let t = 0; t < def.duration - 1e-6; t += step) {
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
    const a = keys[i], b = keys[i + 1];
    const span = Math.max(1e-6, b.t - a.t);
    const u = easeFn(b.ease ?? 'inout')(Math.min(1, Math.max(0, (t - a.t) / span)));
    const pose: Pose = {};
    const names = new Set<QuadBoneName>([...(Object.keys(a.pose) as QuadBoneName[]), ...(Object.keys(b.pose) as QuadBoneName[])]);
    for (const bone of names) {
      const pa = a.pose[bone] ?? [0, 0, 0], pb = b.pose[bone] ?? [0, 0, 0];
      pose[bone] = [lerp(pa[0], pb[0], u), lerp(pa[1], pb[1], u), lerp(pa[2], pb[2], u)];
    }
    const ra = a.root ?? [0, 0, 0], rb = b.root ?? [0, 0, 0];
    out.push({ t, pose, root: [lerp(ra[0], rb[0], u), lerp(ra[1], rb[1], u), lerp(ra[2], rb[2], u)] });
  }
  return out;
}

export function buildQuadClip(def: QuadClipDef): THREE.AnimationClip {
  const dense = def.frames.length > 8 ? def.frames : bakeKeys(def);
  const tracks: THREE.QuaternionKeyframeTrack[] = [];
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  for (const bone of QUAD_BONES) {
    if (!dense.some(f => f.pose[bone])) continue;
    const times: number[] = [], values: number[] = [];
    for (const f of dense) {
      const p = f.pose[bone] ?? [0, 0, 0];
      times.push(f.t);
      e.set(p[0] * D2R, p[1] * D2R, p[2] * D2R, 'XYZ');
      q.setFromEuler(e);
      values.push(q.x, q.y, q.z, q.w);
    }
    if (dense.length > 1) times.push(def.duration), values.push(...values.slice(-4));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, Float32Array.from(times), Float32Array.from(values)));
  }
  if (dense.some(f => f.root && f.root.some(v => v !== 0))) {
    const rt: number[] = [], rv: number[] = [];
    for (const f of dense) { rt.push(f.t); rv.push(...(f.root ?? [0, 0, 0])); }
    if (rt.length > 1) { rt.push(def.duration); rv.push(...(dense[0].root ?? [0, 0, 0])); }
    tracks.push(new THREE.VectorKeyframeTrack('Root.position', Float32Array.from(rt), Float32Array.from(rv)));
  }
  return new THREE.AnimationClip(def.name, def.duration, tracks);
}

/* ------------------------------------------------------------------ */
/* Gait model                                                          */
/* ------------------------------------------------------------------ */

const wrap = (v: number): number => ((v % 1) + 1) % 1;

/**
 * One foot's angles (degrees) at cycle phase `u` for a gait.
 *
 * Sign convention, straight from the bone axes: +X rotates a limb segment
 * backward, so retraction is positive and protraction negative. Flexion at a
 * knee/hock is positive in front and negative behind, matching how a horse's
 * carpus bends forward and its hock backward.
 *
 * Stance is a slow, monotone retraction — the limb sweeps from reach to
 * push-off at a constant rate, which is what makes a planted hoof look planted
 * once the actor couples the clip's `timeScale` to the ground speed. Swing is
 * the short fast arc: lift, fold, then a deliberate unweighting at the toe.
 */
export interface FootAngles {
  /** Scapula (fore) or pelvis (hind) tilt. */
  root: number;
  /** Proximal segment: humerus / femur. */
  upper: number;
  /** Distal segment: forearm / gaskin. Flexion, always ≥ 0 here. */
  flex: number;
  /** Desired *world* pitch of the sole, degrees (0 = flat on the ground). */
  sole: number;
  /** Hoof height above rest, metres — 0 while planted. */
  lift: number;
  /** Abduction, degrees: limbs splay out slightly under a heavy animal. */
  splay: number;
  planted: boolean;
}

export function footAngles(u: number, leg: LegId, gait: GaitSpec, species: QuadSpecies): FootAngles {
  const fore = isForeLeg(leg);
  const duty = Math.min(0.94, Math.max(0.3, gait.duty));
  // x = 0 at footfall: the stance beat runs land → carry → toe-off.
  const x = wrap(u - gait.phases[leg]);
  const reach = gait.stride * 44;
  const push = gait.stride * 40;
  const splayBase = species === 'ox' ? 1.9 : 1.2;
  if (x < duty) {
    const s = x / duty;
    return {
      root: lerp(-reach * 0.42, push * 0.36, s),
      upper: lerp(-reach, push, s),
      // A soft yield on loading, then the hock/stifle braces for push-off.
      flex: (fore ? 4 : 9) + Math.sin(s * Math.PI) * (fore ? 4.5 : 8) + Math.max(0, s - 0.8) * 26,
      sole: lerp(-7, 13, s) + (s > 0.86 ? (s - 0.86) * 52 : 0),
      lift: 0,
      splay: splayBase + Math.sin(s * Math.PI) * 0.7,
      planted: true,
    };
  }
  const s = (x - duty) / (1 - duty);
  // Fast breakover, a hang-time near the top, then the reach out to plant.
  const fold = Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.06)), 0.72);
  return {
    root: lerp(push * 0.36, -reach * 0.42, s),
    upper: lerp(push, -reach, s * s * (3 - 2 * s)),
    flex: (fore ? 5 : 10) + fold * (fore ? 34 : 31),
    sole: lerp(13, -6, s) - fold * (fore ? 8 : 12),
    lift: fold * gait.lift,
    splay: splayBase + fold * 2.4,
    planted: false,
  };
}

/** Spine, head and tail response to a gait: spring, roll, and gaze hold. */
function spinePose(u: number, gait: GaitSpec, spec: SpeciesSpec, species: QuadSpecies): { pose: Pose; root: [number, number, number] } {
  const a = u * Math.PI * 2;
  const two = a * 2;
  // The withers rise once per footfall pair; the head counter-rolls to hold
  // the gaze steady, which is the loudest "this is alive" cue there is.
  const bob = Math.sin(two - 0.55);
  const roll = Math.sin(a - 0.9) * spec.gait.roll * (species === 'ox' ? 1.3 : 1);
  const flex = Math.sin(two + 0.35) * (species === 'ox' ? 1.5 : 2.2) + (gait.duty < 0.5 ? 1.6 : 0);
  const pose: Pose = {
    Hips: [flex * 0.45, roll * 0.35, 0],
    Loin: [flex * 0.3, roll * 0.62, 0],
    Chest: [-flex * 0.26, roll * 0.46, 0],
    Withers: [-flex * 0.2 + bob * 0.7, roll * 0.22, 0],
    Neck1: [bob * 1.2 - flex * 0.4, -roll * 0.5, 0],
    Neck2: [-bob * 1.6 - flex * 0.2, -roll * 0.34, 0],
    Head: [bob * 2.1 + flex * 0.3, roll * 0.72, 0],
    Jaw: [2 + Math.max(0, bob) * 2.2, 0, 0],
  };
  const swish = species === 'ox' ? 0.85 : 0.5;
  pose.Tail1 = [Math.sin(a * 0.5) * 2.6, 0, Math.sin(a * swish) * 6 + 2];
  pose.Tail2 = [Math.sin(a * swish - 0.6) * 4.5, 0, Math.sin(a * swish - 0.8) * 7.5];
  pose.Tail3 = [Math.sin(a * swish - 1.2) * 5, 0, Math.sin(a * swish - 1.5) * 9];
  return { pose, root: [0, bob * spec.gait.bob, Math.max(0, flex) * -0.004] };
}

function gaitPose(u: number, gait: GaitSpec, spec: SpeciesSpec, species: QuadSpecies): { pose: Pose; root: [number, number, number] } {
  const { pose, root } = spinePose(u, gait, spec, species);
  for (const leg of LEG_IDS) {
    const fore = isForeLeg(leg);
    const side = leg === 'FL' || leg === 'RL' ? 1 : -1;
    const f = footAngles(u, leg, gait, species);
    // Flexion pitches the distal segment backward in front, forward behind.
    const lower = fore ? f.flex : -f.flex;
    // The ankle only carries what the chain above it has not already used, so
    // the sole keeps the pitch `f.sole` through the whole step.
    const foot = f.sole - (fore ? f.root + f.upper : f.root * 0.4 + f.upper) - lower;
    if (fore) {
      pose[`Shoulder${leg}` as QuadBoneName] = [-f.root, 0, side * (f.splay * 0.7 + f.lift * 26)];
      pose[`UpperLeg${leg}` as QuadBoneName] = [-f.upper, 0, side * (f.splay + f.lift * 30)];
      pose[`LowerLeg${leg}` as QuadBoneName] = [lower, 0, 0];
      pose[`Foot${leg}` as QuadBoneName] = [foot, 0, 0];
    } else {
      pose[`Pelvis${leg}` as QuadBoneName] = [-f.root * 0.5, 0, side * f.splay * 0.4];
      pose[`UpperLeg${leg}` as QuadBoneName] = [-f.upper, 0, side * (f.splay * 0.9 + f.lift * 22)];
      pose[`LowerLeg${leg}` as QuadBoneName] = [lower, 0, 0];
      pose[`Foot${leg}` as QuadBoneName] = [foot, 0, 0];
    }
  }
  // Ears track the footfall: an animal at rest still listens to the road.
  const flick = Math.sin(u * Math.PI * 4 + 0.6);
  pose.EarL = [flick * 2.5, 0, 2 + flick * 3.5];
  pose.EarR = [-flick * 2.2, 0, -2 + flick * 3];
  // Blink once a cycle at a walk, twice at a trot.
  const blink = Math.max(0, Math.sin(u * Math.PI * 2 * (gait.duty < 0.5 ? 2 : 1) - 1.9) - 0.94) * 40;
  pose.EyelidL = [blink, 0, 0];
  pose.EyelidR = [blink, 0, 0];
  return { pose, root };
}

function gaitDef(species: QuadSpecies, spec: SpeciesSpec, name: 'walk' | 'trot'): QuadClipDef {
  const gait = name === 'walk' ? spec.gait.walk : spec.gait.trot;
  const frames: Frame[] = [];
  const samples = name === 'walk' ? 34 : 30;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const { pose, root } = gaitPose(u, gait, spec, species);
    frames.push({ t: u * gait.duration, pose, root });
  }
  frames[frames.length - 1] = { ...frames[0], t: gait.duration };
  return { name, duration: gait.duration, loop: true, frames };
}

/** The window in which one foot is off the ground, as cycle fractions. */
export function swingWindow(gait: GaitSpec, leg: LegId): { from: number; to: number } {
  const duty = Math.min(0.94, Math.max(0.3, gait.duty));
  const start = wrap(gait.phases[leg] + duty);
  return { from: start, to: wrap(start + (1 - duty)) };
}

/** How many feet are planted at cycle time `u` (a walk never drops below two). */
export function plantedCount(u: number, gait: GaitSpec): number {
  let n = 0;
  for (const leg of LEG_IDS) if (footAngles(u, leg, gait, 'horse').planted) n++;
  return n;
}

/* ------------------------------------------------------------------ */
/* Standing loops                                                      */
/* ------------------------------------------------------------------ */

/**
 * Idle: breathing, weight shifted onto three legs with the fourth resting,
 * slow head sweeps, ear flicks, blinks, and a tail that only swishes when a
 * fly says so. Sampled densely so the loops never repeat visibly.
 */
function idleDef(species: QuadSpecies): QuadClipDef {
  const duration = species === 'ox' ? 6.4 : 5.6;
  const frames: Frame[] = [];
  const samples = 46;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples, a = u * Math.PI * 2;
    const breath = Math.sin(a * 2.2);
    const shift = Math.sin(a * 0.5);
    const head = Math.sin(a * 0.75 + 0.4);
    const head2 = Math.sin(a * 1.5 + 1.1);
    // One hind leg rests, cocked and unloaded, swapping sides mid-loop.
    const rest = Math.max(0, Math.sin(a * 0.5 - 0.4));
    const pose: Pose = {
      Hips: [0.5 * breath, shift * 1.9, shift * 0.8],
      Loin: [0.4 * breath, -shift * 0.9, 0],
      Chest: [1.1 * breath, shift * 0.7, 0],
      Withers: [0.8 * breath, 0, 0],
      Neck1: [1.2 * head + 0.5, 2.6 * shift, 0],
      Neck2: [0.9 * head2, 1.8 * head, 0],
      Head: [-1.5 * head2 + Math.sin(a * 4.6) * 0.6, 5.2 * head, 0.8 * shift],
      Jaw: [1.4 + 1.1 * Math.max(0, Math.sin(a * 1.5)), 0, 0],
      Tail1: [1.5 * Math.sin(a * 0.6), 0, 5 * Math.sin(a * 0.9)],
      Tail2: [2 * Math.sin(a * 0.6 - 0.5), 0, 7 * Math.sin(a * 0.9 - 0.7)],
      Tail3: [1.4 * Math.sin(a * 0.6 - 1), 0, 9 * Math.sin(a * 0.9 - 1.4)],
    };
    for (const leg of LEG_IDS) {
      const fore = isForeLeg(leg);
      const side = leg === 'FL' || leg === 'RL' ? 1 : -1;
      const relaxed = !fore && side > 0 ? rest : side < 0 ? rest * 0.35 : 0;
      const sway = Math.sin(a * 0.5 + (fore ? 0 : 0.4)) * (leg[0] === 'F' ? 0.9 : 1.2);
      pose[`${fore ? 'Shoulder' : 'Pelvis'}${leg}` as QuadBoneName] = [-0.4 * sway + relaxed * 3, 0, side * (0.5 + relaxed * 1.6)];
      pose[`UpperLeg${leg}` as QuadBoneName] = [sway * 0.8 - relaxed * 9, 0, side * (0.7 + relaxed * 2.4)];
      pose[`LowerLeg${leg}` as QuadBoneName] = [fore ? 1.4 + relaxed * 6 : -2.2 - relaxed * 12, 0, 0];
      pose[`Foot${leg}` as QuadBoneName] = [0.4 - relaxed * 5, 0, 0];
    }
    // Ear flicks: mostly alert-forward, occasionally one sharp swivel.
    const flick = Math.max(0, Math.sin(a * 3.1 - 1.2));
    const flick2 = Math.max(0, Math.sin(a * 2.2 + 2.4));
    pose.EarL = [flick * 8 - 2, 0, 3 + flick * 10];
    pose.EarR = [flick2 * 7 - 2, 0, -3 - flick2 * 9];
    const blink = Math.max(0, Math.sin(a * 5.5 - 0.3) - 0.93) * 14;
    pose.EyelidL = [blink * 8, 0, 0];
    pose.EyelidR = [blink * 8, 0, 0];
    frames.push({ t: u * duration, pose, root: [0, breath * 0.006, 0] });
  }
  frames[frames.length - 1] = { ...frames[0], t: duration };
  return { name: 'idle', duration, loop: true, frames };
}

/** Haltered at the stake: calmer, lower head, slower breath, drowsy lids. */
function tiedDef(species: QuadSpecies): QuadClipDef {
  const duration = species === 'ox' ? 8 : 7.2;
  const frames: Frame[] = [];
  const samples = 40;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples, a = u * Math.PI * 2;
    const breath = Math.sin(a * 1.7);
    const sway = Math.sin(a * 0.5);
    const doze = Math.max(0, Math.sin(a * 0.5 - 0.5));
    const pose: Pose = {
      Hips: [0.4 * breath, sway * 1.1, 0],
      Loin: [0.3 * breath, 0, 0],
      Chest: [1 * breath, 0, 0],
      Withers: [0.6 * breath, 0, 0],
      Neck1: [9 + 1.6 * breath, sway * 1.6, 0],
      Neck2: [7 + 1.2 * Math.sin(a * 1.7 + 0.6), 1.4 * sway, 0],
      Head: [3 + 2.2 * Math.sin(a * 0.9 + 0.4), 4.4 * Math.sin(a * 0.5 + 0.6), 0],
      Jaw: [4.5 + 2.4 * Math.sin(a * 1.2), 0, 0],
      Tail1: [1, 0, 4 * Math.sin(a * 0.55)],
      Tail2: [1.6, 0, 6 * Math.sin(a * 0.55 - 0.6)],
      Tail3: [1.2, 0, 7 * Math.sin(a * 0.55 - 1.1)],
      EarL: [-2 - doze * 5, 0, 5 + doze * 7],
      EarR: [-2 - doze * 4, 0, -5 - doze * 6],
      EyelidL: [5 + doze * 5, 0, 0],
      EyelidR: [5 + doze * 5, 0, 0],
    };
    for (const leg of LEG_IDS) {
      const fore = isForeLeg(leg);
      const side = leg === 'FL' || leg === 'RL' ? 1 : -1;
      pose[`${fore ? 'Shoulder' : 'Pelvis'}${leg}` as QuadBoneName] = [0, 0, side * 0.4];
      pose[`UpperLeg${leg}` as QuadBoneName] = [Math.sin(a * 0.5 + (fore ? 0 : 1)) * 0.7, 0, side * 0.5];
      pose[`LowerLeg${leg}` as QuadBoneName] = [fore ? 1.2 : -1.6, 0, 0];
      pose[`Foot${leg}` as QuadBoneName] = [0, 0, 0];
    }
    frames.push({ t: u * duration, pose, root: [0, breath * 0.005, 0] });
  }
  frames[frames.length - 1] = { ...frames[0], t: duration };
  return { name: 'tied', duration, loop: true, frames };
}

/** Head-low grazing: neck reaches down, muzzle works the grass, jaw chews. */
function grazeDef(species: QuadSpecies): QuadClipDef {
  const duration = species === 'ox' ? 7.4 : 6.6;
  const frames: Frame[] = [];
  const samples = 44;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples, a = u * Math.PI * 2;
    const reach = Math.min(1, Math.max(0, Math.sin(a * 0.5) * 1.25 + 0.15));
    const crop = Math.sin(a * 3.4);
    const tear = Math.max(0, Math.sin(a * 1.7 - 0.6));
    const pose: Pose = {
      // Hindquarters stay put; the front legs brace and the loin hinges.
      Hips: [-2.4 * reach, 0, 0],
      Loin: [-3.2 * reach, 0, 0],
      Chest: [3.4 * reach, 0, 0],
      Withers: [5 * reach, 0, 0],
      Neck1: [34 + 9 * reach + 2 * crop, 3 * Math.sin(a * 0.5), 0],
      Neck2: [22 + 6 * reach + 2 * tear, 2 * Math.sin(a * 0.75 + 1), 0],
      Head: [16 + 6 * reach - 8 * tear, 6 * Math.sin(a * 0.5 + 0.5), 1.4 * Math.sin(a * 0.25)],
      Jaw: [9 + 6 * tear + 3 * crop, 0, 0],
      EarL: [-6 - 4 * reach, 0, 7],
      EarR: [-6 - 4 * reach, 0, -7],
      EyelidL: [7, 0, 0], EyelidR: [7, 0, 0],
      Tail1: [3, 0, 6 * Math.sin(a * 0.75)],
      Tail2: [4, 0, 8 * Math.sin(a * 0.75 - 0.7)],
      Tail3: [3, 0, 9 * Math.sin(a * 0.75 - 1.3)],
    };
    for (const leg of LEG_IDS) {
      const fore = isForeLeg(leg);
      const side = leg === 'FL' || leg === 'RL' ? 1 : -1;
      const brace = fore ? reach : -reach * 0.45;
      pose[`${fore ? 'Shoulder' : 'Pelvis'}${leg}` as QuadBoneName] = [-brace * 7, 0, side * 1.1];
      pose[`UpperLeg${leg}` as QuadBoneName] = [brace * 9, 0, side * 0.9];
      pose[`LowerLeg${leg}` as QuadBoneName] = [fore ? brace * 7 : -brace * 8, 0, 0];
      pose[`Foot${leg}` as QuadBoneName] = [-brace * 4, 0, 0];
    }
    frames.push({ t: u * duration, pose, root: [-0.004 * reach, -0.03 * reach, 0.02 * reach] });
  }
  frames[frames.length - 1] = { ...frames[0], t: duration };
  return { name: 'graze', duration, loop: true, frames };
}

/** Sniffing the ground: a lower, quicker head than grazing, nostrils working. */
function sniffDef(): QuadClipDef {
  const duration = 3.9;
  const frames: Frame[] = [];
  const samples = 30;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples, a = u * Math.PI * 2;
    const dip = Math.max(0, Math.sin(a * 2 - 1.1));
    const pose: Pose = {
      Hips: [-9 - 1.6 * dip, 0, 0],
      Loin: [-6 - 1.2 * dip, 0, 0],
      Chest: [3 + dip, 0, 0],
      Withers: [4 + dip, 0, 0],
      Neck1: [30 + 10 * dip, 3 * Math.sin(a * 0.5), 0],
      Neck2: [18 + 6 * dip, 2 * Math.sin(a), 0],
      Head: [14 + 9 * dip, 5 * Math.sin(a), 0],
      Jaw: [7 + 6 * dip, 0, 0],
      UpperLegFL: [4 + 2 * dip, 0, 0], LowerLegFL: [7 + 3 * dip, 0, 0],
      UpperLegFR: [4 + 2 * dip, 0, 0], LowerLegFR: [7 + 3 * dip, 0, 0],
      UpperLegRL: [-2, 0, 0], LowerLegRL: [-5, 0, 0],
      UpperLegRR: [-2, 0, 0], LowerLegRR: [-5, 0, 0],
      EarL: [-4, 0, 8], EarR: [-4, 0, -8],
      Tail1: [3, 0, 5 * Math.sin(a * 0.75)],
      Tail2: [5, 0, 6 * Math.sin(a * 0.75 + 0.8)],
      Tail3: [4, 0, 7 * Math.sin(a * 0.75 + 1.4)],
    };
    frames.push({ t: u * duration, pose, root: [0, -0.01 * dip, 0.008 * dip] });
  }
  frames[frames.length - 1] = { ...frames[0], t: duration };
  return { name: 'sniff', duration, loop: true, frames };
}

/* ------------------------------------------------------------------ */
/* One-shots                                                           */
/* ------------------------------------------------------------------ */

/** Whirled and startled: a four-beat scramble — rear back, snort, settle. */
const STARTLE: QuadClipDef = {
  name: 'startle', duration: 1.5, loop: false,
  frames: [
    { t: 0, pose: {} },
    {
      t: 0.24, root: [0, 0.03, -0.12],
      pose: {
        Hips: [6, 0, 0], Loin: [4, 0, 0], Chest: [-7, 0, 0], Withers: [-6, 0, 0],
        Neck1: [-22, 0, 0], Neck2: [-16, 4, 0], Head: [-22, 8, 0], Jaw: [12, 0, 0],
        EarL: [-14, 0, -6], EarR: [-14, 0, 6], EyelidL: [-14, 0, 0], EyelidR: [-14, 0, 0],
        ShoulderFL: [-14, 0, 0], UpperLegFL: [-16, 0, 0], LowerLegFL: [14, 0, 0], FootFL: [10, 0, 0],
        ShoulderFR: [-18, 0, 0], UpperLegFR: [-20, 0, 0], LowerLegFR: [18, 0, 0], FootFR: [12, 0, 0],
        PelvisRL: [8, 0, 0], UpperLegRL: [12, 0, 0], LowerLegRL: [-10, 0, 0], FootRL: [-6, 0, 0],
        PelvisRR: [9, 0, 0], UpperLegRR: [14, 0, 0], LowerLegRR: [-12, 0, 0], FootRR: [-7, 0, 0],
        Tail1: [-14, 0, 0], Tail2: [-16, 0, 6], Tail3: [-12, 0, 8],
      },
    },
    {
      t: 0.6, root: [0, 0.05, -0.24],
      pose: {
        Hips: [9, 3, -2], Loin: [6, 2, 0], Chest: [-4, -2, 0], Withers: [-5, -2, 0],
        Neck1: [-26, -6, 0], Neck2: [-12, -10, 0], Head: [-20, -16, 4], Jaw: [16, 0, 0],
        EarL: [-18, 0, -12], EarR: [-8, 0, 10],
        ShoulderFL: [-26, 0, 4], UpperLegFL: [-24, 0, 6], LowerLegFL: [22, 0, 0], FootFL: [16, 0, 0],
        ShoulderFR: [-6, 0, -4], UpperLegFR: [-8, 0, -6], LowerLegFR: [6, 0, 0], FootFR: [2, 0, 0],
        PelvisRL: [14, 0, 0], UpperLegRL: [18, 0, 0], LowerLegRL: [-16, 0, 0], FootRL: [-12, 0, 0],
        PelvisRR: [16, 0, 0], UpperLegRR: [22, 0, 0], LowerLegRR: [-20, 0, 0], FootRR: [-14, 0, 0],
        Tail1: [-20, 0, 10], Tail2: [-22, 0, 14], Tail3: [-18, 0, 12],
      },
    },
    {
      t: 0.95, root: [0, 0.01, -0.1],
      pose: {
        Hips: [3, -1, 1], Chest: [-2, 1, 0], Neck1: [-14, 6, 0], Neck2: [-8, 8, 0], Head: [-8, 14, 0],
        Jaw: [6, 0, 0], EarL: [-6, 0, 8], EarR: [-10, 0, -4],
        ShoulderFL: [-8, 0, 0], UpperLegFL: [-6, 0, 2], LowerLegFL: [8, 0, 0],
        PelvisRR: [6, 0, 0], UpperLegRR: [8, 0, 0], LowerLegRR: [-8, 0, 0],
        Tail1: [-6, 0, -8], Tail2: [-8, 0, -10], Tail3: [-6, 0, -8],
      },
    },
    { t: 1.5, pose: {} },
  ],
};

/** Being calmed and tied: reaches toward the hand, licks, then settles low. */
const TIE_REACT: QuadClipDef = {
  name: 'tie_react', duration: 2.6, loop: false,
  frames: [
    { t: 0, pose: {} },
    {
      t: 0.6, root: [0, -0.004, 0.008],
      pose: {
        Neck1: [16, 4, 0], Neck2: [12, 6, 0], Head: [10, 8, 0], Jaw: [5, 0, 0],
        EarL: [-2, 0, 6], EarR: [-2, 0, -6],
        Tail1: [1, 0, 5], Tail2: [2, 0, 7],
      },
    },
    {
      t: 1.3, root: [0, -0.016, 0.02],
      pose: {
        Neck1: [26, -5, 0], Neck2: [18, -8, 0], Head: [16, -12, 0], Jaw: [12, 0, 0],
        EyelidL: [5, 0, 0], EyelidR: [5, 0, 0],
        ShoulderFL: [-4, 0, 0], UpperLegFL: [-5, 0, 2], LowerLegFL: [7, 0, 0],
        Tail1: [1, 0, -6], Tail2: [2, 0, -8],
      },
    },
    {
      t: 1.95, root: [0, -0.01, 0.012],
      pose: {
        Neck1: [20, 3, 0], Neck2: [14, 4, 0], Head: [10, 6, 0], Jaw: [16, 0, 0],
        EarL: [-4, 0, 4], EarR: [-4, 0, -4],
      },
    },
    { t: 2.6, pose: { Neck1: [12, 0, 0], Neck2: [8, 0, 0], Head: [5, 0, 0], Jaw: [4, 0, 0] } },
  ],
};

/** Pawing: a sharp, repeated scrape of a front foot — impatience. */
const PAW: QuadClipDef = {
  name: 'paw', duration: 1.5, loop: false,
  frames: [
    { t: 0, pose: {} },
    {
      t: 0.3, root: [0, 0.014, -0.02],
      pose: {
        Neck1: [6, 0, 0], Neck2: [4, 2, 0], Head: [-4, 4, 0],
        ShoulderFL: [-16, 0, 3], UpperLegFL: [-22, 0, 4], LowerLegFL: [26, 0, 0], FootFL: [-14, 0, 0],
        EarL: [-8, 0, 6], EarR: [-8, 0, -6],
        Tail1: [0, 0, 4], Tail2: [0, 0, 6],
      },
    },
    {
      t: 0.6, root: [0, -0.006, 0.01],
      pose: {
        Neck1: [10, 0, 0], Neck2: [6, 1, 0], Head: [-2, 2, 0],
        ShoulderFL: [4, 0, 2], UpperLegFL: [10, 0, 3], LowerLegFL: [-6, 0, 0], FootFL: [16, 0, 0],
        Hips: [-1.4, 0, 0], Chest: [1.6, 0, 0],
        PelvisRR: [3, 0, 0], UpperLegRR: [5, 0, 0], LowerLegRR: [-4, 0, 0],
      },
    },
    {
      t: 0.92, root: [0, 0.01, -0.015],
      pose: {
        Neck1: [8, 0, 0], Head: [-3, -2, 0],
        ShoulderFL: [-13, 0, 3], UpperLegFL: [-18, 0, 3], LowerLegFL: [22, 0, 0], FootFL: [-10, 0, 0],
      },
    },
    { t: 1.24, pose: { ShoulderFL: [3, 0, 0], UpperLegFL: [7, 0, 2], LowerLegFL: [-4, 0, 0], FootFL: [10, 0, 0] } },
    { t: 1.5, pose: {} },
  ],
};

/** Head-flip and mane shake, then a snort. Also settles water and flies. */
const SHAKE: QuadClipDef = {
  name: 'shake', duration: 1.35, loop: false,
  frames: [
    { t: 0, pose: {} },
    {
      t: 0.3, root: [0, 0.01, -0.03],
      pose: {
        Hips: [4, 0, 0], Loin: [3, 0, 0], Chest: [-4, 0, 0], Withers: [-6, 0, 0],
        Neck1: [-24, 0, 0], Neck2: [-10, 0, 0], Head: [-14, 0, 0], Jaw: [14, 0, 0],
        Tail1: [-8, 0, 0], Tail2: [-10, 0, 0], Tail3: [-8, 0, 0],
      },
    },
    { t: 0.5, pose: { Neck1: [-16, 0, 16], Neck2: [-6, 0, 20], Head: [-6, 0, 26], Hips: [2, -3, 0], Loin: [1, -2, 0] } },
    { t: 0.66, pose: { Neck1: [-14, 0, -18], Neck2: [-4, 0, -22], Head: [-4, 0, -28], Hips: [2, 3, 0], Loin: [1, 2, 0] } },
    { t: 0.83, pose: { Neck1: [-10, 0, 12], Neck2: [-2, 0, 14], Head: [0, 0, 18], Jaw: [8, 0, 0] } },
    { t: 1.0, pose: { Neck1: [-2, 0, -6], Neck2: [2, 0, -6], Head: [4, 0, -8], Jaw: [4, 0, 0] } },
    { t: 1.35, pose: {} },
  ],
};

/** A fly bite: skin twitch, tail-crack and a hind leg kick. */
const BUGBITE: QuadClipDef = {
  name: 'bugbite', duration: 1.1, loop: false,
  frames: [
    { t: 0, pose: {} },
    {
      t: 0.18, pose: {
        Hips: [2, 0, 4], Loin: [1, 0, 6], Tail1: [-16, 0, 12], Tail2: [-18, 0, 18], Tail3: [-14, 0, 16],
      },
    },
    {
      t: 0.5, root: [0, 0.012, 0], pose: {
        Hips: [4, 0, -6], Loin: [2, 0, -8], Chest: [-3, 0, -4],
        Neck1: [-8, 6, 0], Head: [4, 16, 0], EarL: [-6, 0, 8],
        PelvisRL: [10, 0, 0], UpperLegRL: [16, 0, 0], LowerLegRL: [-22, 0, 0], FootRL: [18, 0, 0],
        Tail1: [-20, 0, -14], Tail2: [-22, 0, -20], Tail3: [-16, 0, -18],
      },
    },
    { t: 0.78, pose: { Hips: [1, 0, -2], UpperLegRL: [6, 0, 0], LowerLegRL: [-8, 0, 0], Tail1: [-8, 0, -6], Tail2: [-9, 0, -8] } },
    { t: 1.1, pose: {} },
  ],
};

/** Tail swish only — used as an additive flourish over a standing loop. */
/** A fly on the flank: the whole animal braces, not just the tail. */
const SWAT: QuadClipDef = {
  name: 'swat', duration: 1.7, loop: false,
  frames: [
    { t: 0, pose: { Tail1: [0, 0, 0], Tail2: [0, 0, 0], Tail3: [0, 0, 0] } },
    {
      t: 0.26, ease: 'out',
      pose: {
        Tail1: [8, 0, -12], Tail2: [9, 0, -14], Tail3: [6, 0, -10],
        Hips: [-2, 0, 2.4], Loin: [-1, 0, 1.6], EarL: [-7, 0, -9], EarR: [-4, 0, 7],
        PelvisRR: [-3, 0, 0], UpperLegRR: [-3, 0, 0],
      },
    },
    {
      t: 0.62, ease: 'in',
      pose: { Tail1: [-6, 0, 24], Tail2: [-8, 0, 32], Tail3: [-6, 0, 36], Hips: [1, 0, -2], EarL: [-10, 0, -6] },
    },
    {
      t: 0.95, ease: 'out',
      pose: { Tail1: [-4, 0, -22], Tail2: [-6, 0, -30], Tail3: [-5, 0, -34], Hips: [0, 0, 1.4] },
    },
    {
      t: 1.28, ease: 'inout',
      pose: { Tail1: [-6, 0, 13], Tail2: [-7, 0, 16], Tail3: [-5, 0, 18], EarR: [-5, 0, -4] },
    },
    { t: 1.7, pose: { Tail1: [0, 0, 0], Tail2: [0, 0, 0], Tail3: [0, 0, 0] } },
  ],
};

export function buildQuadClips(species: QuadSpecies, spec: SpeciesSpec): Record<QuadClipName, THREE.AnimationClip> {
  const defs: QuadClipDef[] = [
    idleDef(species),
    gaitDef(species, spec, 'walk'),
    gaitDef(species, spec, 'trot'),
    sniffDef(),
    grazeDef(species),
    tiedDef(species),
    STARTLE,
    TIE_REACT,
    PAW,
    SHAKE,
    SWAT,
    BUGBITE,
  ];
  const out = {} as Record<QuadClipName, THREE.AnimationClip>;
  for (const def of defs) out[def.name] = buildQuadClip(def);
  return out;
}
