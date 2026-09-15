/**
 * Centralised dice-overlay timing (motion-safe aware).
 *
 * There is deliberately no auto-dismiss any more: the overlay opens armed and
 * waits for the Roll button, then holds the result until the Continue button.
 * The only timers left are cosmetic — how long the readout takes to land, and
 * the short beat before Continue appears so nobody can skip past the number.
 */
export const DICE_TIMING = {
  badgeDelayMs: 420,
  bannerDelayMs: 950,
  /** Beat after the verdict lands before Continue becomes available. */
  continueDelayMs: 420,
  physicsTimeoutMs: 3200,
  /** Free-tumble seconds before the final-window guidance eases in. */
  guideBeginSec: 1.15,
  reduced: {
    settleDelayMs: 350,
    continueDelayMs: 0,
  },
};

export const diceTiming = (reduced: boolean): { continueDelayMs: number } => ({
  continueDelayMs: reduced ? DICE_TIMING.reduced.continueDelayMs : DICE_TIMING.continueDelayMs,
});

export const waitMs = (ms: number): Promise<void> =>
  new Promise(resolve => { window.setTimeout(resolve, ms); });
