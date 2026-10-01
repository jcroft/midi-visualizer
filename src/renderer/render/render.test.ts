import { describe, expect, it } from 'vitest';
import { fifthsPos, hueOf, oklchToLinear } from './color';
import { nearestAngle, stepSpring } from './spring';

describe('color', () => {
  it('converts OKLCH white and black', () => {
    const out = new Float32Array(3);
    oklchToLinear(1, 0, 0, out);
    for (const v of out) expect(v).toBeCloseTo(1, 3);
    oklchToLinear(0, 0, 0, out);
    for (const v of out) expect(v).toBeCloseTo(0, 6);
  });

  it('walks the circle of fifths 30 degrees per fifth', () => {
    expect(fifthsPos(0)).toBe(0);
    expect(fifthsPos(7)).toBe(1); // G
    expect(fifthsPos(5)).toBe(11); // F
    expect((hueOf(7) - hueOf(0) + 360) % 360).toBe(30);
  });
});

describe('spring', () => {
  it('is critically damped: settles without overshoot', () => {
    const s = { x: 0, v: 0 };
    let maxX = 0;
    for (let i = 0; i < 120; i++) {
      stepSpring(s, 1, 13, 1 / 120);
      maxX = Math.max(maxX, s.x);
    }
    expect(maxX).toBeLessThanOrEqual(1 + 1e-9);
    expect(s.x).toBeGreaterThan(0.99);
  });

  it('takes the short way round', () => {
    expect(nearestAngle(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.1, 9);
  });
});
