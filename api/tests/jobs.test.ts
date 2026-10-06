import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleCheer, handleEveningReminder, handlePartnerCheckin, runJob } from '../src/push/jobs.js';
import { upsertSubscription } from '../src/push/subscriptions.js';
import { FakeSender, closeDb, cookieHeader, db, goalId, login, makeApp, migrateOnce, resetDb, subscription, userId } from './helpers.js';

// Saturday Oct 10 2026, 21:00 Toronto (EDT) → challenge day 5.
const NOW = new Date('2026-10-11T01:00:00Z');

let app: Awaited<ReturnType<typeof makeApp>>;
let sender: FakeSender;

beforeAll(async () => {
  await migrateOnce();
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  sender = new FakeSender();
  app = await makeApp({ now: () => NOW, sender });
  await upsertSubscription(db, await userId('enes'), subscription('https://push.example/enes'));
  await upsertSubscription(db, await userId('agnes'), subscription('https://push.example/agnes-phone'));
  await upsertSubscription(db, await userId('agnes'), subscription('https://push.example/agnes-watch'));
});
afterEach(async () => {
  await app.close();
});

async function checkin(cookie: string, date: string, entries: unknown[]) {
  const res = await app.inject({ method: 'PUT', url: `/api/checkins/${date}`, headers: cookieHeader(cookie), payload: { entries } });
  expect(res.statusCode).toBe(200);
}

describe('evening-reminder', () => {
  it('nudges only users with no entry today', async () => {
    const enes = await login(app, 'enes');
    await checkin(enes, '2026-10-10', [{ goalId: await goalId('enes', 'walk'), value: true }]);
    // Agnes logged yesterday only.
    const agnes = await login(app, 'agnes');
    await checkin(agnes, '2026-10-09', [{ goalId: await goalId('agnes', 'f45'), value: true }]);

    await handleEveningReminder(db, sender, NOW);
    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example/agnes-phone', 'https://push.example/agnes-watch']);
    expect(sender.sent[0]!.payload).toEqual({
      title: 'Hydrox 45',
      body: 'Day 5 of 45 — nothing logged yet. 30 seconds?',
      url: '/',
      tag: 'reminder-2026-10-10',
    });
  });

  it('nudges both when neither logged; nobody when both did; is silent outside the challenge', async () => {
    await handleEveningReminder(db, sender, NOW);
    expect(sender.sent).toHaveLength(3);

    sender.sent = [];
    const enes = await login(app, 'enes');
    const agnes = await login(app, 'agnes');
    await checkin(enes, '2026-10-10', [{ goalId: await goalId('enes', 'kcal'), value: 1500 }]);
    await checkin(agnes, '2026-10-10', [{ goalId: await goalId('agnes', 'practice'), value: false }]);
    await handleEveningReminder(db, sender, NOW);
    expect(sender.sent).toEqual([]);

    await handleEveningReminder(db, sender, new Date('2026-10-05T23:00:00Z')); // day 0
    await handleEveningReminder(db, sender, new Date('2026-11-21T01:00:00Z')); // day 46
    expect(sender.sent).toEqual([]);
  });
});

