import type { Streak } from '../api/types';

/**
 * Compact streak label for a card header. `current === 0` is deliberately calm
 * (no "broken", no red): "No streak yet".
 */
export function streakLabel(streak: Pick<Streak, 'current'>): string {
  if (streak.current <= 0) return 'No streak yet';
  return `${streak.current}-day streak`;
}

/** "one more miss breaks it" when the grace day is used up; null otherwise. */
export function streakHint(streak: Pick<Streak, 'current' | 'graceUsed'>): string | null {
  if (streak.current <= 0 || !streak.graceUsed) return null;
  return 'one more miss breaks it';
}

/** "best 9" when the best run is longer than the current one; null otherwise. */
export function bestLabel(streak: Pick<Streak, 'current' | 'best'>): string | null {
  if (streak.best <= streak.current || streak.best <= 0) return null;
  return `best ${streak.best}`;
}

/** "12 days checked in" / "1 day checked in" / "No days checked in yet". */
export function totalCheckinsLabel(total: number): string {
  if (total <= 0) return 'No days checked in yet';
  return total === 1 ? '1 day checked in' : `${total} days checked in`;
}
