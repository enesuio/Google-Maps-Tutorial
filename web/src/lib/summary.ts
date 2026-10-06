// Pure helpers for the Day 45 summary (T15). No DOM here. Nothing in this file ever
// compares the two people: every label describes one person or the team as a whole.
import type { BodySummary, FinishTest, GoalSummary, SummaryView, UserSummary } from '../api/types';
import { formatShortDate, parseISODate } from './dates';
import { formatNumber } from './goals';
import { formatThousands } from './health';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Nov 19" (no weekday). */
export function monthDay(date: string): string {
  const p = parseISODate(date);
  return `${MONTHS_SHORT[p.month - 1]} ${p.day}`;
}

/**
 * A signed change with its unit: "−1.6 kg", "+0.5 cm", "±0 cm". A true minus sign, never a
 * hyphen. `decimals` rounds first so −0.04 kg reads "±0 kg" rather than "−0.0 kg".
 * Returns null when there is no change to show.
 */
export function formatChange(delta: number | null, unit: string, decimals = 1): string | null {
  if (delta === null || !Number.isFinite(delta)) return null;
  const factor = 10 ** decimals;
  const rounded = Math.round(delta * factor) / factor;
  const suffix = unit ? ` ${unit}` : '';
  if (rounded === 0) return `±0${suffix}`;
  const sign = rounded < 0 ? '−' : '+';
  return `${sign}${Math.abs(rounded).toFixed(decimals)}${suffix}`;
}

