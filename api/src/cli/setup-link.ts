import { cliConfig } from './_env.js';
import { createSetupToken } from '../auth.js';
import { createDb, createPool } from '../db.js';

const slug = process.argv[2];
if (!slug) {
  console.error('usage: pnpm setup-link <slug>');
  process.exit(1);
}

const config = cliConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
try {
  const user = await db.selectFrom('users').select(['id', 'name']).where('slug', '=', slug).executeTakeFirst();
  if (!user) {
    console.error(`no user with slug "${slug}" (run pnpm seed first?)`);
    process.exitCode = 1;
  } else {
    const token = await createSetupToken(db, user.id);
    console.log(`${config.APP_ORIGIN}/setup/${token}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
