import { describe, expect, it } from 'vitest';
import type { DayView, GoalView } from '../api/types';
import {
  applyValue,
  computeHit,
  formatValue,
  parseNumberInput,
  summarize,
  summaryLabel,
  targetLabel,
  weeklyLabel,
} from './goals';

const kcal: GoalView = {
  id: 2,
  key: 'kcal',
  label: 'Calories',
  kind: 'number',
  unit: 'kcal',
  direction: 'at_most',
  dailyTarget: 1600,
  weeklyTarget: null,
  value: null,
  hit: null,
  weekCount: null,
  source: 'manual',
};
const protein: GoalView = { ...kcal, id: 3, key: 'protein', label: 'Protein', unit: 'g', direction: 'at_least', dailyTarget: 160 };
const walk: GoalView = { ...kcal, id: 1, key: 'walk', label: 'Daily walk', kind: 'bool', unit: null, direction: null, dailyTarget: null };
const f45: GoalView = { ...walk, id: 10, key: 'f45', label: 'F45 class', weeklyTarget: 3, weekCount: 1 };

describe('goal labels', () => {
  it('formats targets', () => {
    expect(targetLabel(kcal)).toBe('≤ 1600 kcal');
    expect(targetLabel(protein)).toBe('≥ 160 g');
    expect(targetLabel(walk)).toBeNull();
    expect(targetLabel({ ...kcal, dailyTarget: null })).toBeNull();
    expect(targetLabel({ ...kcal, unit: null })).toBe('≤ 1600');
  });

  it('formats weekly progress', () => {
    expect(weeklyLabel(f45)).toBe('1 of 3 this week');
    expect(weeklyLabel(walk)).toBeNull();
  });

  it('formats values', () => {
    expect(formatValue(kcal)).toBe('—');
    expect(formatValue({ ...kcal, value: 1550 })).toBe('1550 kcal');
    expect(formatValue({ ...protein, value: 160.5 })).toBe('160.5 g');
    expect(formatValue({ ...walk, value: 1 })).toBe('Done');
  });

  it('summarizes', () => {
    const s = summarize([
      { ...walk, value: 1, hit: true },
      { ...kcal, value: 1700, hit: false },
      { ...protein, value: null, hit: null },
    ]);
    expect(s).toEqual({ hit: 1, total: 3, entered: 2 });
    expect(summaryLabel(s)).toBe('1 of 3 hit');
  });
});

describe('computeHit', () => {
  it('follows the API rules', () => {
    expect(computeHit(walk, 1)).toBe(true);
    expect(computeHit(walk, 0)).toBe(false);
    expect(computeHit(walk, null)).toBeNull();
    expect(computeHit(kcal, 1600)).toBe(true);
    expect(computeHit(kcal, 1601)).toBe(false);
    expect(computeHit(protein, 160)).toBe(true);
    expect(computeHit(protein, 159)).toBe(false);
    expect(computeHit({ ...kcal, dailyTarget: null }, 5)).toBe(true);
  });
});

describe('parseNumberInput', () => {
  it('parses decimals and clears on empty', () => {
    expect(parseNumberInput('1550')).toBe(1550);
    expect(parseNumberInput(' 160.5 ')).toBe(160.5);
    expect(parseNumberInput('160,5')).toBe(160.5);
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('abc')).toBeUndefined();
    expect(parseNumberInput('1.2.3')).toBeUndefined();
  });
});

describe('applyValue', () => {
  const noStreak = { current: 0, best: 0, graceUsed: false };
  const view: DayView = {
    date: '2026-10-08',
    day: 3,
    today: '2026-10-08',
    challenge: { name: 'Hydrox 45', startDate: '2026-10-06', lengthDays: 45 },
    users: [
      { id: 1, slug: 'enes', name: 'Enes', isMe: true, goals: [walk, kcal], streak: noStreak, totalCheckins: 0, cheers: [], health: null },
      { id: 2, slug: 'partner', name: 'Partner', isMe: false, goals: [f45], streak: noStreak, totalCheckins: 0, cheers: [], health: null },
    ],
  };

  it('sets value and hit for the right user only', () => {
    const next = applyValue(view, 1, 2, 1700);
    expect(next.users[0]?.goals[1]).toMatchObject({ value: 1700, hit: false });
    expect(next.users[0]?.goals[0]).toBe(walk);
    expect(next.users[1]).toBe(view.users[1]);
    expect(view.users[0]?.goals[1]?.value).toBeNull();
  });

  it('nudges weekCount on weekly goals', () => {
    const on = applyValue(view, 2, 10, 1);
    expect(on.users[1]?.goals[0]).toMatchObject({ value: 1, hit: true, weekCount: 2 });
    const off = applyValue(on, 2, 10, 0);
    expect(off.users[1]?.goals[0]).toMatchObject({ value: 0, hit: false, weekCount: 1 });
    const cleared = applyValue(on, 2, 10, null);
    expect(cleared.users[1]?.goals[0]).toMatchObject({ value: null, hit: null, weekCount: 1 });
  });
});
