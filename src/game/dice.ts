/**
 * Deterministic dice for the rules kernel.
 *
 * Every roll in Astra comes from an explicit `DiceStream`. A stream is created
 * from a seed and advances one step per die, so an encounter replayed from the
 * same seed produces the same fight. Nothing in the renderer, UI or AI is
 * allowed to call `Math.random` for a rules-visible outcome.
 *
 * The previous implementation hashed a single integer seed per action, which
 * meant every goblin resolving on the same frame rolled the same number and
 * "advantage" was two hashes of one value. A counter-based stream fixes both.
 */

/** A counter-based PRNG (SplitMix32). Uniform, fast, and trivially replayable. */
export class DiceStream {
  private state: number;
  /** Number of dice drawn so far — useful for logging and replay assertions. */
  count = 0;

  constructor(seed: number) {
    // Fold the seed so adjacent encounter ids do not produce adjacent streams.
    let s = seed | 0;
    s = Math.imul(s ^ (s >>> 16), 0x21f0aaad);
    s = Math.imul(s ^ (s >>> 15), 0x735a2d97);
    this.state = (s ^ (s >>> 15)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.count++;
    this.state = (this.state + 0x9e3779b9) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  }

  /** Roll one die with `sides` faces. */
  die(sides: number): number {
    if (!Number.isInteger(sides) || sides < 2) throw new Error(`Invalid die: d${sides}`);
    return Math.floor(this.next() * sides) + 1;
  }

  d20() { return this.die(20); }

  /** Roll `count`d`sides` and return the individual faces. */
  roll(count: number, sides: number): number[] {
    const dice: number[] = [];
    for (let i = 0; i < Math.max(0, Math.floor(count)); i++) dice.push(this.die(sides));
    return dice;
  }

  /** Pick one element uniformly. */
  pick<T>(items: readonly T[]): T { return items[Math.floor(this.next() * items.length)]; }

  /** A child stream, so a sub-system can roll without disturbing this order. */
  fork(tag: number) { return new DiceStream((this.state ^ Math.imul(tag | 0, 0x85ebca6b)) | 0); }
}

/** `2d6+3`, `1d8`, `4` — the subset of dice notation the game data uses. */
export interface DiceExpression { count: number; sides: number; bonus: number }

const NOTATION = /^\s*(?:(\d+)\s*[dD]\s*(\d+))?\s*(?:([+-])\s*(\d+))?\s*$/;

export function parseDice(notation: string): DiceExpression {
  const match = NOTATION.exec(notation);
  if (!match || (!match[1] && !match[4])) throw new Error(`Unreadable dice notation: "${notation}"`);
  const bonus = match[4] ? Number(match[4]) * (match[3] === '-' ? -1 : 1) : 0;
  return { count: match[1] ? Number(match[1]) : 0, sides: match[2] ? Number(match[2]) : 0, bonus };
}

export interface DiceRoll { dice: number[]; bonus: number; total: number; notation: string }

/**
 * Roll an expression. `criticalDice` adds the weapon/spell dice again without
 * repeating the flat bonus, which is exactly how a PHB critical hit works.
 */
export function rollDice(expression: string | DiceExpression, stream: DiceStream, criticalDice = false): DiceRoll {
  const expr = typeof expression === 'string' ? parseDice(expression) : expression;
  const count = expr.count * (criticalDice ? 2 : 1);
  const dice = expr.sides > 0 ? stream.roll(count, expr.sides) : [];
  const total = dice.reduce((sum, d) => sum + d, 0) + expr.bonus;
  const notation = `${expr.count ? `${count}d${expr.sides}` : ''}${expr.bonus ? `${expr.bonus > 0 ? '+' : ''}${expr.bonus}` : ''}`;
  // Damage is never negative, but the raw total is kept for explanations.
  return { dice, bonus: expr.bonus, total, notation };
}

/** Average result, used for AI target selection and UI previews. */
export function averageOf(expression: string | DiceExpression) {
  const expr = typeof expression === 'string' ? parseDice(expression) : expression;
  return expr.count * (expr.sides + 1) / 2 + expr.bonus;
}
