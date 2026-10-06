import type { Db } from './db.js';
import { addDays, maxDate, minDate } from './dates.js';
import { loadChallenge, type Challenge } from './views.js';

// ---- Shared types (mirror docs/API.md) ----

/** Tape measurements (T14), all in cm. */
export interface Measurements {
  waistCm: number | null;
  hipsCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
}

export const MEASUREMENT_KEYS = ['waistCm', 'hipsCm', 'chestCm', 'armCm', 'thighCm'] as const;
export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

export interface MetricPoint extends Measurements {
  date: string;
  weightKg: number | null;
  /** Mean of the entered weights in the 7 days ending on `date` (inclusive); null when none. */
  weightAvg7: number | null;
}

export interface MetricsSeries {
  userId: number;
  name: string;
  isMe: boolean;
  shared: boolean;
  points: MetricPoint[];
  latestWeightKg: number | null;
  startWeightKg: number | null;
  /** Latest non-null measurement of each kind; own user only, null for the partner. */
  latest: Measurements | null;
  /** Earliest measurement of each kind since startDate; own user only, null for the partner. */
  start: Measurements | null;
}

export interface MetricsView {
  challenge: Challenge;
  today: string;
  series: MetricsSeries[];
}

export const WEIGHT_KG_MIN = 20;
export const WEIGHT_KG_MAX = 400;
/** Every tape measurement shares the waist range. */
export const WAIST_CM_MIN = 30;
export const WAIST_CM_MAX = 250;
export const MEASUREMENT_CM_MIN = WAIST_CM_MIN;
export const MEASUREMENT_CM_MAX = WAIST_CM_MAX;

interface MetricRow {
  user_id: number;
  date: string;
  weight_kg: string | null;
  waist_cm: string | null;
  hips_cm: string | null;
  chest_cm: string | null;
  arm_cm: string | null;
  thigh_cm: string | null;
}

/** A day's entered values before the 7-day mean is added. */
export type MetricEntry = Omit<MetricPoint, 'weightAvg7'>;

const toNumber = (v: string | null): number | null => (v === null ? null : Number(v));
const round2 = (n: number): number => Math.round(n * 100) / 100;

export const emptyMeasurements = (): Measurements => ({ waistCm: null, hipsCm: null, chestCm: null, armCm: null, thighCm: null });

/** 7-day trailing mean for every row (rows ascending by date, one user). */
export function withAvg7(rows: MetricEntry[]): MetricPoint[] {
  const weights = new Map<string, number>();
  for (const r of rows) if (r.weightKg !== null) weights.set(r.date, r.weightKg);
  return rows.map((r) => {
    let sum = 0;
    let n = 0;
    for (let d = addDays(r.date, -6); d <= r.date; d = addDays(d, 1)) {
      const w = weights.get(d);
      if (w !== undefined) {
        sum += w;
        n++;
      }
    }
    return { ...r, weightAvg7: n === 0 ? null : round2(sum / n) };
  });
}

/** Latest non-null value of each measurement (rows ascending). */
export function latestMeasurements(rows: MetricEntry[]): Measurements {
  const out = emptyMeasurements();
  for (const key of MEASUREMENT_KEYS) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = rows[i]![key];
      if (v !== null) {
        out[key] = v;
        break;
      }
    }
  }
  return out;
}

/** Earliest non-null value of each measurement among rows on/after `since` (rows ascending). */
export function startMeasurements(rows: MetricEntry[], since: string): Measurements {
  const out = emptyMeasurements();
  for (const key of MEASUREMENT_KEYS) {
    const first = rows.find((r) => r.date >= since && r[key] !== null);
    if (first) out[key] = first[key];
  }
  return out;
}

export async function buildMetricsView(
  db: Db,
  meId: number,
  today: string,
  range: { from?: string | undefined; to?: string | undefined } = {},
): Promise<MetricsView> {
  const challenge = await loadChallenge(db);
  const from = maxDate(range.from ?? challenge.startDate, challenge.startDate);
  const to = minDate(range.to ?? today, today);

  const users = await db
    .selectFrom('users')
    .select(['id', 'name', 'metrics_shared'])
    .orderBy('id', 'asc')
    .execute();
  const ordered = [...users.filter((u) => u.id === meId), ...users.filter((u) => u.id !== meId)];

  // Rows up to today for everyone whose series is visible to the caller. The window reaches
  // 6 days before `from` so the first point's 7-day mean sees earlier entries.
  const visible = ordered.filter((u) => u.id === meId || u.metrics_shared).map((u) => u.id);
  const rows: MetricRow[] =
    visible.length === 0
      ? []
      : await db
          .selectFrom('body_metrics')
          .select(['user_id', 'date', 'weight_kg', 'waist_cm', 'hips_cm', 'chest_cm', 'arm_cm', 'thigh_cm'])
          .where('user_id', 'in', visible)
          .where('date', '<=', today)
          .orderBy('date', 'asc')
          .execute();

  const series: MetricsSeries[] = ordered.map((u) => {
    const isMe = u.id === meId;
    const shared = u.metrics_shared;
    if (!isMe && !shared) {
      return { userId: u.id, name: u.name, isMe, shared, points: [], latestWeightKg: null, startWeightKg: null, latest: null, start: null };
    }
    const mine: MetricEntry[] = rows
      .filter((r) => r.user_id === u.id)
      .map((r) => ({
        date: r.date,
        weightKg: toNumber(r.weight_kg),
        waistCm: toNumber(r.waist_cm),
        hipsCm: toNumber(r.hips_cm),
        chestCm: toNumber(r.chest_cm),
        armCm: toNumber(r.arm_cm),
        thighCm: toNumber(r.thigh_cm),
      }));
    const points = withAvg7(mine).filter((p) => p.date >= from && p.date <= to);
    const weighed = mine.filter((r) => r.weightKg !== null);
    const sinceStart = weighed.filter((r) => r.date >= challenge.startDate);
    return {
      userId: u.id,
      name: u.name,
      isMe,
      shared,
      points,
      latestWeightKg: weighed.length > 0 ? weighed[weighed.length - 1]!.weightKg : null,
      startWeightKg: sinceStart.length > 0 ? sinceStart[0]!.weightKg : null,
      // Measurements are shown to their owner only (the partner sees the series, not these).
      latest: isMe ? latestMeasurements(mine) : null,
      start: isMe ? startMeasurements(mine, challenge.startDate) : null,
    };
  });

  return { challenge, today, series };
}
