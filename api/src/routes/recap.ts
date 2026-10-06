import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateSchema, todayInToronto } from '../dates.js';
import { assertRecapWeekInRange, buildRecap, defaultRecapWeek, weekStartOf } from '../recap.js';
import { parse } from '../validate.js';
import { loadChallenge } from '../views.js';
import { me, type RouteContext } from './context.js';

const recapQuery = z.object({ week: dateSchema.optional() });

export async function recapRoutes(api: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, now } = ctx;

  // `?week=` is any date in the wanted week; default = the most recent completed week, or the
  // current one while the challenge is in its first week.
  api.get('/recap', async (req) => {
    const user = me(req);
    const { week } = parse(recapQuery, req.query, 'query');
    const today = todayInToronto(now());
    const challenge = await loadChallenge(db);
    const weekStart = week ? weekStartOf(week) : defaultRecapWeek(today, challenge);
    assertRecapWeekInRange(weekStart, today, challenge);
    return buildRecap(db, user.id, weekStart, today);
  });
}
