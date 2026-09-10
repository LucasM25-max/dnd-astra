import { describe, it, expect } from 'vitest';
import { sobelNormal, spriteLightUniforms } from '../src/engine/actors/sprites';

describe('sprite normal kernel (billboard tangent space)', () => {
  it('faces the viewer on flat paint', () => {
    const [r, g, b] = sobelNormal(() => .5, 3, 4, 2.4);
    expect(r).toBeCloseTo(.5, 6); expect(g).toBeCloseTo(.5, 6); expect(b).toBeCloseTo(1, 6);
  });
  it('tilts away from brightening paint (U right)', () => {
    // Height rising toward +U: the surface normal tips toward −U.
    const [r, g, b] = sobelNormal((x) => x * .1, 5, 5, 2.4);
    expect(r).toBeLessThan(.5); expect(g).toBeCloseTo(.5, 6); expect(b).toBeLessThan(1);
  });
  it('treats canvas-down as V-down (green up)', () => {
    // Height rising toward canvas row+1 (V-down): the normal tips toward +V.
    const [, g] = sobelNormal((_x, y) => y * .1, 5, 5, 2.4);
    expect(g).toBeGreaterThan(.5);
  });
  it('rounds a bump: crown faces out, flanks tilt away', () => {
    const h = (x: number, y: number) => Math.max(0, 1 - (x * x + y * y) * .1);
    const crown = sobelNormal(h, 0, 0, 2.4);
    expect(crown[0]).toBeCloseTo(.5, 6); expect(crown[2]).toBeCloseTo(1, 2);
    const [r] = sobelNormal(h, 1, 0, 2.4);
    expect(r).toBeGreaterThan(.5);
  });
  it('stays flat at zero strength', () => {
    const [r, g, b] = sobelNormal((x, y) => x + y * 2, 5, 5, 0);
    expect(r).toBeCloseTo(.5, 6); expect(g).toBeCloseTo(.5, 6); expect(b).toBeCloseTo(1, 6);
  });
});

describe('shared sprite light rig', () => {
  it('exposes one sun + hemisphere uniform set for all actors', () => {
    expect(spriteLightUniforms.uSunDir.value.length()).toBeCloseTo(1, 6);
    for (const key of ['uSunColor', 'uHemiSky', 'uHemiGround'] as const) {
      expect(spriteLightUniforms[key].value.isColor).toBe(true);
    }
  });
});
