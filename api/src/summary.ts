import type { Db, GoalDirection, GoalKind, GoalSource } from './db.js';
import { addDays, dateRange, dayNumber, isoWeekRange, minDate } from './dates.js';
import { photoView, type Photo } from './photos.js';
import { challengeEndDate } from './recap.js';
import { computeStreak, totalCheckins } from './streaks.js';
import { isHit, loadChallenge, loadEnteredDates, type Challenge } from './views.js';

// ---- Shared types (mirror docs/API.md, T15) ----

export interface FinishTest {
  id: number;
  userId: number;
  key: string;
  label: string;
  /** null = not tested yet */
  passed: boolean | null;
  result: string | null;
  testedOn: string | null;
}

export interface GoalSummary {
  goalId: number;
  label: string;
  kind: GoalKind;
  unit: string | null;
  source: GoalSource;
  dailyTarget: number | null;
  weeklyTarget: number | null;
  enteredDays: number;
  hitDays: number;
  /** Number goals: mean of the entered values; null for bool goals or when nothing was entered. */
  average: number | null;
  /** Weekly goals: Mon–Sun weeks so far, how many reached the target, and all hits. */
  weeklyHits: { weeks: number; weeksHit: number; total: number } | null;
}

export interface BodyPoint {
  date: string;
  weightKg: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
}

export type BodyChange = Omit<BodyPoint, 'date'>;

/** Caller only; null for the partner. */
export interface BodySummary {
  start: BodyPoint | null;
  latest: BodyPoint | null;
  change: BodyChange | null;
}

export interface UserSummary {
  userId: number;
  name: string;
  isMe: boolean;
  daysCheckedIn: number;
  /** min(day, lengthDays), 0 before the start. */
  daysSoFar: number;
  goalsHit: number;
  /** Active goals × daysSoFar. */
  goalsTotal: number;
  bestStreak: number;
  currentStreak: number;
  cheersSent: number;
  cheersReceived: number;
  topEmojiReceived: string | null;
  steps: { total: number | null; avgPerDay: number | null; bestDay: { date: string; steps: number } | null };
  goals: GoalSummary[];
  body: BodySummary | null;
  /** Caller only. */
  photos: { start: Photo | null; end: Photo | null } | null;
  /** Both users' tests are visible. */
  finishTests: FinishTest[];
}

export interface SummaryView {
  challenge: Challenge;
  today: string;
  day: number;
  endDate: string;
  complete: boolean;
  team: {
    checkins: number;
    possible: number;
    cheers: number;
    bestWeek: { weekStart: string; checkins: number } | null;
  };
  /** Me first. */
  users: UserSummary[];
}

const toNumber = (v: string | number | null): number | null => (v === null ? null : Number(v));
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function finishTestView(row: {
  id: number;
  user_id: number;
  key: string;
  label: string;
  passed: boolean | null;
  result: string | null;
  tested_on: string | null;
}): FinishTest {
  return {
    id: row.id,
    userId: row.user_id,
    key: row.key,
    label: row.label,
    passed: row.passed,
    result: row.result,
    testedOn: row.tested_on,
  };
}

/** Mondays of every Mon–Sun week that overlaps [from, to] (empty when from > to). */
export function weekStartsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  for (let monday = isoWeekRange(from).start; monday <= to; monday = addDays(monday, 7)) out.push(monday);
  return out;
}

/** The most frequent emoji; ties go to the one received first (rows oldest first). */
export function topEmoji(received: ReadonlyArray<{ emoji: string }>): string | null {
  const counts = new Map<string, number>(); // insertion order = first received
  for (const c of received) counts.set(c.emoji, (counts.get(c.emoji) ?? 0) + 1);
  let top: string | null = null;
  let best = 0;
  for (const [emoji, n] of counts) {
    if (n > best) {
      best = n;
      top = emoji;
    }
  }
  return top;
}

interface BodyRow {
  user_id: number;
  date: string;
  weight_kg: string | null;
  waist_cm: string | null;
  hips_cm: string | null;
  chest_cm: string | null;
  arm_cm: string | null;
  thigh_cm: string | null;
}

const BODY_KEYS = ['weightKg', 'waistCm', 'hipsCm', 'chestCm', 'armCm', 'thighCm'] as const;

