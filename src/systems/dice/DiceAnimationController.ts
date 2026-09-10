/** Centralised dice-overlay timing (motion-safe aware). */
export const DICE_TIMING = {
  settleDelayMs: 1500,
  badgeDelayMs: 420,
  bannerDelayMs: 950,
  dismissMs: 2500,
  physicsTimeoutMs: 3200,
  /** Free-tumble seconds before the final-window guidance eases in. */
  guideBeginSec: 1.15,
  reduced: {
    settleDelayMs: 350,
    dismissMs: 2200,
  },
};

export const diceTiming = (reduced: boolean): { dismissMs: number } => ({
  dismissMs: reduced ? DICE_TIMING.reduced.dismissMs : DICE_TIMING.dismissMs,
});

export const waitMs = (ms: number): Promise<void> =>
  new Promise(resolve => { window.setTimeout(resolve, ms); });
