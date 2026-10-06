import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleWeeklyRecap, runJob } from '../src/push/jobs.js';
import { upsertSubscription } from '../src/push/subscriptions.js';
import { buildRecap, defaultRecapWeek, recapPushBody, type RecapView } from '../src/recap.js';
import { FakeSender, closeDb, cookieHeader, db, goalId, login, makeApp, migrateOnce, resetDb, subscription, userId } from './helpers.js';

// Tuesday Oct 20 2026, noon Toronto → challenge day 15; the last completed week is Oct 12–18.
const NOW = () => new Date('2026-10-20T16:00:00Z');
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
  app = await makeApp({ now: NOW });
});
afterEach(async () => {
  await app.close();
});

const json = <T>(res: { body: string }): T => JSON.parse(res.body) as T;
const codeOf = (res: { body: string }) => json<{ error: { code: string } }>(res).error.code;

async function checkin(cookie: string, date: string, entries: unknown[]) {
  const res = await app.inject({ method: 'PUT', url: `/api/checkins/${date}`, headers: cookieHeader(cookie), payload: { entries } });
  expect(res.statusCode, res.body).toBe(200);
}
async function cheer(cookie: string, toUserId: number, date: string) {
  const res = await app.inject({ method: 'POST', url: '/api/cheers', headers: cookieHeader(cookie), payload: { toUserId, date, emoji: '👏' } });
  expect(res.statusCode, res.body).toBe(201);
}
async function weigh(cookie: string, date: string, weightKg: number) {
  const res = await app.inject({ method: 'PUT', url: `/api/metrics/${date}`, headers: cookieHeader(cookie), payload: { weightKg } });
  expect(res.statusCode, res.body).toBe(200);
}
async function importSteps(cookie: string, date: string, steps: number) {
  const tok = await app.inject({ method: 'POST', url: '/api/import/token', headers: cookieHeader(cookie) });
  const { token } = json<{ token: string }>(tok);
  const res = await app.inject({ method: 'POST', url: '/api/import', headers: { authorization: `Bearer ${token}` }, payload: { date, steps } });
  expect(res.statusCode, res.body).toBe(200);
}
const recap = async (cookie: string, qs = '') =>
  app.inject({ method: 'GET', url: `/api/recap${qs}`, headers: cookieHeader(cookie) });

/** Week 1 (Oct 6–11) and week 2 (Oct 12–18) with known check-ins, cheers, weights and steps. */
async function seedWeeks() {
  const enes = await login(app, 'enes');
  const agnes = await login(app, 'agnes');
  const enesId = await userId('enes');
  const agnesId = await userId('agnes');
  const [walk, kcal, protein] = await Promise.all([goalId('enes', 'walk'), goalId('enes', 'kcal'), goalId('enes', 'protein')]);
  const [f45, akcal, aprotein, practice] = await Promise.all([
    goalId('agnes', 'f45'), goalId('agnes', 'kcal'), goalId('agnes', 'protein'), goalId('agnes', 'practice'),
  ]);

  // Week 1: Enes logs Oct 6–8 then misses 9, 10, 11 (two misses in a row break the streak).
  for (const d of ['2026-10-06', '2026-10-07', '2026-10-08']) await checkin(enes, d, [{ goalId: walk, value: true }]);
  await cheer(enes, agnesId, '2026-10-08'); // outside week 2: not counted there

  // Week 2, Enes: 12 (3 hits), 13 (0), 14 —, 15 (1), 16 (4 incl. imported steps), 17 —, 18 (1).
  await checkin(enes, '2026-10-12', [{ goalId: walk, value: true }, { goalId: kcal, value: 1500 }, { goalId: protein, value: 170 }]);
  await checkin(enes, '2026-10-13', [{ goalId: walk, value: false }, { goalId: kcal, value: 1700 }]);
  await checkin(enes, '2026-10-15', [{ goalId: walk, value: true }]);
  await checkin(enes, '2026-10-16', [{ goalId: walk, value: true }, { goalId: kcal, value: 1400 }, { goalId: protein, value: 165 }]);
  await importSteps(enes, '2026-10-16', 9000);
  await checkin(enes, '2026-10-18', [{ goalId: kcal, value: 1600 }]);
  await importSteps(enes, '2026-10-18', 3000); // entered, below target
  await weigh(enes, '2026-10-12', 82);
  await weigh(enes, '2026-10-18', 81.2);

  // Week 2, Agnes: 12 (2 hits), 14 (1), 16 (1), 17 (2); F45 twice of three.
  await checkin(agnes, '2026-10-12', [{ goalId: f45, value: true }, { goalId: akcal, value: 1400 }]);
  await checkin(agnes, '2026-10-14', [{ goalId: f45, value: true }]);
  await checkin(agnes, '2026-10-16', [{ goalId: f45, value: false }, { goalId: practice, value: true }]);
  await checkin(agnes, '2026-10-17', [{ goalId: akcal, value: 1450 }, { goalId: aprotein, value: 140 }]);
  await weigh(agnes, '2026-10-13', 65);
  await weigh(agnes, '2026-10-17', 64.5);

  await cheer(enes, agnesId, '2026-10-12');
  await cheer(enes, agnesId, '2026-10-14');
  await cheer(agnes, enesId, '2026-10-16');
  return { enes, agnes, enesId, agnesId, f45 };
}

