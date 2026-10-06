import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PushStatus } from '../src/routes/push.js';
import { FAKE_VAPID, FakeSender, closeDb, cookieHeader, db, login, makeApp, migrateOnce, resetDb, subscription, userId } from './helpers.js';

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
});
afterEach(async () => {
  await app.close();
});

const json = <T>(res: { body: string }): T => JSON.parse(res.body) as T;
const codeOf = (res: { body: string }) => json<{ error: { code: string } }>(res).error.code;

describe('push disabled (no VAPID keys)', () => {
  it('status reports enabled:false and subscribe is 503 push_disabled; the real createJobs yields a no-op stub', async () => {
    app = await makeApp({ now: NOW, jobs: undefined });
    const enes = await login(app, 'enes');
    const status = await app.inject({ method: 'GET', url: '/api/push/status', headers: cookieHeader(enes) });
    expect(status.statusCode).toBe(200);
    expect(json<PushStatus>(status)).toEqual({ enabled: false, publicKey: null, subscribed: false });

    const sub = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: subscription('https://push.example/a') });
    expect(sub.statusCode).toBe(503);
    expect(codeOf(sub)).toBe('push_disabled');

    const test = await app.inject({ method: 'POST', url: '/api/push/test', headers: cookieHeader(enes) });
    expect(test.statusCode).toBe(503);

    // Everything else keeps working, including check-ins (partner-checkin enqueue is a no-op).
    const walk = await db.selectFrom('goals').select('id').where('key', '=', 'walk').executeTakeFirstOrThrow();
    const put = await app.inject({ method: 'PUT', url: '/api/checkins/2026-10-10', headers: cookieHeader(enes), payload: { entries: [{ goalId: walk.id, value: true }] } });
    expect(put.statusCode).toBe(200);
  });

  it('is disabled when only REDIS_URL is set, and when VAPID is set but REDIS_URL is not', async () => {
    app = await makeApp({ now: NOW, jobs: undefined, config: { REDIS_URL: 'redis://127.0.0.1:1' } });
    let enes = await login(app, 'enes');
    expect(json<PushStatus>(await app.inject({ method: 'GET', url: '/api/push/status', headers: cookieHeader(enes) })).enabled).toBe(false);
    await app.close();

    app = await makeApp({ now: NOW, jobs: undefined, config: { ...FAKE_VAPID, REDIS_URL: '' } });
    enes = await login(app, 'enes');
    expect(json<PushStatus>(await app.inject({ method: 'GET', url: '/api/push/status', headers: cookieHeader(enes) })).enabled).toBe(false);
  });
});

