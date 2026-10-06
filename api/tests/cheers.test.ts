import { sql } from 'kysely';
import type { InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Cheer, DayView } from '../src/views.js';
import { closeDb, cookieHeader, db, login, makeApp, migrateOnce, resetDb, userId } from './helpers.js';

// Saturday Oct 10 2026 → challenge day 5.
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

async function post(cookie: string, payload: NonNullable<InjectOptions['payload']>) {
  return app.inject({ method: 'POST', url: '/api/cheers', headers: cookieHeader(cookie), payload });
}

describe('POST /api/cheers', () => {
  it('creates a cheer that appears on the receiver’s card for that date, oldest first, and enqueues a push', async () => {
    const enes = await login(app, 'enes');
    const agnes = await login(app, 'agnes');
    const agnesId = await userId('agnes');
    const enesId = await userId('enes');

    let res = await post(enes, { toUserId: agnesId, date: '2026-10-08', emoji: '👏', note: 'Nice one' });
    expect(res.statusCode).toBe(201);
    const first = json<Cheer>(res);
    expect(first).toMatchObject({ id: 1, fromUserId: enesId, toUserId: agnesId, date: '2026-10-08', emoji: '👏', note: 'Nice one' });
    expect(new Date(first.createdAt).toISOString()).toBe(first.createdAt);

    await sql`update cheers set created_at = now() - interval '1 minute' where id = 1`.execute(db);
    res = await post(enes, { toUserId: agnesId, date: '2026-10-08', emoji: '🔥' });
    expect(res.statusCode).toBe(201);
    expect(json<Cheer>(res).note).toBeNull();
    // A different day is not shown on Oct 8.
    await post(enes, { toUserId: agnesId, date: '2026-10-10', emoji: '💪' });
    // Whitespace-only notes are stored as null.
    res = await post(agnes, { toUserId: enesId, date: '2026-10-08', emoji: '🫡', note: '   ' });
    expect(json<Cheer>(res).note).toBeNull();

    const day = json<DayView>(await app.inject({ method: 'GET', url: '/api/days/2026-10-08', headers: cookieHeader(agnes) }));
    const me = day.users.find((u) => u.isMe)!;
    expect(me.slug).toBe('agnes');
    expect(me.cheers.map((c) => [c.emoji, c.fromUserId])).toEqual([
      ['👏', enesId],
      ['🔥', enesId],
    ]);
    expect(day.users.find((u) => !u.isMe)!.cheers.map((c) => c.emoji)).toEqual(['🫡']);

    const today = json<DayView>(await app.inject({ method: 'GET', url: '/api/today', headers: cookieHeader(agnes) }));
    expect(today.users[0]!.cheers.map((c) => c.emoji)).toEqual(['💪']);

    expect(app.jobs!.enqueued).toEqual([
      { name: 'cheer', data: { cheerId: 1 } },
      { name: 'cheer', data: { cheerId: 2 } },
      { name: 'cheer', data: { cheerId: 3 } },
      { name: 'cheer', data: { cheerId: 4 } },
    ]);
  });

  it('validates emoji, note length, body shape and the receiver', async () => {
    const enes = await login(app, 'enes');
    const agnesId = await userId('agnes');

    let res = await post(enes, { toUserId: agnesId, date: '2026-10-08', emoji: '🎉' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');

    res = await post(enes, { toUserId: agnesId, date: '2026-10-08', emoji: '👏', note: 'x'.repeat(141) });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
    res = await post(enes, { toUserId: agnesId, date: '2026-10-08', emoji: '👏', note: 'x'.repeat(140) });
    expect(res.statusCode).toBe(201);

    res = await post(enes, { toUserId: 'agnes', date: '2026-10-08', emoji: '👏' });
    expect(res.statusCode).toBe(400);
    res = await post(enes, { toUserId: agnesId, date: '2026-02-30', emoji: '👏' });
    expect(res.statusCode).toBe(400);
    res = await post(enes, { toUserId: 999, date: '2026-10-08', emoji: '👏' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
  });

  it('rejects cheering yourself, future dates and dates before the start', async () => {
    const enes = await login(app, 'enes');
    const enesId = await userId('enes');
    const agnesId = await userId('agnes');

    let res = await post(enes, { toUserId: enesId, date: '2026-10-08', emoji: '👏' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');

    res = await post(enes, { toUserId: agnesId, date: '2026-10-11', emoji: '👏' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('future_date');

    res = await post(enes, { toUserId: agnesId, date: '2026-10-05', emoji: '👏' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('before_start');

    expect(await db.selectFrom('cheers').select('id').execute()).toHaveLength(0);
    expect(app.jobs!.enqueued).toEqual([]);
  });

  it('requires a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/cheers', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /api/cheers/:id', () => {
  it('sender deletes with 204; anyone else gets 404', async () => {
    const enes = await login(app, 'enes');
    const agnes = await login(app, 'agnes');
    const cheer = json<Cheer>(await post(enes, { toUserId: await userId('agnes'), date: '2026-10-08', emoji: '❤️' }));

    let res = await app.inject({ method: 'DELETE', url: `/api/cheers/${cheer.id}`, headers: cookieHeader(agnes) });
    expect(res.statusCode).toBe(404);
    expect(codeOf(res)).toBe('not_found');
    expect(await db.selectFrom('cheers').select('id').execute()).toHaveLength(1);

    res = await app.inject({ method: 'DELETE', url: `/api/cheers/${cheer.id}`, headers: cookieHeader(enes) });
    expect(res.statusCode).toBe(204);
    expect(await db.selectFrom('cheers').select('id').execute()).toHaveLength(0);

    res = await app.inject({ method: 'DELETE', url: `/api/cheers/${cheer.id}`, headers: cookieHeader(enes) });
    expect(res.statusCode).toBe(404);
    res = await app.inject({ method: 'DELETE', url: '/api/cheers/abc', headers: cookieHeader(enes) });
    expect(res.statusCode).toBe(400);
  });
});
