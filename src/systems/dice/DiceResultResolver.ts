/** True-random dice resolution. crypto.getRandomValues only — never Math.random. */

export type DieType = 4 | 6 | 8 | 10 | 12 | 20;

export interface DiceRollRequest {
  die: DieType;
  modifier?: number;
  label: string;
  dc?: number;
}

export interface DiceRollResult {
  die: DieType;
  natural: number;
  modifier: number;
  total: number;
  label: string;
  dc: number | null;
  success: boolean | null;
}

function randomUint32(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0];
}

/**
 * Crypto-secure integer. Two-arg form is inclusive on both ends:
 * cryptoRandomInt(1, 20) → 1..20. Single-arg form is 0..max-1.
 */
export function cryptoRandomInt(minOrMax: number, max?: number): number {
  const inclusive = max !== undefined;
  const min = inclusive ? Math.ceil(minOrMax) : 0;
  const hi = inclusive ? Math.floor(max!) : Math.ceil(minOrMax) - 1;
  const range = hi - min + 1;
  if (range <= 0) return min;
  // Rejection sampling: unbiased even when range doesn't divide 2^32.
  const limit = Math.floor(0x100000000 / range) * range;
  let roll = randomUint32();
  while (roll >= limit) roll = randomUint32();
  return min + (roll % range);
}

/** Crypto-secure float in [0, 1). */
export function cryptoRandomFloat(): number {
  return randomUint32() / 0x100000000;
}

/** Resolve a roll from a pre-determined natural result (pure, unit-tested). */
export function resolveRoll(req: DiceRollRequest, natural: number): DiceRollResult {
  const modifier = req.modifier ?? 0;
  const clamped = Math.min(req.die, Math.max(1, Math.round(natural)));
  const total = clamped + modifier;
  const dc = req.dc ?? null;
  return {
    die: req.die,
    natural: clamped,
    modifier,
    total,
    label: req.label,
    dc,
    success: dc === null ? null : total >= dc,
  };
}
