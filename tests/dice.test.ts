import { describe, it, expect } from 'vitest';
import { cryptoRandomFloat, cryptoRandomInt, resolveRoll } from '../src/systems/dice/DiceResultResolver';
import { faceLabel } from '../src/systems/dice/DieMeshFactory';

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
