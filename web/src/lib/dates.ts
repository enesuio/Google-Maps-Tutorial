// Pure date helpers. Dates are plain `YYYY-MM-DD` strings (Toronto calendar dates
// decided by the server). We never use the browser clock to derive challenge days.

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface YMD {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

export function isValidISODate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function parseISODate(s: string): YMD {
  if (!isValidISODate(s)) throw new Error(`Invalid date: ${s}`);
  const [y, m, d] = s.split('-');
  return { year: Number(y), month: Number(m), day: Number(d) };
}

export function toISODate(ymd: YMD): string {
  const mm = String(ymd.month).padStart(2, '0');
  const dd = String(ymd.day).padStart(2, '0');
  return `${ymd.year}-${mm}-${dd}`;
}

/** Days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const pa = parseISODate(a);
  const pb = parseISODate(b);
  const ua = Date.UTC(pa.year, pa.month - 1, pa.day);
  const ub = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((ub - ua) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const p = parseISODate(date);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return toISODate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayIndex(date: string): number {
  const p = parseISODate(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** "Tue Oct 6" */
export function formatShortDate(date: string): string {
  const p = parseISODate(date);
  const wd = WEEKDAYS_SHORT[weekdayIndex(date)];
  const mo = MONTHS_SHORT[p.month - 1];
  return `${wd} ${mo} ${p.day}`;
}

/** "Tuesday, Oct 6" */
export function formatLongDate(date: string): string {
  const p = parseISODate(date);
  const wd = WEEKDAYS_LONG[weekdayIndex(date)];
  const mo = MONTHS_SHORT[p.month - 1];
  return `${wd}, ${mo} ${p.day}`;
}

/**
 * Header counter. `day` is the server-computed challenge day for the date shown.
 *  - day < 1            → "Starts in N days" (N = 1 - day)
 *  - 1 ≤ day ≤ length   → "Day X of 45"
 *  - day > length       → "Challenge complete"
 */
export function dayCounterLabel(day: number, lengthDays: number): string {
  if (day < 1) {
    const n = 1 - day;
    return n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`;
  }
  if (day > lengthDays) return 'Challenge complete';
  return `Day ${day} of ${lengthDays}`;
}
