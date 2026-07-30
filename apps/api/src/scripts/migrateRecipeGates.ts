/**
 * Apply the author-time recipe gates to recipes already in the database, so the
 * stored CSS matches what the current pipeline would produce and the renderer's
 * floor becomes a safety net instead of a permanent crutch.
 *
 *   npm run migrate:recipes -- --dry-run   # report only, writes nothing
 *   npm run migrate:recipes                # actually repair
 *
 * No model is called and no design decision changes — every repair is one of
 * the deterministic gates, and each is idempotent.
 */
import { connectDb, disconnectDb } from '../db';
import { config } from '../config';
import { formatRecipeGateSummary, runRecipeGateMigration } from '../lib/recipeGateMigration';

const dryRun = process.argv.slice(2).some((a) => a === '--dry-run' || a === '-n');

(async () => {
  await connectDb();
  console.log(
    `[migrate:recipes] ${dryRun ? 'dry run against' : 'repairing'} ${config.mongoUri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@')}`,
  );
  console.log(formatRecipeGateSummary(await runRecipeGateMigration({ dryRun })));
  await disconnectDb();
})().catch(async (err) => {
  console.error('[migrate:recipes] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
