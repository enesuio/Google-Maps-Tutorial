import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

// Works from both src/ (tsx) and dist/ (compiled): migrations/ is a sibling of each.
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies every `.sql` file in `api/migrations/` in filename order, each inside its own
 * transaction, recording the name in `schema_migrations`. Already-applied files are skipped.
 */
export async function runMigrations(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<MigrateResult> {
  const client = await pool.connect();
  const result: MigrateResult = { applied: [], skipped: [] };
  try {
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    // Serialize concurrent runners (e.g. two containers starting at once).
    await client.query('select pg_advisory_lock(727_001)');
    try {
      const done = new Set(
        (await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name),
      );
      const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        if (done.has(file)) {
          result.skipped.push(file);
          continue;
        }
        const sqlText = await readFile(path.join(dir, file), 'utf8');
        await client.query('begin');
        try {
          await client.query(sqlText);
          await client.query('insert into schema_migrations (name) values ($1)', [file]);
          await client.query('commit');
        } catch (err) {
          await client.query('rollback');
          throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        result.applied.push(file);
      }
    } finally {
      await client.query('select pg_advisory_unlock(727_001)');
    }
  } finally {
    client.release();
  }
  return result;
}
