import type { InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ImportResult, ImportStatus } from '../src/import.js';
import type { DayView } from '../src/views.js';
import { closeDb, cookieHeader, db, goalId, login, makeApp, migrateOnce, resetDb, userId } from './helpers.js';

// Saturday Oct 10 2026, noon in Toronto → challenge day 5.
const NOW = () => new Date('2026-10-10T16:00:00Z');

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

async function createToken(cookie: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/import/token', headers: cookieHeader(cookie) });
  expect(res.statusCode).toBe(201);
  return json<{ token: string }>(res).token;
}

async function post(token: string | null, payload: NonNullable<InjectOptions['payload']>, extraHeaders: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/import',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    payload,
  });
}

const status = async (cookie: string) =>
  json<ImportStatus>(await app.inject({ method: 'GET', url: '/api/import/status', headers: cookieHeader(cookie) }));

const todayView = async (cookie: string) =>
  json<DayView>(await app.inject({ method: 'GET', url: '/api/today', headers: cookieHeader(cookie) }));

describe('import tokens', () => {
  it('status starts empty; a token is 32 random bytes base64url, shown once', async () => {
    const enes = await login(app, 'enes');
    expect(await status(enes)).toEqual({ hasToken: false, createdAt: null, lastUsedAt: null, lastImport: null });

    const token = await createToken(enes);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes → 43 base64url chars
    const after = await status(enes);
    expect(after.hasToken).toBe(true);
    expect(after.createdAt).toBe(NOW().toISOString());
    expect(after.lastUsedAt).toBeNull();
    expect(after.lastImport).toBeNull();
  });

  it('rejects a missing, malformed, unknown or revoked bearer token with 401 bad_token; the cookie does not count', async () => {
    const enes = await login(app, 'enes');
    for (const res of [
      await post(null, { steps: 1 }),
      await post('not-a-real-token', { steps: 1 }),
      await post(null, { steps: 1 }, { authorization: 'Basic abc' }),
      await post(null, { steps: 1 }, cookieHeader(enes)),
    ]) {
      expect(res.statusCode).toBe(401);
      expect(codeOf(res)).toBe('bad_token');
    }

    const token = await createToken(enes);
    expect((await post(token, { steps: 100 })).statusCode).toBe(200);
    const del = await app.inject({ method: 'DELETE', url: '/api/import/token', headers: cookieHeader(enes) });
    expect(del.statusCode).toBe(204);
    const revoked = await post(token, { steps: 200 });
    expect(revoked.statusCode).toBe(401);
    expect(codeOf(revoked)).toBe('bad_token');
    expect((await status(enes)).hasToken).toBe(false);
  });

  it('rotation revokes the previous token and keeps exactly one active', async () => {
    const enes = await login(app, 'enes');
    const first = await createToken(enes);
    const second = await createToken(enes);
    expect(second).not.toBe(first);
    expect((await post(first, { steps: 1 })).statusCode).toBe(401);
    expect((await post(second, { steps: 1 })).statusCode).toBe(200);
    const rows = await db.selectFrom('import_tokens').select(['token', 'revoked_at']).orderBy('created_at').execute();
    expect(rows.map((r) => [r.token === first, r.revoked_at !== null])).toEqual([
      [true, true],
      [false, false],
    ]);
  });

  it('token routes need the session cookie', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/import/status' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/import/token' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/import/token' })).statusCode).toBe(401);
  });
});

