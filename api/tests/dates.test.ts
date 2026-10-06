import { describe, expect, it } from 'vitest';
import { addDays, dateRange, dateSchema, dayNumber, isoWeekRange, todayInToronto } from '../src/dates.js';

describe('todayInToronto', () => {
  it('rolls over at midnight Toronto during EDT (UTC-4)', () => {
    expect(todayInToronto(new Date('2026-10-07T03:59:59Z'))).toBe('2026-10-06');
    expect(todayInToronto(new Date('2026-10-07T04:00:00Z'))).toBe('2026-10-07');
  });

  it('handles the Nov 1 2026 DST change (EDT → EST)', () => {
    // Clocks fall back at 2:00 EDT on Sun Nov 1 2026 (06:00Z). Before that, midnight is 04:00Z;
    // after, midnight is 05:00Z.
    expect(todayInToronto(new Date('2026-11-01T03:59:59Z'))).toBe('2026-10-31');
    expect(todayInToronto(new Date('2026-11-01T04:00:00Z'))).toBe('2026-11-01');
    expect(todayInToronto(new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01'); // 1:30 EDT (first time)
    expect(todayInToronto(new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01'); // 1:30 EST (second time)
    expect(todayInToronto(new Date('2026-11-02T04:30:00Z'))).toBe('2026-11-01'); // 23:30 EST Nov 1
    expect(todayInToronto(new Date('2026-11-02T05:00:00Z'))).toBe('2026-11-02'); // midnight EST
  });
});

describe('date helpers', () => {
  it('dayNumber is 1 on the start date', () => {
    expect(dayNumber('2026-10-06', '2026-10-06')).toBe(1);
    expect(dayNumber('2026-10-07', '2026-10-06')).toBe(2);
    expect(dayNumber('2026-11-19', '2026-10-06')).toBe(45);
    expect(dayNumber('2026-10-05', '2026-10-06')).toBe(0);
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('isoWeekRange returns Monday..Sunday', () => {
    expect(isoWeekRange('2026-10-06')).toEqual({ start: '2026-10-05', end: '2026-10-11' }); // Tuesday
    expect(isoWeekRange('2026-10-05')).toEqual({ start: '2026-10-05', end: '2026-10-11' }); // Monday
    expect(isoWeekRange('2026-10-11')).toEqual({ start: '2026-10-05', end: '2026-10-11' }); // Sunday
    expect(isoWeekRange('2026-10-12')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
  });

  it('dateRange is inclusive and empty when reversed', () => {
    expect(dateRange('2026-10-06', '2026-10-08')).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    expect(dateRange('2026-10-08', '2026-10-06')).toEqual([]);
  });
});

describe('dateSchema', () => {
  it('accepts real calendar dates', () => {
    expect(dateSchema.safeParse('2026-10-06').success).toBe(true);
    expect(dateSchema.safeParse('2028-02-29').success).toBe(true);
  });

  it('rejects malformed and impossible dates', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2027-02-29', '26-10-06', '2026/10/06', '2026-10-6', '']) {
      expect(dateSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
