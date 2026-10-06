import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { dateSchema, todayInToronto } from '../dates.js';
import { badRequest, notFound } from '../errors.js';
import { buildSummary, finishTestView, type FinishTest } from '../summary.js';
import { parse } from '../validate.js';
import { loadChallenge } from '../views.js';
import { me, type RouteContext } from './context.js';

export const FINISH_TEST_RESULT_MAX = 80;
export const FINISH_TESTS_MAX = 5;

const idParams = z.object({ id: z.coerce.number().int().positive() });
const putFinishTestBody = z
  .object({
    passed: z.boolean().nullable(),
    result: z.string().max(FINISH_TEST_RESULT_MAX).nullable().optional(),
    testedOn: dateSchema.nullable().optional(),
  })
  .strict();
const postFinishTestBody = z.object({ label: z.string().trim().min(1).max(FINISH_TEST_RESULT_MAX) }).strict();

const FINISH_TEST_COLUMNS = ['id', 'user_id', 'key', 'label', 'passed', 'result', 'tested_on'] as const;

/** "3 push-ups" → "3-push-ups" (accents stripped); anything without letters or digits becomes "test". */
export function slugify(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'test';
}

/** Four random base36 characters. */
export function shortSuffix(): string {
  return (randomBytes(4).readUInt32BE(0) % 36 ** 4).toString(36).padStart(4, '0');
}

export async function summaryRoutes(api: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, now } = ctx;

  api.get('/summary', async (req) => buildSummary(db, me(req).id, todayInToronto(now())));

  api.put('/finish-tests/:id', async (req): Promise<FinishTest> => {
    const user = me(req);
    const { id } = parse(idParams, req.params, 'params');
    const body = parse(putFinishTestBody, req.body, 'body');
    if (body.testedOn) {
      const today = todayInToronto(now());
      if (body.testedOn > today) throw badRequest('future_date', `${body.testedOn} is after today (${today}).`);
      const challenge = await loadChallenge(db);
      if (body.testedOn < challenge.startDate) {
        throw badRequest('before_start', `${body.testedOn} is before the challenge start (${challenge.startDate}).`);
      }
    }
    // Omitted fields keep their stored value; null clears. An empty result is the same as none.
    const result = body.result === undefined ? undefined : body.result?.trim() || null;
    const row = await db
      .updateTable('finish_tests')
      .set({
        passed: body.passed,
        ...(result !== undefined ? { result } : {}),
        ...(body.testedOn !== undefined ? { tested_on: body.testedOn } : {}),
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .where('user_id', '=', user.id)
      .returning(FINISH_TEST_COLUMNS)
      .executeTakeFirst();
    if (!row) throw notFound(`No finish test ${id} of yours.`);
    return finishTestView(row);
  });

  api.post('/finish-tests', async (req, reply) => {
    const user = me(req);
    const { label } = parse(postFinishTestBody, req.body, 'body');
    const row = await db.transaction().execute(async (trx) => {
      const count = await trx
        .selectFrom('finish_tests')
        .select(sql<string>`count(*)`.as('n'))
        .where('user_id', '=', user.id)
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= FINISH_TESTS_MAX) {
        throw badRequest('too_many', `You already have ${FINISH_TESTS_MAX} finish tests; delete one first.`);
      }
      return trx
        .insertInto('finish_tests')
        .values({ user_id: user.id, key: `${slugify(label)}-${shortSuffix()}`, label })
        .returning(FINISH_TEST_COLUMNS)
        .executeTakeFirstOrThrow();
    });
    return reply.status(201).send(finishTestView(row));
  });

  api.delete('/finish-tests/:id', async (req, reply) => {
    const user = me(req);
    const { id } = parse(idParams, req.params, 'params');
    const result = await db.deleteFrom('finish_tests').where('id', '=', id).where('user_id', '=', user.id).executeTakeFirst();
    if ((result.numDeletedRows ?? 0n) === 0n) throw notFound(`No finish test ${id} of yours.`);
    return reply.status(204).send();
  });
}
