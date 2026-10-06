import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSetupToken } from '../src/auth.js';
import { runSeed } from '../src/seed.js';
import type { DayView, HistoryView } from '../src/views.js';
import { closeDb, cookieHeader, db, goalId, login, makeApp, migrateOnce, resetDb, userId } from './helpers.js';

// Saturday Oct 10 2026, noon in Toronto → challenge day 5.
const NOW = () => new Date('2026-10-10T16:00:00Z');

let app: FastifyInstance;

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

async function put(cookie: string, date: string, entries: unknown[]) {
  return app.inject({ method: 'PUT', url: `/api/checkins/${date}`, headers: cookieHeader(cookie), payload: { entries } });
}

const goalOf = (view: DayView, slug: string, key: string) => {
  const user = view.users.find((u) => u.slug === slug);
  const goal = user?.goals.find((g) => g.key === key);
  if (!goal) throw new Error(`goal ${slug}/${key} missing`);
  return goal;
};

describe('GET /health', () => {
  it('returns ok with db true', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, db: true });
  });
});

describe('auth', () => {
  it('rejects /api/* without a cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/today' });
    expect(res.statusCode).toBe(401);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('unauthenticated');
  });

  it('rejects a tampered cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: cookieHeader('nope.bad') });
    expect(res.statusCode).toBe(401);
  });

  it('setup link sets a cookie that works, and the token cannot be reused', async () => {
    const token = await createSetupToken(db, await userId('enes'));
    const res = await app.inject({ method: 'GET', url: `/setup/${token}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('hx_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=31536000');
    expect(setCookie).not.toContain('Secure'); // not production

    const cookie = res.cookies.find((c) => c.name === 'hx_session');
    expect(cookie).toBeDefined();
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: cookieHeader(cookie!.value) });
    expect(me.statusCode).toBe(200);
    expect(json(me)).toEqual({ user: { id: 1, slug: 'enes', name: 'Enes' } });

    const again = await app.inject({ method: 'GET', url: `/setup/${token}` });
    expect(again.statusCode).toBe(404);
    expect(again.headers['content-type']).toContain('text/html');
    expect(again.body).toContain('This link is invalid or already used.');
  });

  it('unknown token → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/setup/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('logout deletes the session and clears the cookie', async () => {
    const cookie = await login(app, 'enes');
    const out = await app.inject({ method: 'POST', url: '/api/logout', headers: cookieHeader(cookie) });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/hx_session=;/);
    const after = await app.inject({ method: 'GET', url: '/api/me', headers: cookieHeader(cookie) });
    expect(after.statusCode).toBe(401);
    expect(await db.selectFrom('sessions').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).toEqual({ n: '0' });
  });

  it('an expired session is rejected', async () => {
    const cookie = await login(app, 'enes');
    await db.updateTable('sessions').set({ expires_at: new Date('2020-01-01T00:00:00Z') }).execute();
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: cookieHeader(cookie) });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/today', () => {
  it('returns both users, me first, with active goals only', async () => {
    const cookie = await login(app, 'agnes');
    const res = await app.inject({ method: 'GET', url: '/api/today', headers: cookieHeader(cookie) });
    expect(res.statusCode).toBe(200);
    const view = json<DayView>(res);
    expect(view.date).toBe('2026-10-10');
    expect(view.today).toBe('2026-10-10');
    expect(view.day).toBe(5);
    expect(view.challenge).toEqual({ name: 'Hydrox 45', startDate: '2026-10-06', lengthDays: 45 });
    expect(view.users.map((u) => [u.slug, u.isMe])).toEqual([
      ['agnes', true],
      ['enes', false],
    ]);
    const enes = view.users[1]!;
    expect(enes.goals.map((g) => g.key)).toEqual(['walk', 'kcal', 'protein', 'steps']); // strength inactive
    const kcal = enes.goals[1]!;
    expect(kcal).toMatchObject({
      kind: 'number',
      unit: 'kcal',
      direction: 'at_most',
      dailyTarget: 1600,
      weeklyTarget: null,
      value: null,
      hit: null,
      weekCount: null,
      source: 'manual',
    });
    expect(enes.goals[3]).toMatchObject({ key: 'steps', source: 'health_steps', dailyTarget: 8000, value: null });
    const f45 = view.users[0]!.goals[0]!;
    expect(f45).toMatchObject({ key: 'f45', kind: 'bool', weeklyTarget: 3, value: null, hit: null, weekCount: 0 });
    // Phase 2 fields are present with empty history.
    expect(enes.streak).toEqual({ current: 0, best: 0, graceUsed: false });
    expect(enes.totalCheckins).toBe(0);
    expect(enes.cheers).toEqual([]);
    // Phase 3: nothing imported yet.
    expect(enes.health).toBeNull();
  });

  it('day boundary: 23:59 Toronto on Oct 6 is still day 1; 00:00 is day 2', async () => {
    await app.close();
    app = await makeApp({ now: () => new Date('2026-10-07T03:59:00Z') });
    let cookie = await login(app, 'enes');
    let view = json<DayView>(await app.inject({ method: 'GET', url: '/api/today', headers: cookieHeader(cookie) }));
    expect(view.date).toBe('2026-10-06');
    expect(view.day).toBe(1);

    await app.close();
    app = await makeApp({ now: () => new Date('2026-10-07T04:00:00Z') });
    cookie = await login(app, 'enes');
    view = json<DayView>(await app.inject({ method: 'GET', url: '/api/today', headers: cookieHeader(cookie) }));
    expect(view.date).toBe('2026-10-07');
    expect(view.day).toBe(2);
  });
});

describe('GET /api/days/:date', () => {
  it('rejects malformed and impossible dates with bad_request', async () => {
    const cookie = await login(app, 'enes');
    for (const bad of ['2026-02-30', 'yesterday', '2026-10-6']) {
      const res = await app.inject({ method: 'GET', url: `/api/days/${bad}`, headers: cookieHeader(cookie) });
      expect(res.statusCode, bad).toBe(400);
      expect(json<{ error: { code: string } }>(res).error.code).toBe('bad_request');
    }
  });

  it('rejects a future date', async () => {
    const cookie = await login(app, 'enes');
    const res = await app.inject({ method: 'GET', url: '/api/days/2026-10-11', headers: cookieHeader(cookie) });
    expect(res.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('future_date');
  });

  it('returns a day before the start with day <= 0', async () => {
    const cookie = await login(app, 'enes');
    const res = await app.inject({ method: 'GET', url: '/api/days/2026-10-05', headers: cookieHeader(cookie) });
    expect(res.statusCode).toBe(200);
    expect(json<DayView>(res).day).toBe(0);
  });
});

describe('PUT /api/checkins/:date', () => {
  it('upserts, overwrites, stores booleans as 1/0, clears with null, and computes hit', async () => {
    const cookie = await login(app, 'enes');
    const walk = await goalId('enes', 'walk');
    const kcal = await goalId('enes', 'kcal');
    const protein = await goalId('enes', 'protein');

    let res = await put(cookie, '2026-10-10', [
      { goalId: walk, value: true },
      { goalId: kcal, value: 1700 },
      { goalId: protein, value: 160 },
    ]);
    expect(res.statusCode).toBe(200);
    let view = json<DayView>(res);
    expect(view.date).toBe('2026-10-10');
    expect(view.users[0]!.isMe).toBe(true);
    expect(goalOf(view, 'enes', 'walk')).toMatchObject({ value: 1, hit: true });
    expect(goalOf(view, 'enes', 'kcal')).toMatchObject({ value: 1700, hit: false });
    expect(goalOf(view, 'enes', 'protein')).toMatchObject({ value: 160, hit: true });

    // Overwrite + boolean false
    res = await put(cookie, '2026-10-10', [
      { goalId: walk, value: false },
      { goalId: kcal, value: 1550.5 },
      { goalId: protein, value: 120 },
    ]);
    expect(res.statusCode).toBe(200);
    view = json<DayView>(res);
    expect(goalOf(view, 'enes', 'walk')).toMatchObject({ value: 0, hit: false });
    expect(goalOf(view, 'enes', 'kcal')).toMatchObject({ value: 1550.5, hit: true });
    expect(goalOf(view, 'enes', 'protein')).toMatchObject({ value: 120, hit: false });

    const rows = await db.selectFrom('checkins').select(['goal_id', 'value']).orderBy('goal_id').execute();
    expect(rows).toEqual([
      { goal_id: walk, value: '0' },
      { goal_id: kcal, value: '1550.5' },
      { goal_id: protein, value: '120' },
    ]);

    // Clear one entry
    res = await put(cookie, '2026-10-10', [{ goalId: kcal, value: null }]);
    view = json<DayView>(res);
    expect(goalOf(view, 'enes', 'kcal')).toMatchObject({ value: null, hit: null });
    expect(goalOf(view, 'enes', 'walk')).toMatchObject({ value: 0 }); // untouched
    expect(await db.selectFrom('checkins').select('goal_id').execute()).toHaveLength(2);

    // Visible to the partner too
    const partner = await login(app, 'agnes');
    const theirs = json<DayView>(await app.inject({ method: 'GET', url: '/api/today', headers: cookieHeader(partner) }));
    expect(theirs.users.map((u) => u.slug)).toEqual(['agnes', 'enes']);
    expect(goalOf(theirs, 'enes', 'protein')).toMatchObject({ value: 120, hit: false });
  });

  it('backfills a past day', async () => {
    const cookie = await login(app, 'enes');
    const walk = await goalId('enes', 'walk');
    const res = await put(cookie, '2026-10-06', [{ goalId: walk, value: true }]);
    expect(res.statusCode).toBe(200);
    const view = json<DayView>(res);
    expect(view.date).toBe('2026-10-06');
    expect(view.day).toBe(1);
    expect(view.today).toBe('2026-10-10');
    expect(goalOf(view, 'enes', 'walk')).toMatchObject({ value: 1, hit: true });
    const today = json<DayView>(await app.inject({ method: 'GET', url: '/api/today', headers: cookieHeader(cookie) }));
    expect(goalOf(today, 'enes', 'walk').value).toBeNull();
  });

  it('rejects future dates, dates before start, and other users’ or inactive goals', async () => {
    const cookie = await login(app, 'enes');
    const walk = await goalId('enes', 'walk');
    const codeOf = (res: { body: string }) => json<{ error: { code: string } }>(res).error.code;

    let res = await put(cookie, '2026-10-11', [{ goalId: walk, value: true }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('future_date');

    res = await put(cookie, '2026-10-05', [{ goalId: walk, value: true }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('before_start');

    res = await put(cookie, '2026-10-10', [{ goalId: await goalId('agnes', 'f45'), value: true }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('not_your_goal');

    res = await put(cookie, '2026-10-10', [{ goalId: await goalId('enes', 'strength'), value: true }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('not_your_goal');

    res = await put(cookie, '2026-10-10', [{ goalId: 99999, value: true }]);
    expect(codeOf(res)).toBe('not_your_goal');

    // A Health-filled goal is never entered by hand (Phase 3).
    res = await put(cookie, '2026-10-10', [
      { goalId: walk, value: true },
      { goalId: await goalId('enes', 'steps'), value: 9000 },
    ]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('auto_goal');
    expect(res.body).toContain('Apple Health');

    expect(await db.selectFrom('checkins').select('goal_id').execute()).toHaveLength(0);
  });

  it('validates the body', async () => {
    const cookie = await login(app, 'enes');
    const walk = await goalId('enes', 'walk');
    const codeOf = (res: { body: string }) => json<{ error: { code: string } }>(res).error.code;

    let res = await put(cookie, '2026-10-10', [{ goalId: walk, value: 'yes' }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');

    res = await put(cookie, '2026-10-10', [{ goalId: 'walk', value: 1 }]);
    expect(res.statusCode).toBe(400);

    res = await app.inject({ method: 'PUT', url: '/api/checkins/2026-10-10', headers: cookieHeader(cookie), payload: {} });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');

    res = await app.inject({
      method: 'PUT',
      url: '/api/checkins/2026-10-10',
      headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');

    res = await put(cookie, '2026-02-30', [{ goalId: walk, value: true }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
  });
});

describe('weekly goals', () => {
  it('weekCount counts hits in the Mon–Sun week containing the date', async () => {
    await app.close();
    app = await makeApp({ now: () => new Date('2026-10-14T16:00:00Z') }); // Wed Oct 14
    const cookie = await login(app, 'agnes');
    const f45 = await goalId('agnes', 'f45');

    // Week 1 (Mon Oct 5 – Sun Oct 11): hits on Tue 6, Thu 8, Sat 10; a miss on Fri 9.
    for (const d of ['2026-10-06', '2026-10-08', '2026-10-10']) {
      expect((await put(cookie, d, [{ goalId: f45, value: true }])).statusCode).toBe(200);
    }
    await put(cookie, '2026-10-09', [{ goalId: f45, value: false }]);
    // Week 2 (Mon Oct 12 – Sun Oct 18): one hit on Tue 13.
    await put(cookie, '2026-10-13', [{ goalId: f45, value: true }]);

    const day = async (d: string) =>
      json<DayView>(await app.inject({ method: 'GET', url: `/api/days/${d}`, headers: cookieHeader(cookie) }));

    expect(goalOf(await day('2026-10-10'), 'agnes', 'f45')).toMatchObject({ value: 1, hit: true, weekCount: 3, weeklyTarget: 3 });
    expect(goalOf(await day('2026-10-09'), 'agnes', 'f45')).toMatchObject({ value: 0, hit: false, weekCount: 3 });
    expect(goalOf(await day('2026-10-11'), 'agnes', 'f45')).toMatchObject({ value: null, hit: null, weekCount: 3 });
    expect(goalOf(await day('2026-10-12'), 'agnes', 'f45')).toMatchObject({ value: null, weekCount: 1 });
    expect(goalOf(await day('2026-10-13'), 'agnes', 'f45')).toMatchObject({ value: 1, weekCount: 1 });
    expect(goalOf(await day('2026-10-14'), 'agnes', 'f45')).toMatchObject({ value: null, weekCount: 1 });
    // Non-weekly goals report null.
    expect(goalOf(await day('2026-10-14'), 'agnes', 'kcal').weekCount).toBeNull();
  });
});

describe('GET /api/history', () => {
  it('returns startDate..today newest first with hit/total/entered per user', async () => {
    const cookie = await login(app, 'enes');
    const walk = await goalId('enes', 'walk');
    const kcal = await goalId('enes', 'kcal');
    const protein = await goalId('enes', 'protein');
    const partnerCookie = await login(app, 'agnes');
    const f45 = await goalId('agnes', 'f45');

    await put(cookie, '2026-10-06', [
      { goalId: walk, value: true },
      { goalId: kcal, value: 1500 },
      { goalId: protein, value: 170 },
    ]);
    await put(cookie, '2026-10-08', [
      { goalId: walk, value: false },
      { goalId: kcal, value: 1900 },
    ]);
    await put(partnerCookie, '2026-10-10', [{ goalId: f45, value: true }]);

    const res = await app.inject({ method: 'GET', url: '/api/history', headers: cookieHeader(cookie) });
    expect(res.statusCode).toBe(200);
    const view = json<HistoryView>(res);
    expect(view.today).toBe('2026-10-10');
    expect(view.challenge.startDate).toBe('2026-10-06');
    expect(view.users.map((u) => [u.slug, u.isMe])).toEqual([
      ['enes', true],
      ['agnes', false],
    ]);
    expect(view.days.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06']);
    expect(view.days.map((d) => d.day)).toEqual([5, 4, 3, 2, 1]);

    const enesId = await userId('enes');
    const partnerId = await userId('agnes');
    const byDate = Object.fromEntries(view.days.map((d) => [d.date, d]));
    expect(byDate['2026-10-06']!.users).toEqual([
      { userId: enesId, hit: 3, total: 4, entered: true },
      { userId: partnerId, hit: 0, total: 5, entered: false },
    ]);
    expect(byDate['2026-10-08']!.users[0]).toEqual({ userId: enesId, hit: 0, total: 4, entered: true });
    expect(byDate['2026-10-07']!.users[0]).toEqual({ userId: enesId, hit: 0, total: 4, entered: false });
    expect(byDate['2026-10-10']!.users[1]).toEqual({ userId: partnerId, hit: 1, total: 5, entered: true });
  });

  it('clamps from/to to [startDate, today] and validates them', async () => {
    const cookie = await login(app, 'enes');
    let res = await app.inject({
      method: 'GET',
      url: '/api/history?from=2026-09-01&to=2026-12-31',
      headers: cookieHeader(cookie),
    });
    expect(res.statusCode).toBe(200);
    expect(json<HistoryView>(res).days).toHaveLength(5);

    res = await app.inject({ method: 'GET', url: '/api/history?from=2026-10-08&to=2026-10-09', headers: cookieHeader(cookie) });
    expect(json<HistoryView>(res).days.map((d) => d.date)).toEqual(['2026-10-09', '2026-10-08']);

    res = await app.inject({ method: 'GET', url: '/api/history?from=2026-10-09&to=2026-10-08', headers: cookieHeader(cookie) });
    expect(json<HistoryView>(res).days).toEqual([]);

    res = await app.inject({ method: 'GET', url: '/api/history?from=2026-02-30', headers: cookieHeader(cookie) });
    expect(res.statusCode).toBe(400);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('bad_request');
  });

  it('is empty before the challenge starts', async () => {
    await app.close();
    app = await makeApp({ now: () => new Date('2026-10-01T16:00:00Z') });
    const cookie = await login(app, 'enes');
    const res = await app.inject({ method: 'GET', url: '/api/history', headers: cookieHeader(cookie) });
    expect(json<HistoryView>(res).days).toEqual([]);
  });
});

describe('seed', () => {
  it('is idempotent', async () => {
    const counts = async () => {
      const [u, c, g] = await Promise.all([
        db.selectFrom('users').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow(),
        db.selectFrom('challenges').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow(),
        db.selectFrom('goals').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow(),
      ]);
      return { users: Number(u.n), challenges: Number(c.n), goals: Number(g.n) };
    };
    const before = await counts();
    expect(before).toEqual({ users: 2, challenges: 1, goals: 10 });
    const ids = await db.selectFrom('goals').select(['id', 'key', 'user_id']).orderBy('id').execute();
    await runSeed(db);
    await runSeed(db);
    expect(await counts()).toEqual(before);
    expect(await db.selectFrom('goals').select(['id', 'key', 'user_id']).orderBy('id').execute()).toEqual(ids);
    const strength = await db.selectFrom('goals').select(['active', 'unit', 'daily_target', 'source']).where('key', '=', 'strength').executeTakeFirstOrThrow();
    expect(strength).toEqual({ active: false, unit: null, daily_target: null, source: 'manual' });
    // `source` is read from the seed file (default manual).
    const sources = await db.selectFrom('goals').select('source').where('key', '=', 'steps').execute();
    expect(sources).toEqual([{ source: 'health_steps' }, { source: 'health_steps' }]);
  });
});

describe('404s', () => {
  it('unknown /api route returns JSON not_found (after auth)', async () => {
    const cookie = await login(app, 'enes');
    const res = await app.inject({ method: 'GET', url: '/api/nothing', headers: cookieHeader(cookie) });
    expect(res.statusCode).toBe(404);
    expect(json<{ error: { code: string } }>(res).error.code).toBe('not_found');
  });
});
