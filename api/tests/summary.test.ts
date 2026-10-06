import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bodySummary, topEmoji, weekStartsBetween, type SummaryView } from '../src/summary.js';
import { FORTNIGHT_NOW, seedFortnight } from './fortnight.js';
import { closeDb, cookieHeader, login, makeApp, migrateOnce, resetDb } from './helpers.js';

const CHALLENGE = { name: 'Hydrox 45', startDate: '2026-10-06', lengthDays: 45 };

let app: Awaited<ReturnType<typeof makeApp>>;

beforeAll(async () => {
  await migrateOnce();
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  app = await makeApp({ now: FORTNIGHT_NOW });
});
afterEach(async () => {
  await app.close();
});

const json = <T>(res: { body: string }): T => JSON.parse(res.body) as T;
const summary = async (cookie: string) => {
  const res = await app.inject({ method: 'GET', url: '/api/summary', headers: cookieHeader(cookie) });
  expect(res.statusCode, res.body).toBe(200);
  return json<SummaryView>(res);
};
const noBody = { weightKg: null, waistCm: null, hipsCm: null, chestCm: null, armCm: null, thighCm: null };

describe('GET /api/summary', () => {
  it('sums the fortnight so far for both users, me first', async () => {
    const f = await seedFortnight(app);
    const view = await summary(f.enes);

    expect(view).toMatchObject({
      challenge: CHALLENGE,
      today: '2026-10-19',
      day: 14,
      endDate: '2026-11-19',
      complete: false,
      team: { checkins: 17, possible: 28, cheers: 5, bestWeek: { weekStart: '2026-10-05', checkins: 8 } }, // week 2 ties at 8 → earliest
    });
    expect(view.users.map((u) => [u.userId, u.isMe])).toEqual([
      [f.enesId, true],
      [f.agnesId, false],
    ]);

    const [enes, agnes] = view.users as [SummaryView['users'][number], SummaryView['users'][number]];
    expect(enes).toMatchObject({
      name: 'Enes',
      daysCheckedIn: 9,
      daysSoFar: 14,
      goalsHit: 14,
      goalsTotal: 56, // 4 active goals × 14 days
      bestStreak: 5, // Oct 6–10
      currentStreak: 4, // 13, 14, 15, (16 forgiven), 17; 18 missed, today empty
      cheersSent: 4,
      cheersReceived: 1,
      topEmojiReceived: '💪',
      steps: { total: 24000, avgPerDay: 8000, bestDay: { date: '2026-10-17', steps: 12000 } },
      finishTests: [],
    });
    expect(enes.goals).toEqual([
      { goalId: f.goals.walk, label: 'Daily walk', kind: 'bool', unit: null, source: 'manual', dailyTarget: null, weeklyTarget: null, enteredDays: 7, hitDays: 6, average: null, weeklyHits: null },
      { goalId: f.goals.kcal, label: 'Calories', kind: 'number', unit: 'kcal', source: 'manual', dailyTarget: 1600, weeklyTarget: null, enteredDays: 5, hitDays: 4, average: 1550, weeklyHits: null },
      { goalId: f.goals.protein, label: 'Protein', kind: 'number', unit: 'g', source: 'manual', dailyTarget: 160, weeklyTarget: null, enteredDays: 2, hitDays: 2, average: 167.5, weeklyHits: null },
      { goalId: f.goals.steps, label: 'Steps', kind: 'number', unit: 'steps', source: 'health_steps', dailyTarget: 8000, weeklyTarget: null, enteredDays: 3, hitDays: 2, average: 8000, weeklyHits: null },
    ]);
    // Body and photos: the caller's only.
    expect(enes.body).toEqual({
      start: { date: '2026-10-06', ...noBody, weightKg: 82, waistCm: 92 },
      latest: { date: '2026-10-18', ...noBody, weightKg: 80.5, waistCm: 90 },
      change: { ...noBody, weightKg: -1.5, waistCm: -2 },
    });
    expect(enes.photos).toMatchObject({ start: { id: f.photoId, date: '2026-10-06', kind: 'start', url: `/api/photos/${f.photoId}/file` }, end: null });

    expect(agnes).toMatchObject({
      name: 'Agnes',
      daysCheckedIn: 8,
      daysSoFar: 14,
      goalsHit: 12,
      goalsTotal: 70, // 5 active goals × 14 days
      bestStreak: 8,
      currentStreak: 8, // never missed twice; today already logged
      cheersSent: 1,
      cheersReceived: 4,
      topEmojiReceived: '👏', // 👏 and 🔥 tie at 2 → the one received first
      steps: { total: null, avgPerDay: null, bestDay: null },
      body: null,
      photos: null,
    });
    // F45 (3 a week): week 1 three classes (hit), week 2 two, the week of today one so far.
    expect(agnes.goals.find((g) => g.goalId === f.goals.f45)).toMatchObject({
      weeklyTarget: 3,
      enteredDays: 7,
      hitDays: 6,
      average: null,
      weeklyHits: { weeks: 3, weeksHit: 1, total: 6 },
    });
    expect(agnes.goals.find((g) => g.goalId === f.goals.akcal)).toMatchObject({ enteredDays: 3, hitDays: 2, average: 1483.33 });
    // Both users' finish tests are visible; Agnes's two come from the seed, untested.
    expect(agnes.finishTests).toEqual([
      { id: expect.any(Number), userId: f.agnesId, key: 'pushups', label: '3 push-ups', passed: null, result: null, testedOn: null },
      { id: expect.any(Number), userId: f.agnesId, key: 'pullup', label: '1 pull-up', passed: null, result: null, testedOn: null },
    ]);
  });

  it('from the partner’s side: her body and photos, mine hidden; a single weigh-in has no change yet', async () => {
    const f = await seedFortnight(app);
    const view = await summary(f.agnes);
    expect(view.users.map((u) => [u.name, u.isMe])).toEqual([
      ['Agnes', true],
      ['Enes', false],
    ]);
    const [agnes, enes] = view.users as [SummaryView['users'][number], SummaryView['users'][number]];
    expect(agnes.body).toEqual({
      start: { date: '2026-10-07', ...noBody, weightKg: 65 },
      latest: { date: '2026-10-07', ...noBody, weightKg: 65 },
      change: null,
    });
    expect(agnes.photos).toEqual({ start: null, end: null });
    expect(enes.body).toBeNull();
    expect(enes.photos).toBeNull();
    expect(enes.finishTests).toEqual([]);
    expect(agnes.finishTests).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: '/api/summary' })).statusCode).toBe(401);
  });

  it('is empty before the start and becomes complete on the end date', async () => {
    await seedFortnight(app);
    await app.close();

    app = await makeApp({ now: () => new Date('2026-10-01T16:00:00Z') });
    let view = await summary(await login(app, 'enes'));
    expect(view).toMatchObject({ day: -4, complete: false, team: { checkins: 0, possible: 0, bestWeek: null } });
    expect(view.users[0]).toMatchObject({ daysSoFar: 0, daysCheckedIn: 0, goalsTotal: 0, goalsHit: 0, bestStreak: 0, currentStreak: 0 });
    await app.close();

    // Day 45 (Thu Nov 19) and well after it: the summary is final and caps at 45 days.
    app = await makeApp({ now: () => new Date('2026-11-19T16:00:00Z') });
    view = await summary(await login(app, 'enes'));
    expect(view).toMatchObject({ day: 45, endDate: '2026-11-19', complete: true, team: { checkins: 17, possible: 90 } });
    expect(view.users[0]).toMatchObject({ daysSoFar: 45, daysCheckedIn: 9, goalsTotal: 180 });
    await app.close();

    app = await makeApp({ now: () => new Date('2026-12-01T16:00:00Z') });
    view = await summary(await login(app, 'agnes'));
    expect(view).toMatchObject({ day: 57, complete: true, team: { possible: 90 } });
    expect(view.users.map((u) => u.daysSoFar)).toEqual([45, 45]);
    expect(view.users[0]!.goals.find((g) => g.weeklyTarget !== null)!.weeklyHits).toEqual({ weeks: 7, weeksHit: 1, total: 6 });
  });
});

