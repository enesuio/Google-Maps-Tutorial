// Pure helpers for milestones and the team ring strip (T13).
import type { Milestone } from '../api/types';

export interface NextMilestone {
  milestone: Milestone;
  daysUntil: number;
}

/**
 * The first milestone still ahead of `day` (the challenge day shown). Milestones already
 * reached or happening today are skipped; null once the finish line is behind us.
 */
export function nextMilestone(milestones: readonly Milestone[], day: number): NextMilestone | null {
  const ahead = [...milestones].filter((m) => m.day > day && !m.reached && !m.isToday).sort((a, b) => a.day - b.day);
  const m = ahead[0];
  if (!m) return null;
  return { milestone: m, daysUntil: m.day - day };
}

/** The milestone that falls on the day shown, if any. */
export function todayMilestone(milestones: readonly Milestone[]): Milestone | null {
  return milestones.find((m) => m.isToday) ?? null;
}

/** "Day 15 in 4 days" / "Day 15 tomorrow" */
export function nextMilestoneLabel(next: NextMilestone): string {
  const { milestone, daysUntil } = next;
  if (daysUntil <= 1) return `Day ${milestone.day} tomorrow`;
  return `Day ${milestone.day} in ${daysUntil} days`;
}

const BANNER_BY_DAY: Record<number, string> = {
  7: 'one week in!',
  15: 'a third of the way!',
  30: 'two thirds done!',
  45: 'finish line!',
};

/** Celebration copy for a milestone day: "Day 7 — one week in!". Falls back to the label. */
export function milestoneBanner(m: Pick<Milestone, 'day' | 'label'>): string {
  const tail = BANNER_BY_DAY[m.day] ?? `${m.label.charAt(0).toLowerCase()}${m.label.slice(1)}!`;
  return `Day ${m.day} — ${tail}`;
}
