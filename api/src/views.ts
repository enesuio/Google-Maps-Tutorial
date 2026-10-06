import type { Db, GoalDirection, GoalKind } from './db.js';
import { dateRange, dayNumber, isoWeekRange, maxDate, minDate } from './dates.js';

// ---- Shared types (mirror docs/API.md) ----

export interface Challenge {
  name: string;
  startDate: string;
  lengthDays: number;
}

export interface GoalView {
  id: number;
  key: string;
  label: string;
  kind: GoalKind;
  unit: string | null;
  direction: GoalDirection | null;
  dailyTarget: number | null;
  weeklyTarget: number | null;
  value: number | null;
  hit: boolean | null;
  weekCount: number | null;
}

export interface UserDayView {
  id: number;
  slug: string;
  name: string;
  isMe: boolean;
  goals: GoalView[];
}

export interface DayView {
  date: string;
  day: number;
  today: string;
  challenge: Challenge;
  users: UserDayView[];
}

export interface HistoryDay {
  date: string;
  day: number;
  users: Array<{ userId: number; hit: number; total: number; entered: boolean }>;
}

export interface HistoryView {
  challenge: Challenge;
  today: string;
  users: Array<{ id: number; slug: string; name: string; isMe: boolean }>;
  days: HistoryDay[];
}

// ---- Internal row shapes ----

interface GoalRow {
  id: number;
  user_id: number;
  key: string;
  label: string;
  kind: GoalKind;
  unit: string | null;
  direction: GoalDirection | null;
  daily_target: string | null;
  weekly_target: string | null;
  sort: number;
}

interface UserRow {
  id: number;
  slug: string;
  name: string;
}

const toNumber = (v: string | number | null): number | null => (v === null ? null : Number(v));

/** `hit` rules from docs/API.md. */
export function isHit(
  goal: { kind: GoalKind; direction: GoalDirection | null; dailyTarget: number | null },
  value: number | null,
): boolean | null {
  if (value === null) return null;
  if (goal.kind === 'bool') return value === 1;
  if (goal.dailyTarget === null || goal.direction === null) return true;
  return goal.direction === 'at_most' ? value <= goal.dailyTarget : value >= goal.dailyTarget;
}

export async function loadChallenge(db: Db): Promise<Challenge> {
  const row = await db
    .selectFrom('challenges')
    .select(['name', 'start_date', 'length_days'])
    .orderBy('id', 'asc')
    .executeTakeFirst();
  if (!row) throw new Error('No challenge row. Run the seed.');
  return { name: row.name, startDate: row.start_date, lengthDays: row.length_days };
}

/** All users, caller first, then the rest by id. */
async function loadUsers(db: Db, meId: number): Promise<UserRow[]> {
  const rows = await db.selectFrom('users').select(['id', 'slug', 'name']).orderBy('id', 'asc').execute();
  return [...rows.filter((u) => u.id === meId), ...rows.filter((u) => u.id !== meId)];
}

async function loadActiveGoals(db: Db): Promise<GoalRow[]> {
  return db
    .selectFrom('goals')
    .select(['id', 'user_id', 'key', 'label', 'kind', 'unit', 'direction', 'daily_target', 'weekly_target', 'sort'])
    .where('active', '=', true)
    .orderBy('sort', 'asc')
    .orderBy('id', 'asc')
    .execute();
}

/** Map of `${userId}:${date}:${goalId}` → value for check-ins in [from, to]. */
async function loadCheckins(db: Db, from: string, to: string): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom('checkins')
    .select(['user_id', 'date', 'goal_id', 'value'])
    .where('date', '>=', from)
    .where('date', '<=', to)
    .execute();
  const map = new Map<string, number>();
  for (const r of rows) map.set(`${r.user_id}:${r.date}:${r.goal_id}`, Number(r.value));
  return map;
}

function goalView(goal: GoalRow, value: number | null, weekCount: number | null): GoalView {
  const dailyTarget = toNumber(goal.daily_target);
  const weeklyTarget = toNumber(goal.weekly_target);
  return {
    id: goal.id,
    key: goal.key,
    label: goal.label,
    kind: goal.kind,
    unit: goal.unit,
    direction: goal.direction,
    dailyTarget,
    weeklyTarget,
    value,
    hit: isHit({ kind: goal.kind, direction: goal.direction, dailyTarget }, value),
    weekCount,
  };
}

export async function buildDayView(db: Db, meId: number, date: string, today: string): Promise<DayView> {
  const week = isoWeekRange(date);
  const [challenge, users, goals, checkins] = await Promise.all([
    loadChallenge(db),
    loadUsers(db, meId),
    loadActiveGoals(db),
    loadCheckins(db, week.start, week.end),
  ]);
  const weekDays = dateRange(week.start, week.end);

  const userViews: UserDayView[] = users.map((u) => ({
    id: u.id,
    slug: u.slug,
    name: u.name,
    isMe: u.id === meId,
    goals: goals
      .filter((g) => g.user_id === u.id)
      .map((g) => {
        const value = checkins.get(`${u.id}:${date}:${g.id}`) ?? null;
        const dailyTarget = toNumber(g.daily_target);
        let weekCount: number | null = null;
        if (g.weekly_target !== null) {
          weekCount = 0;
          for (const d of weekDays) {
            const v = checkins.get(`${u.id}:${d}:${g.id}`) ?? null;
            if (isHit({ kind: g.kind, direction: g.direction, dailyTarget }, v) === true) weekCount++;
          }
        }
        return goalView(g, value, weekCount);
      }),
  }));

  return {
    date,
    day: dayNumber(date, challenge.startDate),
    today,
    challenge,
    users: userViews,
  };
}

export async function buildHistoryView(
  db: Db,
  meId: number,
  today: string,
  range: { from?: string | undefined; to?: string | undefined },
): Promise<HistoryView> {
  const [challenge, users, goals] = await Promise.all([loadChallenge(db), loadUsers(db, meId), loadActiveGoals(db)]);

  // Clamp the requested window to [startDate, today].
  const from = maxDate(range.from ?? challenge.startDate, challenge.startDate);
  const to = minDate(range.to ?? today, today);
  const dates = from <= to ? dateRange(from, to) : [];
  const checkins = dates.length > 0 ? await loadCheckins(db, from, to) : new Map<string, number>();

  const days: HistoryDay[] = dates
    .map((date) => ({
      date,
      day: dayNumber(date, challenge.startDate),
      users: users.map((u) => {
        const mine = goals.filter((g) => g.user_id === u.id);
        let hit = 0;
        let entered = false;
        for (const g of mine) {
          const value = checkins.get(`${u.id}:${date}:${g.id}`) ?? null;
          if (value !== null) entered = true;
          if (isHit({ kind: g.kind, direction: g.direction, dailyTarget: toNumber(g.daily_target) }, value) === true) {
            hit++;
          }
        }
        return { userId: u.id, hit, total: mine.length, entered };
      }),
    }))
    .reverse(); // newest first

  return {
    challenge,
    today,
    users: users.map((u) => ({ id: u.id, slug: u.slug, name: u.name, isMe: u.id === meId })),
    days,
  };
}
