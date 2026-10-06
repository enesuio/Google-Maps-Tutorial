import { describe, expect, it } from 'vitest';
import { ringArc, ringDescription, ringFraction } from './ring';

describe('ringFraction', () => {
  it('clamps to [0, 1] and survives a zero target', () => {
    expect(ringFraction(27, 90)).toBeCloseTo(0.3);
    expect(ringFraction(0, 90)).toBe(0);
    expect(ringFraction(95, 90)).toBe(1);
    expect(ringFraction(-3, 90)).toBe(0);
    expect(ringFraction(5, 0)).toBe(0);
  });
});

describe('ringArc', () => {
  it('keeps the stroke inside the box', () => {
    const a = ringArc(0, 90, 64, 6);
    expect(a.radius).toBe(29);
    expect(a.circumference).toBeCloseTo(2 * Math.PI * 29, 2);
    expect(a.dashArray).toBe(a.circumference);
  });
  it('offsets the dash by the unfilled share', () => {
    const empty = ringArc(0, 90, 64, 6);
    const half = ringArc(45, 90, 64, 6);
    const full = ringArc(90, 90, 64, 6);
    expect(empty.dashOffset).toBeCloseTo(empty.circumference, 2);
    expect(half.dashOffset).toBeCloseTo(half.circumference / 2, 2);
    expect(full.dashOffset).toBe(0);
    expect(half.fraction).toBe(0.5);
  });
  it('describes itself for assistive tech', () => {
    expect(ringDescription(27, 90)).toBe('27 of 90 team days logged');
  });
});