describe('summary helpers', () => {
  it('weekStartsBetween lists the Mondays of every week overlapping the range', () => {
    expect(weekStartsBetween('2026-10-06', '2026-10-19')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
    expect(weekStartsBetween('2026-10-06', '2026-10-06')).toEqual(['2026-10-05']);
    expect(weekStartsBetween('2026-10-06', '2026-10-05')).toEqual([]);
    expect(weekStartsBetween('2026-10-06', '2026-11-19')).toHaveLength(7);
  });

  it('topEmoji picks the most frequent, earliest on ties, null when none', () => {
    expect(topEmoji([])).toBeNull();
    expect(topEmoji([{ emoji: '🔥' }, { emoji: '👏' }, { emoji: '👏' }])).toBe('👏');
    expect(topEmoji([{ emoji: '🔥' }, { emoji: '👏' }])).toBe('🔥');
  });

  it('bodySummary ignores entries before the start for `start` and needs two dates for a change', () => {
    const row = (date: string, weight: string | null, waist: string | null = null) => ({
      user_id: 1, date, weight_kg: weight, waist_cm: waist, hips_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null,
    });
    expect(bodySummary([], '2026-10-06')).toEqual({ start: null, latest: null, change: null });
    const s = bodySummary([row('2026-10-01', '84'), row('2026-10-06', '82', '92'), row('2026-10-18', '80.5')], '2026-10-06');
    expect(s.start).toMatchObject({ date: '2026-10-06', weightKg: 82, waistCm: 92 });
    expect(s.latest).toMatchObject({ date: '2026-10-18', weightKg: 80.5, waistCm: null });
    expect(s.change).toEqual({ ...noBody, weightKg: -1.5 }); // waist missing on one side → null
    // Only a pre-start entry: latest is set, start and change are not.
    expect(bodySummary([row('2026-10-01', '84')], '2026-10-06')).toMatchObject({ start: null, change: null, latest: { date: '2026-10-01' } });
  });
});
