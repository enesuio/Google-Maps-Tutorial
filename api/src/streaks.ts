import { addDays } from './dates.js';

// ---- Shared type (mirror docs/API.md) ----

export interface Streak {
  current: number;
  best: number;
  /** True when the most recent day before today was missed and the streak survived it (one more miss breaks it). */
  graceUsed: boolean;
}

const toSet = (dates: Set<string> | Iterable<string>): Set<string> => (dates instanceof Set ? dates : new Set(dates));

/**
 * "Never miss twice" streaks (docs/API.md, T9).
 *
 * - Nothing before `startDate` counts.
 * - `referenceDate` (today) never breaks a streak while it has no entries; it is simply not counted.
 * - One missed day is forgiven and not counted; two consecutive misses end the run.
 * - `current` is the run that reaches the reference day; `best` the longest run since `startDate`.
 */
export function computeStreak(
  enteredDates: Set<string> | string[],
  startDate: string,
  referenceDate: string,
): Streak {
  const entered = toSet(enteredDates);
  // Today only counts once something is entered; otherwise the walk starts from yesterday.
  const end = entered.has(referenceDate) ? referenceDate : addDays(referenceDate, -1);
  if (end < startDate) return { current: 0, best: 0, graceUsed: false };

  let run = 0;
  let runStart = ''; // first entered day of the current run
  let best = 0;
  let misses = 0;
  for (let d = startDate; d <= end; d = addDays(d, 1)) {
    if (entered.has(d)) {
      if (run === 0) runStart = d;
      run++;
      misses = 0;
      if (run > best) best = run;
    } else {
      misses++;
      if (misses >= 2) run = 0;
    }
  }

  // Grace is "used" when the current run survived a miss yesterday (so it began before then).
  const yesterday = addDays(referenceDate, -1);
  const graceUsed = run > 0 && yesterday >= startDate && !entered.has(yesterday) && runStart < yesterday;
  return { current: run, best, graceUsed };
}

/** Checked-in days in [startDate, referenceDate]. */
export function totalCheckins(enteredDates: Set<string> | string[], startDate: string, referenceDate: string): number {
  let n = 0;
  for (const d of toSet(enteredDates)) if (d >= startDate && d <= referenceDate) n++;
  return n;
}
