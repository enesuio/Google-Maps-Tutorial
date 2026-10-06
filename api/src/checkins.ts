import { sql } from 'kysely';
import type { Db } from './db.js';
import type { Jobs } from './push/queue.js';

/** One check-in write: `null` clears the entry; booleans are already mapped to 1/0. */
export interface CheckinWrite {
  goalId: number;
  value: number | null;
}

/**
 * Writes `entries` for one user and day in a single transaction, then enqueues `partner-checkin`
 * when `date` is today and the day went from no entries to some entries. Shared by the manual
 * `PUT /api/checkins/:date` and the Health import, so both follow the same first-entry rule
 * (never for backfills or later edits). Returns the number of entries before and after.
 */
export async function writeCheckins(
  db: Db,
  jobs: Jobs,
  userId: number,
  date: string,
  today: string,
  entries: CheckinWrite[],
): Promise<{ before: number; after: number }> {
  const countEntries = async (q: Db) => {
    const row = await q
      .selectFrom('checkins')
      .select(sql<string>`count(*)`.as('n'))
      .where('user_id', '=', userId)
      .where('date', '=', date)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  };

  const result = await db.transaction().execute(async (trx) => {
    const before = await countEntries(trx);
    for (const entry of entries) {
      if (entry.value === null) {
        await trx
          .deleteFrom('checkins')
          .where('user_id', '=', userId)
          .where('date', '=', date)
          .where('goal_id', '=', entry.goalId)
          .execute();
        continue;
      }
      const value = entry.value;
      await trx
        .insertInto('checkins')
        .values({ user_id: userId, date, goal_id: entry.goalId, value })
        .onConflict((oc) => oc.columns(['user_id', 'date', 'goal_id']).doUpdateSet({ value, updated_at: sql`now()` }))
        .execute();
    }
    return { before, after: await countEntries(trx) };
  });

  // First entry of today → tell the partner (never for backfills or later edits).
  if (date === today && result.before === 0 && result.after > 0) {
    await jobs.enqueue('partner-checkin', { userId, date });
  }
  return result;
}
