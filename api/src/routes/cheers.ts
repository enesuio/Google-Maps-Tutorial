import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateSchema, todayInToronto } from '../dates.js';
import { badRequest, notFound } from '../errors.js';
import { parse } from '../validate.js';
import { CHEER_EMOJI, cheerView, loadChallenge, type Cheer } from '../views.js';
import { me, type RouteContext } from './context.js';

const postCheerBody = z.object({
  toUserId: z.number().int().positive(),
  date: dateSchema,
  emoji: z.enum(CHEER_EMOJI),
  note: z.string().max(140).optional(),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });

export async function cheerRoutes(api: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, now, jobs } = ctx;

  api.post('/cheers', async (req, reply) => {
    const user = me(req);
    const body = parse(postCheerBody, req.body, 'body');
    if (body.toUserId === user.id) throw badRequest('bad_request', 'You cannot cheer yourself.');
    const today = todayInToronto(now());
    if (body.date > today) throw badRequest('future_date', `${body.date} is after today (${today}).`);
    const challenge = await loadChallenge(db);
    if (body.date < challenge.startDate) {
      throw badRequest('before_start', `${body.date} is before the challenge start (${challenge.startDate}).`);
    }
    const receiver = await db.selectFrom('users').select('id').where('id', '=', body.toUserId).executeTakeFirst();
    if (!receiver) throw badRequest('bad_request', `No user ${body.toUserId}.`);

    const note = body.note?.trim() ? body.note.trim() : null;
    const row = await db
      .insertInto('cheers')
      .values({ from_user: user.id, to_user: body.toUserId, date: body.date, emoji: body.emoji, note })
      .returning(['id', 'from_user', 'to_user', 'date', 'emoji', 'note', 'created_at'])
      .executeTakeFirstOrThrow();
    const cheer: Cheer = cheerView(row);
    await jobs.enqueue('cheer', { cheerId: cheer.id });
    return reply.status(201).send(cheer);
  });

  api.delete('/cheers/:id', async (req, reply) => {
    const user = me(req);
    const { id } = parse(idParams, req.params, 'params');
    const result = await db.deleteFrom('cheers').where('id', '=', id).where('from_user', '=', user.id).executeTakeFirst();
    if ((result.numDeletedRows ?? 0n) === 0n) throw notFound(`No cheer ${id} sent by you.`);
    return reply.status(204).send();
  });
}
