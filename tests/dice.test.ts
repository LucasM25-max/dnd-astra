import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DiceTray } from '../src/engine/actors/dice';

/**
 * The physical dice are only honest if the face pointing at the sky when a die
 * stops moving is the face the rules engine rolled. These tests throw every
 * die type, let the integrator settle it, and read the settled face back off
 * the mesh rather than trusting the number that went in.
 */

function tray() {
  const scene = new THREE.Scene();
  return new DiceTray(scene);
}

/** Which face value is pointing most nearly straight up, read off the mesh. */
function upFaceValue(trayInstance: DiceTray, index: number, faces: { value: number; normal: THREE.Vector3 }[]) {
  const die = (trayInstance as unknown as { dice: { group: THREE.Group }[] }).dice[index];
  die.group.updateMatrixWorld(true);
  let best = faces[0], bestDot = -Infinity;
  for (const face of faces) {
    const dot = face.normal.clone().applyQuaternion(die.group.quaternion).dot(new THREE.Vector3(0, 1, 0));
    if (dot > bestDot) { bestDot = dot; best = face; }
  }
  return { value: best.value, dot: bestDot, y: die.group.position.y };
}

function facesOf(trayInstance: DiceTray, sides: number) {
  const cache = (trayInstance as unknown as { cache: Map<number, { faces: { value: number; normal: THREE.Vector3 }[] }> }).cache;
  return cache.get(sides)!.faces;
}

function settle(trayInstance: DiceTray, limit = 1200) {
  for (let i = 0; i < limit && !trayInstance.settled; i++) trayInstance.update(1 / 60);
  return trayInstance.settled;
}

describe('physical dice tray', () => {
  it('registers every rolled die so it can fall and settle', () => {
    const t = tray();
    t.roll({ d20: 14, d20Pool: [14, 3], anchor: new THREE.Vector3(0, 0, 0) });
    expect(t.count).toBe(2);
    expect(t.settled).toBe(false);
    expect(settle(t)).toBe(true);
  });

  it('settles with the rolled face pointing up, for every die type', () => {
    for (const [sides, values] of [[4, [1, 2, 3, 4]], [6, [1, 3, 6]], [8, [1, 5, 8]], [10, [2, 7, 10]], [12, [1, 6, 12]], [20, [1, 7, 13, 20]]] as const) {
      for (const value of values) {
        const t = tray();
        t.roll({
          d20: sides === 20 ? value : undefined,
          d20Pool: sides === 20 ? [value] : undefined,
          damage: sides === 20 ? undefined : { dice: [value], sides, bonus: 0 },
          anchor: new THREE.Vector3(2, 0.5, -1),
        });
        expect(settle(t), `d${sides} value ${value} never settled`).toBe(true);
        const read = upFaceValue(t, 0, facesOf(t, sides));
        expect(read.value, `d${sides} settled showing ${read.value}, expected ${value}`).toBe(value);
        // The winning face must actually be facing the sky, not merely be the
        // least-wrong of twenty.
        expect(read.dot).toBeGreaterThan(0.995);
      }
    }
  });

  it('rests each die on the ground rather than through it', () => {
    for (const sides of [4, 6, 8, 10, 12, 20]) {
      const t = tray();
      t.roll({
        d20: sides === 20 ? 1 : undefined,
        damage: sides === 20 ? undefined : { dice: [1], sides, bonus: 0 },
        anchor: new THREE.Vector3(0, 0, 0),
      });
      expect(settle(t)).toBe(true);
      const die = (t as unknown as { dice: { group: THREE.Group; rest: number; inradius: number }[] }).dice[0];
      expect(die.group.position.y).toBeGreaterThanOrEqual(die.rest - 1e-6);
      expect(die.group.position.y).toBeLessThan(die.rest + die.inradius * 1.6);
    }
  });

  it('numbers a d20 so opposite faces sum to twenty-one', () => {
    const t = tray();
    t.roll({ d20: 1, anchor: new THREE.Vector3() });
    const faces = facesOf(t, 20);
    expect(faces).toHaveLength(20);
    const values = faces.map(f => f.value).sort((a, b) => a - b);
    expect(values).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    for (const face of faces) {
      const opposite = faces.reduce((best, other) =>
        (other !== face && face.normal.dot(other.normal) < best.normal.dot(face.normal) ? other : best), faces[0]);
      expect(face.value + opposite.value, `face ${face.value} opposite ${opposite.value}`).toBe(21);
    }
  });

  it('never leaves a die behind when the tray is cleared', () => {
    const t = tray();
    const group = t.group;
    for (let i = 0; i < 6; i++) {
      t.roll({ d20: 11 + i, anchor: new THREE.Vector3(i, 0, 0) });
      settle(t);
    }
    expect(group.children.length).toBeGreaterThan(0);
    t.clear();
    expect(group.children.length).toBe(0);
    expect(t.count).toBe(0);
  });

  it('adds damage dice beside the fate die instead of replacing it', () => {
    const t = tray();
    t.roll({ d20: 19, anchor: new THREE.Vector3() });
    expect(settle(t)).toBe(true);
    const before = t.count;
    t.roll({ damage: { dice: [4, 5], sides: 6, bonus: 2 }, anchor: new THREE.Vector3(), keep: true });
    expect(t.count).toBe(before + 2);
    expect(settle(t)).toBe(true);
    const sixes = facesOf(t, 6);
    expect(upFaceValue(t, before, sixes).value).toBe(4);
    expect(upFaceValue(t, before + 1, sixes).value).toBe(5);
  });

  it('fires the settled callback exactly once, only when every die has stopped', () => {
    const t = tray();
    let calls = 0;
    t.roll({ d20: 8, d20Pool: [8, 2], anchor: new THREE.Vector3() }, () => calls++);
    for (let i = 0; i < 60; i++) t.update(1 / 60);
    expect(calls).toBe(0);
    expect(settle(t)).toBe(true);
    // One more frame is what drains the listener queue.
    t.update(1 / 60);
    expect(calls).toBe(1);
    for (let i = 0; i < 120; i++) t.update(1 / 60);
    expect(calls).toBe(1);
  });
});
