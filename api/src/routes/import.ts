import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dateSchema, todayInToronto } from '../dates.js';
import { HttpError, badRequest } from '../errors.js';
import {
  applyHealthImport,
  createImportToken,
  findImportTokenUser,
  importStatus,
  revokeImportTokens,
  touchImportToken,
} from '../import.js';
import { parse } from '../validate.js';
import { loadChallenge } from '../views.js';
import { me, type RouteContext } from './context.js';

/** Shortcuts sends numbers as text ("8421", "512.3", even "8,421"): coerce before validating. */
const numeric = (schema: z.ZodNumber) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const cleaned = v.trim().replace(/,/g, '');
    return cleaned !== '' && !Number.isNaN(Number(cleaned)) ? Number(cleaned) : v;
  }, schema);

const importBody = z
  .object({
    date: dateSchema.optional(),
    // Health sums can arrive as "8421.0"; round to the integer the contract asks for.
    steps: numeric(z.number().finite().min(0)).transform((n) => Math.round(n)).optional(),
    activeKcal: numeric(z.number().finite().min(0)).optional(),
  })
  .refine((b) => b.steps !== undefined || b.activeKcal !== undefined, {
    message: 'send at least one of steps, activeKcal',
  });

const badToken = (): HttpError =>
  new HttpError(401, 'bad_token', 'Send a valid import token as "Authorization: Bearer <token>".');

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m?.[1] ?? null;
}

/**
 * `POST /api/import`: the iOS Shortcut's endpoint. Authenticated by the per-user bearer token, not
 * the session cookie, so it lives in its own encapsulated plugin next to the cookie-protected
 * `/api/*` context instead of being special-cased inside the cookie hook.
 */
export async function importIngestRoute(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, now, jobs } = ctx;
  await app.register(
    async (bearer) => {
      bearer.addHook('preHandler', async (req: FastifyRequest) => {
        const token = bearerToken(req);
        if (!token) throw badToken();
        const user = await findImportTokenUser(db, token);
        if (!user) throw badToken();
        req.user = user;
      });

      bearer.post('/import', async (req) => {
        const user = me(req);
        const token = bearerToken(req);
        const body = parse(importBody, req.body ?? {}, 'body');
        const today = todayInToronto(now());
        const date = body.date ?? today;
        if (date > today) throw badRequest('future_date', `${date} is after today (${today}).`);
        const challenge = await loadChallenge(db);
        if (date < challenge.startDate) {
          throw badRequest('before_start', `${date} is before the challenge start (${challenge.startDate}).`);
        }
        const result = await applyHealthImport(db, jobs, user.id, { date, steps: body.steps, activeKcal: body.activeKcal }, today);
        if (token) await touchImportToken(db, token, now());
        return result;
      });
    },
    { prefix: '/api' },
  );
}

/** Cookie-authenticated token management, registered inside the `/api` session context. */
export async function importRoutes(api: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, now } = ctx;

  api.get('/import/status', async (req) => importStatus(db, me(req).id));

  api.post('/import/token', async (req, reply) => {
    const token = await createImportToken(db, me(req).id, now());
    return reply.status(201).send({ token });
  });

  api.delete('/import/token', async (req, reply) => {
    await revokeImportTokens(db, me(req).id, now());
    return reply.status(204).send();
  });
}
