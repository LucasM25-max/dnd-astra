import * as THREE from 'three';

/**
 * Deterministic skin-weight assignment for the authored hero body.
 *
 * Each body part is authored in bind-pose space and declares its own blend
 * rule, so weights are exact (no nearest-bone surprises at armpits/crotch).
 * Every vertex gets exactly two influences that sum to 1.
 */

export const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/**
 * Blend factor 0→1 as `value` travels from `from` to `to` (smoothstepped).
 * Works when `to` < `from` too (factor rises as value falls).
 */
export function blendRange(value: number, from: number, to: number): number {
  if (from === to) return value >= to ? 1 : 0;
  return smoothstep((value - from) / (to - from));
}

/** One vertex's skinning: two bone indices + the first bone's weight. */
export type WeightRule = (p: THREE.Vector3) => [number, number, number];

/** Constant single-bone weights (rigid parts: head, hands, feet). */
export function rigidRule(boneIndex: number): WeightRule {
  return () => [boneIndex, boneIndex, 1];
}

/**
 * Blend from boneA to boneB as the vertex travels along `axis` (a unit
 * direction through `origin`) from distance `from` to distance `to`.
 */
export function axisBlendRule(
  boneA: number,
  boneB: number,
  origin: THREE.Vector3,
  axis: THREE.Vector3,
  from: number,
  to: number,
): WeightRule {
  return (p: THREE.Vector3) => [boneA, boneB, 1 - blendRange(p.clone().sub(origin).dot(axis), from, to)];
}

/** Blend from boneA to boneB as world Y travels from `yFrom` to `yTo`. */
export function heightBlendRule(boneA: number, boneB: number, yFrom: number, yTo: number): WeightRule {
  return (p: THREE.Vector3) => [boneA, boneB, 1 - blendRange(p.y, yFrom, yTo)];
}

/**
 * Blend from boneA (weight 1 at/below `yLow`) to boneB (weight 1 at/above
 * `yHigh`), smoothstepped. For torso spans between two joints.
 */
export function sandwichRule(boneA: number, boneB: number, yLow: number, yHigh: number): WeightRule {
  return (p: THREE.Vector3) => [boneA, boneB, 1 - blendRange(p.y, yLow, yHigh)];
}

/** Write skinIndex/skinWeight attributes onto `geometry` using `rule`. */
export function applySkinWeights(geometry: THREE.BufferGeometry, rule: WeightRule): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const count = pos.count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i);
    const [a, b, w] = rule(v);
    indices[i * 4] = a;
    indices[i * 4 + 1] = b;
    weights[i * 4] = w;
    weights[i * 4 + 1] = 1 - w;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
}
