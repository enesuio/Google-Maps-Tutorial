import { cliConfig } from './_env.js';
import { createDb, createPool } from '../db.js';
import { runSeed, SEED_PATH } from '../seed.js';

const config = cliConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
try {
  await runSeed(db);
  console.log(`seeded from ${SEED_PATH}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
