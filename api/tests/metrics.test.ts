import type { InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MetricsView } from '../src/metrics.js';
import { closeDb, cookieHeader, db, login, makeApp, migrateOnce, resetDb, userId } from './helpers.js';

// Tuesday Oct 20 2026 → challenge day 15.
const NOW = () => new Date('2026-10-20T16:00:00Z');

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

async function put(cookie: string, date: string, payload: NonNullable<InjectOptions['payload']>) {
  return app.inject({ method: 'PUT', url: `/api/metrics/${date}`, headers: cookieHeader(cookie), payload });
}
async function get(cookie: string, qs = '') {
  return json<MetricsView>(await app.inject({ method: 'GET', url: `/api/metrics${qs}`, headers: cookieHeader(cookie) }));
}
const mine = (v: MetricsView) => v.series.find((s) => s.isMe)!;
const theirs = (v: MetricsView) => v.series.find((s) => !s.isMe)!;

describe('GET /api/metrics', () => {
  it('returns both series, me first, shared by default, empty when nothing is entered', async () => {
    const enes = await login(app, 'enes');
    const view = await get(enes);
    expect(view.today).toBe('2026-10-20');
    expect(view.challenge.startDate).toBe('2026-10-06');
    expect(view.series.map((s) => [s.userId, s.name, s.isMe, s.shared])).toEqual([
      [await userId('enes'), 'Enes', true, true],
      [await userId('agnes'), 'Agnes', false, true],
    ]);
    for (const s of view.series) expect(s).toMatchObject({ points: [], latestWeightKg: null, startWeightKg: null });
  });

  it('validates and clamps from/to', async () => {
    const enes = await login(app, 'enes');
    for (const d of ['2026-10-06', '2026-10-10', '2026-10-20']) await put(enes, d, { weightKg: 80 });
    expect((await get(enes, '?from=2026-10-07&to=2026-10-19')).series[0]!.points.map((p) => p.date)).toEqual(['2026-10-10']);
    expect((await get(enes, '?from=2026-01-01&to=2027-01-01')).series[0]!.points).toHaveLength(3);
    const bad = await app.inject({ method: 'GET', url: '/api/metrics?from=2026-13-01', headers: cookieHeader(enes) });
    expect(bad.statusCode).toBe(400);
    expect(codeOf(bad)).toBe('bad_request');
  });
});

