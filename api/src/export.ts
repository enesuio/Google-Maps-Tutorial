import type { Db, GoalDirection, GoalKind, GoalSource } from './db.js';
import { dayNumber } from './dates.js';
import { photoView, type Photo } from './photos.js';
import { finishTestView, type FinishTest } from './summary.js';
import { cheerView, isHit, loadChallenge, type Challenge, type Cheer } from './views.js';

// ---- Shared types (mirror docs/API.md, T16) ----

export interface ExportUser {
  id: number;
  slug: string;
  name: string;
  kcalTarget: number | null;
  proteinTargetG: number | null;
}

/** Every goal of both users, active or not, with all of its fields. */
export interface ExportGoal {
  id: number;
  userId: number;
  key: string;
  label: string;
  kind: GoalKind;
  unit: string | null;
  direction: GoalDirection | null;
  dailyTarget: number | null;
  weeklyTarget: number | null;
  sort: number;
  active: boolean;
  source: GoalSource;
}

export interface ExportCheckin {
  userId: number;
  date: string;
  day: number;
  goalId: number;
  value: number;
  hit: boolean | null;
  updatedAt: string;
}

export interface ExportHealthDay {
  userId: number;
  date: string;
  day: number;
  steps: number | null;
  activeKcal: number | null;
  source: string;
  updatedAt: string;
}

export interface ExportBodyMetrics {
  userId: number;
  date: string;
  day: number;
  weightKg: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  updatedAt: string;
}

export interface ExportJson {
  exportedAt: string;
  challenge: Challenge;
  users: ExportUser[];
  goals: ExportGoal[];
  checkins: ExportCheckin[];
  cheers: Cheer[];
  healthDaily: ExportHealthDay[];
  /** The caller's rows, plus the partner's when they share their metrics. */
  bodyMetrics: ExportBodyMetrics[];
  finishTests: FinishTest[];
  /** The caller's photo metadata only; the files are not bundled. */
  photos: Photo[];
}

export const CHECKINS_CSV_HEADER = ['date', 'day', 'user', 'goal_key', 'goal_label', 'kind', 'unit', 'value', 'hit'] as const;
export const METRICS_CSV_HEADER = ['date', 'day', 'weight_kg', 'waist_cm', 'hips_cm', 'chest_cm', 'arm_cm', 'thigh_cm'] as const;
export const HEALTH_CSV_HEADER = ['date', 'day', 'user', 'steps', 'active_kcal'] as const;

// ---- CSV (RFC 4180: UTF-8, "\n" line ends, quote fields holding , " or a newline) ----

export type CsvValue = string | number | boolean | null | undefined;

/** One field: empty for null/undefined, quoted when it holds a comma, a quote or a line break. */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows (the first being the header) → CSV text ending in a newline. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvValue>>): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\n') + '\n';
}

// ---- Builders ----

const toNumber = (v: string | number | null): number | null => (v === null ? null : Number(v));

async function loadUsers(db: Db) {
  return db
    .selectFrom('users')
    .select(['id', 'slug', 'name', 'kcal_target', 'protein_target_g', 'metrics_shared'])
    .orderBy('id', 'asc')
    .execute();
}

async function loadGoals(db: Db) {
  return db
    .selectFrom('goals')
    .select(['id', 'user_id', 'key', 'label', 'kind', 'unit', 'direction', 'daily_target', 'weekly_target', 'sort', 'active', 'source'])
    .orderBy('user_id', 'asc')
    .orderBy('sort', 'asc')
    .orderBy('id', 'asc')
    .execute();
}

type GoalRow = Awaited<ReturnType<typeof loadGoals>>[number];

const hitOf = (goal: GoalRow | undefined, value: number): boolean | null =>
  goal ? isHit({ kind: goal.kind, direction: goal.direction, dailyTarget: toNumber(goal.daily_target) }, value) : null;

/** Check-ins of both users, oldest first, then by user and goal order. */
async function loadCheckins(db: Db) {
  return db
    .selectFrom('checkins')
    .innerJoin('goals', 'goals.id', 'checkins.goal_id')
    .select(['checkins.user_id', 'checkins.date', 'checkins.goal_id', 'checkins.value', 'checkins.updated_at'])
    .orderBy('checkins.date', 'asc')
    .orderBy('checkins.user_id', 'asc')
    .orderBy('goals.sort', 'asc')
    .orderBy('goals.id', 'asc')
    .execute();
}

async function loadHealth(db: Db) {
  return db
    .selectFrom('health_daily')
    .select(['user_id', 'date', 'steps', 'active_kcal', 'source', 'updated_at'])
    .orderBy('date', 'asc')
    .orderBy('user_id', 'asc')
    .execute();
}

async function loadBodyMetrics(db: Db, userIds: number[]) {
  if (userIds.length === 0) return [];
  return db
    .selectFrom('body_metrics')
    .select(['user_id', 'date', 'weight_kg', 'waist_cm', 'hips_cm', 'chest_cm', 'arm_cm', 'thigh_cm', 'updated_at'])
    .where('user_id', 'in', userIds)
    .orderBy('date', 'asc')
    .orderBy('user_id', 'asc')
    .execute();
}

/** The caller's own rows plus every partner who shares their metrics. */
function visibleMetricsUsers(users: Awaited<ReturnType<typeof loadUsers>>, meUserId: number): number[] {
  return users.filter((u) => u.id === meUserId || u.metrics_shared).map((u) => u.id);
}

