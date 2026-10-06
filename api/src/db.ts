import { Kysely, PostgresDialect, type ColumnType, type Generated } from 'kysely';
import pg from 'pg';

// Return `date` columns as plain 'YYYY-MM-DD' strings instead of JS Dates, so a
// calendar date never shifts because of the process time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

/** numeric comes back from pg as a string; writers may pass numbers. */
type Numeric = ColumnType<string, number | string, number | string>;
type NullableNumeric = ColumnType<string | null, number | string | null, number | string | null>;

export type GoalKind = 'bool' | 'number';
export type GoalDirection = 'at_least' | 'at_most';
/** Who fills a goal's check-in: by hand, or the Apple Health import (steps / active energy). */
export type GoalSource = 'manual' | 'health_steps' | 'health_active_kcal';
export type PhotoKind = 'start' | 'progress' | 'end';

export interface UsersTable {
  id: Generated<number>;
  slug: string;
  name: string;
  timezone: Generated<string>;
  kcal_target: number | null;
  protein_target_g: number | null;
  created_at: Generated<Date>;
  metrics_shared: Generated<boolean>;
}

export interface ChallengesTable {
  id: Generated<number>;
  name: string;
  start_date: string; // YYYY-MM-DD
  length_days: number;
}

export interface GoalsTable {
  id: Generated<number>;
  user_id: number;
  key: string;
  label: string;
  kind: GoalKind;
  unit: string | null;
  direction: GoalDirection | null;
  daily_target: NullableNumeric;
  weekly_target: NullableNumeric;
  sort: Generated<number>;
  active: Generated<boolean>;
  source: Generated<GoalSource>;
}

export interface CheckinsTable {
  user_id: number;
  date: string; // YYYY-MM-DD
  goal_id: number;
  value: Numeric;
  updated_at: Generated<Date>;
}

export interface SessionsTable {
  id: string;
  user_id: number;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface SetupTokensTable {
  token: string;
  user_id: number;
  created_at: Generated<Date>;
  used_at: Date | null;
}

export interface CheersTable {
  id: Generated<number>;
  from_user: number;
  to_user: number;
  date: string; // YYYY-MM-DD
  emoji: string;
  note: string | null;
  created_at: Generated<Date>;
}

export interface BodyMetricsTable {
  user_id: number;
  date: string; // YYYY-MM-DD
  weight_kg: NullableNumeric;
  waist_cm: NullableNumeric;
  hips_cm: NullableNumeric;
  chest_cm: NullableNumeric;
  arm_cm: NullableNumeric;
  thigh_cm: NullableNumeric;
  updated_at: Generated<Date>;
}

export interface PushSubscriptionsTable {
  id: Generated<number>;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: Generated<Date>;
  last_error: string | null;
  failed_at: Date | null;
}

export interface HealthDailyTable {
  user_id: number;
  date: string; // YYYY-MM-DD
  steps: number | null;
  active_kcal: NullableNumeric;
  source: Generated<string>;
  updated_at: Generated<Date>;
}

export interface ImportTokensTable {
  token: string;
  user_id: number;
  created_at: Generated<Date>;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export interface PhotosTable {
  id: Generated<number>;
  user_id: number;
  date: string; // YYYY-MM-DD
  kind: PhotoKind;
  /** Relative to UPLOADS_DIR: `<userId>/<photoId>.<ext>`. */
  path: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  created_at: Generated<Date>;
}

/** Finish-line tests (T15): recorded once in the Day 45 summary, never tracked daily. */
export interface FinishTestsTable {
  id: Generated<number>;
  user_id: number;
  key: string;
  label: string;
  /** null = not tested yet */
  passed: boolean | null;
  result: string | null;
  tested_on: string | null; // YYYY-MM-DD
  updated_at: Generated<Date>;
}

export interface SchemaMigrationsTable {
  name: string;
  applied_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  challenges: ChallengesTable;
  goals: GoalsTable;
  checkins: CheckinsTable;
  sessions: SessionsTable;
  setup_tokens: SetupTokensTable;
  cheers: CheersTable;
  body_metrics: BodyMetricsTable;
  push_subscriptions: PushSubscriptionsTable;
  health_daily: HealthDailyTable;
  import_tokens: ImportTokensTable;
  photos: PhotosTable;
  finish_tests: FinishTestsTable;
  schema_migrations: SchemaMigrationsTable;
}

export type Db = Kysely<Database>;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
