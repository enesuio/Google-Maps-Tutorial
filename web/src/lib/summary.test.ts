import { describe, expect, it } from 'vitest';
import {
  bodyRows,
  cheersSummaryParts,
  finishTestStatus,
  formatChange,
  goalDetail,
  stepsLabel,
  summaryHeading,
  userDaysLabel,
} from './summary';

describe('formatChange', () => {
  it('signs with a true minus and keeps the unit', () => {
    expect(formatChange(-1.6, 'kg')).toBe('−1.6 kg');
    expect(formatChange(0.5, 'cm')).toBe('+0.5 cm');
    expect(formatChange(2, 'kg')).toBe('+2.0 kg');
  });
  it('rounds before deciding on the sign', () => {
    expect(formatChange(-0.04, 'kg')).toBe('±0 kg');
    expect(formatChange(0, 'cm')).toBe('±0 cm');
    expect(formatChange(-0.06, 'kg')).toBe('−0.1 kg');
  });
  it('respects decimals and an empty unit', () => {
    expect(formatChange(-3.25, '', 0)).toBe('−3');
    expect(formatChange(1234.5, 'steps', 0)).toBe('+1235 steps');
  });
  it('is null when there is nothing to say', () => {
    expect(formatChange(null, 'kg')).toBeNull();
    expect(formatChange(Number.NaN, 'kg')).toBeNull();
  });
});

describe('finishTestStatus', () => {
  it('reads passed with its date and result', () => {
    expect(finishTestStatus({ passed: true, result: null, testedOn: '2026-11-19' })).toBe('Passed on Nov 19');
    expect(finishTestStatus({ passed: true, result: '3 push-ups', testedOn: '2026-11-19' })).toBe('Passed on Nov 19 · 3 push-ups');
    expect(finishTestStatus({ passed: true, result: null, testedOn: null })).toBe('Passed');
  });
  it('is calm about a miss', () => {
    expect(finishTestStatus({ passed: false, result: '2 push-ups', testedOn: '2026-11-19' })).toBe('Not this time · Nov 19 · 2 push-ups');
    expect(finishTestStatus({ passed: false, result: '  ', testedOn: null })).toBe('Not this time');
  });
  it('is "Not tested yet" until a result is recorded', () => {
    expect(finishTestStatus({ passed: null, result: null, testedOn: null })).toBe('Not tested yet');
    expect(finishTestStatus({ passed: null, result: 'warming up', testedOn: '2026-11-01' })).toBe('Not tested yet');
  });
});

describe('summaryHeading', () => {
  const challenge = { name: 'Hydrox 45', startDate: '2026-10-06', lengthDays: 45 };
  it('says "so far" before the finish', () => {
    expect(summaryHeading({ day: 14, complete: false, endDate: '2026-11-19', challenge })).toEqual({ title: 'Summary', sub: 'Day 14 of 45 · so far' });
  });
  it('celebrates once complete', () => {
    expect(summaryHeading({ day: 45, complete: true, endDate: '2026-11-19', challenge })).toEqual({
      title: '45 days. You did it.',
      sub: 'Finished Thu Nov 19',
    });
  });
  it('clamps days past the end when not yet marked complete', () => {
    expect(summaryHeading({ day: 50, complete: false, endDate: '2026-11-19', challenge }).sub).toBe('Day 45 of 45 · so far');
  });
});

describe('labels', () => {
  it('pluralises days and carries the top emoji', () => {
    expect(userDaysLabel({ daysCheckedIn: 12, daysSoFar: 14 })).toBe('12 of 14 days');
    expect(userDaysLabel({ daysCheckedIn: 1, daysSoFar: 1 })).toBe('1 of 1 day');
    expect(cheersSummaryParts({ cheersReceived: 3, cheersSent: 2, topEmojiReceived: '👏' })).toEqual({ received: '3 received 👏', sent: '2 sent' });
    expect(cheersSummaryParts({ cheersReceived: 0, cheersSent: 0, topEmojiReceived: null })).toEqual({ received: '0 received', sent: '0 sent' });
  });
  it('describes goals by kind', () => {
    expect(goalDetail({ kind: 'number', unit: 'kcal', average: 1540.4, weeklyHits: null, weeklyTarget: null })).toBe('avg 1,540 kcal');
    expect(goalDetail({ kind: 'number', unit: 'g', average: 158.26, weeklyHits: null, weeklyTarget: null })).toBe('avg 158.3 g');
    expect(goalDetail({ kind: 'bool', unit: null, average: null, weeklyHits: { weeks: 6, weeksHit: 4, total: 15 }, weeklyTarget: 3 })).toBe('weeks hit 4 of 6');
    expect(goalDetail({ kind: 'bool', unit: null, average: null, weeklyHits: null, weeklyTarget: null })).toBe('');
  });
  it('sums steps with a note', () => {
    expect(stepsLabel({ total: 123456, avgPerDay: 8818.3, bestDay: { date: '2026-10-12', steps: 11205 } })).toEqual({
      total: '123,456 steps',
      note: '8,818 a day · best 11,205 on Oct 12',
    });
    expect(stepsLabel({ total: null, avgPerDay: null, bestDay: null })).toBeNull();
  });
});

describe('bodyRows', () => {
  it('skips rows with nothing on either side and signs the change', () => {
    const rows = bodyRows({
      start: { date: '2026-10-06', weightKg: 92.4, waistCm: 101, hipsCm: null, chestCm: null, armCm: null, thighCm: null },
      latest: { date: '2026-10-19', weightKg: 90.8, waistCm: 100, hipsCm: 107, chestCm: null, armCm: null, thighCm: null },
      change: { weightKg: -1.6, waistCm: -1, hipsCm: null, chestCm: null, armCm: null, thighCm: null },
    });
    expect(rows.map((r) => r.label)).toEqual(['Weight', 'Waist', 'Hips']);
    expect(rows[0]).toMatchObject({ start: '92.4 kg', latest: '90.8 kg', change: '−1.6 kg' });
    expect(rows[2]).toMatchObject({ start: '—', latest: '107.0 cm', change: null });
  });
  it('is empty for the partner (body is null)', () => {
    expect(bodyRows(null)).toEqual([]);
  });
});
