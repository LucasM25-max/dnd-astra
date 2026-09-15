import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cryptoRandomFloat, cryptoRandomInt, resolveRoll } from '../src/systems/dice/DiceResultResolver';
import { faceLabel } from '../src/systems/dice/DieMeshFactory';
import {
  advanceDie, armedSpot, cappedToss, ceilingAt, collideBounds, dieInFrame, flightEscapes, keepInView, trayBounds,
} from '../src/systems/dice/DiceContainment';
import { diceTrayLimit } from '../src/systems/dice/DicePhysicsScene';

const here = dirname(fileURLToPath(import.meta.url));
const source = (file: string): string => readFileSync(resolve(here, '..', 'src', 'systems', 'dice', file), 'utf8');

/** The exact camera the physics scene builds, so the bounds are meaningful. */
function trayCamera(aspect = 1): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 30);
  camera.position.set(0, 3.4, 4.8);
  camera.lookAt(0, 0.35, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

const D20_R = 0.62;
/** Mirrors DicePhysicsScene.measureTray: a d20 sits at 0.72r, dipping 0.28r below. */
const sceneBounds = (camera: THREE.PerspectiveCamera) => trayBounds(camera, {
  floorY: 0,
  restY: D20_R * 0.72,
  radius: D20_R,
  margin: 0.05,
  limit: diceTrayLimit(),
});
const BELOW = D20_R * 0.28;
const GRAV = -12.5;
const insideFrame = (camera: THREE.Camera, p: THREE.Vector3, slack = 0): boolean => {
  const v = p.clone().project(camera);
  return Math.abs(v.x) <= 1 - slack && Math.abs(v.y) <= 1 - slack && v.z < 1;
};

describe('crypto randomness', () => {
  it('stays inside inclusive two-arg bounds', () => {
    for (let i = 0; i < 200; i++) {
      const roll = cryptoRandomInt(1, 20);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
    }
  });
  it('treats a single argument as 0..max-1', () => {
    for (let i = 0; i < 100; i++) {
      const roll = cryptoRandomInt(6);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThanOrEqual(5);
    }
  });
  it('produces floats in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const roll = cryptoRandomFloat();
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
    }
  });
  it('covers the full d20 range over many draws', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(cryptoRandomInt(1, 20));
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('roll resolution', () => {
  it('adds modifiers and resolves DC checks', () => {
    const check = resolveRoll({ die: 20, modifier: 3, label: 'Perception Check', dc: 12 }, 9);
    expect(check.total).toBe(12);
    expect(check.success).toBe(true);
    const fail = resolveRoll({ die: 20, modifier: 1, label: 'Perception Check', dc: 12 }, 9);
    expect(fail.total).toBe(10);
    expect(fail.success).toBe(false);
  });
  it('leaves healing rolls without a verdict', () => {
    const heal = resolveRoll({ die: 10, modifier: 2, label: 'Hit Die — Healing' }, 7);
    expect(heal.total).toBe(9);
    expect(heal.dc).toBeNull();
    expect(heal.success).toBeNull();
  });
  it('clamps out-of-range naturals into the die', () => {
    expect(resolveRoll({ die: 6, label: 'x' }, 99).natural).toBe(6);
    expect(resolveRoll({ die: 6, label: 'x' }, -4).natural).toBe(1);
  });
});

describe('face labels', () => {
  it('shows 0 for 10 on a d10, like physical dice', () => {
    expect(faceLabel(10, 10)).toBe('0');
    expect(faceLabel(10, 7)).toBe('7');
  });
  it('dots 6 and 9 on a d20 so they cannot be misread', () => {
    expect(faceLabel(20, 6)).toBe('6.');
    expect(faceLabel(20, 9)).toBe('9.');
    expect(faceLabel(20, 16)).toBe('16');
  });
  it('labels other dice plainly', () => {
    expect(faceLabel(6, 3)).toBe('3');
    expect(faceLabel(12, 12)).toBe('12');
    expect(faceLabel(4, 1)).toBe('1');
  });
});

describe('dice containment', () => {
  it('derives tray bounds that keep a resting die fully on screen', () => {
    const camera = trayCamera();
    const b = trayBounds(camera, { floorY: 0, radius: D20_R, margin: 0.06 });
    expect(Number.isFinite(b.minX + b.maxX + b.minZ + b.maxZ + b.ceilingY)).toBe(true);
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxZ).toBeGreaterThan(b.minZ);
    expect(b.ceilingY).toBeGreaterThan(b.restY + 0.5);
    // A sane tray: neither postage-stamp nor whole-world.
    expect(b.maxX - b.minX).toBeGreaterThan(1.2);
    expect(b.maxX - b.minX).toBeLessThan(9);
    // Every corner of the resting rectangle must be visible, die included.
    for (const x of [b.minX, b.maxX, (b.minX + b.maxX) / 2]) {
      for (const z of [b.minZ, b.maxZ, (b.minZ + b.maxZ) / 2]) {
        const centre = new THREE.Vector3(x, b.restY, z);
        expect(insideFrame(camera, centre, 0.02), `${x.toFixed(2)},${z.toFixed(2)}`).toBe(true);
        // …and the die's own silhouette around that centre, since half of it
        // poking past the edge is exactly the bug being prevented.
        for (const d of [[D20_R, 0], [-D20_R, 0], [0, D20_R], [0, -D20_R], [0, 0, D20_R]]) {
          expect(insideFrame(camera, centre.clone().add(new THREE.Vector3(...d)))).toBe(true);
        }
      }
    }
  });

  it('stays in frame on a wide viewport as well as a square one', () => {
    for (const aspect of [0.6, 1, 1.9, 2.6]) {
      const camera = trayCamera(aspect);
      const b = trayBounds(camera, { floorY: 0, radius: D20_R, margin: 0.06 });
      const mid = new THREE.Vector3((b.minX + b.maxX) / 2, b.restY, (b.minZ + b.maxZ) / 2);
      expect(insideFrame(camera, mid, 0.1), `aspect ${aspect}`).toBe(true);
      expect(b.maxX - b.minX).toBeGreaterThan(0.8);
    }
  });

  it('reflects a runaway die off the walls instead of letting it travel', () => {
    const camera = trayCamera();
    const b = trayBounds(camera, { floorY: 0, radius: D20_R, margin: 0.06 });
    const pos = new THREE.Vector3(b.maxX + 3, b.ceilingY + 4, b.minZ - 3);
    const vel = new THREE.Vector3(5, 6, -5);
    const hit = collideBounds(pos, vel, b);
    expect(hit.x && hit.z).toBe(true);
    expect(pos.x).toBeLessThanOrEqual(b.maxX + 1e-6);
    expect(pos.z).toBeGreaterThanOrEqual(b.minZ - 1e-6);
    expect(vel.x).toBeLessThan(0);
    expect(vel.z).toBeGreaterThan(0);
    // The ceiling clamp matters as much as the side walls: the reported escape
    // was the die arcing out of the top of the frame.
    expect(pos.y).toBeLessThanOrEqual(b.ceilingY + 1e-6);
  });

  it('pulls a die back into view when physics puts it off-screen', () => {
    const camera = trayCamera();
    const b = trayBounds(camera, { floorY: 0, radius: D20_R, margin: 0.06 });
    const pos = new THREE.Vector3(14, 9, 14);
    const vel = new THREE.Vector3(9, 9, 9);
    expect(insideFrame(camera, pos)).toBe(false);
    expect(keepInView(pos, vel, camera, b)).toBe(true);
    expect(insideFrame(camera, pos)).toBe(true);
    expect(vel.length()).toBeLessThan(2);
    // Already-visible dice are left completely alone.
    const ok = new THREE.Vector3(0, b.restY, (b.minZ + b.maxZ) / 2);
    expect(keepInView(ok, new THREE.Vector3(1, 0, 0), camera, b)).toBe(false);
    expect(ok.x).toBe(0);
  });

  it('caps a toss so the flight cannot outrun the tray or the ceiling', () => {
    const camera = trayCamera();
    const b = sceneBounds(camera);
    for (let i = 0; i < 40; i++) {
      const wild = new THREE.Vector3((i % 2 ? -1 : 1) * (4 + i * 0.4), 9 + i * 0.5, (i % 3 - 1) * 5);
      const v = cappedToss(wild, b, -12.5);
      // Softer than what went in, and it lands somewhere the player can see.
      expect(v.length()).toBeLessThan(wild.length());
      const run = flightEscapes(armedSpot(b, () => (i * 0.29) % 1), v, b, {
        gravity: -12.5, restitution: 0.42, frames: 300, dt: 1 / 60, camera, below: BELOW, radius: D20_R,
      });
      expect(run.escaped, `toss ${i} left the frame at frame ${run.frames}`).toBe(false);
      // 1.25x of the frame's room is the deliberate slack in `cappedToss`; the
      // frame-aware ceiling inside `advanceDie` is what actually stops the die.
      expect(v.y).toBeLessThanOrEqual(Math.sqrt(2 * 12.5 * (b.ceilingY - b.restY) * 1.25) + 1e-6);
    }
  });

  it('arms the die inside the tray at a random-ish spot', () => {
    const camera = trayCamera();
    const b = trayBounds(camera, { floorY: 0, radius: D20_R, margin: 0.06 });
    let n = 0;
    for (let i = 0; i < 30; i++) {
      const p = armedSpot(b, () => (i * 0.37) % 1);
      expect(p.x).toBeGreaterThanOrEqual(b.minX - 1e-6);
      expect(p.x).toBeLessThanOrEqual(b.maxX + 1e-6);
      expect(insideFrame(camera, p)).toBe(true);
      if (Math.abs(p.x - (b.minX + b.maxX) / 2) > 0.01) n++;
    }
    expect(n).toBeGreaterThan(1);
  });
});

describe('player-gated dice overlay', () => {
  it('offers a Roll button and a separate Continue button', () => {
    const ui = source('DiceOverlayUI.ts');
    expect(ui).toContain('id="dice-roll"');
    expect(ui).toContain('id="dice-continue"');
    expect(ui).toContain("if (phase === 'armed') confirmRoll()");
    expect(ui).toContain("if (phase === 'result') confirmContinue()");
    // The result must gate the way out: Continue only appears after the readout.
    expect(ui).toMatch(/armContinue\(DICE_TIMING\.bannerDelayMs/);
  });

  it('has no auto-dismiss timer anywhere in the flow', () => {
    const ui = source('DiceOverlayUI.ts');
    const roller = source('DiceRoller.ts');
    const timing = source('DiceAnimationController.ts');
    expect(ui).not.toMatch(/setTimeout\(\s*(finish|resolve|dismiss)/);
    expect(roller).not.toContain('waitForDiceDismiss(');
    expect(timing).not.toContain('dismissMs');
    expect(ui).toContain('export function waitForDiceContinue');
  });

  it('rolls only after the button, and holds the result until the next one', () => {
    const roller = source('DiceRoller.ts');
    const rollGate = roller.indexOf('await waitForRoll()');
    const toss = roller.indexOf('physics.toss(');
    const result = roller.indexOf('showDiceResult(result)');
    const confirm = roller.indexOf('await waitForDiceContinue()');
    expect(rollGate).toBeGreaterThan(-1);
    expect(toss).toBeGreaterThan(rollGate);
    expect(result).toBeGreaterThan(toss);
    expect(confirm).toBeGreaterThan(result);
    // …and the same gate covers the reduced-motion and no-WebGL paths.
    expect(roller.match(/await waitForRoll\(\)/g)?.length).toBe(1);
    expect(roller.slice(0, rollGate)).not.toContain('diceSfx.throwDie()');
  });

  it('keeps the overlay buttons clickable through the inert panel', () => {
    const css = readFileSync(resolve(here, '..', 'src', 'systems', 'dice', 'dice.css'), 'utf8');
    const panel = css.slice(css.indexOf('.dice-actions'), css.indexOf('.dice-hint'));
    expect(panel).toContain('pointer-events: auto');
    expect(css.slice(css.indexOf('#dice-overlay .dice-panel'), css.indexOf('.dice-eyebrow'))).toContain('pointer-events: none');
  });
});

describe('dice flight replay', () => {
  /** The scene's own numbers, thrown through the scene's own integrator. */
  const tosses = (wild: boolean): THREE.Vector3[] => {
    const list: THREE.Vector3[] = [];
    for (let i = 0; i < 48; i++) {
      const dirX = i % 2 === 0 ? -1 : 1;
      list.push(new THREE.Vector3(
        dirX * (wild ? 3 + i * 0.3 : 1.2 + (i % 7) * 0.16),
        wild ? 8 + i * 0.4 : 2.2 + (i % 9) * 0.25,
        (wild ? ((i % 5) - 2) * 2.4 : ((i % 5) - 2) * 0.33),
      ));
    }
    return list;
  };
  const replay = (camera: THREE.PerspectiveCamera, raw: THREE.Vector3, i: number, wild: boolean) => {
    const b = sceneBounds(camera);
    const start = armedSpot(b, () => (i * 0.37) % 1);
    const room = Math.max(0.4, ceilingAt(camera, start, b, BELOW) - b.restY);
    const v = cappedToss(raw, b, GRAV, wild ? undefined : room);
    const run = flightEscapes(start, v, b, {
      gravity: GRAV, restitution: 0.42, frames: 300, dt: 1 / 60,
      camera, below: BELOW, radius: D20_R,
    });
    return { b, run, v };
  };

  it('keeps every production-shaped toss fully in shot, frame by frame', () => {
    const camera = trayCamera();
    const list = tosses(false);
    list.forEach((raw, i) => {
      const { run, v } = replay(camera, raw, i, false);
      expect(run.escaped, `toss ${i} (v=${v.toArray().map(n => n.toFixed(2)).join(',')}) escaped at frame ${run.frames}`).toBe(false);
      expect(run.outOfFrame).toBe(0);
      expect(run.frames).toBeLessThan(300); // it comes to rest, it does not float
    });
  });

  it('holds the line even for a throw no player could make', () => {
    const camera = trayCamera();
    tosses(true).forEach((raw, i) => {
      const { run } = replay(camera, raw, i, true);
      expect(run.escaped, `wild toss ${i} escaped at frame ${run.frames}`).toBe(false);
    });
  });

  it('rests the die on the leather inside the frame after the flight', () => {
    const camera = trayCamera();
    const b = sceneBounds(camera);
    for (let i = 0; i < 12; i++) {
      const start = armedSpot(b, () => (i * 0.41) % 1);
      const v = cappedToss(new THREE.Vector3(-2.4, 3.1, 0.5), b, GRAV, ceilingAt(camera, start, b, BELOW) - b.restY);
      const body = { pos: start.clone(), vel: v };
      for (let f = 0; f < 240; f++) {
        // Guidance damping, then the scene's own step — floor, walls, ceiling.
        body.vel.multiplyScalar(Math.max(0, 1 - (1 / 60) * 2.2));
        advanceDie(body, 1 / 60, { gravity: GRAV, restitution: 0.42, bounds: b, camera, below: BELOW });
      }
      expect(dieInFrame(camera, body.pos, D20_R, BELOW), `settled at ${body.pos.toArray().map(n => n.toFixed(2)).join(',')}`).toBe(true);
    }
  });
});
