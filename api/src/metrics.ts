import type { Db } from './db.js';
import { addDays, maxDate, minDate } from './dates.js';
import { loadChallenge, type Challenge } from './views.js';

// ---- Shared types (mirror docs/API.md) ----

export interface MetricPoint {
  date: string;
  weightKg: number | null;
  waistCm: number | null;
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
}

export interface MetricsView {
  challenge: Challenge;
  today: string;
  series: MetricsSeries[];
}

export const WEIGHT_KG_MIN = 20;
export const WEIGHT_KG_MAX = 400;
export const WAIST_CM_MIN = 30;
export const WAIST_CM_MAX = 250;

interface MetricRow {
  user_id: number;
  date: string;
  weight_kg: string | null;
  waist_cm: string | null;
}

const toNumber = (v: string | null): number | null => (v === null ? null : Number(v));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 7-day trailing mean for every row (rows ascending by date, one user). */
export function withAvg7(rows: Array<{ date: string; weightKg: number | null; waistCm: number | null }>): MetricPoint[] {
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
    return { date: r.date, weightKg: r.weightKg, waistCm: r.waistCm, weightAvg7: n === 0 ? null : round2(sum / n) };
  });
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
          .select(['user_id', 'date', 'weight_kg', 'waist_cm'])
          .where('user_id', 'in', visible)
          .where('date', '<=', today)
          .orderBy('date', 'asc')
          .execute();

  const series: MetricsSeries[] = ordered.map((u) => {
    const isMe = u.id === meId;
    const shared = u.metrics_shared;
    if (!isMe && !shared) {
      return { userId: u.id, name: u.name, isMe, shared, points: [], latestWeightKg: null, startWeightKg: null };
    }
    const mine = rows
      .filter((r) => r.user_id === u.id)
      .map((r) => ({ date: r.date, weightKg: toNumber(r.weight_kg), waistCm: toNumber(r.waist_cm) }));
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
    };
  });

  return { challenge, today, series };
}
