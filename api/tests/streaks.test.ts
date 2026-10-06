import { describe, expect, it } from 'vitest';
import { computeStreak, totalCheckins } from '../src/streaks.js';

const START = '2026-10-06';

describe('computeStreak ("never miss twice")', () => {
  it('empty history → zeros', () => {
    expect(computeStreak([], START, '2026-10-10')).toEqual({ current: 0, best: 0, graceUsed: false });
    expect(computeStreak(new Set(), START, '2026-10-06')).toEqual({ current: 0, best: 0, graceUsed: false });
  });

  it('nothing before startDate counts', () => {
    const s = computeStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'], START, '2026-10-10');
    expect(s).toEqual({ current: 0, best: 0, graceUsed: false });
    // Reference day before the start: zeros even with entries.
    expect(computeStreak(['2026-10-01'], START, '2026-10-02')).toEqual({ current: 0, best: 0, graceUsed: false });
    expect(totalCheckins(['2026-10-01', '2026-10-06'], START, '2026-10-10')).toBe(1);
  });

  it('a streak that starts today', () => {
    expect(computeStreak(['2026-10-10'], START, '2026-10-10')).toEqual({ current: 1, best: 1, graceUsed: false });
  });

  it('consecutive days count; today without an entry does not break the streak', () => {
    const days = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
    expect(computeStreak(days, START, '2026-10-09')).toEqual({ current: 4, best: 4, graceUsed: false });
    // Oct 10 is today with nothing logged yet.
    expect(computeStreak(days, START, '2026-10-10')).toEqual({ current: 4, best: 4, graceUsed: false });
    // Logging today extends it.
    expect(computeStreak([...days, '2026-10-10'], START, '2026-10-10')).toEqual({ current: 5, best: 5, graceUsed: false });
  });

  it('gap of 1 day is forgiven and not counted', () => {
    // 6, 7, (8 missed), 9, 10
    const days = ['2026-10-06', '2026-10-07', '2026-10-09', '2026-10-10'];
    expect(computeStreak(days, START, '2026-10-10')).toEqual({ current: 4, best: 4, graceUsed: false });
  });

  it('gap of 2 days ends the streak', () => {
    // 6, 7, (8, 9 missed), 10
    const days = ['2026-10-06', '2026-10-07', '2026-10-10'];
    expect(computeStreak(days, START, '2026-10-10')).toEqual({ current: 1, best: 2, graceUsed: false });
  });

  it('gap of 3 days ends the streak', () => {
    // 6, 7, (8, 9, 10 missed), 11
    const days = ['2026-10-06', '2026-10-07', '2026-10-11'];
    expect(computeStreak(days, START, '2026-10-11')).toEqual({ current: 1, best: 2, graceUsed: false });
  });

  it('yesterday missed, today empty → streak alive on grace', () => {
    // 6, 7, 8, (9 missed), today 10 not yet logged
    const days = ['2026-10-06', '2026-10-07', '2026-10-08'];
    expect(computeStreak(days, START, '2026-10-10')).toEqual({ current: 3, best: 3, graceUsed: true });
    // Two misses before an empty today → broken.
    expect(computeStreak(['2026-10-06', '2026-10-07'], START, '2026-10-10')).toEqual({ current: 0, best: 2, graceUsed: false });
    // ...but logging today starts a fresh run of 1.
    expect(computeStreak(['2026-10-06', '2026-10-07', '2026-10-10'], START, '2026-10-10')).toEqual({ current: 1, best: 2, graceUsed: false });
  });

  it('a forgiven day in the middle of a long run', () => {
    // 6..9, (10 missed), 11..14 ; today 14
    const days = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];
    expect(computeStreak(days, START, '2026-10-14')).toEqual({ current: 8, best: 8, graceUsed: false });
  });

  it('best > current after a break', () => {
    // 6..11 (6 days), (12, 13 missed), 14, 15 ; today 15
    const days = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-14', '2026-10-15'];
    expect(computeStreak(days, START, '2026-10-15')).toEqual({ current: 2, best: 6, graceUsed: false });
    expect(totalCheckins(days, START, '2026-10-15')).toBe(8);
    // Dates after the reference day are ignored.
    expect(totalCheckins(days, START, '2026-10-11')).toBe(6);
  });

  it('accepts a Set', () => {
    expect(computeStreak(new Set(['2026-10-06', '2026-10-07']), START, '2026-10-07')).toEqual({ current: 2, best: 2, graceUsed: false });
  });
});
