import * as THREE from 'three';
import { QUAD_BONES, LEG_IDS, type QuadBoneName, type QuadSpecies, type SpeciesSpec } from './QuadrupedRig';

/**
 * Procedural clip library for the quadruped rig.
 *
 * Poses are authored in degrees about each bone's local axes (identity at
 * bind, like the hero rig): +X pitches a segment down/forward, +Z swings it
 * sideways. The walk gait is generated per species so stride, lift and beat
 * offsets follow the animal's proportions, and the foot bones carry the same
 * world-pitch compensation as the hero gait so hooves plant flat.
 */

export type QuadClipName = 'idle' | 'walk' | 'sniff' | 'tied' | 'startle' | 'tie_react';
export const QUAD_CLIP_NAMES: QuadClipName[] = ['idle', 'walk', 'sniff', 'tied', 'startle', 'tie_react'];

type Pose = Partial<Record<QuadBoneName, [number, number, number]>>;
interface Key { t: number; ease?: 'in' | 'out' | 'inout' | 'smooth'; pose: Pose; root?: [number, number, number] }
interface ClipDef { name: QuadClipName; duration: number; loop: boolean; keys: Key[] }

const easeFn = (kind: Key['ease']): ((t: number) => number) => {
  if (kind === 'in') return t => t * t;
  if (kind === 'out') return t => 1 - (1 - t) * (1 - t);
  if (kind === 'smooth') return t => t * t * t * (t * (t * 6 - 15) + 10);
  return t => t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function sample(def: ClipDef, time: number): { pose: Map<QuadBoneName, [number, number, number]>; root: [number, number, number] } {
  const keys = def.keys;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= time) i++;
  const a = keys[i], b = keys[i + 1];
  const span = Math.max(1e-6, b.t - a.t);
  const t = easeFn(b.ease)(Math.min(1, Math.max(0, (time - a.t) / span)));
  const pose = new Map<QuadBoneName, [number, number, number]>();
  for (const bone of QUAD_BONES) {
    const pa = a.pose[bone], pb = b.pose[bone];
    if (!pa && !pb) continue;
    const from = pa ?? (pb as [number, number, number]);
    const to = pb ?? (pa as [number, number, number]);
    pose.set(bone, [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)]);
  }
  const ra = a.root ?? [0, 0, 0], rb = b.root ?? [0, 0, 0];
  return { pose, root: [lerp(ra[0], rb[0], t), lerp(ra[1], rb[1], t), lerp(ra[2], rb[2], t)] };
}

/**
 * Bake a clip to quaternion tracks. Sparse authored keys (<=8) are resampled
 * at 30 Hz through the eased sampler so one-shots curve instead of snapping;
 * dense procedural gaits pass through as authored.
 */
export function buildQuadClip(def: ClipDef): THREE.AnimationClip {
  const dense = def.keys.length > 8;
  const frames: { t: number; pose: Map<QuadBoneName, [number, number, number]>; root: [number, number, number] }[] = [];
  if (dense) {
    for (const key of def.keys) {
      const pose = new Map<QuadBoneName, [number, number, number]>();
      for (const [bone, p] of Object.entries(key.pose)) pose.set(bone as QuadBoneName, p as [number, number, number]);
      frames.push({ t: key.t, pose, root: key.root ?? [0, 0, 0] });
    }
  } else {
    const step = 1 / 30;
    for (let t = 0; t < def.duration - 1e-6; t += step) frames.push({ t, ...sample(def, t) });
    frames.push({ t: def.duration, ...sample(def, def.duration) });
  }
  const tracks: THREE.QuaternionKeyframeTrack[] = [];
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  for (const bone of QUAD_BONES) {
    if (!frames.some(f => f.pose.has(bone))) continue;
    const times: number[] = [], values: number[] = [];
    for (const f of frames) {
      const p = f.pose.get(bone) ?? [0, 0, 0];
      times.push(f.t);
      e.set((p[0] * Math.PI) / 180, (p[1] * Math.PI) / 180, (p[2] * Math.PI) / 180, 'XYZ');
      q.setFromEuler(e);
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, Float32Array.from(times), Float32Array.from(values)));
  }
  if (frames.some(f => f.root.some(v => v !== 0))) {
    const rt: number[] = [], rv: number[] = [];
    for (const f of frames) { rt.push(f.t); rv.push(...f.root); }
    tracks.push(new THREE.VectorKeyframeTrack('Root.position', Float32Array.from(rt), Float32Array.from(rv)));
  }
  return new THREE.AnimationClip(def.name, def.duration, tracks);
}

/* ------------------------------------------------------------------ */
/* Gait generation                                                     */
/* ------------------------------------------------------------------ */

/**
 * One leg's pose at cycle phase `u` (0..1). Returns thigh/knee/foot angles in
 * degrees with the foot's world-pitch term compensated out of the chain so
 * the hoof sole stays parallel to the ground through stance.
 */