describe('partner-checkin', () => {
  it('is enqueued only when today goes from no entries to some entries', async () => {
    const enes = await login(app, 'enes');
    const walk = await goalId('enes', 'walk');
    const kcal = await goalId('enes', 'kcal');
    const enesId = await userId('enes');

    // Backfilling a past day never notifies.
    await checkin(enes, '2026-10-08', [{ goalId: walk, value: true }]);
    expect(app.jobs!.enqueued).toEqual([]);

    // Clearing a value on an empty day: still nothing.
    await checkin(enes, '2026-10-10', [{ goalId: walk, value: null }]);
    expect(app.jobs!.enqueued).toEqual([]);

    // First entry of today → one job.
    await checkin(enes, '2026-10-10', [{ goalId: walk, value: true }]);
    expect(app.jobs!.enqueued).toEqual([{ name: 'partner-checkin', data: { userId: enesId, date: '2026-10-10' } }]);

    // Adding or editing later does not repeat it.
    await checkin(enes, '2026-10-10', [{ goalId: kcal, value: 1500 }]);
    await checkin(enes, '2026-10-10', [{ goalId: walk, value: false }]);
    expect(app.jobs!.enqueued).toHaveLength(1);

    // Clear everything, then log again → fires again (the day went empty → non-empty once more).
    await checkin(enes, '2026-10-10', [
      { goalId: walk, value: null },
      { goalId: kcal, value: null },
    ]);
    await checkin(enes, '2026-10-10', [{ goalId: kcal, value: 1400 }]);
    expect(app.jobs!.enqueued).toHaveLength(2);

    // Partner logging her first entry notifies too (with her id).
    const agnes = await login(app, 'agnes');
    await checkin(agnes, '2026-10-10', [{ goalId: await goalId('agnes', 'f45'), value: true }]);
    expect(app.jobs!.enqueued[2]).toEqual({ name: 'partner-checkin', data: { userId: await userId('agnes'), date: '2026-10-10' } });
  });

  it('handler notifies the partner’s devices with the day number', async () => {
    await handlePartnerCheckin(db, sender, NOW, { userId: await userId('enes'), date: '2026-10-10' });
    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example/agnes-phone', 'https://push.example/agnes-watch']);
    expect(sender.sent[0]!.payload).toEqual({
      title: 'Hydrox 45',
      body: 'Enes checked in for Day 5',
      url: '/day/2026-10-10',
      tag: `checkin-${await userId('enes')}-2026-10-10`,
    });

    sender.sent = [];
    await runJob(db, sender, NOW, 'partner-checkin', { userId: await userId('agnes'), date: '2026-10-08' });
    expect(sender.sent.map((s) => s.endpoint)).toEqual(['https://push.example/enes']);
    expect(sender.sent[0]!.payload.body).toBe('Agnes checked in for Day 3');

    // Unknown user: nothing, no throw.
    sender.sent = [];
    await handlePartnerCheckin(db, sender, NOW, { userId: 999, date: '2026-10-10' });
    expect(sender.sent).toEqual([]);
  });
});

describe('cheer', () => {
  it('payload includes the emoji and the note, and goes to the receiver only', async () => {
    const enes = await login(app, 'enes');
    const agnesId = await userId('agnes');
    const res = await app.inject({
      method: 'POST',
      url: '/api/cheers',
      headers: cookieHeader(enes),
      payload: { toUserId: agnesId, date: '2026-10-08', emoji: '👏', note: 'Great class!' },
    });
    expect(res.statusCode).toBe(201);
    const { id } = JSON.parse(res.body) as { id: number };
    expect(app.jobs!.enqueued).toEqual([{ name: 'cheer', data: { cheerId: id } }]);

    await handleCheer(db, sender, NOW, { cheerId: id });
    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example/agnes-phone', 'https://push.example/agnes-watch']);
    expect(sender.sent[0]!.payload).toEqual({
      title: 'Hydrox 45',
      body: 'Enes cheered your Day 3 👏 — Great class!',
      url: '/day/2026-10-08',
      tag: `cheer-${id}`,
    });

    // Without a note: just the headline. Deleted cheer: nothing.
    sender.sent = [];
    const res2 = await app.inject({ method: 'POST', url: '/api/cheers', headers: cookieHeader(enes), payload: { toUserId: agnesId, date: '2026-10-10', emoji: '🔥' } });
    const second = JSON.parse(res2.body) as { id: number };
    await runJob(db, sender, NOW, 'cheer', { cheerId: second.id });
    expect(sender.sent[0]!.payload.body).toBe('Enes cheered your Day 5 🔥');
    sender.sent = [];
    await handleCheer(db, sender, NOW, { cheerId: 9999 });
    expect(sender.sent).toEqual([]);
  });
});
