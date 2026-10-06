import type { FastifyRequest } from 'fastify';
import type { SessionUser } from '../auth.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { unauthenticated } from '../errors.js';
import type { Jobs } from '../push/queue.js';
import type { PushSender } from '../push/sender.js';

/** What every authenticated route module needs from the app. */
export interface RouteContext {
  db: Db;
  config: Config;
  now: () => Date;
  jobs: Jobs;
  sender: PushSender;
  /** True when VAPID keys are present and the job queue is on. */
  pushEnabled: boolean;
  /** Absolute photo storage directory (UPLOADS_DIR), created on boot. */
  uploadsDir: string;
}

/** The session user set by the /api preHandler; throws 401 if somehow missing. */
export function me(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}
