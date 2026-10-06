import { describe, expect, it } from 'vitest';
import {
  dayDots,
  dayRangeLabel,
  daysLabel,
  hasNextWeek,
  hasPreviousWeek,
  nextWeek,
  previousWeek,
  recapTitle,
  weekRangeLabel,
  weightChangeLabel,
} from './recap';

describe('weekRangeLabel', () => {
  it('collapses the month when both ends share it', () => {
    expect(weekRangeLabel('2026-10-05', '2026-10-11')).toBe('Oct 5–11');
    expect(weekRangeLabel('2026-10-12', '2026-10-18')).toBe('Oct 12–18');
  });
  it('names both months across a boundary', () => {
    expect(weekRangeLabel('2026-10-26', '2026-11-01')).toBe('Oct 26–Nov 1');
    expect(weekRangeLabel('2026-12-28', '2027-01-03')).toBe('Dec 28–Jan 3');
  });
});

describe('dayRangeLabel / recapTitle', () => {
  it('clamps days before the challenge', () => {
    expect(dayRangeLabel({ from: 0, to: 6 })).toBe('Days 1–6');
    expect(dayRangeLabel({ from: 7, to: 13 })).toBe('Days 7–13');
    expect(dayRangeLabel({ from: 1, to: 1 })).toBe('Day 1');
    expect(dayRangeLabel({ from: -6, to: 0 })).toBe('Before the challenge');
  });
  it('builds the header', () => {
    expect(recapTitle({ weekNumber: 1, weekStart: '2026-10-05', weekEnd: '2026-10-11', dayRange: { from: 0, to: 6 } })).toBe(
      'Week 1 · Oct 5–11 · Days 1–6',
    );
  });
});

describe('week navigation', () => {
  it('steps by seven days', () => {
    expect(previousWeek('2026-10-12')).toBe('2026-10-05');
    expect(nextWeek('2026-10-12')).toBe('2026-10-19');
  });
  it('disables arrows outside the range', () => {
    expect(hasPreviousWeek({ weekNumber: 1 })).toBe(false);
    expect(hasPreviousWeek({ weekNumber: 2 })).toBe(true);
    expect(hasNextWeek({ weekEnd: '2026-10-18', today: '2026-10-15' })).toBe(false);
    expect(hasNextWeek({ weekEnd: '2026-10-11', today: '2026-10-12' })).toBe(true);
    expect(hasNextWeek({ weekEnd: '2026-10-11', today: '2026-10-11' })).toBe(false);
  });
});

describe('dayDots', () => {
  it('puts the day before the start at the front of week 1', () => {
    expect(dayDots({ daysCheckedIn: 5, daysInChallenge: 6 }, { weekNumber: 1, dayRange: { from: 0, to: 6 } })).toEqual([
      'out',
      'done',
      'done',
      'done',
      'done',
      'done',
      'in',
    ]);
  });
  it('puts days not yet reached at the end of the current week', () => {
    expect(dayDots({ daysCheckedIn: 3, daysInChallenge: 4 }, { weekNumber: 2, dayRange: { from: 7, to: 13 } })).toEqual([
      'done',
      'done',
      'done',
      'in',
      'out',
      'out',
      'out',
    ]);
  });
  it('never overflows seven dots or the in-challenge count', () => {
    expect(dayDots({ daysCheckedIn: 9, daysInChallenge: 7 }, { weekNumber: 3, dayRange: { from: 14, to: 20 } })).toEqual(
      Array(7).fill('done'),
    );
    expect(dayDots({ daysCheckedIn: 0, daysInChallenge: 0 }, { weekNumber: 1, dayRange: { from: -6, to: 0 } })).toEqual(
      Array(7).fill('out'),
    );
  });
});

describe('labels', () => {
  it('pluralises days', () => {
    expect(daysLabel({ daysCheckedIn: 5, daysInChallenge: 7 })).toBe('5 of 7 days');
    expect(daysLabel({ daysCheckedIn: 1, daysInChallenge: 1 })).toBe('1 of 1 day');
  });
  it('signs the weight change with a true minus and hides nothing-to-say', () => {
    expect(weightChangeLabel(-0.6)).toBe('−0.6 kg this week');
    expect(weightChangeLabel(0.25)).toBe('+0.3 kg this week');
    expect(weightChangeLabel(0.04)).toBe('no change this week');
    expect(weightChangeLabel(null)).toBeNull();
  });
});