function legAngles(u: number, phase: number, swing: number, foldBase: number, foldAmp: number, foldSign: 1 | -1): { thigh: number; knee: number; footWorld: number } {
  const x = (u + phase) % 1;
  const thigh = swing * Math.sin(2 * Math.PI * x);
  // Knee folds through the swing half of the cycle.
  const swingGate = Math.max(0, Math.sin(2 * Math.PI * x - 1.1));
  const knee = (foldBase + foldAmp * swingGate) * foldSign;
  // World pitch of the foot: heel-up at strike, flat mid-stance, toe-off,
  // then level through the swing.
  let footWorld: number;
  if (x < 0.55) footWorld = lerp(-7, 16, x / 0.55);
  else footWorld = lerp(16, -6, (x - 0.55) / 0.45);
  return { thigh, knee, footWorld };
}

function walkDef(spec: SpeciesSpec, species: QuadSpecies): ClipDef {
  const duration = species === 'ox' ? 1.05 : 0.86;
  const swing = species === 'ox' ? 13 : 17;
  const bobAmp = spec.lift * 0.2;
  const phases: Record<string, number> = { FL: 0, FR: 0.5, RL: 0.25, RR: 0.75 };
  const fold: Record<string, [number, number, 1 | -1]> = {
    FL: [7, 32, 1], FR: [7, 32, 1], RL: [10, 26, -1], RR: [10, 26, -1],
  };
  const samples = 22;
  const keys: Key[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const pose: Pose = {};
    for (const leg of LEG_IDS) {
      const { thigh, knee, footWorld } = legAngles(u, phases[leg], swing, fold[leg][0], fold[leg][1], fold[leg][2]);
      pose[`UpperLeg${leg}` as QuadBoneName] = [thigh, 0, leg === 'FL' || leg === 'RL' ? 1.2 : -1.2];
      pose[`LowerLeg${leg}` as QuadBoneName] = [knee, 0, 0];
      // Compensate: the foot bone only needs the leftover world pitch.
      pose[`Foot${leg}` as QuadBoneName] = [footWorld - thigh - knee * fold[leg][2] * 0.35, 0, 0];
    }
    const bob = Math.sin(4 * Math.PI * u + 1);
    pose.Hips = [1.1 * bob, 1.6 * Math.sin(2 * Math.PI * u), 0];
    pose.Chest = [-0.9 * bob, 0, 0.8 * Math.sin(2 * Math.PI * u)];
    pose.Neck = [1.6 * Math.sin(2 * Math.PI * u + 0.8), 0, 0];
    pose.Head = [-1.4 * Math.sin(2 * Math.PI * u + 0.4), 2.4 * Math.sin(2 * Math.PI * u), 0];
    pose.Tail1 = [0, 0, 5 * Math.sin(2 * Math.PI * u * 0.5)];
    pose.Tail2 = [0, 0, 7 * Math.sin(2 * Math.PI * u * 0.5 - 0.7)];
    keys.push({ t: u * duration, pose, root: [0, bobAmp * bob, 0] });
  }
  // Wrap seamlessly: last key equals first.
  keys[keys.length - 1].pose = keys[0].pose;
  keys[keys.length - 1].root = keys[0].root;
  return { name: 'walk', duration, loop: true, keys };
}

function idleDef(species: QuadSpecies): ClipDef {
  const duration = species === 'ox' ? 4.6 : 3.8;
  const T = (f: number, p = 0) => Math.sin((2 * Math.PI * f) + p);
  const keys: Key[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, a = u * Math.PI * 2;
    const pose: Pose = {
      Hips: [0.8 * T(a * 0.5, 1), 2.2 * T(a * 0.25), 0],
      Chest: [1.5 * T(a), 0, 0.6 * T(a * 0.5)],
      Neck: [1.2 * T(a, 0.6), 2.6 * T(a * 0.25, 1.2), 0],
      Head: [-0.8 * T(a, 0.9), 3.4 * T(a * 0.5, 0.4), 0.8 * T(a * 0.25)],
      Tail1: [1.5 * T(a * 0.5), 0, 8 * T(a * 0.75)],
      Tail2: [2 * T(a * 0.5, 0.8), 0, 10 * T(a * 0.75, 0.9)],
    };
    if (species === 'ox') pose.Head = [-0.6 * T(a, 0.9), 4.2 * T(a * 0.5, 0.4), 0];
    keys.push({ t: u * duration, pose, root: [0, 0.006 * T(a), 0] });
  }
  keys[keys.length - 1].pose = keys[0].pose;
  keys[keys.length - 1].root = keys[0].root;
  return { name: 'idle', duration, loop: true, keys };
}