describe('PUT /api/metrics/:date', () => {
  it('upserts, keeps omitted fields, clears with null and deletes the row when both are null', async () => {
    const enes = await login(app, 'enes');
    let res = await put(enes, '2026-10-20', { weightKg: 82.4 });
    expect(res.statusCode).toBe(200);
    let view = json<MetricsView>(res);
    expect(mine(view).points).toEqual([{ date: '2026-10-20', weightKg: 82.4, waistCm: null, weightAvg7: 82.4 }]);
    expect(mine(view)).toMatchObject({ latestWeightKg: 82.4, startWeightKg: 82.4 });

    // Omitted weight stays; waist added.
    view = json<MetricsView>(await put(enes, '2026-10-20', { waistCm: 91 }));
    expect(mine(view).points[0]).toEqual({ date: '2026-10-20', weightKg: 82.4, waistCm: 91, weightAvg7: 82.4 });

    // Overwrite weight.
    view = json<MetricsView>(await put(enes, '2026-10-20', { weightKg: 82 }));
    expect(mine(view).points[0]).toMatchObject({ weightKg: 82, waistCm: 91 });
    expect(await db.selectFrom('body_metrics').select(['weight_kg', 'waist_cm']).execute()).toEqual([{ weight_kg: '82', waist_cm: '91' }]);

    // Clear weight only → row stays with waist.
    view = json<MetricsView>(await put(enes, '2026-10-20', { weightKg: null }));
    expect(mine(view).points[0]).toEqual({ date: '2026-10-20', weightKg: null, waistCm: 91, weightAvg7: null });
    expect(mine(view).latestWeightKg).toBeNull();

    // Clear waist too → row deleted.
    view = json<MetricsView>(await put(enes, '2026-10-20', { waistCm: null }));
    expect(mine(view).points).toEqual([]);
    expect(await db.selectFrom('body_metrics').select('date').execute()).toEqual([]);

    // Clearing a day with no row is a no-op 200.
    res = await put(enes, '2026-10-19', { weightKg: null, waistCm: null });
    expect(res.statusCode).toBe(200);
    expect(await db.selectFrom('body_metrics').select('date').execute()).toEqual([]);
  });

  it('weightAvg7 is the mean of entered weights in the 7 days ending on the date, skipping gaps', async () => {
    const enes = await login(app, 'enes');
    // Oct 10, 11, (12 gap), 13, 14, 15, 16 (no weight, waist only), 17 ... then Oct 20.
    await put(enes, '2026-10-10', { weightKg: 84 });
    await put(enes, '2026-10-11', { weightKg: 83 });
    await put(enes, '2026-10-13', { weightKg: 82 });
    await put(enes, '2026-10-14', { weightKg: 81 });
    await put(enes, '2026-10-15', { weightKg: 80 });
    await put(enes, '2026-10-16', { waistCm: 90 });
    await put(enes, '2026-10-17', { weightKg: 79 });
    const view = json<MetricsView>(await put(enes, '2026-10-20', { weightKg: 78 }));
    const byDate = Object.fromEntries(mine(view).points.map((p) => [p.date, p]));
    expect(mine(view).points.map((p) => p.date)).toEqual([
      '2026-10-10', '2026-10-11', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-20',
    ]);
    expect(byDate['2026-10-10']!.weightAvg7).toBe(84);
    expect(byDate['2026-10-11']!.weightAvg7).toBe(83.5);
    expect(byDate['2026-10-13']!.weightAvg7).toBe(83); // 84, 83, 82
    // Oct 16: window Oct 10–16 → 84, 83, 82, 81, 80 (no weight on 16 itself) = 82
    expect(byDate['2026-10-16']).toEqual({ date: '2026-10-16', weightKg: null, waistCm: 90, weightAvg7: 82 });
    // Oct 17: window Oct 11–17 → 83, 82, 81, 80, 79 = 81
    expect(byDate['2026-10-17']!.weightAvg7).toBe(81);
    // Oct 20: window Oct 14–20 → 81, 80, 79, 78 = 79.5
    expect(byDate['2026-10-20']!.weightAvg7).toBe(79.5);
    expect(mine(view)).toMatchObject({ latestWeightKg: 78, startWeightKg: 84 });
    // A window that starts before `from` still sees earlier rows.
    const clipped = await get(enes, '?from=2026-10-17');
    expect(mine(clipped).points.map((p) => [p.date, p.weightAvg7])).toEqual([
      ['2026-10-17', 81],
      ['2026-10-20', 79.5],
    ]);
    expect(mine(clipped)).toMatchObject({ latestWeightKg: 78, startWeightKg: 84 });
  });

  it('validates ranges and the body', async () => {
    const enes = await login(app, 'enes');
    for (const bad of [
      { weightKg: 19.9 },
      { weightKg: 400.1 },
      { waistCm: 29 },
      { waistCm: 251 },
      { weightKg: '80' },
      { weightKg: 80, extra: 1 },
      [],
    ]) {
      const res = await put(enes, '2026-10-20', bad as NonNullable<InjectOptions['payload']>);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(codeOf(res)).toBe('bad_request');
    }
    expect((await put(enes, '2026-10-20', { weightKg: 20, waistCm: 30 })).statusCode).toBe(200);
    expect((await put(enes, '2026-10-19', { weightKg: 400, waistCm: 250 })).statusCode).toBe(200);
    expect((await put(enes, '2026-10-18', {})).statusCode).toBe(200);
  });

  it('rejects future dates, dates before the start and malformed dates', async () => {
    const enes = await login(app, 'enes');
    let res = await put(enes, '2026-10-21', { weightKg: 80 });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('future_date');
    res = await put(enes, '2026-10-05', { weightKg: 80 });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('before_start');
    res = await put(enes, '2026-10-5', { weightKg: 80 });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
    res = await put(enes, 'nonsense', { weightKg: 80 });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
  });
});

describe('PUT /api/metrics/sharing', () => {
  it('hides the partner’s series when off but keeps shared:false and the name; own series always visible', async () => {
    const enes = await login(app, 'enes');
    const agnes = await login(app, 'agnes');
    await put(agnes, '2026-10-20', { weightKg: 65, waistCm: 70 });
    await put(enes, '2026-10-20', { weightKg: 82 });

    let view = await get(enes);
    expect(theirs(view)).toMatchObject({ name: 'Agnes', shared: true, latestWeightKg: 65, startWeightKg: 65 });
    expect(theirs(view).points).toHaveLength(1);

    const res = await app.inject({ method: 'PUT', url: '/api/metrics/sharing', headers: cookieHeader(agnes), payload: { shared: false } });
    expect(res.statusCode).toBe(200);
    view = json<MetricsView>(res);
    // Agnes still sees her own data.
    expect(mine(view)).toMatchObject({ name: 'Agnes', shared: false, latestWeightKg: 65 });
    expect(mine(view).points).toHaveLength(1);
    expect(theirs(view)).toMatchObject({ name: 'Enes', shared: true, latestWeightKg: 82 });

    view = await get(enes);
    expect(theirs(view)).toEqual({
      userId: await userId('agnes'),
      name: 'Agnes',
      isMe: false,
      shared: false,
      points: [],
      latestWeightKg: null,
      startWeightKg: null,
    });

    // Back on.
    view = json<MetricsView>(
      await app.inject({ method: 'PUT', url: '/api/metrics/sharing', headers: cookieHeader(agnes), payload: { shared: true } }),
    );
    expect(mine(view).shared).toBe(true);
    expect(theirs(await get(enes)).points).toHaveLength(1);

    // Validation; and "sharing" never reaches the :date route.
    const bad = await app.inject({ method: 'PUT', url: '/api/metrics/sharing', headers: cookieHeader(agnes), payload: { shared: 'yes' } });
    expect(bad.statusCode).toBe(400);
    expect(codeOf(bad)).toBe('bad_request');
    expect(bad.body).toContain('shared');
  });
});