describe('GET /api/recap', () => {
  it('computes the completed week for both users, me first, with own weight change only', async () => {
    const { enes, agnes, enesId, agnesId, f45 } = await seedWeeks();

    const res = await recap(enes);
    expect(res.statusCode).toBe(200);
    const view = json<RecapView>(res);
    expect(view).toMatchObject({
      weekStart: '2026-10-12',
      weekEnd: '2026-10-18',
      weekNumber: 2,
      dayRange: { from: 7, to: 13 },
      today: '2026-10-20',
      team: { checkins: 9, possible: 14 },
    });
    expect(view.users.map((u) => [u.userId, u.isMe])).toEqual([
      [enesId, true],
      [agnesId, false],
    ]);
    expect(view.users[0]).toEqual({
      userId: enesId,
      name: 'Enes',
      isMe: true,
      daysCheckedIn: 5,
      daysInChallenge: 7,
      goalsHit: 9,
      goalsTotal: 28, // 4 active goals × 7 days
      weeklyGoals: [],
      streakEnd: 5,
      cheersReceived: 1,
      cheersSent: 2,
      steps: 12000,
      weightChangeKg: -0.8,
      bestDay: { date: '2026-10-16', hit: 4, total: 4 },
    });
    expect(view.users[1]).toEqual({
      userId: agnesId,
      name: 'Agnes',
      isMe: false,
      daysCheckedIn: 4,
      daysInChallenge: 7,
      goalsHit: 6,
      goalsTotal: 35,
      weeklyGoals: [{ goalId: f45, label: 'F45 class', count: 2, target: 3 }],
      streakEnd: 4,
      cheersReceived: 2,
      cheersSent: 1,
      steps: null,
      weightChangeKg: null, // partner: never
      bestDay: { date: '2026-10-12', hit: 2, total: 5 }, // tie with Oct 17 → earliest
    });

    // From Agnes's side her own change is shown and Enes's is null.
    const hers = json<RecapView>(await recap(agnes));
    expect(hers.users.map((u) => [u.name, u.weightChangeKg])).toEqual([
      ['Agnes', -0.5],
      ['Enes', null],
    ]);
  });

  it('?week= picks the week containing any date; partial weeks count only challenge days', async () => {
    const { enes } = await seedWeeks();
    // Week 1 is Oct 5–11, but the challenge starts Tue Oct 6 → 6 counted days, days 1–6.
    let view = json<RecapView>(await recap(enes, '?week=2026-10-09'));
    expect(view).toMatchObject({ weekStart: '2026-10-05', weekEnd: '2026-10-11', weekNumber: 1, dayRange: { from: 1, to: 6 } });
    expect(view.users[0]).toMatchObject({ daysCheckedIn: 3, daysInChallenge: 6, goalsTotal: 24, goalsHit: 3, streakEnd: 0, cheersSent: 1 });
    expect(view.users[1]).toMatchObject({ daysCheckedIn: 0, daysInChallenge: 6, cheersReceived: 1, bestDay: null, steps: null });
    expect(view.team).toEqual({ checkins: 3, possible: 12 });

    // The current week (Oct 19–25) only counts up to today, Tue Oct 20 → 2 days; nothing logged yet.
    view = json<RecapView>(await recap(enes, '?week=2026-10-20'));
    expect(view).toMatchObject({ weekStart: '2026-10-19', weekNumber: 3, dayRange: { from: 14, to: 20 } });
    expect(view.users[0]).toMatchObject({ daysCheckedIn: 0, daysInChallenge: 2, goalsTotal: 8, streakEnd: 5, weightChangeKg: null });
    expect(view.team).toEqual({ checkins: 0, possible: 4 });
  });

  it('defaults to the most recent completed week, or the current week during the first week', async () => {
    expect(defaultRecapWeek('2026-10-20', CHALLENGE)).toBe('2026-10-12');
    expect(defaultRecapWeek('2026-10-18', CHALLENGE)).toBe('2026-10-05'); // Sunday: this week is not complete yet
    expect(defaultRecapWeek('2026-10-12', CHALLENGE)).toBe('2026-10-05'); // Monday after week 1
    expect(defaultRecapWeek('2026-10-08', CHALLENGE)).toBe('2026-10-05'); // first week → current week
    expect(defaultRecapWeek('2026-10-06', CHALLENGE)).toBe('2026-10-05');

    await app.close();
    app = await makeApp({ now: () => new Date('2026-10-08T16:00:00Z') });
    const enes = await login(app, 'enes');
    const view = json<RecapView>(await recap(enes));
    expect(view).toMatchObject({ weekStart: '2026-10-05', weekNumber: 1, today: '2026-10-08' });
    expect(view.users[0]!.daysInChallenge).toBe(3); // Oct 6, 7, 8
  });

  it('rejects weeks entirely before the start or after today, and malformed dates', async () => {
    const enes = await login(app, 'enes');
    let res = await recap(enes, '?week=2026-10-04'); // Sep 28 – Oct 4
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('before_start');
    res = await recap(enes, '?week=2026-10-26'); // Oct 26 – Nov 1
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('future_date');
    expect((await recap(enes, '?week=2026-10-05')).statusCode).toBe(200); // overlaps the start
    expect((await recap(enes, '?week=2026-10-25')).statusCode).toBe(200); // the current week
    res = await recap(enes, '?week=nope');
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
    expect((await app.inject({ method: 'GET', url: '/api/recap' })).statusCode).toBe(401);
  });
});

