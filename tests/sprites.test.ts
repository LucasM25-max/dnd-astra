import { describe, it, expect } from 'vitest';
import { directionIndex, viewAngle, relForIndex } from '../src/engine/actors/sprites';
import { fighterPose } from '../src/engine/actors/fighter';
import { animalPose } from '../src/engine/actors/animalSprite';
const D2R = Math.PI / 180;
const finite = (p: { x: number; y: number; z: number }) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const camAt = (deg: number, r = 5) => ({ x: -Math.sin(deg * D2R) * r, z: -Math.cos(deg * D2R) * r });

describe('16-position sprite direction picking', () => {
  it('maps front, back, left, and right cameras to the right variants', () => {
    // Actor faces north (yaw 0).
    expect(directionIndex(0, 0, 0, 0, -5)).toBe(0);   // camera in front → face
    expect(directionIndex(0, 0, 0, 0, 5)).toBe(8);    // camera behind → back
    expect(directionIndex(0, 0, 0, -5, 0)).toBe(4);   // camera on the actor's left
    expect(directionIndex(0, 0, 0, 5, 0)).toBe(12);   // camera on the actor's right
  });
  it('covers all sixteen variants around the actor', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 16; i++) {
      const c = camAt(i * 22.5);
      seen.add(directionIndex(0, 0, 0, c.x, c.z));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
  it('rotates with the actor, not the world', () => {
    const c = camAt(0);
    expect(directionIndex(Math.PI, 0, 0, c.x, c.z)).toBe(8); // now facing the camera's opposite way
  });
  it('reports the painted camera angle for each variant consistently', () => {
    expect(relForIndex(0)).toBeCloseTo(0, 6);
    expect(relForIndex(8)).toBeCloseTo(Math.PI, 6);
    // Index 4 ↔ camera at +90° (the actor's left side is shown); 12 ↔ −90°.
    expect(relForIndex(4)).toBeCloseTo(Math.PI / 2, 6);
    expect(relForIndex(12)).toBeCloseTo(-Math.PI / 2, 6);
  });
  it('keeps the angle continuous across the wrap-around', () => {
    const a1 = viewAngle(0, 0, 0, camAt(350).x, camAt(350).z);
    const a2 = viewAngle(0, 0, 0, camAt(10).x, camAt(10).z);
    expect(Math.abs(a1 - a2)).toBeLessThan(20 * D2R);
  });
});

describe('fighter pose (chain mail, greatsword, flail, javelins)', () => {
  const actions = ['idle', 'walk', 'sprint', 'seated'] as const;
  it('stays finite and grounded across every action and gait phase', () => {
    for (const action of actions) for (let i = 0; i < 24; i++) {
      const p = fighterPose(action, i / 24 * Math.PI * 2, i * .11);
      for (const key of ['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'toeL', 'toeR', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR', 'head'] as const) {
        expect(finite(p[key]), `${action} ${key}`).toBe(true);
      }
      expect(p.toeL.y).toBeGreaterThanOrEqual(0); expect(p.toeR.y).toBeGreaterThanOrEqual(0);
      if (!p.seated) {
        expect(p.hipL.y).toBeGreaterThan(.9); expect(p.hipL.y).toBeLessThan(1.08);
        expect(p.head.y).toBeGreaterThan(1.45); expect(p.head.y).toBeLessThan(1.72);
      }
    }
  });
  it('keeps the greatsword blade at a constant length', () => {
    for (const action of actions) {
      const p = fighterPose(action, .7, 1.1);
      const dx = p.sword.tip.x - p.sword.grip.x, dy = p.sword.tip.y - p.sword.grip.y, dz = p.sword.tip.z - p.sword.grip.z;
      expect(Math.hypot(dx, dy, dz)).toBeCloseTo(1.02, 1);
    }
  });
  it('swings the legs through the stride while walking, wider when sprinting', () => {
    let walkMax = 0, sprintMax = 0;
    for (let i = 0; i < 24; i++) {
      const w = fighterPose('walk', i / 24 * Math.PI * 2, 0);
      const s = fighterPose('sprint', i / 24 * Math.PI * 2, 0);
      walkMax = Math.max(walkMax, Math.abs(w.toeL.z), Math.abs(w.toeR.z));
      sprintMax = Math.max(sprintMax, Math.abs(s.toeL.z), Math.abs(s.toeR.z));
    }
    expect(walkMax).toBeGreaterThan(.2);
    expect(sprintMax).toBeGreaterThan(walkMax * 1.2);
  });
  it('sits with bent legs and hands forward on the reins', () => {
    const p = fighterPose('seated', 0, 0);
    expect(p.seated).toBe(true);
    expect(p.toeL.y).toBeLessThan(.05); expect(p.toeR.y).toBeLessThan(.05);
    expect(p.toeL.z).toBeGreaterThan(.3); expect(p.toeR.z).toBeGreaterThan(.3);
    expect(p.handL.z).toBeGreaterThan(.15); expect(p.handR.z).toBeGreaterThan(.15);
    expect(p.kneeL.z).toBeGreaterThan(p.hipL.z); expect(p.kneeR.z).toBeGreaterThan(p.hipR.z);
  });
  it('varies the walk cycle frame to frame', () => {
    const a = fighterPose('walk', 0, 0), b = fighterPose('walk', Math.PI / 3, 0);
    expect(Math.abs(a.toeL.z - b.toeL.z) + Math.abs(a.toeR.z - b.toeR.z)).toBeGreaterThan(.05);
  });
});

describe('animal pose (ox and horse sprites)', () => {
  for (const species of ['ox', 'horse'] as const) {
    it(`${species} stays finite and hooves stay on the ground`, () => {
      for (let i = 0; i < 12; i++) {
        const p = animalPose(species, i / 12 * Math.PI * 2, i * .17, 0, 1);
        for (const leg of p.legs) {
          expect(finite(leg.hip)).toBe(true); expect(finite(leg.toe)).toBe(true);
          expect(leg.toe.y).toBeGreaterThanOrEqual(0);
        }
        for (const b of p.body) { expect(finite(b)).toBe(true); expect(b.y).toBeGreaterThan(.4); expect(b.y).toBeLessThan(2); }
      }
    });
    it(`${species} has the right head dress`, () => {
      const ox = animalPose('ox', 0, 0);
      const horse = animalPose('horse', 0, 0);
      expect(ox.horns).not.toBeNull();
      expect(horse.horns).toBeNull();
      expect(horse.mane).toBeDefined();
      expect(ox.mane).toBeUndefined();
    });
  }
  it('lowers the horse head when sniffing the ransacked belongings', () => {
    const up = animalPose('horse', 0, 0, 0, 0);
    const down = animalPose('horse', 0, 0, 1, 0);
    expect(down.skull.y).toBeLessThan(up.skull.y - .25);
    expect(down.muzzle.y).toBeLessThan(up.muzzle.y - .3);
  });
});
