/**
 * Render every slide of one project, with its real photographs, and report the
 * layout gates. The last check before a deck is handed to a human to publish.
 *
 *   npx tsx src/scripts/verifyDeck.ts <projectId>
 */
import { connectDb, disconnectDb } from '../db';
import { config } from '../config';
import { layoutFaults } from '../lib/htmlDirector/renderCheck';

(async () => {
  const id = process.argv[2];
  if (!id) throw new Error('usage: verifyDeck.ts <projectId>');
  await connectDb();
  const { ProjectModel } = await import('../models');
  // `.lean()` widens to a union that includes an array, so the shape this needs
  // is named rather than inferred.
  const project = (await ProjectModel.findById(id).lean()) as
    | { slides?: Array<{ id: string; authored?: { role?: string } }> }
    | null;
  if (!project) throw new Error(`no project ${id}`);

  const { getBrowser } = await import('../lib/browser');
  const page = await (await getBrowser()).newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
  let bad = 0;
  try {
    for (const [i, slide] of (project.slides ?? []).entries()) {
      await page.goto(`${config.webUrl}/render?projectId=${id}&slideId=${slide.id}`, {
        waitUntil: 'load',
        timeout: 45000,
      });
      await page.waitForSelector('[data-slide-root]', { timeout: 25000 });
      await page.waitForFunction(() => document.body.dataset.overflow !== undefined, { timeout: 25000 });
      await new Promise((r) => setTimeout(r, 350));
      const d = await page.evaluate(() => ({ ...document.body.dataset }));
      /**
       * Judge with the SAME gates compose uses, not a subset of them.
       *
       * This reported "ok" on two slides sitting at 65% slack — a `feature` role
       * whose limit is 50% — because it only looked at overflow and collision.
       * A verification that checks less than the thing it verifies is worse than
       * none: it was used to sign off a deck that the real gate would refuse.
       */
      const verdict = {
        state: d.overflow === 'true' ? ('overflows' as const) : ('fits' as const),
        collide: d.collide === 'true',
        slack: Number(d.slack) || 0,
        headlineLines: Number(d.headlineLines) || 0,
      };
      const faults = layoutFaults(verdict, undefined, slide.authored?.role);
      const flag = faults.length ? faults.join(', ') : 'ok';
      if (faults.length) bad += 1;
      console.log(
        `  slide ${i + 1} ${String(slide.authored?.role ?? '?').padEnd(10)} ${flag.padEnd(22)} ` +
          `slack ${(Number(d.slack) * 100).toFixed(0).padStart(2)}%  headline ${d.headlineLines}L`,
      );
    }
  } finally {
    await page.close().catch(() => {});
  }
  console.log(bad ? `\n${bad} slide(s) need attention` : '\nevery slide renders clean, with its photograph');
  await disconnectDb();
})().catch(async (e) => {
  console.error('FAILED', e);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