describe('weekly-recap job', () => {
  it('pushes each subscribed user their own numbers first and the partner’s days only, with the exact body', async () => {
    const { enesId, agnesId } = await seedWeeks();
    const sender = new FakeSender();
    await upsertSubscription(db, enesId, subscription('https://push.example/enes'));
    await upsertSubscription(db, agnesId, subscription('https://push.example/agnes'));

    const sunday = new Date('2026-10-18T23:00:00Z'); // Sun Oct 18, 19:00 Toronto
    await handleWeeklyRecap(db, sender, sunday);
    expect(sender.sent).toEqual([
      {
        endpoint: 'https://push.example/enes',
        payload: { title: 'Hydrox 45', body: 'Week 2: 5 of 7 days, 9 goals hit. Agnes: 4 of 7.', url: '/recap?week=2026-10-12', tag: 'recap-2026-10-12' },
      },
      {
        endpoint: 'https://push.example/agnes',
        payload: { title: 'Hydrox 45', body: 'Week 2: 4 of 7 days, 6 goals hit. Enes: 5 of 7.', url: '/recap?week=2026-10-12', tag: 'recap-2026-10-12' },
      },
    ]);
    expect(recapPushBody(await buildRecap(db, enesId, '2026-10-12', '2026-10-18'))).toBe('Week 2: 5 of 7 days, 9 goals hit. Agnes: 4 of 7.');

    // Only subscribed users; silent for a week outside the challenge.
    sender.sent = [];
    await db.deleteFrom('push_subscriptions').where('user_id', '=', agnesId).execute();
    await runJob(db, sender, sunday, 'weekly-recap', {});
    expect(sender.sent.map((s) => s.endpoint)).toEqual(['https://push.example/enes']);
    sender.sent = [];
    await handleWeeklyRecap(db, sender, new Date('2026-09-27T23:00:00Z'));
    await handleWeeklyRecap(db, sender, new Date('2026-11-29T23:00:00Z')); // after day 45 (Nov 19)
    expect(sender.sent).toEqual([]);
  });
});