/** Head-low loop: neck reaches down and dips twice while the horse mouths at the ground. */
function sniffDef(): ClipDef {
  const duration = 3.6;
  const keys: Key[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, a = u * Math.PI * 2;
    const dip = Math.max(0, Math.sin(a * 2 - 1.2));
    const pose: Pose = {
      Hips: [-16 - 2 * dip, 0, 0],
      Chest: [5 + dip, 0, 0],
      Neck: [52 + 14 * dip, 3 * Math.sin(a * 0.5), 0],
      Head: [44 + 12 * dip, 5 * Math.sin(a), 0],
      UpperLegFL: [6 + 2 * dip, 0, 0], LowerLegFL: [10 + 4 * dip, 0, 0],
      UpperLegFR: [6 + 2 * dip, 0, 0], LowerLegFR: [10 + 4 * dip, 0, 0],
      UpperLegRL: [-3, 0, 0], LowerLegRL: [-6, 0, 0],
      UpperLegRR: [-3, 0, 0], LowerLegRR: [-6, 0, 0],
      Tail1: [4, 0, 5 * Math.sin(a * 0.75)],
      Tail2: [6, 0, 6 * Math.sin(a * 0.75 + 0.8)],
    };
    keys.push({ t: u * duration, pose, root: [0, -0.012 * dip, 0.01 * dip] });
  }
  keys[keys.length - 1].pose = keys[0].pose;
  keys[keys.length - 1].root = keys[0].root;
  return { name: 'sniff', duration, loop: true, keys };
}

/** Calm, haltered standing: head middling low, slow breath, lazy tail. */
function tiedDef(): ClipDef {
  const duration = 5.2;
  const keys: Key[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, a = u * Math.PI * 2;
    const pose: Pose = {
      Hips: [0.6 * Math.sin(a * 0.5), 1.6 * Math.sin(a * 0.25), 0],
      Chest: [1.2 * Math.sin(a * 0.8), 0, 0.5 * Math.sin(a * 0.5)],
      Neck: [16 + 2 * Math.sin(a * 0.8 + 0.6), 3 * Math.sin(a * 0.25), 0],
      Head: [8 + 1.4 * Math.sin(a * 0.8 + 1), 5 * Math.sin(a * 0.5 + 0.4), 0],
      Tail1: [2, 0, 7 * Math.sin(a * 0.6)],
      Tail2: [3, 0, 9 * Math.sin(a * 0.6 + 0.9)],
    };
    keys.push({ t: u * duration, pose, root: [0, 0.005 * Math.sin(a * 0.8), 0] });
  }
  keys[keys.length - 1].pose = keys[0].pose;
  keys[keys.length - 1].root = keys[0].root;
  return { name: 'tied', duration, loop: true, keys };
}

const STARTLE: ClipDef = {
  name: 'startle',
  duration: 1.3,
  loop: false,
  keys: [
    { t: 0, pose: {} },
    {
      t: 0.28, ease: 'out', root: [0, 0.02, -0.14],
      pose: {
        Hips: [4, 0, 0], Chest: [-5, 0, 0], Neck: [-26, 0, 0], Head: [-16, 6, 0],
        UpperLegFL: [-16, 0, 0], LowerLegFL: [12, 0, 0], UpperLegFR: [-20, 0, 0], LowerLegFR: [16, 0, 0],
        UpperLegRL: [10, 0, 0], LowerLegRL: [-8, 0, 0], UpperLegRR: [12, 0, 0], LowerLegRR: [-10, 0, 0],
        Tail1: [-8, 0, 0], Tail2: [-10, 0, 0],
      },
    },
    {
      t: 0.66, ease: 'inout', root: [0, 0.01, -0.24],
      pose: {
        Hips: [2, 0, 0], Chest: [-2, 0, 0], Neck: [-18, 4, 0], Head: [-10, -6, 0],
        UpperLegFL: [-8, 0, 0], LowerLegFL: [6, 0, 0], UpperLegFR: [-6, 0, 0], LowerLegFR: [4, 0, 0],
        UpperLegRL: [6, 0, 0], LowerLegRL: [-4, 0, 0], UpperLegRR: [8, 0, 0], LowerLegRR: [-6, 0, 0],
        Tail1: [-4, 0, 6], Tail2: [-6, 0, 8],
      },
    },
    { t: 1.3, ease: 'inout', root: [0, 0, 0], pose: {} },
  ],
};

const TIE_REACT: ClipDef = {
  name: 'tie_react',
  duration: 2.2,
  loop: false,
  keys: [
    { t: 0, pose: {} },
    {
      t: 0.55, ease: 'inout',
      pose: {
        Neck: [30, 4, 0], Head: [20, -6, 0], Chest: [2, 0, 0],
        Tail1: [2, 0, 6], Tail2: [3, 0, 8],
      },
    },
    {
      t: 1.3, ease: 'smooth',
      pose: {
        Neck: [34, -4, 0], Head: [24, 6, 0], Chest: [2, 0, 0],
        Tail1: [2, 0, -5], Tail2: [3, 0, -7],
      },
    },
    { t: 2.2, ease: 'inout', pose: { Neck: [14, 0, 0], Head: [8, 0, 0] } },
  ],
};

export function buildQuadClips(species: QuadSpecies, spec: SpeciesSpec): Record<QuadClipName, THREE.AnimationClip> {
  return {
    idle: buildQuadClip(idleDef(species)),
    walk: buildQuadClip(walkDef(spec, species)),
    sniff: buildQuadClip(sniffDef()),
    tied: buildQuadClip(tiedDef()),
    startle: buildQuadClip(STARTLE),
    tie_react: buildQuadClip(TIE_REACT),
  };
}