describe('POST /api/import', () => {
  it('upserts health_daily, fills the linked steps goal, coerces numeric strings and reports in /api/today', async () => {
    const enes = await login(app, 'enes');
    const token = await createToken(enes);

    const res = await post(token, { steps: '8421', activeKcal: '512.5' });
    expect(res.statusCode).toBe(200);
    expect(json<ImportResult>(res)).toEqual({ date: '2026-10-10', steps: 8421, activeKcal: 512.5, goalsUpdated: 1 });

    const row = await db.selectFrom('health_daily').selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ user_id: await userId('enes'), date: '2026-10-10', steps: 8421, active_kcal: '512.5', source: 'shortcut' });

    const steps = await goalId('enes', 'steps');
    expect(await db.selectFrom('checkins').select(['goal_id', 'value']).execute()).toEqual([{ goal_id: steps, value: '8421' }]);

    const view = await todayView(enes);
    const me = view.users[0]!;
    expect(me.health).toEqual({ steps: 8421, activeKcal: 512.5 });
    expect(me.goals.find((g) => g.key === 'steps')).toMatchObject({ value: 8421, hit: true, source: 'health_steps' });
    expect(view.users[1]!.health).toBeNull();

    // Later the same day: last write wins; an absent field keeps its stored value.
    const again = await post(token, { steps: 12000 });
    expect(json<ImportResult>(again)).toEqual({ date: '2026-10-10', steps: 12000, activeKcal: 512.5, goalsUpdated: 1 });
    expect((await todayView(enes)).users[0]!.goals.find((g) => g.key === 'steps')!.value).toBe(12000);

    // Thousands separators and float-ish counts from Shortcuts are coerced; only activeKcal → no goal to fill.
    const kcalOnly = await post(token, { date: '2026-10-09', activeKcal: '1,034.2' });
    expect(json<ImportResult>(kcalOnly)).toEqual({ date: '2026-10-09', steps: null, activeKcal: 1034.2, goalsUpdated: 0 });
    const floaty = await post(token, { date: '2026-10-08', steps: '7999.6' });
    expect(json<ImportResult>(floaty).steps).toBe(8000);

    // A goal with source health_active_kcal is filled from activeKcal.
    await db
      .insertInto('goals')
      .values({ user_id: await userId('enes'), key: 'active', label: 'Active energy', kind: 'number', unit: 'kcal', direction: 'at_least', daily_target: 400, weekly_target: null, sort: 10, source: 'health_active_kcal' })
      .execute();
    const both = await post(token, { steps: 9000, activeKcal: 450 });
    expect(json<ImportResult>(both).goalsUpdated).toBe(2);
    const active = (await todayView(enes)).users[0]!.goals.find((g) => g.key === 'active')!;
    expect(active).toMatchObject({ value: 450, hit: true, source: 'health_active_kcal' });
  });

  it('validates the body and the date range', async () => {
    const enes = await login(app, 'enes');
    const token = await createToken(enes);
    for (const bad of [{}, { steps: -1 }, { steps: 'lots' }, { activeKcal: -5 }, { date: '2026-10-9', steps: 1 }, { date: '2026-02-30', steps: 1 }]) {
      const res = await post(token, bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(codeOf(res)).toBe('bad_request');
    }
    let res = await post(token, { date: '2026-10-11', steps: 1 });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('future_date');
    res = await post(token, { date: '2026-10-05', steps: 1 });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('before_start');
    expect(await db.selectFrom('health_daily').select('date').execute()).toEqual([]);
    expect((await status(enes)).lastUsedAt).toBeNull(); // nothing imported, so the token was not "used"
  });

  it('status reflects lastUsedAt and the most recent import', async () => {
    const enes = await login(app, 'enes');
    const token = await createToken(enes);
    await post(token, { date: '2026-10-08', steps: 5000 });
    await post(token, { steps: 7000, activeKcal: 300 });
    const s = await status(enes);
    expect(s.hasToken).toBe(true);
    expect(s.lastUsedAt).toBe(NOW().toISOString());
    expect(s.lastImport).toEqual({ date: '2026-10-10', steps: 7000, activeKcal: 300 });
    // The partner's status is untouched.
    const agnes = await login(app, 'agnes');
    expect(await status(agnes)).toEqual({ hasToken: false, createdAt: null, lastUsedAt: null, lastImport: null });
  });

  it('the first import of today enqueues partner-checkin; a second does not; backfills never do', async () => {
    const enes = await login(app, 'enes');
    const token = await createToken(enes);
    const enesId = await userId('enes');

    await post(token, { date: '2026-10-09', steps: 4000 });
    expect(app.jobs!.enqueued).toEqual([]);

    await post(token, { steps: 8000 });
    expect(app.jobs!.enqueued).toEqual([{ name: 'partner-checkin', data: { userId: enesId, date: '2026-10-10' } }]);

    await post(token, { steps: 9000, activeKcal: 500 });
    expect(app.jobs!.enqueued).toHaveLength(1);

    // A manual entry after the import does not fire again either (the day was already non-empty).
    const walk = await goalId('enes', 'walk');
    const res = await app.inject({ method: 'PUT', url: '/api/checkins/2026-10-10', headers: cookieHeader(enes), payload: { entries: [{ goalId: walk, value: true }] } });
    expect(res.statusCode).toBe(200);
    expect(app.jobs!.enqueued).toHaveLength(1);
  });
});
