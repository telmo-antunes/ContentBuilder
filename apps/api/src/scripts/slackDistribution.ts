/**
 * What does slack read on slides that ACTUALLY SHIPPED?
 *
 * The threshold is only meaningful against the real distribution: a gate that
 * fires on every well-composed slide is as useless as one that never fires.
 * Renders every stored authored slide and reports its slack, so MAX_SLACK can
 * be set from the spread rather than chosen.
 *
 *   npx tsx src/scripts/slackDistribution.ts
 */
import { connectDb, disconnectDb } from '../db';
import { maxSlackFor, openRenderProbe } from '../lib/htmlDirector/renderCheck';
import { config } from '../config';
import type { BrandRecipe } from '@contentbuilder/shared';

interface Sample {
  title: string;
  index: number;
  role: string;
  html: string;
  recipe: BrandRecipe;
}

(async () => {
  await connectDb();
  const { ProjectModel, BrandKitModel } = await import('../models');
  const { BusinessModel } = await import('../models');
  /**
   * A render-check scaffold COPIES the recipe it is measuring, so a leaked one
   * reads as an extra brand with identical geometry — and every run of this
   * script creates more. Sampling them double-counts whatever they cloned and
   * makes the ordering unstable between runs.
   */
  const scaffoldBusinessIds = new Set(
    (await BusinessModel.find({ name: /^__/ }).select('_id').lean()).map((b) => String(b._id)),
  );
  const { default: mongoose } = await import('mongoose');

  // Source slides from every local database, not just the one the web app reads
  // — the worktree database holds the decks that shipped most recently.
  const conn = mongoose.connection;
  const dbNames: string[] = (await conn.db!.admin().listDatabases()).databases
    .map((d: { name: string }) => d.name)
    .filter((n: string) => n.startsWith('contentbuilder'));

  const recipeByBusiness = new Map<string, BrandRecipe>();
  for (const k of await BrandKitModel.find({ recipe: { $exists: true } }).lean()) {
    if (scaffoldBusinessIds.has(String(k.businessId))) continue;
    if (k.recipe) recipeByBusiness.set(String(k.businessId), k.recipe as BrandRecipe);
  }
  const fallback = [...recipeByBusiness.values()][0];
  if (!fallback) throw new Error('no recipe anywhere');

  const samples: Sample[] = [];
  for (const name of dbNames) {
    const projects = await conn
      .getClient()
      .db(name)
      .collection('projects')
      .find({ format: '1080x1350' })
      .toArray();
    for (const p of projects) {
      if (String(p.title ?? '').startsWith('__')) continue; // render-check scaffolds
      const recipe = recipeByBusiness.get(String(p.businessId)) ?? fallback;
      (p.slides ?? []).forEach((s: { authored?: { html?: string; role?: string } }, i: number) => {
        if (s.authored?.html) {
          samples.push({
            title: String(p.title ?? name),
            index: i,
            role: s.authored.role ?? '?',
            html: s.authored.html,
            recipe,
          });
        }
      });
    }
  }

  if (!samples.length) {
    console.log('no shipped slides found');
    await disconnectDb();
    return;
  }
  console.log(`measuring ${samples.length} shipped slides against ${config.webUrl}\n`);

  const results: Array<{ slack: number; role: string; state: string; collide: boolean; label: string }> = [];
  // One scaffold per recipe keeps the page pool warm and the styling honest.
  for (const recipe of new Set(samples.map((s) => s.recipe))) {
    const mine = samples.filter((s) => s.recipe === recipe);
    const probe = await openRenderProbe(recipe, '1080x1350', mine.map((m) => ({ html: m.html, role: m.role })));
    try {
      const verdicts = await probe.measure(mine.map((m, i) => ({ index: i, html: m.html })));
      verdicts.forEach((v, i) => {
        const m = mine[i]!;
        if (v.state === 'unknown') return;
        results.push({
          slack: v.slack,
          role: m.role,
          state: v.state,
          collide: v.collide,
          label: `${m.title.slice(0, 26)} #${m.index + 1} ${m.role}`,
        });
      });
    } finally {
      await probe.close();
    }
  }

  /**
   * REGRESSION CHECK. These slides all SHIPPED, so they rendered acceptably at
   * the time. Anything that overflows or collides now is something a later
   * change did to them — which matters because the type, measure, story-reserve
   * and descender floors all rewrite CSS for every brand at render.
   */
  const broken = results.filter((r) => r.state === 'overflows' || r.collide);
  console.log(`overflowing or colliding: ${broken.length} of ${results.length}`);
  broken.forEach((r) => console.log(`    ${r.state === 'overflows' ? 'OVERFLOW' : 'COLLIDE '}  ${r.label}`));
  console.log('');

  results.sort((a, b) => b.slack - a.slack);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const at = (q: number) => results[Math.min(results.length - 1, Math.floor(results.length * q))]!.slack;

  console.log(`n=${results.length}  max=${pct(results[0]!.slack)}  p75=${pct(at(0.25))}  ` +
    `median=${pct(at(0.5))}  p25=${pct(at(0.75))}  min=${pct(results[results.length - 1]!.slack)}`);
  const firing = results.filter((r) => r.slack > maxSlackFor(r.role));
  console.log(`over this role's limit: ${firing.length} of ${results.length}`);
  firing.forEach((r) => console.log(`    FIRES  ${pct(r.slack).padStart(6)}  ${r.label}`));
  console.log('');
  console.log('worst twelve:');
  results.slice(0, 12).forEach((r) => console.log(`  ${pct(r.slack).padStart(6)}  ${r.label}`));

  // By role: a cover IS a headline over space, so it should read high. A slide
  // whose job is to carry content should not.
  const byRole = new Map<string, number[]>();
  for (const r of results) {
    const role = r.label.split(' ').pop() ?? '?';
    byRole.set(role, [...(byRole.get(role) ?? []), r.slack]);
  }
  console.log('\nby role:');
  for (const [role, xs] of [...byRole.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sorted = xs.slice().sort((a, b) => a - b);
    console.log(
      `  ${role.padEnd(10)} n=${String(xs.length).padStart(2)}  ` +
        `min=${pct(sorted[0]!)}  median=${pct(sorted[sorted.length >> 1]!)}  max=${pct(sorted[sorted.length - 1]!)}`,
    );
  }

  await disconnectDb();
})().catch(async (e) => {
  console.error('FAILED', e);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
