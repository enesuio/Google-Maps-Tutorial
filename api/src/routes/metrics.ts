import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { dateSchema, todayInToronto } from '../dates.js';
import { badRequest } from '../errors.js';
import { WAIST_CM_MAX, WAIST_CM_MIN, WEIGHT_KG_MAX, WEIGHT_KG_MIN, buildMetricsView } from '../metrics.js';
import { parse } from '../validate.js';
import { loadChallenge } from '../views.js';
import { me, type RouteContext } from './context.js';

const rangeQuery = z.object({ from: dateSchema.optional(), to: dateSchema.optional() });
const dateParams = z.object({ date: dateSchema });
const putMetricsBody = z
  .object({
    weightKg: z.number().finite().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX).nullable().optional(),
    waistCm: z.number().finite().min(WAIST_CM_MIN).max(WAIST_CM_MAX).nullable().optional(),
  })
  .strict();
const sharingBody = z.object({ shared: z.boolean() }).strict();

export async function metricsRoutes(api: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, now } = ctx;

  api.get('/metrics', async (req) => {
    const query = parse(rangeQuery, req.query, 'query');
    return buildMetricsView(db, me(req).id, todayInToronto(now()), query);
  });

  // Registered before `/metrics/:date`; `:date` is also strictly YYYY-MM-DD so "sharing" can never match it.
  api.put('/metrics/sharing', async (req) => {
    const user = me(req);
    const { shared } = parse(sharingBody, req.body, 'body');
    await db.updateTable('users').set({ metrics_shared: shared }).where('id', '=', user.id).execute();
    return buildMetricsView(db, user.id, todayInToronto(now()));
  });

  api.put('/metrics/:date', async (req) => {
    const user = me(req);
    const { date } = parse(dateParams, req.params, 'params');
    const body = parse(putMetricsBody, req.body, 'body');
    const today = todayInToronto(now());
    if (date > today) throw badRequest('future_date', `${date} is after today (${today}).`);
    const challenge = await loadChallenge(db);
    if (date < challenge.startDate) {
      throw badRequest('before_start', `${date} is before the challenge start (${challenge.startDate}).`);
    }

    await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('body_metrics')
        .select(['weight_kg', 'waist_cm'])
        .where('user_id', '=', user.id)
        .where('date', '=', date)
        .executeTakeFirst();
      // Omitted fields keep their stored value; null clears.
      const weight = body.weightKg === undefined ? (existing?.weight_kg ?? null) : body.weightKg;
      const waist = body.waistCm === undefined ? (existing?.waist_cm ?? null) : body.waistCm;
      if (weight === null && waist === null) {
        if (existing) {
          await trx.deleteFrom('body_metrics').where('user_id', '=', user.id).where('date', '=', date).execute();
        }
        return;
      }
      await trx
        .insertInto('body_metrics')
        .values({ user_id: user.id, date, weight_kg: weight, waist_cm: waist })
        .onConflict((oc) =>
          oc.columns(['user_id', 'date']).doUpdateSet({ weight_kg: weight, waist_cm: waist, updated_at: sql`now()` }),
        )
        .execute();
    });

    return buildMetricsView(db, user.id, today);
  });
}