describe('push enabled (fake VAPID keys + fake sender)', () => {
  let sender: FakeSender;

  beforeEach(async () => {
    sender = new FakeSender();
    app = await makeApp({ now: NOW, sender, config: FAKE_VAPID });
  });

  it('subscribe (upsert by endpoint), status, unsubscribe', async () => {
    const enes = await login(app, 'enes');
    const agnes = await login(app, 'agnes');

    let status = json<PushStatus>(await app.inject({ method: 'GET', url: '/api/push/status', headers: cookieHeader(enes) }));
    expect(status).toEqual({ enabled: true, publicKey: 'test-public-key', subscribed: false });

    let res = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: subscription('https://push.example/phone') });
    expect(res.statusCode).toBe(201);
    expect(json(res)).toEqual({ ok: true });
    // Same endpoint again with new keys → one row, updated.
    res = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: cookieHeader(enes),
      payload: { endpoint: 'https://push.example/phone', keys: { p256dh: 'new-p256dh', auth: 'new-auth' } },
    });
    expect(res.statusCode).toBe(201);
    res = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: subscription('https://push.example/laptop') });
    expect(res.statusCode).toBe(201);

    const rows = await db.selectFrom('push_subscriptions').select(['user_id', 'endpoint', 'p256dh', 'auth']).orderBy('id').execute();
    expect(rows).toEqual([
      { user_id: await userId('enes'), endpoint: 'https://push.example/phone', p256dh: 'new-p256dh', auth: 'new-auth' },
      { user_id: await userId('enes'), endpoint: 'https://push.example/laptop', p256dh: 'p256dh-e/laptop', auth: 'auth-e/laptop' },
    ]);

    status = json<PushStatus>(await app.inject({ method: 'GET', url: '/api/push/status', headers: cookieHeader(enes) }));
    expect(status.subscribed).toBe(true);
    expect(json<PushStatus>(await app.inject({ method: 'GET', url: '/api/push/status', headers: cookieHeader(agnes) })).subscribed).toBe(false);

    // Body validation.
    res = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: { endpoint: 'not a url', keys: { p256dh: 'x', auth: 'y' } } });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
    res = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: { endpoint: 'https://push.example/x' } });
    expect(res.statusCode).toBe(400);

    // Someone else cannot unsubscribe my endpoint; I can.
    res = await app.inject({ method: 'DELETE', url: '/api/push/subscribe', headers: cookieHeader(agnes), payload: { endpoint: 'https://push.example/phone' } });
    expect(res.statusCode).toBe(204);
    expect(await db.selectFrom('push_subscriptions').select('id').execute()).toHaveLength(2);
    res = await app.inject({ method: 'DELETE', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: { endpoint: 'https://push.example/phone' } });
    expect(res.statusCode).toBe(204);
    res = await app.inject({ method: 'DELETE', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: { endpoint: 'https://push.example/laptop' } });
    expect(res.statusCode).toBe(204);
    expect(await db.selectFrom('push_subscriptions').select('id').execute()).toHaveLength(0);
    status = json<PushStatus>(await app.inject({ method: 'GET', url: '/api/push/status', headers: cookieHeader(enes) }));
    expect(status.subscribed).toBe(false);
    res = await app.inject({ method: 'DELETE', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('test push goes to every device of the caller only', async () => {
    const enes = await login(app, 'enes');
    const agnes = await login(app, 'agnes');
    for (const e of ['https://push.example/e1', 'https://push.example/e2']) {
      await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: subscription(e) });
    }
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: cookieHeader(agnes), payload: subscription('https://push.example/a1') });

    const res = await app.inject({ method: 'POST', url: '/api/push/test', headers: cookieHeader(enes) });
    expect(res.statusCode).toBe(202);
    expect(sender.sent.map((s) => s.endpoint).sort()).toEqual(['https://push.example/e1', 'https://push.example/e2']);
    expect(sender.sent[0]!.payload).toEqual({ title: 'Hydrox 45', body: 'Notifications are on', url: '/', tag: 'test' });
  });

  it('a 410 (or 404) from the push service deletes that subscription; other errors are recorded', async () => {
    const enes = await login(app, 'enes');
    for (const e of ['https://push.example/gone', 'https://push.example/missing', 'https://push.example/flaky', 'https://push.example/ok']) {
      await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: subscription(e) });
    }
    sender.failStatus('https://push.example/gone', 410);
    sender.failStatus('https://push.example/missing', 404);
    sender.failWith.set('https://push.example/flaky', new Error('socket hang up'));

    const res = await app.inject({ method: 'POST', url: '/api/push/test', headers: cookieHeader(enes) });
    expect(res.statusCode).toBe(202);
    expect(sender.sent.map((s) => s.endpoint)).toEqual(['https://push.example/ok']);

    const rows = await db.selectFrom('push_subscriptions').select(['endpoint', 'last_error', 'failed_at']).orderBy('id').execute();
    expect(rows.map((r) => r.endpoint)).toEqual(['https://push.example/flaky', 'https://push.example/ok']);
    expect(rows[0]).toMatchObject({ last_error: 'socket hang up' });
    expect(rows[0]!.failed_at).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({ last_error: null, failed_at: null });

    // Re-subscribing a failed endpoint clears the error.
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: cookieHeader(enes), payload: subscription('https://push.example/flaky') });
    const flaky = await db.selectFrom('push_subscriptions').select(['last_error', 'failed_at']).where('endpoint', '=', 'https://push.example/flaky').executeTakeFirstOrThrow();
    expect(flaky).toEqual({ last_error: null, failed_at: null });
  });
});
