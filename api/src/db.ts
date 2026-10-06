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

export interface UsersTable {
  id: Generated<number>;
  slug: string;
  name: string;
  timezone: Generated<string>;
  kcal_target: number | null;
  protein_target_g: number | null;
  created_at: Generated<Date>;
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
  schema_migrations: SchemaMigrationsTable;
}

export type Db = Kysely<Database>;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
