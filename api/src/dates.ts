import { z } from 'zod';

export const TORONTO = 'America/Toronto';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses 'YYYY-MM-DD' into [year, month (1-12), day]; null if malformed or not a real date. */
export function parseDate(s: string): [number, number, number] | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return [y, mo, d];
}

export function isValidDate(s: string): boolean {
  return parseDate(s) !== null;
}

/** Strict calendar date: 'YYYY-MM-DD' and a real date (rejects 2026-02-30). */
export const dateSchema = z
  .string()
  .regex(DATE_RE, 'expected YYYY-MM-DD')
  .refine(isValidDate, { message: 'not a valid calendar date' });

function toUtcMidnight(s: string): Date {
  const parts = parseDate(s);
  if (!parts) throw new Error(`Invalid date: ${s}`);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function formatUtc(d: Date): string {
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's calendar date in Toronto for the given instant. */
export function todayInToronto(now: Date = new Date()): string {
  return dateInZone(now, TORONTO);
}

export function dateInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, days: number): string {
  const d = toUtcMidnight(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUtc(d);
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: string, b: string): number {
  const ms = toUtcMidnight(b).getTime() - toUtcMidnight(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** Challenge day number: (date - startDate) + 1. Day 1 is the start date. */
export function dayNumber(date: string, startDate: string): number {
  return diffDays(startDate, date) + 1;
}

/** Monday..Sunday (ISO week) range containing `date`, inclusive. */
export function isoWeekRange(date: string): { start: string; end: string } {
  const d = toUtcMidnight(date);
  const dow = d.getUTCDay(); // 0 = Sunday
  const offsetToMonday = (dow + 6) % 7;
  const start = addDays(date, -offsetToMonday);
  return { start, end: addDays(start, 6) };
}

/** Lexicographic comparison works for YYYY-MM-DD strings. */
export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Inclusive list of dates from `from` to `to` (empty if from > to). */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