/** Plain number with unit, "92.4 kg" / "—" when missing. */
export function formatMeasure(value: number | null, unit: string, decimals = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(Math.round(value * 10 ** decimals) / 10 ** decimals).toFixed(decimals)} ${unit}`;
}

/**
 * Status text for a finish-line test, shown read-only on the partner's card and as the
 * summary line under your own control:
 *  - passed === true  → "Passed on Nov 19" (or "Passed" without a date)
 *  - passed === false → "Not this time · Nov 19"
 *  - passed === null  → "Not tested yet"
 * The result text ("2 push-ups") is appended when present.
 */
export function finishTestStatus(test: Pick<FinishTest, 'passed' | 'result' | 'testedOn'>): string {
  const when = test.testedOn ? monthDay(test.testedOn) : null;
  const result = test.result?.trim() ? ` · ${test.result.trim()}` : '';
  if (test.passed === true) return `${when ? `Passed on ${when}` : 'Passed'}${result}`;
  if (test.passed === false) return `Not this time${when ? ` · ${when}` : ''}${result}`;
  return 'Not tested yet';
}

export type FinishTestState = 'pending' | 'passed' | 'failed';

export function finishTestState(passed: boolean | null): FinishTestState {
  return passed === null ? 'pending' : passed ? 'passed' : 'failed';
}

export const FINISH_TEST_LABEL_MAX = 40;
export const FINISH_TEST_RESULT_MAX = 80;
export const FINISH_TESTS_MAX = 5;

/**
 * Header copy. Before the finish: "Day 14 of 45 · so far". Once `complete`:
 * "45 days. You did it." with the end date as the sub-line.
 */
export function summaryHeading(view: Pick<SummaryView, 'day' | 'complete' | 'endDate' | 'challenge'>): { title: string; sub: string } {
  const n = view.challenge.lengthDays;
  if (view.complete) return { title: `${n} days. You did it.`, sub: `Finished ${formatShortDate(view.endDate)}` };
  const day = Math.max(0, Math.min(view.day, n));
  return { title: 'Summary', sub: day < 1 ? 'Starts soon' : `Day ${day} of ${n} · so far` };
}

/** "84 of 90 days" for the team meter. */
export function teamDaysLabel(team: Pick<SummaryView['team'], 'checkins' | 'possible'>): string {
  return `${team.checkins} of ${team.possible} days`;
}

/** "Week of Oct 12 · 14 days" / null. */
export function bestWeekLabel(bestWeek: SummaryView['team']['bestWeek']): string | null {
  if (!bestWeek) return null;
  return `Week of ${monthDay(bestWeek.weekStart)} · ${bestWeek.checkins} ${bestWeek.checkins === 1 ? 'day' : 'days'}`;
}

/** "12 of 14 days" (one person's check-ins). */
export function userDaysLabel(u: Pick<UserSummary, 'daysCheckedIn' | 'daysSoFar'>): string {
  return `${u.daysCheckedIn} of ${u.daysSoFar} ${u.daysSoFar === 1 ? 'day' : 'days'}`;
}

/** "9 days" / "none yet". */
export function streakDays(n: number): string {
  if (n <= 0) return 'none yet';
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

/**
 * Two lines for the Cheers tile: "3 received 👏" (the top emoji received rides along when
 * there is one) over "2 sent".
 */
export function cheersSummaryParts(u: Pick<UserSummary, 'cheersSent' | 'cheersReceived' | 'topEmojiReceived'>): { received: string; sent: string } {
  const top = u.topEmojiReceived ? ` ${u.topEmojiReceived}` : '';
  return { received: `${u.cheersReceived} received${top}`, sent: `${u.cheersSent} sent` };
}

/** "9,340 steps" style total with the per-day average underneath; null when nothing imported. */
export function stepsLabel(steps: UserSummary['steps']): { total: string; note: string } | null {
  if (steps.total === null) return null;
  const parts: string[] = [];
  if (steps.avgPerDay !== null) parts.push(`${formatThousands(Math.round(steps.avgPerDay))} a day`);
  if (steps.bestDay) parts.push(`best ${formatThousands(steps.bestDay.steps)} on ${monthDay(steps.bestDay.date)}`);
  return { total: `${formatThousands(steps.total)} steps`, note: parts.join(' · ') };
}

/**
 * The third column of the per-goal table:
 *  - weekly goals  → "weeks hit 4 of 6"
 *  - number goals  → "avg 1,540 kcal"
 *  - bool goals    → "" (hit days already say it)
 */
export function goalDetail(g: Pick<GoalSummary, 'kind' | 'unit' | 'average' | 'weeklyHits' | 'weeklyTarget'>): string {
  if (g.weeklyHits) return `weeks hit ${g.weeklyHits.weeksHit} of ${g.weeklyHits.weeks}`;
  if (g.kind === 'number' && g.average !== null) {
    const big = Math.abs(g.average) >= 1000;
    const n = big ? formatThousands(Math.round(g.average)) : formatNumber(g.average);
    return `avg ${n}${g.unit ? ` ${g.unit}` : ''}`;
  }
  return '';
}

/** "12 / 14" hit days over entered days. */
export function goalHitLabel(g: Pick<GoalSummary, 'hitDays' | 'enteredDays'>): string {
  return `${g.hitDays} / ${g.enteredDays}`;
}

export interface BodyRow {
  key: keyof NonNullable<BodySummary['change']>;
  label: string;
  unit: string;
  start: string;
  latest: string;
  change: string | null;
}

const BODY_FIELDS: ReadonlyArray<{ key: BodyRow['key']; label: string; unit: string }> = [
  { key: 'weightKg', label: 'Weight', unit: 'kg' },
  { key: 'waistCm', label: 'Waist', unit: 'cm' },
  { key: 'hipsCm', label: 'Hips', unit: 'cm' },
  { key: 'chestCm', label: 'Chest', unit: 'cm' },
  { key: 'armCm', label: 'Arm', unit: 'cm' },
  { key: 'thighCm', label: 'Thigh', unit: 'cm' },
];

/**
 * Before → after rows for the caller's own body block. Rows where both start and latest are
 * null are skipped. Only ever call this with the signed-in user's `body`.
 */
export function bodyRows(body: BodySummary | null): BodyRow[] {
  if (!body) return [];
  const rows: BodyRow[] = [];
  for (const f of BODY_FIELDS) {
    const a = body.start?.[f.key] ?? null;
    const b = body.latest?.[f.key] ?? null;
    if (a === null && b === null) continue;
    const delta = body.change?.[f.key] ?? (a !== null && b !== null ? b - a : null);
    rows.push({
      key: f.key,
      label: f.label,
      unit: f.unit,
      start: formatMeasure(a, f.unit),
      latest: formatMeasure(b, f.unit),
      change: formatChange(delta, f.unit),
    });
  }
  return rows;
}