export async function buildExportJson(db: Db, meUserId: number, exportedAt: Date): Promise<ExportJson> {
  const [challenge, users, goals, checkins, cheers, health, finishTests, photos] = await Promise.all([
    loadChallenge(db),
    loadUsers(db),
    loadGoals(db),
    loadCheckins(db),
    db
      .selectFrom('cheers')
      .select(['id', 'from_user', 'to_user', 'date', 'emoji', 'note', 'created_at'])
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute(),
    loadHealth(db),
    db
      .selectFrom('finish_tests')
      .select(['id', 'user_id', 'key', 'label', 'passed', 'result', 'tested_on'])
      .orderBy('id', 'asc')
      .execute(),
    db
      .selectFrom('photos')
      .select(['id', 'date', 'kind', 'mime', 'bytes', 'width', 'height', 'created_at'])
      .where('user_id', '=', meUserId)
      .orderBy('date', 'asc')
      .orderBy('id', 'asc')
      .execute(),
  ]);
  const bodyMetrics = await loadBodyMetrics(db, visibleMetricsUsers(users, meUserId));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const day = (date: string): number => dayNumber(date, challenge.startDate);

  return {
    exportedAt: exportedAt.toISOString(),
    challenge,
    users: users.map((u) => ({ id: u.id, slug: u.slug, name: u.name, kcalTarget: u.kcal_target, proteinTargetG: u.protein_target_g })),
    goals: goals.map((g) => ({
      id: g.id,
      userId: g.user_id,
      key: g.key,
      label: g.label,
      kind: g.kind,
      unit: g.unit,
      direction: g.direction,
      dailyTarget: toNumber(g.daily_target),
      weeklyTarget: toNumber(g.weekly_target),
      sort: g.sort,
      active: g.active,
      source: g.source,
    })),
    checkins: checkins.map((c) => ({
      userId: c.user_id,
      date: c.date,
      day: day(c.date),
      goalId: c.goal_id,
      value: Number(c.value),
      hit: hitOf(goalById.get(c.goal_id), Number(c.value)),
      updatedAt: c.updated_at.toISOString(),
    })),
    cheers: cheers.map(cheerView),
    healthDaily: health.map((h) => ({
      userId: h.user_id,
      date: h.date,
      day: day(h.date),
      steps: h.steps,
      activeKcal: toNumber(h.active_kcal),
      source: h.source,
      updatedAt: h.updated_at.toISOString(),
    })),
    bodyMetrics: bodyMetrics.map((m) => ({
      userId: m.user_id,
      date: m.date,
      day: day(m.date),
      weightKg: toNumber(m.weight_kg),
      waistCm: toNumber(m.waist_cm),
      hipsCm: toNumber(m.hips_cm),
      chestCm: toNumber(m.chest_cm),
      armCm: toNumber(m.arm_cm),
      thighCm: toNumber(m.thigh_cm),
      updatedAt: m.updated_at.toISOString(),
    })),
    finishTests: finishTests.map(finishTestView),
    photos: photos.map(photoView),
  };
}

/** `date,day,user,goal_key,goal_label,kind,unit,value,hit` — both users, every entered row. */
export async function buildCheckinsCsv(db: Db): Promise<string> {
  const [challenge, users, goals, checkins] = await Promise.all([loadChallenge(db), loadUsers(db), loadGoals(db), loadCheckins(db)]);
  const slugById = new Map(users.map((u) => [u.id, u.slug]));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const rows: CsvValue[][] = [[...CHECKINS_CSV_HEADER]];
  for (const c of checkins) {
    const goal = goalById.get(c.goal_id);
    const value = Number(c.value);
    rows.push([
      c.date,
      dayNumber(c.date, challenge.startDate),
      slugById.get(c.user_id) ?? c.user_id,
      goal?.key ?? null,
      goal?.label ?? null,
      goal?.kind ?? null,
      goal?.unit ?? null,
      value,
      hitOf(goal, value),
    ]);
  }
  return toCsv(rows);
}

/** `date,day,weight_kg,waist_cm,hips_cm,chest_cm,arm_cm,thigh_cm` — the caller's rows only. */
export async function buildMetricsCsv(db: Db, meUserId: number): Promise<string> {
  const [challenge, metrics] = await Promise.all([loadChallenge(db), loadBodyMetrics(db, [meUserId])]);
  const rows: CsvValue[][] = [[...METRICS_CSV_HEADER]];
  for (const m of metrics) {
    rows.push([
      m.date,
      dayNumber(m.date, challenge.startDate),
      toNumber(m.weight_kg),
      toNumber(m.waist_cm),
      toNumber(m.hips_cm),
      toNumber(m.chest_cm),
      toNumber(m.arm_cm),
      toNumber(m.thigh_cm),
    ]);
  }
  return toCsv(rows);
}

/** `date,day,user,steps,active_kcal` — both users. */
export async function buildHealthCsv(db: Db): Promise<string> {
  const [challenge, users, health] = await Promise.all([loadChallenge(db), loadUsers(db), loadHealth(db)]);
  const slugById = new Map(users.map((u) => [u.id, u.slug]));
  const rows: CsvValue[][] = [[...HEALTH_CSV_HEADER]];
  for (const h of health) {
    rows.push([h.date, dayNumber(h.date, challenge.startDate), slugById.get(h.user_id) ?? h.user_id, h.steps, toNumber(h.active_kcal)]);
  }
  return toCsv(rows);
}