const bodyPoint = (r: BodyRow): BodyPoint => ({
  date: r.date,
  weightKg: toNumber(r.weight_kg),
  waistCm: toNumber(r.waist_cm),
  hipsCm: toNumber(r.hips_cm),
  chestCm: toNumber(r.chest_cm),
  armCm: toNumber(r.arm_cm),
  thighCm: toNumber(r.thigh_cm),
});

/**
 * Start = the earliest entry since startDate, latest = the most recent entry up to today.
 * `change` needs two different entries; each field is latest − start when both sides are set.
 */
export function bodySummary(rows: BodyRow[], startDate: string): BodySummary {
  const sinceStart = rows.filter((r) => r.date >= startDate);
  const first = sinceStart[0];
  const last = rows[rows.length - 1];
  const start = first ? bodyPoint(first) : null;
  const latest = last ? bodyPoint(last) : null;
  let change: BodyChange | null = null;
  if (start && latest && start.date !== latest.date) {
    change = { weightKg: null, waistCm: null, hipsCm: null, chestCm: null, armCm: null, thighCm: null };
    for (const key of BODY_KEYS) {
      const a = start[key];
      const b = latest[key];
      change[key] = a === null || b === null ? null : round2(b - a);
    }
  }
  return { start, latest, change };
}

export async function buildSummary(db: Db, meUserId: number, today: string): Promise<SummaryView> {
  const challenge = await loadChallenge(db);
  const { startDate, lengthDays } = challenge;
  const endDate = challengeEndDate(challenge);
  const day = dayNumber(today, startDate);
  const daysSoFar = Math.min(Math.max(day, 0), lengthDays);
  // Nothing after the finish line counts; before the start nothing is counted at all.
  const lastCounted = minDate(today, endDate);
  const countedDays = dateRange(startDate, lastCounted);
  const weekStarts = weekStartsBetween(startDate, lastCounted);

  const allUsers = await db.selectFrom('users').select(['id', 'name']).orderBy('id', 'asc').execute();
  const users = [...allUsers.filter((u) => u.id === meUserId), ...allUsers.filter((u) => u.id !== meUserId)];

  const [goals, checkins, cheers, health, body, photos, finishTests, entered] = await Promise.all([
    db
      .selectFrom('goals')
      .select(['id', 'user_id', 'label', 'kind', 'unit', 'source', 'direction', 'daily_target', 'weekly_target'])
      .where('active', '=', true)
      .orderBy('sort', 'asc')
      .orderBy('id', 'asc')
      .execute(),
    countedDays.length === 0
      ? []
      : db
          .selectFrom('checkins')
          .select(['user_id', 'date', 'goal_id', 'value'])
          .where('date', '>=', startDate)
          .where('date', '<=', lastCounted)
          .execute(),
    db
      .selectFrom('cheers')
      .select(['from_user', 'to_user', 'emoji'])
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute(),
    countedDays.length === 0
      ? []
      : db
          .selectFrom('health_daily')
          .select(['user_id', 'date', 'steps'])
          .where('date', '>=', startDate)
          .where('date', '<=', lastCounted)
          .where('steps', 'is not', null)
          .orderBy('date', 'asc')
          .execute(),
    db
      .selectFrom('body_metrics')
      .select(['user_id', 'date', 'weight_kg', 'waist_cm', 'hips_cm', 'chest_cm', 'arm_cm', 'thigh_cm'])
      .where('user_id', '=', meUserId)
      .where('date', '<=', today)
      .orderBy('date', 'asc')
      .execute(),
    // Same query as GET /api/photos: the caller's photos, newest first.
    db
      .selectFrom('photos')
      .select(['id', 'date', 'kind', 'mime', 'bytes', 'width', 'height', 'created_at'])
      .where('user_id', '=', meUserId)
      .orderBy('date', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute(),
    db
      .selectFrom('finish_tests')
      .select(['id', 'user_id', 'key', 'label', 'passed', 'result', 'tested_on'])
      .orderBy('id', 'asc')
      .execute(),
    loadEnteredDates(db, startDate, lastCounted),
  ]);

  const values = new Map<string, number>();
  for (const c of checkins) values.set(`${c.user_id}:${c.date}:${c.goal_id}`, Number(c.value));

  const myPhotos = photos.map(photoView);
  const startPhotos = myPhotos.filter((p) => p.kind === 'start');
  const endPhotos = myPhotos.filter((p) => p.kind === 'end');

  const userSummaries: UserSummary[] = users.map((u) => {
    const isMe = u.id === meUserId;
    const mine = goals.filter((g) => g.user_id === u.id);
    const enteredDays = entered.get(u.id) ?? new Set<string>();
    const valueOf = (goalId: number, date: string): number | null => values.get(`${u.id}:${date}:${goalId}`) ?? null;

    let goalsHit = 0;
    const goalSummaries: GoalSummary[] = mine.map((g) => {
      const dailyTarget = toNumber(g.daily_target);
      const weeklyTarget = toNumber(g.weekly_target);
      const rule = { kind: g.kind, direction: g.direction as GoalDirection | null, dailyTarget };
      const hitOn = (date: string): boolean => isHit(rule, valueOf(g.id, date)) === true;

      let enteredCount = 0;
      let hitDays = 0;
      let sum = 0;
      for (const date of countedDays) {
        const v = valueOf(g.id, date);
        if (v === null) continue;
        enteredCount++;
        sum += v;
        if (hitOn(date)) hitDays++;
      }
      goalsHit += hitDays;

      let weeklyHits: GoalSummary['weeklyHits'] = null;
      if (weeklyTarget !== null) {
        let weeksHit = 0;
        for (const monday of weekStarts) {
          const count = dateRange(monday, minDate(addDays(monday, 6), lastCounted))
            .filter((d) => d >= startDate)
            .filter(hitOn).length;
          if (count >= weeklyTarget) weeksHit++;
        }
        weeklyHits = { weeks: weekStarts.length, weeksHit, total: hitDays };
      }

      return {
        goalId: g.id,
        label: g.label,
        kind: g.kind,
        unit: g.unit,
        source: g.source,
        dailyTarget,
        weeklyTarget,
        enteredDays: enteredCount,
        hitDays,
        average: g.kind === 'number' && enteredCount > 0 ? round2(sum / enteredCount) : null,
        weeklyHits,
      };
    });

    // Steps: over the days with an import; a day without one is unknown, not zero.
    const stepDays = health.filter((h) => h.user_id === u.id && h.steps !== null);
    let steps: UserSummary['steps'] = { total: null, avgPerDay: null, bestDay: null };
    if (stepDays.length > 0) {
      let total = 0;
      let bestDay: { date: string; steps: number } | null = null;
      for (const h of stepDays) {
        const n = h.steps ?? 0;
        total += n;
        if (bestDay === null || n > bestDay.steps) bestDay = { date: h.date, steps: n };
      }
      steps = { total, avgPerDay: Math.round(total / stepDays.length), bestDay };
    }

    const received = cheers.filter((c) => c.to_user === u.id);
    const streak = computeStreak(enteredDays, startDate, lastCounted);

    return {
      userId: u.id,
      name: u.name,
      isMe,
      daysCheckedIn: totalCheckins(enteredDays, startDate, lastCounted),
      daysSoFar,
      goalsHit,
      goalsTotal: mine.length * daysSoFar,
      bestStreak: streak.best,
      currentStreak: streak.current,
      cheersSent: cheers.filter((c) => c.from_user === u.id).length,
      cheersReceived: received.length,
      topEmojiReceived: topEmoji(received),
      steps,
      goals: goalSummaries,
      body: isMe ? bodySummary(body, startDate) : null,
      photos: isMe
        ? { start: startPhotos[startPhotos.length - 1] ?? null, end: endPhotos[0] ?? null }
        : null,
      finishTests: finishTests.filter((t) => t.user_id === u.id).map(finishTestView),
    };
  });

  // Best week: most combined checked-in days in a Mon–Sun week; ties go to the earliest.
  let bestWeek: SummaryView['team']['bestWeek'] = null;
  for (const monday of weekStarts) {
    const days = dateRange(monday, minDate(addDays(monday, 6), lastCounted)).filter((d) => d >= startDate);
    let n = 0;
    for (const u of users) {
      const set = entered.get(u.id);
      if (set) for (const d of days) if (set.has(d)) n++;
    }
    if (n > 0 && (bestWeek === null || n > bestWeek.checkins)) bestWeek = { weekStart: monday, checkins: n };
  }

  return {
    challenge,
    today,
    day,
    endDate,
    complete: today >= endDate,
    team: {
      checkins: userSummaries.reduce((sum, u) => sum + u.daysCheckedIn, 0),
      possible: users.length * daysSoFar,
      cheers: cheers.length,
      bestWeek,
    },
    users: userSummaries,
  };
}
