import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayCounterLabel,
  daysBetween,
  formatLongDate,
  formatShortDate,
  isValidISODate,
  parseISODate,
  weekdayIndex,
} from './dates';

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isValidISODate('2026-10-06')).toBe(true);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('20261006')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });

  it('parses and formats', () => {
    expect(parseISODate('2026-10-06')).toEqual({ year: 2026, month: 10, day: 6 });
    expect(formatShortDate('2026-10-06')).toBe('Tue Oct 6');
    expect(formatShortDate('2026-11-19')).toBe('Thu Nov 19');
    expect(formatLongDate('2026-10-06')).toBe('Tuesday, Oct 6');
    expect(weekdayIndex('2026-10-06')).toBe(2);
  });

  it('does date arithmetic without timezone drift', () => {
    expect(daysBetween('2026-10-06', '2026-10-08')).toBe(2);
    expect(daysBetween('2026-10-08', '2026-10-06')).toBe(-2);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-10-06', 44)).toBe('2026-11-19');
  });

  it('labels the day counter', () => {
    expect(dayCounterLabel(1, 45)).toBe('Day 1 of 45');
    expect(dayCounterLabel(45, 45)).toBe('Day 45 of 45');
    expect(dayCounterLabel(0, 45)).toBe('Starts tomorrow');
    expect(dayCounterLabel(-2, 45)).toBe('Starts in 3 days');
    expect(dayCounterLabel(46, 45)).toBe('Challenge complete');
  });
});
