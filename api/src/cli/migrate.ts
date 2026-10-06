import { cliConfig } from './_env.js';
import { createPool } from '../db.js';
import { runMigrations } from '../migrate.js';

const config = cliConfig();
const pool = createPool(config.DATABASE_URL);
try {
  const result = await runMigrations(pool);
  for (const name of result.skipped) console.log(`skip   ${name}`);
  for (const name of result.applied) console.log(`apply  ${name}`);
  console.log(`migrations: ${result.applied.length} applied, ${result.skipped.length} already applied`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
