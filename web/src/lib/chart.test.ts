import { describe, expect, it } from 'vitest';
import { avg7, chartSummary, linePath, nearestIndex, xTicks, yScale } from './chart';

describe('avg7', () => {
  const pts = [
    { date: '2026-10-06', weightKg: 92 },
    { date: '2026-10-07', weightKg: 91 },
    { date: '2026-10-09', weightKg: null },
    { date: '2026-10-13', weightKg: 90 },
  ];
  it('averages entered weights in the trailing 7-day window', () => {
    expect(avg7(pts, '2026-10-07')).toBe(91.5);
    expect(avg7(pts, '2026-10-12')).toBe(91.5); // window Oct 6–12
    expect(avg7(pts, '2026-10-13')).toBe(90.5); // Oct 7–13: 91, 90
    expect(avg7(pts, '2026-10-14')).toBe(90); // Oct 8–14
  });
  it('ignores future days and empty windows', () => {
    expect(avg7(pts, '2026-10-05')).toBeNull();
    expect(avg7([], '2026-10-06')).toBeNull();
  });
});

describe('yScale', () => {
  it('returns null without values', () => {
    expect(yScale([])).toBeNull();
  });
  it('pads and snaps to nice ticks', () => {
    const s = yScale([90.8, 92.4]);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.min).toBeLessThan(90.8);
    expect(s.max).toBeGreaterThan(92.4);
    expect(s.ticks[0]).toBe(s.min);
    expect(s.ticks[s.ticks.length - 1]).toBe(s.max);
    expect(s.ticks.length).toBeGreaterThanOrEqual(2);
    expect(s.ticks.length).toBeLessThanOrEqual(6);
    const step = (s.ticks[1] ?? 0) - (s.ticks[0] ?? 0);
    expect([0.5, 1, 2, 2.5, 5]).toContain(step);
  });
  it('does not zoom into a flat series', () => {
    const s = yScale([70, 70.1]);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.max - s.min).toBeGreaterThanOrEqual(2);
  });
});

describe('xTicks', () => {
  it('always includes both ends', () => {
    const t = xTicks('2026-10-06', '2026-10-15', 4);
    expect(t[0]).toEqual({ date: '2026-10-06', label: 'Oct 6' });
    expect(t[t.length - 1]).toEqual({ date: '2026-10-15', label: 'Oct 15' });
    expect(t.length).toBe(4);
  });
  it('collapses a single day', () => {
    expect(xTicks('2026-10-06', '2026-10-06')).toEqual([{ date: '2026-10-06', label: 'Oct 6' }]);
  });
  it('never duplicates dates on short spans', () => {
    const t = xTicks('2026-10-06', '2026-10-07', 4);
    expect(t.map((x) => x.date)).toEqual(['2026-10-06', '2026-10-07']);
  });
});

describe('linePath / nearestIndex', () => {
  it('builds an SVG path', () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 10, y: 2.25 }])).toBe('M0.0 1.0 L10.0 2.3');
  });
  it('finds the nearest x', () => {
    expect(nearestIndex([0, 10, 20], 12)).toBe(1);
    expect(nearestIndex([], 12)).toBe(-1);
  });
});

describe('chartSummary', () => {
  it('describes the series', () => {
    const s = chartSummary('Enes', [
      { date: '2026-10-06', weightKg: 92.4, weightAvg7: 92.4 },
      { date: '2026-10-08', weightKg: 91.6, weightAvg7: 92 },
    ]);
    expect(s).toContain('2 entries');
    expect(s).toContain('Start 92.4 kg');
    expect(s).toContain('latest 91.6 kg');
    expect(s).toContain('7-day average 92.0 kg');
  });
  it('has an empty state', () => {
    expect(chartSummary('Mia', [])).toBe('Weight trend for Mia: no entries yet.');
  });
});
