/**
 * Rewrite legacy absolute media URLs (`http://localhost:4000/media/x.png`) to
 * their root-relative form (`/media/x.png`), so stored records stop depending
 * on the API keeping one particular port.
 *
 *   npm run migrate:media-urls -- --dry-run   # report only, writes nothing
 *   npm run migrate:media-urls                # actually migrate
 *
 * Idempotent: run it twice and the second run reports zero changes.
 * Honours MONGODB_URI through the API's own config/db bootstrap.
 */
import { connectDb, disconnectDb } from '../db';
import { config } from '../config';
import { formatMediaUrlMigrationSummary, runMediaUrlMigration } from '../lib/mediaUrlMigration';

const dryRun = process.argv.slice(2).some((a) => a === '--dry-run' || a === '-n');

(async () => {
  await connectDb();
  console.log(
    `[migrate:media-urls] ${dryRun ? 'dry run against' : 'migrating'} ${config.mongoUri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@')}`,
  );
  const stats = await runMediaUrlMigration({ dryRun });
  console.log(formatMediaUrlMigrationSummary(stats));
  await disconnectDb();
})().catch(async (err) => {
  console.error('[migrate:media-urls] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
