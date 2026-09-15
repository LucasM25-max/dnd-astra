import * as THREE from 'three';
import { cryptoRandomFloat, cryptoRandomInt, resolveRoll, type DiceRollRequest, type DiceRollResult, type DieType } from './DiceResultResolver';
import { createDieMesh, disposeDieMesh, getFaceUpQuaternion, preloadDiceMaps } from './DieMeshFactory';
import { DicePhysicsScene } from './DicePhysicsScene';
import { diceStage, hideDiceOverlay, reducedMotion, showDiceOverlay, showDiceResult, waitForDiceContinue, waitForRoll } from './DiceOverlayUI';
import { diceSfx } from './DiceSfx';
import { DICE_TIMING, waitMs } from './DiceAnimationController';
import { gameState } from '../../game/state';

/**
 * Single entry point for every die roll in the game.
 * True-random result first (crypto), cosmetic physics guided to match.
 */
let tail: Promise<unknown> = Promise.resolve();

export interface DicePauseDeps {
  pause: (reason: string) => void;
  resume: (reason: string) => void;
}
let pausers: DicePauseDeps | null = null;

/** Wire the world's nested pause so rolls freeze the simulation (idempotent). */
export function initializeDiceRoller(deps: DicePauseDeps): void {
  pausers = deps;
  // Warm the PBR body-map cache so the first visible roll is already ivory.
  void preloadDiceMaps();
}

/**
 * The throw's flavour. `DicePhysicsScene` clamps this into the visible tray
 * (`cappedToss`), so the numbers can stay punchy without risking an escape.
 */
function randomToss(): { velocity: THREE.Vector3; angular: THREE.Vector3 } {
  return {
    velocity: new THREE.Vector3(
      (cryptoRandomFloat() < 0.5 ? -1 : 1) * (1.2 + cryptoRandomFloat() * 1.1),
      2.2 + cryptoRandomFloat() * 1.3,
      (cryptoRandomFloat() - 0.5) * 1.3,
    ),
    angular: new THREE.Vector3(
      (cryptoRandomFloat() - 0.5) * 22,
      (cryptoRandomFloat() - 0.5) * 22,
      (cryptoRandomFloat() - 0.5) * 22,
    ),
  };
}

async function doRoll(req: DiceRollRequest): Promise<DiceRollResult> {
  // 1. True random result BEFORE any visuals.
  const natural = cryptoRandomInt(1, req.die);
  const result = resolveRoll(req, natural);

  // 2. Target orientation for the pre-determined face.
  // Best-effort PBR: wait briefly for the body maps (instant after warm-up,
  // procedural ivory fallback if the connection is slow — never blocks).
  await Promise.race([preloadDiceMaps(), waitMs(900)]);
  const mesh = createDieMesh(req.die);
  const targetQuat = getFaceUpQuaternion(mesh, natural, cryptoRandomFloat());

  // 3. Dim the world + pause it.
  gameState.enter('CINEMATIC', 'dice');
  pausers?.pause('dice');
  document.body.dataset.dice = 'true';
  diceSfx.unlock();
  showDiceOverlay(req.label, result.dc, req.die);

  const reduced = reducedMotion();
  let physics: DicePhysicsScene | null = null;
  try {
    // 4–5. Toss + guided settle (or a single static frame when reduced motion
    // is preferred — the die is still visible, it simply never tumbles).
    // The panel also carries the readout and the two buttons, so the stage is
    // sized against the leftover height — otherwise a short window clips the
    // Continue button off the bottom of the panel.
    const budget = Math.floor(Math.min(window.innerWidth * 0.82, (window.innerHeight - 250) * 0.95));
    const size = Math.max(220, Math.min(460, budget));
    try {
      physics = new DicePhysicsScene(diceStage(), Math.max(280, size));
    } catch {
      physics = null; // No WebGL context: the numeric readout still carries the roll.
    }
    // 4. Settle the die into the tray and WAIT. Nothing is thrown until the
    //    player presses Roll — no auto-roll, no timed sequence.
    if (physics) {
      physics.onBounce = strength => diceSfx.bounce(strength);
      if (!reduced) physics.arm(mesh);
      else mesh.group.position.set(0, mesh.radius * 0.72, 0);
    }
    await waitForRoll();

    // 5. Throw it (or place it, when the player asked for reduced motion).
    if (physics && !reduced) {
      diceSfx.throwDie();
      physics.toss(randomToss());
      physics.guideTo(targetQuat, DICE_TIMING.guideBeginSec);
      await physics.untilSettled(DICE_TIMING.physicsTimeoutMs);
      diceSfx.land();
      physics.freeze();
    } else if (physics) {
      try {
        await physics.presentStatic(mesh, targetQuat);
      } catch {
        mesh.group.quaternion.copy(targetQuat);
      }
    } else {
      mesh.group.quaternion.copy(targetQuat);
    }
    // 6. Readout sequence.
    showDiceResult(result);
    // 7. Hold the result on screen until the player presses Continue.
    await waitForDiceContinue();
  } finally {
    physics?.dispose();
    disposeDieMesh(mesh);
    hideDiceOverlay();
    document.body.dataset.dice = 'false';
    pausers?.resume('dice');
    gameState.exit('CINEMATIC', 'dice');
  }
  return result;
}

/** Visible BG3-style roll. Serialised so overlays never stack. */
export function roll(req: DiceRollRequest): Promise<DiceRollResult> {
  const next = tail.then(() => doRoll(req));
  tail = next.catch(() => {});
  return next as Promise<DiceRollResult>;
}

/** Hidden roll with no overlay. */
export function rollHidden(sides: DieType): number {
  return cryptoRandomInt(1, sides);
}

/** Object-style access for engine wiring (world initialisation). */
export const roller = {
  initialize: initializeDiceRoller,
  roll,
  rollHidden,
};
