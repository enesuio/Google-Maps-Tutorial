import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z, type ZodTypeAny } from 'zod';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  consumeSetupToken,
  createSession,
  deleteSession,
  findSessionUser,
  type SessionUser,
} from './auth.js';
import { loadConfig, type Config } from './config.js';
import { dateSchema, todayInToronto } from './dates.js';
import { createDb, createPool, type Db } from './db.js';
import { HttpError, badRequest, unauthenticated } from './errors.js';
import { buildDayView, buildHistoryView, loadChallenge, type DayView } from './views.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionId: string | null;
  }
}

export interface BuildAppOptions {
  /** Overrides for env-derived config (tests pass DATABASE_URL etc.). */
  config?: Partial<Config>;
  /** Share an existing Kysely instance; the app then does not close it. */
  db?: Db;
  /** Clock, injectable for date-boundary tests. */
  now?: () => Date;
  /** Serve the web build with SPA fallback. Defaults to NODE_ENV === 'production'. */
  serveStatic?: boolean;
  /** Directory of the web build. Defaults to ../web/dist relative to the api package. */
  webDist?: string;
  logger?: boolean;
}

// api/src/app.ts → ../../web/dist ; api/dist/app.js → ../../web/dist
const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

function parse<T extends ZodTypeAny>(schema: T, input: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || what}: ${i.message}`).join('; ');
    throw badRequest('bad_request', `Invalid ${what}: ${detail}`);
  }
  return result.data;
}

const dateParams = z.object({ date: dateSchema });
const tokenParams = z.object({ token: z.string().min(1).max(512) });
const historyQuery = z.object({ from: dateSchema.optional(), to: dateSchema.optional() });
const putCheckinsBody = z.object({
  entries: z
    .array(
      z.object({
        goalId: z.number().int().positive(),
        value: z.union([z.number().finite(), z.boolean(), z.null()]),
      }),
    )
    .max(200),
});

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config: Config = { ...loadConfig({ ...process.env, ...stringifyEnv(opts.config) }) };
  const now = opts.now ?? (() => new Date());
  const ownsDb = !opts.db;
  const db = opts.db ?? createDb(createPool(config.DATABASE_URL));
  const isProd = config.NODE_ENV === 'production';

  const app = Fastify({ logger: opts.logger ?? !isTest(config), trustProxy: true });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  if (ownsDb) app.addHook('onClose', async () => db.destroy());

  await app.register(fastifyCookie, { secret: config.SESSION_SECRET });

  // ---- Errors ----
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      const code = e.statusCode === 404 ? 'not_found' : e.statusCode === 401 ? 'unauthenticated' : 'bad_request';
      return reply.status(e.statusCode).send({ error: { code, message: e.message ?? 'Bad request' } });
    }
    app.log.error(err);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  // ---- Public ----
  app.get('/health', async (_req, reply) => {
    try {
      await sql`select 1`.execute(db);
      return { ok: true, db: true };
    } catch (err) {
      app.log.error(err, 'health check: database unreachable');
      return reply.status(503).send({ ok: false, db: false });
    }
  });

  app.get('/setup/:token', async (req, reply) => {
    const { token } = parse(tokenParams, req.params, 'params');
    const userId = await consumeSetupToken(db, token);
    if (userId === null) {
      return reply
        .status(404)
        .type('text/html; charset=utf-8')
        .send(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hydrox 45</title></head>' +
            '<body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center"><h1>This link is invalid or already used.</h1><p>Ask for a new setup link.</p></body></html>',
        );
    }
    const sessionId = await createSession(db, userId, now());
    reply.setCookie(SESSION_COOKIE, sessionId, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return reply.redirect('/', 302);
  });

  // ---- Authenticated /api/* ----
  await app.register(
    async (api) => {
      api.addHook('preHandler', async (req: FastifyRequest) => {
        const raw = req.cookies[SESSION_COOKIE];
        if (!raw) throw unauthenticated();
        const unsigned = api.unsignCookie(raw);
        if (!unsigned.valid || !unsigned.value) throw unauthenticated();
        const user = await findSessionUser(db, unsigned.value, now());
        if (!user) throw unauthenticated();
        req.user = user;
        req.sessionId = unsigned.value;
      });

      const me = (req: FastifyRequest): SessionUser => {
        if (!req.user) throw unauthenticated();
        return req.user;
      };

      api.post('/logout', async (req, reply) => {
        if (req.sessionId) await deleteSession(db, req.sessionId);
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return reply.status(204).send();
      });

      api.get('/me', async (req) => {
        const user = me(req);
        return { user: { id: user.id, slug: user.slug, name: user.name } };
      });

      api.get('/today', async (req) => {
        const today = todayInToronto(now());
        return buildDayView(db, me(req).id, today, today);
      });

      api.get('/days/:date', async (req) => {
        const { date } = parse(dateParams, req.params, 'params');
        const today = todayInToronto(now());
        if (date > today) throw badRequest('future_date', `${date} is after today (${today}).`);
        return buildDayView(db, me(req).id, date, today);
      });

      api.put('/checkins/:date', async (req) => {
        const user = me(req);
        const { date } = parse(dateParams, req.params, 'params');
        const body = parse(putCheckinsBody, req.body, 'body');
        const today = todayInToronto(now());
        if (date > today) throw badRequest('future_date', `${date} is after today (${today}).`);
        const challenge = await loadChallenge(db);
        if (date < challenge.startDate) {
          throw badRequest('before_start', `${date} is before the challenge start (${challenge.startDate}).`);
        }
        const myGoals = await db
          .selectFrom('goals')
          .select('id')
          .where('user_id', '=', user.id)
          .where('active', '=', true)
          .execute();
        const allowed = new Set(myGoals.map((g) => g.id));
        const bad = body.entries.find((e) => !allowed.has(e.goalId));
        if (bad) throw badRequest('not_your_goal', `Goal ${bad.goalId} is not one of your active goals.`);

        await db.transaction().execute(async (trx) => {
          for (const entry of body.entries) {
            if (entry.value === null) {
              await trx
                .deleteFrom('checkins')
                .where('user_id', '=', user.id)
                .where('date', '=', date)
                .where('goal_id', '=', entry.goalId)
                .execute();
              continue;
            }
            const value = typeof entry.value === 'boolean' ? (entry.value ? 1 : 0) : entry.value;
            await trx
              .insertInto('checkins')
              .values({ user_id: user.id, date, goal_id: entry.goalId, value })
              .onConflict((oc) =>
                oc.columns(['user_id', 'date', 'goal_id']).doUpdateSet({ value, updated_at: sql`now()` }),
              )
              .execute();
          }
        });

        const view: DayView = await buildDayView(db, user.id, date, today);
        return view;
      });

      api.get('/history', async (req) => {
        const query = parse(historyQuery, req.query, 'query');
        return buildHistoryView(db, me(req).id, todayInToronto(now()), query);
      });
    },
    { prefix: '/api' },
  );

  // ---- Static web build (production) with SPA fallback ----
  const webDist = opts.webDist ?? WEB_DIST;
  const serveStatic = (opts.serveStatic ?? isProd) && existsSync(path.join(webDist, 'index.html'));
  if (serveStatic) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: true });
  } else if (opts.serveStatic ?? isProd) {
    app.log.warn({ dir: webDist }, 'web/dist not found; static files are not served');
  }

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    if (req.url.startsWith('/api/') || req.url === '/api') {
      return reply.status(404).send({ error: { code: 'not_found', message: `No route ${req.method} ${req.url}` } });
    }
    if (serveStatic && req.method === 'GET') {
      return reply.sendFile('index.html');
    }
    return reply
      .status(404)
      .type('text/html; charset=utf-8')
      .send('<!doctype html><html lang="en"><body><h1>Not found</h1></body></html>');
  });

  return app;
}

function isTest(config: Config): boolean {
  return config.NODE_ENV === 'test';
}

/** process.env only holds strings; partial Config overrides may hold numbers. */
function stringifyEnv(partial: Partial<Config> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!partial) return out;
  for (const [k, v] of Object.entries(partial)) if (v !== undefined) out[k] = String(v);
  return out;
}
