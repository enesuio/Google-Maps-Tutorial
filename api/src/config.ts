import { z } from 'zod';

/** Treat an empty env var the same as an unset one (e.g. `VAPID_PUBLIC_KEY=` in .env). */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  TZ: z.string().min(1).default('America/Toronto'),
  /** Photo storage (T14): `<UPLOADS_DIR>/<userId>/<photoId>.<ext>`; created on boot. */
  UPLOADS_DIR: z.string().min(1).default('./uploads'),
  // Push + jobs (T7). All four must be set for push to be enabled; otherwise it is disabled
  // with one warning and everything else keeps working.
  REDIS_URL: optionalString,
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^(mailto:|https:)/, 'VAPID_SUBJECT must be a mailto: or https: URL').optional(),
  ),
});

export type Config = z.infer<typeof configSchema>;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Validates environment variables. Throws a readable error listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

/** The VAPID key set when all three variables are present, else null. */
export function vapidFromConfig(config: Config): VapidConfig | null {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT) return null;
  return { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT };
}
