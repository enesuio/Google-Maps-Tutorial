import type { InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { slugify } from '../src/routes/summary.js';
import type { FinishTest, SummaryView } from '../src/summary.js';
import { closeDb, cookieHeader, db, login, makeApp, migrateOnce, resetDb, userId } from './helpers.js';

// Monday Oct 19 2026 → challenge day 14.
const NOW = () => new Date('2026-10-19T16:00:00Z');

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

async function seededTests(slug: string): Promise<FinishTest[]> {
  const cookie = await login(app, slug);
  const view = json<SummaryView>(await app.inject({ method: 'GET', url: '/api/summary', headers: cookieHeader(cookie) }));
  return view.users.find((u) => u.isMe)!.finishTests;
}
const put = (cookie: string, id: number, payload: NonNullable<InjectOptions['payload']>) =>
  app.inject({ method: 'PUT', url: `/api/finish-tests/${id}`, headers: cookieHeader(cookie), payload });
const post = (cookie: string, label: string) =>
  app.inject({ method: 'POST', url: '/api/finish-tests', headers: cookieHeader(cookie), payload: { label } });
const del = (cookie: string, id: number) => app.inject({ method: 'DELETE', url: `/api/finish-tests/${id}`, headers: cookieHeader(cookie) });

describe('seed', () => {
  it('gives Agnes her two tests and keeps a recorded result on re-seed', async () => {
    const tests = await seededTests('agnes');
    expect(tests.map((t) => [t.key, t.label, t.passed])).toEqual([
      ['pushups', '3 push-ups', null],
      ['pullup', '1 pull-up', null],
    ]);
    expect(await seededTests('enes')).toEqual([]);

    const agnes = await login(app, 'agnes');
    await put(agnes, tests[0]!.id, { passed: true, result: '3 push-ups', testedOn: '2026-10-19' });
    const { runSeed } = await import('../src/seed.js');
    await runSeed(db);
    const after = await db.selectFrom('finish_tests').select(['id', 'key', 'passed', 'result', 'tested_on']).orderBy('id').execute();
    expect(after).toEqual([
      { id: tests[0]!.id, key: 'pushups', passed: true, result: '3 push-ups', tested_on: '2026-10-19' },
      { id: tests[1]!.id, key: 'pullup', passed: null, result: null, tested_on: null },
    ]);
  });
});

describe('PUT /api/finish-tests/:id', () => {
  it('records passed, result and testedOn on an own test; omitted fields stay, null clears', async () => {
    const [pushups] = await seededTests('agnes');
    const agnes = await login(app, 'agnes');
    let res = await put(agnes, pushups!.id, { passed: true, result: '3 push-ups', testedOn: '2026-10-19' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<FinishTest>(res)).toEqual({
      id: pushups!.id,
      userId: await userId('agnes'),
      key: 'pushups',
      label: '3 push-ups',
      passed: true,
      result: '3 push-ups',
      testedOn: '2026-10-19',
    });

    res = await put(agnes, pushups!.id, { passed: false });
    expect(json<FinishTest>(res)).toMatchObject({ passed: false, result: '3 push-ups', testedOn: '2026-10-19' });
    res = await put(agnes, pushups!.id, { passed: null, result: null, testedOn: null });
    expect(json<FinishTest>(res)).toMatchObject({ passed: null, result: null, testedOn: null });
    res = await put(agnes, pushups!.id, { passed: true, result: '   ' });
    expect(json<FinishTest>(res)).toMatchObject({ passed: true, result: null });
  });

  it('is 404 for the partner’s test and 400 for a long result, a future or pre-start date, or a bad body', async () => {
    const [pushups] = await seededTests('agnes');
    const enes = await login(app, 'enes');
    const agnes = await login(app, 'agnes');

    let res = await put(enes, pushups!.id, { passed: true });
    expect(res.statusCode).toBe(404);
    expect(codeOf(res)).toBe('not_found');
    expect((await put(agnes, 9999, { passed: true })).statusCode).toBe(404);

    res = await put(agnes, pushups!.id, { passed: true, result: 'x'.repeat(81) });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
    expect((await put(agnes, pushups!.id, { passed: true, result: 'x'.repeat(80) })).statusCode).toBe(200);

    res = await put(agnes, pushups!.id, { passed: true, testedOn: '2026-10-20' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('future_date');
    res = await put(agnes, pushups!.id, { passed: true, testedOn: '2026-10-05' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('before_start');
    expect((await put(agnes, pushups!.id, { passed: true, testedOn: '2026-10-06' })).statusCode).toBe(200);

    expect((await put(agnes, pushups!.id, {})).statusCode).toBe(400);
    expect((await put(agnes, pushups!.id, { passed: 'yes' })).statusCode).toBe(400);
    expect((await put(agnes, pushups!.id, { passed: true, testedOn: 'today' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/finish-tests/${pushups!.id}`, payload: { passed: true } })).statusCode).toBe(401);
  });
});

describe('POST and DELETE /api/finish-tests', () => {
  it('adds up to five tests with a derived key, then too_many', async () => {
    const enes = await login(app, 'enes');
    const enesId = await userId('enes');
    const made: FinishTest[] = [];
    for (const label of ['10 push-ups', 'Plank 60 s', 'Touch toes', '5 km run', 'Dead hang 30 s']) {
      const res = await post(enes, label);
      expect(res.statusCode, res.body).toBe(201);
      made.push(json<FinishTest>(res));
    }
    expect(made[0]).toEqual({
      id: expect.any(Number),
      userId: enesId,
      key: expect.stringMatching(/^10-push-ups-[0-9a-z]{4}$/),
      label: '10 push-ups',
      passed: null,
      result: null,
      testedOn: null,
    });
    expect(made.map((t) => t.key.replace(/-[0-9a-z]{4}$/, ''))).toEqual(['10-push-ups', 'plank-60-s', 'touch-toes', '5-km-run', 'dead-hang-30-s']);

    let res = await post(enes, 'One more');
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('too_many');
    expect(await seededTests('enes')).toHaveLength(5);

    // Agnes already has two from the seed: three more, then too_many.
    const agnes = await login(app, 'agnes');
    for (const label of ['A', 'B', 'C']) expect((await post(agnes, label)).statusCode).toBe(201);
    res = await post(agnes, 'D');
    expect(codeOf(res)).toBe('too_many');

    expect((await post(enes, '')).statusCode).toBe(400);
    expect((await post(enes, 'x'.repeat(81))).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/finish-tests', headers: cookieHeader(enes), payload: {} })).statusCode).toBe(400);
  });

  it('deletes an own test (204) and 404s the partner’s', async () => {
    const [pushups, pullup] = await seededTests('agnes');
    const enes = await login(app, 'enes');
    const agnes = await login(app, 'agnes');

    let res = await del(enes, pushups!.id);
    expect(res.statusCode).toBe(404);
    expect(codeOf(res)).toBe('not_found');

    res = await del(agnes, pushups!.id);
    expect(res.statusCode).toBe(204);
    expect((await del(agnes, pushups!.id)).statusCode).toBe(404);
    expect((await seededTests('agnes')).map((t) => t.id)).toEqual([pullup!.id]);
    // The partner still sees what is left.
    const view = json<SummaryView>(await app.inject({ method: 'GET', url: '/api/summary', headers: cookieHeader(enes) }));
    expect(view.users[1]!.finishTests.map((t) => t.key)).toEqual(['pullup']);
  });

  it('slugify', () => {
    expect(slugify('3 push-ups')).toBe('3-push-ups');
    expect(slugify('  Plank: 60 s!! ')).toBe('plank-60-s');
    expect(slugify('Ünïcödé')).toBe('unicode');
    expect(slugify('🔥🔥')).toBe('test');
    expect(slugify('a'.repeat(80)).length).toBeLessThanOrEqual(40);
  });
});
