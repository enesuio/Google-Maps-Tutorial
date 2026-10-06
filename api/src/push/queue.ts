import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Db } from '../db.js';
import { runJob, type JobData, type JobName } from './jobs.js';
import type { PushSender } from './sender.js';

export const QUEUE_NAME = 'hydrox';
export const EVENING_REMINDER_PATTERN = '0 21 * * *';
export const TORONTO_TZ = 'America/Toronto';

export interface Jobs {
  /** False when REDIS_URL or VAPID is missing; `enqueue` is then a no-op. */
  enabled: boolean;
  enqueue<N extends JobName>(name: N, data: JobData[N]): Promise<void>;
  close(): Promise<void>;
}

export interface JobsLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface CreateJobsOptions {
  db: Db;
  sender: PushSender;
  /** Clock; the worker passes `now()` to each handler. */
  now?: () => Date;
  /** Redis connection string; missing → disabled stub. */
  redisUrl?: string | undefined;
  /** Whether VAPID is configured; false → disabled stub. */
  vapidConfigured: boolean;
  logger?: JobsLogger;
  /** Queue name override (tests use a unique one). */
  queueName?: string;
  /** Register the repeatable evening reminder (default true). */
  schedule?: boolean;
}

const silent: JobsLogger = { info() {}, warn() {}, error() {} };

/** Stable job ids so the same event never notifies twice while a job is still queued. */
function jobIdFor<N extends JobName>(name: N, data: JobData[N]): string | undefined {
  switch (name) {
    case 'partner-checkin': {
      const d = data as JobData['partner-checkin'];
      return `partner-checkin-${d.userId}-${d.date}`; // BullMQ forbids ':' in custom ids
    }
    case 'cheer':
      return `cheer-${(data as JobData['cheer']).cheerId}`;
    default:
      return undefined;
  }
}

/**
 * BullMQ queue + in-process worker on the `hydrox` queue, with the repeatable 21:00 Toronto
 * evening reminder. Returns a disabled stub (one warning, no-op enqueue) when Redis or VAPID
 * is not configured, so every other feature keeps working.
 */
export function createJobs(opts: CreateJobsOptions): Jobs {
  const log = opts.logger ?? silent;
  const now = opts.now ?? (() => new Date());

  if (!opts.redisUrl || !opts.vapidConfigured) {
    const missing = [
      !opts.redisUrl ? 'REDIS_URL' : null,
      !opts.vapidConfigured ? 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT' : null,
    ].filter((m): m is string => m !== null);
    log.warn({ missing }, 'push notifications and jobs are disabled (set REDIS_URL and the VAPID keys to enable)');
    return {
      enabled: false,
      async enqueue() {
        /* disabled */
      },
      async close() {
        /* nothing to close */
      },
    };
  }

  const queueName = opts.queueName ?? QUEUE_NAME;
  // BullMQ needs maxRetriesPerRequest: null; the worker duplicates this for its blocking connection.
  const connection = new Redis(opts.redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: true });
  let loggedError = false;
  connection.on('error', (err: Error) => {
    if (!loggedError) log.error({ err: err.message }, 'redis connection error (jobs will retry)');
    loggedError = true;
  });
  connection.on('ready', () => {
    loggedError = false;
  });

  const queue = new Queue(queueName, {
    connection,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
  });
  queue.on('error', () => {
    /* reported through the shared connection listener above */
  });

  const worker = new Worker(
    queueName,
    async (job) => {
      const name = job.name as JobName;
      // BullMQ job data is untyped; handlers validate what they read from the DB.
      await runJob(opts.db, opts.sender, now(), name, job.data as JobData[JobName]);
    },
    { connection, concurrency: 2 },
  );
  worker.on('failed', (job, err) => log.error({ job: job?.name, id: job?.id, err: err.message }, 'job failed'));
  worker.on('error', () => {
    /* reported through the shared connection listener above */
  });

  if (opts.schedule ?? true) {
    queue
      .upsertJobScheduler(
        'evening-reminder',
        { pattern: EVENING_REMINDER_PATTERN, tz: TORONTO_TZ },
        { name: 'evening-reminder', data: {} },
      )
      .then(() => log.info({ pattern: EVENING_REMINDER_PATTERN, tz: TORONTO_TZ }, 'evening reminder scheduled'))
      .catch((err: unknown) => log.error({ err: err instanceof Error ? err.message : String(err) }, 'could not schedule the evening reminder'));
  }

  return {
    enabled: true,
    async enqueue(name, data) {
      const jobId = jobIdFor(name, data);
      // A push problem must never fail the request that triggered it; the data is already saved.
      try {
        await queue.add(name, data, jobId ? { jobId } : {});
      } catch (err: unknown) {
        log.error({ job: name, err: err instanceof Error ? err.message : String(err) }, 'could not enqueue job');
      }
    },
    async close() {
      await worker.close();
      await queue.close();
      connection.disconnect();
    },
  };
}
