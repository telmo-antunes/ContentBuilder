/**
 * THE CORPUS CHECK — every slide that ever shipped, re-measured.
 *
 * Two jobs, and the second is why this is a command rather than a one-off.
 *
 * 1. CALIBRATION. A threshold is only meaningful against the real distribution:
 *    a gate that fires on every well-composed slide is as useless as one that
 *    never fires. This is where MAX_SLACK's per-role limits came from.
 *
 * 2. REGRESSION. Four render-time floors rewrite CSS for EVERY brand — type,
 *    measure, story reserve, descender clearance — and the reserved photo slot
 *    changes what the gate even sees. A change to any of them can break a brand
 *    that has been fine for months, and nothing else would notice. These slides
 *    shipped, so they rendered acceptably at the time; anything overflowing or
 *    colliding now is something a later change did to them.
 *
 *    That is not hypothetical. Reserving empty photo slots (#58) put a zero-gap
 *    box between the logo row and the eyebrow on every slide with an unfilled
 *    slot — 9 of 79 shipped slides reported a collision with nothing overlapping
 *    — and this check is what caught it.
 *
 *   npm run layout:corpus --workspace=apps/api            # report
 *   npm run layout:corpus --workspace=apps/api -- --gate  # exit 1 on a fault
 *
 * Needs the web server up: the probe renders through `${WEB_URL}/render`.
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
  /** The size each slot's photograph actually occupies on the stored slide. */
  slotSizes: Record<string, { shape?: string; size?: string }>;
}

/**
 * The faults that were already there. Checked in beside the script so the gate
 * has something to compare against on a fresh clone.
 */
const BASELINE_PATH = new URL('./layout-corpus-baseline.json', import.meta.url);

async function readBaseline(): Promise<string[]> {
  try {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as string[];
  } catch {
    return [];
  }
}

async function writeBaseline(labels: string[]): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(BASELINE_PATH, `${JSON.stringify(labels, null, 2)}\n`);
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
      type StoredPhoto = { placement?: string; slot?: string; shape?: string; size?: string };
      (p.slides ?? []).forEach(
        (s: { authored?: { html?: string; role?: string }; photos?: StoredPhoto[] }, i: number) => {
          if (!s.authored?.html) return;
          /**
           * Carry the REAL slot geometry through. Without it every slot is
           * reserved at the default size, which over-reports precisely the
           * slides someone has already hand-tuned: one shipped slide renders
           * clean at `wide`/`sm` and was flagged as overflowing for that reason.
           */
          const slotSizes: Record<string, { shape?: string; size?: string }> = {};
          for (const ph of s.photos ?? []) {
            if (ph.placement === 'slot' && ph.slot) slotSizes[ph.slot] = { shape: ph.shape, size: ph.size };
          }
          samples.push({
            title: String(p.title ?? name),
            index: i,
            role: s.authored.role ?? '?',
            html: s.authored.html,
            recipe,
            slotSizes,
          });
        },
      );
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
    const probe = await openRenderProbe(
      recipe,
      '1080x1350',
      mine.map((m) => ({ html: m.html, role: m.role, slotSizes: m.slotSizes })),
    );
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

  /**
   * `--gate` makes this usable BEFORE a change lands rather than after — but
   * only against a BASELINE.
   *
   * Nine shipped slides already fail, from before this check existed. A gate
   * that is permanently red is a gate everyone learns to ignore, which is the
   * same way `MAX_SLACK` at 0.15 became decorative. So the baseline records what
   * was already broken and the gate fails only on what is NEW — and on anything
   * that has quietly been fixed, because a shrinking baseline nobody trims stops
   * describing the code.
   */
  if (process.argv.includes('--gate')) {
    const current = broken.map((r) => r.label).sort();
    const baseline = await readBaseline();
    const added = current.filter((x) => !baseline.includes(x));
    const gone = baseline.filter((x) => !current.includes(x));

    if (process.argv.includes('--update-baseline')) {
      await writeBaseline(current);
      console.log(`baseline updated: ${current.length} known fault(s)`);
    } else if (added.length) {
      console.error(`\nFAILED: ${added.length} slide(s) that rendered cleanly before now do not:`);
      added.forEach((x) => console.error(`    NEW  ${x}`));
      console.error('\nThese shipped, so they rendered acceptably at the time — this is a regression.');
      process.exit(1);
    } else if (gone.length) {
      console.log(`${gone.length} baseline fault(s) no longer fire — re-run with --update-baseline:`);
      gone.forEach((x) => console.log(`    FIXED  ${x}`));
    } else {
      console.log(`gate: clean against ${baseline.length} known fault(s)`);
    }
  }
})().catch(async (e) => {
  console.error('FAILED', e);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
