import { describe, expect, it } from 'vitest';
import { bestLabel, streakHint, streakLabel, totalCheckinsLabel } from './streaks';

describe('streakLabel', () => {
  it('is calm at zero', () => {
    expect(streakLabel({ current: 0 })).toBe('No streak yet');
  });
  it('pluralises with a hyphen', () => {
    expect(streakLabel({ current: 1 })).toBe('1-day streak');
    expect(streakLabel({ current: 5 })).toBe('5-day streak');
  });
});

describe('streakHint', () => {
  it('warns only when the grace day is used on a live streak', () => {
    expect(streakHint({ current: 5, graceUsed: true })).toBe('one more miss breaks it');
    expect(streakHint({ current: 5, graceUsed: false })).toBeNull();
    expect(streakHint({ current: 0, graceUsed: true })).toBeNull();
  });
});

describe('bestLabel', () => {
  it('shows best only when it beats current', () => {
    expect(bestLabel({ current: 3, best: 9 })).toBe('best 9');
    expect(bestLabel({ current: 9, best: 9 })).toBeNull();
    expect(bestLabel({ current: 0, best: 0 })).toBeNull();
  });
});

describe('totalCheckinsLabel', () => {
  it('handles 0, 1 and many', () => {
    expect(totalCheckinsLabel(0)).toBe('No days checked in yet');
    expect(totalCheckinsLabel(1)).toBe('1 day checked in');
    expect(totalCheckinsLabel(12)).toBe('12 days checked in');
  });
});
