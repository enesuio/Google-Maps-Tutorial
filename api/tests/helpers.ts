import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createSetupToken } from '../src/auth.js';
import { buildApp, type BuildAppOptions } from '../src/app.js';
import { createDb, createPool, type Db } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
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
  await sql`truncate table checkins, sessions, setup_tokens, goals, challenges, users restart identity cascade`.execute(
    db,
  );
  await runSeed(db);
}

export async function closeDb(): Promise<void> {
  await db.destroy();
}

export async function makeApp(opts: Omit<BuildAppOptions, 'db' | 'config'> & { config?: Partial<typeof TEST_ENV> } = {}) {
  return buildApp({ ...opts, db, config: { ...TEST_ENV, ...(opts.config ?? {}) }, logger: false });
}

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
