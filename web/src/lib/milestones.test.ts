import { describe, expect, it } from 'vitest';
import type { Milestone } from '../api/types';
import { milestoneBanner, nextMilestone, nextMilestoneLabel, todayMilestone } from './milestones';

function set(day: number): Milestone[] {
  return [
    { day: 7, label: 'One week' },
    { day: 15, label: 'A third in' },
    { day: 30, label: 'Two thirds' },
    { day: 45, label: 'Finish line' },
  ].map((m) => ({ ...m, date: `2026-10-${String(5 + m.day).padStart(2, '0')}`, reached: day >= m.day, isToday: day === m.day }));
}

describe('nextMilestone', () => {
  it('finds the first milestone ahead', () => {
    const n = nextMilestone(set(10), 10);
    expect(n?.milestone.day).toBe(15);
    expect(n?.daysUntil).toBe(5);
  });
  it('skips the one happening today', () => {
    const n = nextMilestone(set(15), 15);
    expect(n?.milestone.day).toBe(30);
    expect(todayMilestone(set(15))?.day).toBe(15);
    expect(todayMilestone(set(10))).toBeNull();
  });
  it('returns null after the finish line', () => {
    expect(nextMilestone(set(45), 45)).toBeNull();
    expect(nextMilestone(set(46), 46)).toBeNull();
  });
  it('works before Day 1', () => {
    const n = nextMilestone(set(0), 0);
    expect(n?.milestone.day).toBe(7);
    expect(n?.daysUntil).toBe(7);
  });
});

describe('labels', () => {
  it('counts down', () => {
    const [m15] = set(10).filter((m) => m.day === 15);
    if (!m15) throw new Error('fixture');
    expect(nextMilestoneLabel({ milestone: m15, daysUntil: 4 })).toBe('Day 15 in 4 days');
    expect(nextMilestoneLabel({ milestone: m15, daysUntil: 1 })).toBe('Day 15 tomorrow');
  });
  it('celebrates', () => {
    expect(milestoneBanner({ day: 7, label: 'One week' })).toBe('Day 7 — one week in!');
    expect(milestoneBanner({ day: 45, label: 'Finish line' })).toBe('Day 45 — finish line!');
    expect(milestoneBanner({ day: 20, label: 'Halfway there' })).toBe('Day 20 — halfway there!');
  });
});
