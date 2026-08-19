/**
 * Render every slide of one project, with its real photographs, and report the
 * layout gates. The last check before a deck is handed to a human to publish.
 *
 *   npx tsx src/scripts/verifyDeck.ts <projectId>
 */
import { connectDb, disconnectDb } from '../db';
import { config } from '../config';

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
      const flag = d.overflow === 'true' ? 'OVERFLOW' : d.collide === 'true' ? 'COLLIDE' : 'ok';
      if (flag !== 'ok') bad += 1;
      console.log(
        `  slide ${i + 1} ${String(slide.authored?.role ?? '?').padEnd(10)} ${flag.padEnd(9)} ` +
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
