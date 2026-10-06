// Pure helpers for the hand-rolled SVG weight chart (TrendScreen). No DOM here.
import type { MetricPoint } from '../api/types';
import { addDays, daysBetween, formatShortDate, parseISODate } from './dates';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Mean of the entered weights in the 7 days ending on `date` (inclusive), rounded to 0.1.
 * Mirrors the server's `weightAvg7`, used to fill in optimistic points before it replies.
 */
export function avg7(points: ReadonlyArray<Pick<MetricPoint, 'date' | 'weightKg'>>, date: string): number | null {
  const from = addDays(date, -6);
  let sum = 0;
  let n = 0;
  for (const p of points) {
    if (p.weightKg === null || p.date < from || p.date > date) continue;
    sum += p.weightKg;
    n += 1;
  }
  return n === 0 ? null : Math.round((sum / n) * 10) / 10;
}

export interface YScale {
  min: number;
  max: number;
  ticks: number[];
}

function niceStep(rawStep: number): number {
  const exp = Math.floor(Math.log10(rawStep));
  const base = 10 ** exp;
  const f = rawStep / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

/**
 * Auto-ranged y axis with ~10% padding, snapped to "nice" tick values. Always spans at
 * least `minSpan` so a flat series does not zoom into noise. Ticks are clean numbers
 * (0.5 / 1 / 2 kg steps) and there are at most `maxTicks` of them.
 */
export function yScale(values: readonly number[], opts: { maxTicks?: number; minSpan?: number } = {}): YScale | null {
  const maxTicks = opts.maxTicks ?? 4;
  const minSpan = opts.minSpan ?? 2;
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length === 0) return null;
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  const step = niceStep((hi - lo) / Math.max(1, maxTicks - 1));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 1000; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { min, max, ticks };
}

export interface XTick {
  date: string;
  label: string; // "Oct 6"
}

/** "Oct 6" (no weekday: the axis needs short labels). */
export function shortMonthDay(date: string): string {
  const p = parseISODate(date);
  return `${MONTHS_SHORT[p.month - 1]} ${p.day}`;
}

/**
 * A few evenly spaced date labels across [start, end], always including both ends.
 * `count` is the maximum number of ticks (ends included).
 */
export function xTicks(start: string, end: string, count = 4): XTick[] {
  const span = daysBetween(start, end);
  if (span <= 0) return [{ date: start, label: shortMonthDay(start) }];
  const n = Math.max(2, Math.min(count, span + 1));
  const out: XTick[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = addDays(start, Math.round((span * i) / (n - 1)));
    if (out.some((t) => t.date === d)) continue;
    out.push({ date: d, label: shortMonthDay(d) });
  }
  return out;
}

/** Linear map of a value onto a pixel range. */
export function scaleLinear(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
  const span = domainMax - domainMin || 1;
  return (v: number) => rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

/** SVG path "M x y L x y …" through the given pixel points. */
export function linePath(pts: ReadonlyArray<{ x: number; y: number }>): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** Index of the point whose x is closest to `x`. */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = -1;
  let dist = Infinity;
  xs.forEach((px, i) => {
    const d = Math.abs(px - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

export function formatKg(n: number | null): string {
  return n === null ? '—' : `${(Math.round(n * 10) / 10).toFixed(1)} kg`;
}

export function formatCm(n: number | null): string {
  return n === null ? '—' : `${Math.round(n * 10) / 10} cm`;
}

/** One-sentence summary for the chart's aria-label. */
export function chartSummary(
  name: string,
  points: ReadonlyArray<Pick<MetricPoint, 'date' | 'weightKg' | 'weightAvg7'>>,
): string {
  const weighed = points.filter((p) => p.weightKg !== null);
  if (weighed.length === 0) return `Weight trend for ${name}: no entries yet.`;
  const first = weighed[0];
  const last = weighed[weighed.length - 1];
  if (!first || !last) return `Weight trend for ${name}.`;
  const avg = last.weightAvg7 === null ? '' : `, 7-day average ${formatKg(last.weightAvg7)}`;
  return (
    `Weight trend for ${name}: ${weighed.length} ${weighed.length === 1 ? 'entry' : 'entries'} from ` +
    `${formatShortDate(first.date)} to ${formatShortDate(last.date)}. Start ${formatKg(first.weightKg)}, ` +
    `latest ${formatKg(last.weightKg)}${avg}.`
  );
}
