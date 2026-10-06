import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleMilestone, runJob } from '../src/push/jobs.js';
import { upsertSubscription } from '../src/push/subscriptions.js';
import { finishLinePushBody, milestonePushBody, milestonesFor, type TeamView } from '../src/team.js';
import { FakeSender, closeDb, cookieHeader, db, goalId, login, makeApp, migrateOnce, resetDb, subscription, userId } from './helpers.js';

// Tuesday Oct 20 2026 → challenge day 15 (a milestone day).
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

async function checkin(cookie: string, date: string, entries: unknown[]) {
  const res = await app.inject({ method: 'PUT', url: `/api/checkins/${date}`, headers: cookieHeader(cookie), payload: { entries } });
  expect(res.statusCode, res.body).toBe(200);
}

/** Enes logs 5 days, Agnes 3 (one of hers before the start, which never counts). */
async function seedCheckins() {
  const enes = await login(app, 'enes');
  const agnes = await login(app, 'agnes');
  const walk = await goalId('enes', 'walk');
  const f45 = await goalId('agnes', 'f45');
  for (const d of ['2026-10-06', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-20']) await checkin(enes, d, [{ goalId: walk, value: true }]);
  for (const d of ['2026-10-06', '2026-10-08', '2026-10-13']) await checkin(agnes, d, [{ goalId: f45, value: false }]);
  await db.insertInto('checkins').values({ user_id: await userId('agnes'), date: '2026-10-01', goal_id: f45, value: 1 }).execute();
  return { enes, agnes };
}

describe('GET /api/team', () => {
  it('ring = both users’ checked-in days over 2 × lengthDays; milestones at 7/15/30/45 with reached/isToday', async () => {
    const { agnes } = await seedCheckins();
    const res = await app.inject({ method: 'GET', url: '/api/team', headers: cookieHeader(agnes) });
    expect(res.statusCode).toBe(200);
    const view = json<TeamView>(res);
    expect(view).toEqual({
      today: '2026-10-20',
      day: 15,
      challenge: CHALLENGE,
      ring: { done: 8, target: 90 },
      perUser: [
        { userId: await userId('agnes'), name: 'Agnes', isMe: true, checkins: 3 },
        { userId: await userId('enes'), name: 'Enes', isMe: false, checkins: 5 },
      ],
      milestones: [
        { day: 7, date: '2026-10-12', label: 'One week', reached: true, isToday: false },
        { day: 15, date: '2026-10-20', label: 'A third in', reached: true, isToday: true },
        { day: 30, date: '2026-11-04', label: 'Two thirds', reached: false, isToday: false },
        { day: 45, date: '2026-11-19', label: 'Finish line', reached: false, isToday: false },
      ],
    });
  });

  it('is empty before the challenge and complete after it', async () => {
    expect(milestonesFor(CHALLENGE, '2026-10-01').map((m) => m.reached)).toEqual([false, false, false, false]);
    expect(milestonesFor(CHALLENGE, '2026-11-19').map((m) => [m.reached, m.isToday])).toEqual([
      [true, false],
      [true, false],
      [true, false],
      [true, true],
    ]);
    expect(milestonesFor(CHALLENGE, '2026-12-01').every((m) => m.reached && !m.isToday)).toBe(true);

    await app.close();
    app = await makeApp({ now: () => new Date('2026-10-01T16:00:00Z') });
    const enes = await login(app, 'enes');
    const view = json<TeamView>(await app.inject({ method: 'GET', url: '/api/team', headers: cookieHeader(enes) }));
    expect(view).toMatchObject({ day: -4, ring: { done: 0, target: 90 } });
    expect(view.perUser.map((u) => u.checkins)).toEqual([0, 0]);
    expect((await app.inject({ method: 'GET', url: '/api/team' })).statusCode).toBe(401);
  });
});

describe('milestone job', () => {
  it('pushes to every subscribed user on day 7 with the team total so far, and stays silent on day 8', async () => {
    await seedCheckins();
    const sender = new FakeSender();
    await upsertSubscription(db, await userId('enes'), subscription('https://push.example/enes'));
    await upsertSubscription(db, await userId('agnes'), subscription('https://push.example/agnes-phone'));
    await upsertSubscription(db, await userId('agnes'), subscription('https://push.example/agnes-watch'));

    // Mon Oct 12 09:00 Toronto = day 7. Logged by then: Enes 6, 7, 9, 12 (4) + Agnes 6, 8 (2) = 6 of 14.
    const day7 = new Date('2026-10-12T13:00:00Z');
    await handleMilestone(db, sender, day7);
    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual([
      'https://push.example/agnes-phone',
      'https://push.example/agnes-watch',
      'https://push.example/enes',
    ]);
    for (const s of sender.sent) {
      expect(s.payload).toEqual({
        title: 'Hydrox 45',
        body: "Day 7 — one week in. Together you've logged 6 of 14 days.",
        url: '/',
        tag: 'milestone-7',
      });
    }
    expect(milestonePushBody(7, 'one week in', 13, 14)).toBe("Day 7 — one week in. Together you've logged 13 of 14 days.");

    sender.sent = [];
    await runJob(db, sender, new Date('2026-10-13T13:00:00Z'), 'milestone', {}); // day 8
    await handleMilestone(db, sender, new Date('2026-10-05T13:00:00Z')); // day 0
    expect(sender.sent).toEqual([]);

    // Day 15 (today in this file): 8 of 30, still opening the home screen.
    await handleMilestone(db, sender, NOW());
    expect(sender.sent[0]!.payload).toMatchObject({ body: "Day 15 — a third in. Together you've logged 8 of 30 days.", url: '/', tag: 'milestone-15' });
    sender.sent = [];
    await handleMilestone(db, sender, new Date('2026-11-04T14:00:00Z')); // day 30
    expect(sender.sent[0]!.payload).toMatchObject({ body: "Day 30 — two thirds in. Together you've logged 8 of 60 days.", url: '/', tag: 'milestone-30' });

    // Day 45: the finish line, out of 90, opening the summary (T15).
    sender.sent = [];
    await handleMilestone(db, sender, new Date('2026-11-19T14:00:00Z'));
    expect(sender.sent).toHaveLength(3);
    expect(sender.sent[0]!.payload).toEqual({
      title: 'Hydrox 45',
      body: 'Day 45 — the finish line. Together you logged 8 of 90 days. Open your summary.',
      url: '/summary',
      tag: 'milestone-45',
    });
    expect(finishLinePushBody(45, 84, 90)).toBe('Day 45 — the finish line. Together you logged 84 of 90 days. Open your summary.');
  });
});
