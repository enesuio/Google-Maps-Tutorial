import type { Db } from './db.js';
import { addDays, dateRange, dayNumber, diffDays, isoWeekRange, minDate } from './dates.js';
import { badRequest } from './errors.js';
import { computeStreak } from './streaks.js';
import { isHit, loadChallenge, loadEnteredDates, type Challenge } from './views.js';

// ---- Shared types (mirror docs/API.md, T12) ----

export interface UserRecap {
  userId: number;
  name: string;
  isMe: boolean;
  /** 0–7; only days within the challenge count toward the denominator. */
  daysCheckedIn: number;
  /** How many of the 7 days fall inside [startDate, min(today, endDate)]. */
  daysInChallenge: number;
  goalsHit: number;
  goalsTotal: number;
  weeklyGoals: Array<{ goalId: number; label: string; count: number; target: number }>;
  /** Current streak as of the week's last day. */
  streakEnd: number;
  cheersReceived: number;
  cheersSent: number;
  /** Sum of imported steps, null if none. */
  steps: number | null;
  /** Own user only (first vs last entry in the week); null for the partner. */
  weightChangeKg: number | null;
  bestDay: { date: string; hit: number; total: number } | null;
}

export interface RecapView {
  weekStart: string;
  weekEnd: string;
  /** 1-based from the challenge start week. */
  weekNumber: number;
  /** Challenge days covered. */
  dayRange: { from: number; to: number };
  today: string;
  /** Me first. */
  users: UserRecap[];
  /** Sum over both users for the week. */
  team: { checkins: number; possible: number };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const challengeEndDate = (c: Challenge): string => addDays(c.startDate, c.lengthDays - 1);

/** Monday of the week `date` falls in. */
export const weekStartOf = (date: string): string => isoWeekRange(date).start;

/**
 * The week to show when none is asked for: the most recent completed week, or the current week
 * while the challenge is still in its first week.
 */
export function defaultRecapWeek(today: string, challenge: Challenge): string {
  const current = weekStartOf(today);
  const previous = addDays(current, -7);
  return addDays(previous, 6) < challenge.startDate ? current : previous;
}

/** 400 when the week lies entirely before the start or entirely after today. */
export function assertRecapWeekInRange(weekStart: string, today: string, challenge: Challenge): void {
  if (addDays(weekStart, 6) < challenge.startDate) {
    throw badRequest('before_start', `The week of ${weekStart} is before the challenge start (${challenge.startDate}).`);
  }
  if (weekStart > today) throw badRequest('future_date', `The week of ${weekStart} is after today (${today}).`);
}

/** Recap of the Monday–Sunday week starting at `weekStartMonday`, computed from the data. */
export async function buildRecap(db: Db, meUserId: number, weekStartMonday: string, today: string): Promise<RecapView> {
  const challenge = await loadChallenge(db);
  const weekStart = weekStartMonday;
  const weekEnd = addDays(weekStart, 6);
  const endDate = challengeEndDate(challenge);
  const lastCounted = minDate(today, endDate);
  const countedDays = dateRange(weekStart, weekEnd).filter((d) => d >= challenge.startDate && d <= lastCounted);
  const daysInChallenge = countedDays.length;
  const weekNumber = Math.floor(diffDays(weekStartOf(challenge.startDate), weekStart) / 7) + 1;
  const streakReference = minDate(weekEnd, today);

  const allUsers = await db.selectFrom('users').select(['id', 'name']).orderBy('id', 'asc').execute();
  const users = [...allUsers.filter((u) => u.id === meUserId), ...allUsers.filter((u) => u.id !== meUserId)];

  const [goals, checkins, cheers, health, weights, entered] = await Promise.all([
    db
      .selectFrom('goals')
      .select(['id', 'user_id', 'label', 'kind', 'direction', 'daily_target', 'weekly_target'])
      .where('active', '=', true)
      .orderBy('sort', 'asc')
      .orderBy('id', 'asc')
      .execute(),
    db
      .selectFrom('checkins')
      .select(['user_id', 'date', 'goal_id', 'value'])
      .where('date', '>=', weekStart)
      .where('date', '<=', weekEnd)
      .execute(),
    db
      .selectFrom('cheers')
      .select(['from_user', 'to_user'])
      .where('date', '>=', weekStart)
      .where('date', '<=', weekEnd)
      .execute(),
    db
      .selectFrom('health_daily')
      .select(['user_id', 'steps'])
      .where('date', '>=', weekStart)
      .where('date', '<=', weekEnd)
      .where('steps', 'is not', null)
      .execute(),
    db
      .selectFrom('body_metrics')
      .select(['date', 'weight_kg'])
      .where('user_id', '=', meUserId)
      .where('date', '>=', weekStart)
      .where('date', '<=', weekEnd)
      .where('weight_kg', 'is not', null)
      .orderBy('date', 'asc')
      .execute(),
    loadEnteredDates(db, challenge.startDate, streakReference),
  ]);

  const values = new Map<string, number>();
  for (const c of checkins) values.set(`${c.user_id}:${c.date}:${c.goal_id}`, Number(c.value));

  // Own weight change: last minus first weigh-in of the week; needs two entries to be a change.
  let weightChangeKg: number | null = null;
  if (weights.length >= 2) {
    weightChangeKg = round2(Number(weights[weights.length - 1]!.weight_kg) - Number(weights[0]!.weight_kg));
  }

  const userRecaps: UserRecap[] = users.map((u) => {
    const mine = goals.filter((g) => g.user_id === u.id);
    const hitOf = (g: (typeof mine)[number], date: string): boolean =>
      isHit(
        { kind: g.kind, direction: g.direction, dailyTarget: g.daily_target === null ? null : Number(g.daily_target) },
        values.get(`${u.id}:${date}:${g.id}`) ?? null,
      ) === true;

    const enteredDays = entered.get(u.id) ?? new Set<string>();
    let goalsHit = 0;
    let bestDay: UserRecap['bestDay'] = null;
    for (const date of countedDays) {
      const hit = mine.filter((g) => hitOf(g, date)).length;
      goalsHit += hit;
      if (enteredDays.has(date) && (bestDay === null || hit > bestDay.hit)) bestDay = { date, hit, total: mine.length };
    }

    const weeklyGoals = mine
      .filter((g) => g.weekly_target !== null)
      .map((g) => ({
        goalId: g.id,
        label: g.label,
        count: dateRange(weekStart, weekEnd).filter((d) => hitOf(g, d)).length,
        target: Number(g.weekly_target),
      }));

    const stepRows = health.filter((h) => h.user_id === u.id);
    const steps = stepRows.length === 0 ? null : stepRows.reduce((sum, h) => sum + (h.steps ?? 0), 0);

    return {
      userId: u.id,
      name: u.name,
      isMe: u.id === meUserId,
      daysCheckedIn: countedDays.filter((d) => enteredDays.has(d)).length,
      daysInChallenge,
      goalsHit,
      goalsTotal: mine.length * daysInChallenge,
      weeklyGoals,
      streakEnd: computeStreak(enteredDays, challenge.startDate, streakReference).current,
      cheersReceived: cheers.filter((c) => c.to_user === u.id).length,
      cheersSent: cheers.filter((c) => c.from_user === u.id).length,
      steps,
      weightChangeKg: u.id === meUserId ? weightChangeKg : null,
      bestDay,
    };
  });

  return {
    weekStart,
    weekEnd,
    weekNumber,
    dayRange: {
      from: Math.max(1, dayNumber(weekStart, challenge.startDate)),
      to: Math.min(challenge.lengthDays, dayNumber(weekEnd, challenge.startDate)),
    },
    today,
    users: userRecaps,
    team: {
      checkins: userRecaps.reduce((sum, u) => sum + u.daysCheckedIn, 0),
      possible: users.length * daysInChallenge,
    },
  };
}

/** Push body for the Sunday recap: own numbers first, then each partner's days only (never weight). */
export function recapPushBody(view: RecapView): string {
  const [self, ...others] = view.users;
  if (!self) return '';
  const head = `Week ${view.weekNumber}: ${self.daysCheckedIn} of ${self.daysInChallenge} days, ${self.goalsHit} goals hit.`;
  const rest = others.map((o) => ` ${o.name}: ${o.daysCheckedIn} of ${o.daysInChallenge}.`).join('');
  return head + rest;
}
