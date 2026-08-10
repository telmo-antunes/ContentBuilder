/**
 * Report (and optionally remove) media records whose file is gone.
 *
 *   npm run media:orphans                    # report, write nothing
 *   npm run media:orphans -- --apply         # remove the unreferenced ones
 *   npm run media:orphans -- --business <id> # one brand only
 */
import { connectDb, disconnectDb } from '../db';
import { formatOrphanReport, sweepOrphanedMedia } from '../lib/orphanMedia';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const apply = process.argv.includes('--apply');
  await connectDb();
  const report = await sweepOrphanedMedia({ businessId: arg('business'), apply });
  console.log(formatOrphanReport(report));
  if (!apply && report.orphans.length) {
    console.log('\nRe-run with --apply to remove the ones nothing points at.');
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[media:orphans] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
