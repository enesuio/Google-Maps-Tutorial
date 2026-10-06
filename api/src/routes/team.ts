import type { FastifyInstance } from 'fastify';
import { todayInToronto } from '../dates.js';
import { buildTeamView } from '../team.js';
import { me, type RouteContext } from './context.js';

export async function teamRoutes(api: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, now } = ctx;
  api.get('/team', async (req) => buildTeamView(db, me(req).id, todayInToronto(now())));
}
