import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createSetupToken } from '../src/auth.js';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { createDb, createPool, type Db } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import type { JobData, JobName } from '../src/push/jobs.js';
import type { Jobs } from '../src/push/queue.js';
import { PushSendError, type PushPayload, type PushSender, type PushSubscriptionKeys } from '../src/push/sender.js';
import { runSeed } from '../src/seed.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://hydrox:hydrox@localhost:5432/hydrox_test';

export const TEST_ENV = {
  NODE_ENV: 'test' as const,
  DATABASE_URL: TEST_DATABASE_URL,
  SESSION_SECRET: 'test-secret-test-secret-test-secret',
  APP_ORIGIN: 'http://localhost:3000',
};

const pool = createPool(TEST_DATABASE_URL);
export const db: Db = createDb(pool);

export async function migrateOnce(): Promise<void> {
  await runMigrations(pool);
}

/** Empties every table (ids restart at 1) and re-seeds. */
export async function resetDb(): Promise<void> {
  await sql`truncate table checkins, cheers, body_metrics, health_daily, import_tokens, photos, push_subscriptions, sessions, setup_tokens, goals, challenges, users restart identity cascade`.execute(
    db,
  );
  await runSeed(db);
}

export async function closeDb(): Promise<void> {
  await db.destroy();
}

export interface EnqueuedJob {
  name: JobName;
  data: JobData[JobName];
}

/** In-memory stand-in for the BullMQ queue: records what the app enqueues. */
export interface FakeJobs extends Jobs {
  enqueued: EnqueuedJob[];
}

export function fakeJobs(): FakeJobs {
  const enqueued: EnqueuedJob[] = [];
  return {
    enabled: true,
    enqueued,
    async enqueue(name, data) {
      enqueued.push({ name, data });
    },
    async close() {},
  };
}

export interface SentPush {
  endpoint: string;
  payload: PushPayload;
}

/** Records every send; `failWith` makes sends to matching endpoints throw (e.g. a 410). */
export class FakeSender implements PushSender {
  sent: SentPush[] = [];
  failWith = new Map<string, Error>();

  async send(sub: PushSubscriptionKeys, payload: PushPayload): Promise<void> {
    const err = this.failWith.get(sub.endpoint);
    if (err) throw err;
    this.sent.push({ endpoint: sub.endpoint, payload });
  }

  failStatus(endpoint: string, statusCode: number): void {
    this.failWith.set(endpoint, new PushSendError(statusCode, `push service answered ${statusCode}`));
  }
}

export const FAKE_VAPID = {
  VAPID_PUBLIC_KEY: 'test-public-key',
  VAPID_PRIVATE_KEY: 'test-private-key',
  VAPID_SUBJECT: 'mailto:test@example.com',
};

type AppConfig = Partial<typeof TEST_ENV & typeof FAKE_VAPID & { REDIS_URL: string; UPLOADS_DIR: string }>;

/**
 * Builds the app on the shared test DB. Unless `jobs` is given, a fresh fake queue is injected so no
 * Redis is touched (read it back from `app.jobs`). Pass `jobs: undefined` explicitly to exercise
 * the real `createJobs` (disabled stub when VAPID is absent).
 */
export async function makeApp(opts: Omit<BuildAppOptions, 'db' | 'config'> & { config?: AppConfig } = {}) {
  const jobs = 'jobs' in opts ? opts.jobs : fakeJobs();
  const app = await buildApp({
    ...opts,
    ...(jobs ? { jobs } : {}),
    db,
    config: { ...TEST_ENV, ...(opts.config ?? {}) },
    logger: false,
  });
  return Object.assign(app, { jobs: jobs as FakeJobs | undefined });
}

export const subscription = (endpoint: string): PushSubscriptionKeys => ({
  endpoint,
  keys: { p256dh: 'p256dh-' + endpoint.slice(-8), auth: 'auth-' + endpoint.slice(-8) },
});

export async function userId(slug: string): Promise<number> {
  const row = await db.selectFrom('users').select('id').where('slug', '=', slug).executeTakeFirstOrThrow();
  return row.id;
}

export async function goalId(slug: string, key: string): Promise<number> {
  const row = await db
    .selectFrom('goals')
    .innerJoin('users', 'users.id', 'goals.user_id')
    .select('goals.id')
    .where('users.slug', '=', slug)
    .where('goals.key', '=', key)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Consumes a fresh setup link for `slug` and returns the signed session cookie value. */
export async function login(app: FastifyInstance, slug: string): Promise<string> {
  const token = await createSetupToken(db, await userId(slug));
  const res = await app.inject({ method: 'GET', url: `/setup/${token}` });
  if (res.statusCode !== 302) throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'hx_session');
  if (!cookie) throw new Error('no hx_session cookie set');
  return cookie.value;
}

export const cookieHeader = (value: string): Record<string, string> => ({ cookie: `hx_session=${value}` });
