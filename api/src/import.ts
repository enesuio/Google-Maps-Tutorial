import { randomToken } from './auth.js';
import { writeCheckins, type CheckinWrite } from './checkins.js';
import type { Db } from './db.js';
import type { Jobs } from './push/queue.js';
import type { HealthDay } from './views.js';

// ---- Shared types (mirror docs/API.md, T11) ----

export interface ImportBody {
  /** YYYY-MM-DD, default Toronto today; must be within [startDate, today]. */
  date?: string;
  /** Integer ≥ 0. */
  steps?: number;
  /** ≥ 0. */
  activeKcal?: number;
}

export interface ImportResult {
  date: string;
  steps: number | null;
  activeKcal: number | null;
  goalsUpdated: number;
}

export interface ImportStatus {
  hasToken: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
  lastImport: { date: string; steps: number | null; activeKcal: number | null } | null;
}

// ---- Tokens: one active (revoked_at is null) token per user ----

/** Revokes the user's active token(s) and creates a new one. The token is shown once. */
export async function createImportToken(db: Db, userId: number, now: Date): Promise<string> {
  const token = randomToken(); // 32 random bytes, base64url
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('import_tokens')
      .set({ revoked_at: now })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
    await trx.insertInto('import_tokens').values({ token, user_id: userId, created_at: now }).execute();
  });
  return token;
}

export async function revokeImportTokens(db: Db, userId: number, now: Date): Promise<void> {
  await db
    .updateTable('import_tokens')
    .set({ revoked_at: now })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
}

/** The owner of an active token, or null when unknown or revoked. */
export async function findImportTokenUser(db: Db, token: string): Promise<{ id: number; slug: string; name: string } | null> {
  const row = await db
    .selectFrom('import_tokens')
    .innerJoin('users', 'users.id', 'import_tokens.user_id')
    .select(['users.id', 'users.slug', 'users.name'])
    .where('import_tokens.token', '=', token)
    .where('import_tokens.revoked_at', 'is', null)
    .executeTakeFirst();
  return row ?? null;
}

export async function touchImportToken(db: Db, token: string, now: Date): Promise<void> {
  await db.updateTable('import_tokens').set({ last_used_at: now }).where('token', '=', token).execute();
}

export async function importStatus(db: Db, userId: number): Promise<ImportStatus> {
  const [token, last] = await Promise.all([
    db
      .selectFrom('import_tokens')
      .select(['created_at', 'last_used_at'])
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .orderBy('created_at', 'desc')
      .executeTakeFirst(),
    db
      .selectFrom('health_daily')
      .select(['date', 'steps', 'active_kcal'])
      .where('user_id', '=', userId)
      .orderBy('updated_at', 'desc')
      .orderBy('date', 'desc')
      .executeTakeFirst(),
  ]);
  return {
    hasToken: token !== undefined,
    createdAt: token?.created_at.toISOString() ?? null,
    lastUsedAt: token?.last_used_at?.toISOString() ?? null,
    lastImport: last
      ? { date: last.date, steps: last.steps, activeKcal: last.active_kcal === null ? null : Number(last.active_kcal) }
      : null,
  };
}

// ---- The import itself ----

/**
 * Upserts `health_daily` for the day (last write wins; absent fields keep their stored value),
 * then fills the user's active `health_*` goals for the fields present, through the same
 * writer as manual check-ins so the partner is told on the first entry of today.
 */
export async function applyHealthImport(
  db: Db,
  jobs: Jobs,
  userId: number,
  body: { date: string; steps?: number | undefined; activeKcal?: number | undefined },
  today: string,
): Promise<ImportResult> {
  const stored = await db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('health_daily')
      .select(['steps', 'active_kcal'])
      .where('user_id', '=', userId)
      .where('date', '=', body.date)
      .executeTakeFirst();
    const storedKcal = existing?.active_kcal == null ? null : Number(existing.active_kcal);
    const steps = body.steps === undefined ? (existing?.steps ?? null) : body.steps;
    const activeKcal = body.activeKcal === undefined ? storedKcal : body.activeKcal;
    await trx
      .insertInto('health_daily')
      .values({ user_id: userId, date: body.date, steps, active_kcal: activeKcal })
      .onConflict((oc) =>
        oc.columns(['user_id', 'date']).doUpdateSet({ steps, active_kcal: activeKcal, updated_at: new Date() }),
      )
      .execute();
    const day: HealthDay = { steps, activeKcal };
    return day;
  });

  const goals = await db
    .selectFrom('goals')
    .select(['id', 'source'])
    .where('user_id', '=', userId)
    .where('active', '=', true)
    .where('source', '!=', 'manual')
    .execute();
  const entries: CheckinWrite[] = [];
  for (const g of goals) {
    if (g.source === 'health_steps' && body.steps !== undefined) entries.push({ goalId: g.id, value: body.steps });
    if (g.source === 'health_active_kcal' && body.activeKcal !== undefined) entries.push({ goalId: g.id, value: body.activeKcal });
  }
  if (entries.length > 0) await writeCheckins(db, jobs, userId, body.date, today, entries);

  return { date: body.date, steps: stored.steps, activeKcal: stored.activeKcal, goalsUpdated: entries.length };
}
