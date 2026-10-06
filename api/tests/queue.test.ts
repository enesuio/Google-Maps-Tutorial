import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createJobs, type Jobs } from '../src/push/queue.js';
import { upsertSubscription } from '../src/push/subscriptions.js';
import { FakeSender, closeDb, db, migrateOnce, resetDb, subscription, userId } from './helpers.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const NOW = new Date('2026-10-11T01:00:00Z'); // Oct 10 21:00 Toronto → day 5

async function redisReachable(): Promise<boolean> {
  const client = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2_000, enableOfflineQueue: false });
  client.on('error', () => {});
  try {
    await client.connect();
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

let redisUp = false;
let jobs: Jobs | undefined;
const queueName = `hydrox-test-${process.pid}-${Date.now()}`;

beforeAll(async () => {
  await migrateOnce();
  redisUp = await redisReachable();
  if (!redisUp) console.warn(`[queue.test] Redis not reachable at ${REDIS_URL}; skipping the BullMQ integration test`);
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
});
afterEach(async () => {
  await jobs?.close();
  jobs = undefined;
  if (redisUp) {
    const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
    client.on('error', () => {});
    try {
      const keys = await client.keys(`bull:${queueName}:*`);
      if (keys.length > 0) await client.del(...keys);
    } finally {
      client.disconnect();
    }
  }
});

const waitFor = async (check: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> => {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timed out after ${ms}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('BullMQ queue against the real Redis', () => {
  it('enqueue → worker runs the handler → fake sender called; the evening reminder is scheduled', async (ctx) => {
    if (!redisUp) return ctx.skip();
    const sender = new FakeSender();
    const agnesId = await userId('agnes');
    const enesId = await userId('enes');
    await upsertSubscription(db, agnesId, subscription('https://push.example/agnes'));

    jobs = createJobs({ db, sender, now: () => NOW, redisUrl: REDIS_URL, vapidConfigured: true, queueName });
    expect(jobs.enabled).toBe(true);

    await jobs.enqueue('partner-checkin', { userId: enesId, date: '2026-10-10' });
    await waitFor(() => sender.sent.length >= 1);
    expect(sender.sent).toEqual([
      {
        endpoint: 'https://push.example/agnes',
        payload: { title: 'Hydrox 45', body: 'Enes checked in for Day 5', url: '/day/2026-10-10', tag: `checkin-${enesId}-2026-10-10` },
      },
    ]);

    // The repeatable 21:00 Toronto evening reminder is registered on this queue.
    const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
    client.on('error', () => {});
    try {
      await waitFor(async () => (await client.exists(`bull:${queueName}:repeat:evening-reminder`)) === 1);
      const scheduler = await client.hgetall(`bull:${queueName}:repeat:evening-reminder`);
      expect(scheduler).toMatchObject({ pattern: '0 21 * * *', tz: 'America/Toronto' });
    } finally {
      client.disconnect();
    }
  });

  it('is a disabled no-op stub without Redis or VAPID, and warns once', async () => {
    const warnings: unknown[] = [];
    const logger = { info() {}, warn(obj: unknown) { warnings.push(obj); }, error() {} };
    const stub = createJobs({ db, sender: new FakeSender(), redisUrl: undefined, vapidConfigured: true, logger });
    expect(stub.enabled).toBe(false);
    await stub.enqueue('cheer', { cheerId: 1 });
    await stub.close();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({ missing: ['REDIS_URL'] });

    const stub2 = createJobs({ db, sender: new FakeSender(), redisUrl: REDIS_URL, vapidConfigured: false, logger });
    expect(stub2.enabled).toBe(false);
    expect(warnings[1]).toEqual({ missing: ['VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT'] });
  });
});
