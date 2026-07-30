/**
 * Fold every legacy slide-level `mediaAssetId` into the slide's `photos[]` as a
 * background, then drop the field — in projects and in version snapshots.
 * Idempotent: run it twice and the second run reports zero changes.
 *
 *   npm run migrate:photos -- --dry-run   # report only, writes nothing
 *   npm run migrate:photos                # actually migrate
 *
 * Honours MONGODB_URI through the API's own config/db bootstrap.
 */
import { connectDb, disconnectDb } from '../db';
import { config } from '../config';
import { formatMigrationSummary, runLegacyPhotoMigration } from '../lib/legacyPhotoMigration';

const dryRun = process.argv.slice(2).some((a) => a === '--dry-run' || a === '-n');

(async () => {
  await connectDb();
  console.log(
    `[migrate:photos] ${dryRun ? 'dry run against' : 'migrating'} ${config.mongoUri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@')}`,
  );
  const stats = await runLegacyPhotoMigration({ dryRun });
  console.log(formatMigrationSummary(stats));
  await disconnectDb();
})().catch(async (err) => {
  console.error('[migrate:photos] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
