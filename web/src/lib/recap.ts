// Pure helpers for the weekly recap screen (T12). No DOM here.
import type { RecapView, UserRecap } from '../api/types';
import { addDays, parseISODate } from './dates';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * "Oct 6–12" when both ends share a month, "Oct 27–Nov 2" otherwise. En dash, no spaces,
 * the way a calendar prints a week.
 */
export function weekRangeLabel(weekStart: string, weekEnd: string): string {
  const a = parseISODate(weekStart);
  const b = parseISODate(weekEnd);
  const ma = MONTHS_SHORT[a.month - 1];
  const mb = MONTHS_SHORT[b.month - 1];
  if (a.month === b.month && a.year === b.year) return `${ma} ${a.day}–${b.day}`;
  return `${ma} ${a.day}–${mb} ${b.day}`;
}

/**
 * "Days 1–7", clamped so days before the challenge (day 0 and below) never show.
 * A single day reads "Day 7". When the range is entirely before day 1 → "Before the challenge".
 */
export function dayRangeLabel(range: { from: number; to: number }): string {
  const from = Math.max(1, range.from);
  const to = Math.max(from, range.to);
  if (range.to < 1) return 'Before the challenge';
  return from === to ? `Day ${from}` : `Days ${from}–${to}`;
}

/** "Week 2 · Oct 12–18 · Days 7–13" */
export function recapTitle(view: Pick<RecapView, 'weekNumber' | 'weekStart' | 'weekEnd' | 'dayRange'>): string {
  return `Week ${view.weekNumber} · ${weekRangeLabel(view.weekStart, view.weekEnd)} · ${dayRangeLabel(view.dayRange)}`;
}

/** The Monday of the week before / after; the screen navigates with these. */
export function previousWeek(weekStart: string): string {
  return addDays(weekStart, -7);
}
export function nextWeek(weekStart: string): string {
  return addDays(weekStart, 7);
}

/** True when there is a later week that has started (its Monday is on or before today). */
export function hasNextWeek(view: Pick<RecapView, 'weekEnd' | 'today'>): boolean {
  return addDays(view.weekEnd, 1) <= view.today;
}

/** Week 1 is the challenge's first week; nothing before it is a recap. */
export function hasPreviousWeek(view: Pick<RecapView, 'weekNumber'>): boolean {
  return view.weekNumber > 1;
}

export type DayDot = 'out' | 'in' | 'done';

/**
 * Seven dots for a user's week, left to right Monday to Sunday. The contract only carries
 * counts (`daysCheckedIn` of `daysInChallenge`), not per-day flags, so the dots are a count
 * meter: `done` dots first, then empty `in` dots, with the days outside the challenge
 * (`out`) placed where they fall — before day 1 at the start of week 1, otherwise after the
 * last day the challenge has reached.
 */
export function dayDots(
  recap: Pick<UserRecap, 'daysCheckedIn' | 'daysInChallenge'>,
  week: Pick<RecapView, 'weekNumber' | 'dayRange'>,
): DayDot[] {
  const inCount = Math.max(0, Math.min(7, recap.daysInChallenge));
  const outCount = 7 - inCount;
  const before = week.weekNumber === 1 ? Math.min(outCount, Math.max(0, 1 - week.dayRange.from)) : 0;
  const after = outCount - before;
  const done = Math.max(0, Math.min(inCount, recap.daysCheckedIn));
  const dots: DayDot[] = [];
  for (let i = 0; i < before; i += 1) dots.push('out');
  for (let i = 0; i < inCount; i += 1) dots.push(i < done ? 'done' : 'in');
  for (let i = 0; i < after; i += 1) dots.push('out');
  return dots;
}

/** "5 of 7 days" / "1 of 1 day" */
export function daysLabel(recap: Pick<UserRecap, 'daysCheckedIn' | 'daysInChallenge'>): string {
  const n = recap.daysInChallenge;
  return `${recap.daysCheckedIn} of ${n} ${n === 1 ? 'day' : 'days'}`;
}

/**
 * Own card only: "−0.6 kg this week" / "+0.3 kg this week" / "no change this week".
 * Returns null when there is nothing to say. Never call this for the partner.
 */
export function weightChangeLabel(changeKg: number | null): string | null {
  if (changeKg === null || !Number.isFinite(changeKg)) return null;
  const rounded = Math.round(changeKg * 10) / 10;
  if (rounded === 0) return 'no change this week';
  const sign = rounded < 0 ? '−' : '+';
  return `${sign}${Math.abs(rounded).toFixed(1)} kg this week`;
}

/** "3 received · 2 sent" */
export function cheersLabel(recap: Pick<UserRecap, 'cheersReceived' | 'cheersSent'>): string {
  return `${recap.cheersReceived} received · ${recap.cheersSent} sent`;
}

/** "Together: 12 of 14 days" */
export function teamLabel(team: RecapView['team']): string {
  return `Together: ${team.checkins} of ${team.possible} days`;
}
