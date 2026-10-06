import { sql } from 'kysely';
import type { Db } from '../db.js';
import { PushSendError, type PushPayload, type PushSender, type PushSubscriptionKeys } from './sender.js';

export interface SubscriptionRow extends PushSubscriptionKeys {
  id: number;
  userId: number;
}

/** Upsert by endpoint: a device that re-subscribes (or changes owner) updates in place. */
export async function upsertSubscription(db: Db, userId: number, sub: PushSubscriptionKeys): Promise<void> {
  await db
    .insertInto('push_subscriptions')
    .values({ user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflict((oc) =>
      oc.column('endpoint').doUpdateSet({
        user_id: userId,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        last_error: null,
        failed_at: null,
      }),
    )
    .execute();
}

/** Deletes the caller's subscription with that endpoint; returns whether one existed. */
export async function deleteSubscription(db: Db, userId: number, endpoint: string): Promise<boolean> {
  const result = await db
    .deleteFrom('push_subscriptions')
    .where('user_id', '=', userId)
    .where('endpoint', '=', endpoint)
    .executeTakeFirst();
  return (result.numDeletedRows ?? 0n) > 0n;
}

export async function listSubscriptions(db: Db, userId: number): Promise<SubscriptionRow[]> {
  const rows = await db
    .selectFrom('push_subscriptions')
    .select(['id', 'user_id', 'endpoint', 'p256dh', 'auth'])
    .where('user_id', '=', userId)
    .orderBy('id', 'asc')
    .execute();
  return rows.map((r) => ({ id: r.id, userId: r.user_id, endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

export async function hasSubscription(db: Db, userId: number): Promise<boolean> {
  const row = await db
    .selectFrom('push_subscriptions')
    .select('id')
    .where('user_id', '=', userId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

export interface SendReport {
  sent: number;
  removed: number;
  failed: number;
}

/**
 * Sends `payload` to every device of `userId`. A 404/410 from the push service deletes the
 * subscription; any other failure is recorded in `last_error` / `failed_at` and never thrown.
 */
export async function sendToUser(db: Db, sender: PushSender, userId: number, payload: PushPayload): Promise<SendReport> {
  const report: SendReport = { sent: 0, removed: 0, failed: 0 };
  for (const sub of await listSubscriptions(db, userId)) {
    try {
      await sender.send({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      report.sent++;
    } catch (err) {
      if (err instanceof PushSendError && (err.statusCode === 404 || err.statusCode === 410)) {
        await db.deleteFrom('push_subscriptions').where('id', '=', sub.id).execute();
        report.removed++;
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      await db
        .updateTable('push_subscriptions')
        .set({ last_error: message.slice(0, 1000), failed_at: sql`now()` })
        .where('id', '=', sub.id)
        .execute();
      report.failed++;
    }
  }
  return report;
}
