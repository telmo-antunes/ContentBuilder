/**
 * DO A BRAND'S FRAGMENTS HOLD WHAT THEY MAY BE GIVEN?
 *
 * `fillRecipeFragmentGapsMeasured` asks this of a hole it is about to ADD, and
 * that is the only moment it asks — a recipe already carrying its holes never
 * gets the question. Every kit in the database predates the measurement, so
 * this is where they get it.
 *
 * Each fragment is filled with the longest copy every part of it is allowed
 * (`WORST_CASE`, pinned to the compose budgets) and rendered. A fragment with a
 * photo slot is measured twice — a picture is 34% of the canvas, and a slide
 * that fits without one may not fit with it.
 *
 * NOT the same question as `layout:corpus`, which re-measures slides that
 * actually shipped. This one asks what a fragment could be asked to hold on a
 * deck nobody has composed yet.
 *
 *   npm run fragments:check --workspace=apps/api            # report
 *   npm run fragments:check --workspace=apps/api -- --gate  # exit 1 on a NEW fault
 *   npm run fragments:check --workspace=apps/api -- --gate --update-baseline
 *
 * Needs the web server up: the probe renders through `${WEB_URL}/render`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { connectDb, disconnectDb } from '../db';
import { closeBrowser } from '../lib/browser';
import { substituteFragment, WORST_CASE } from '../lib/htmlDirector/fragments';
import { openRenderProbe } from '../lib/htmlDirector/renderCheck';
import { authoredSlots, type BrandRecipe } from '@contentbuilder/shared';
import { config } from '../config';

const BASELINE_PATH = new URL('./fragment-check-baseline.json', import.meta.url);

async function readBaseline(): Promise<string[]> {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as string[];
  } catch {
    return [];
  }
}

/** The worst copy this particular markup can be handed. */
function worstFor(fragment: string): Record<string, unknown> {
  const parts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(WORST_CASE)) {
    if (key === 'rows') continue;
    if (fragment.includes(`{{${key}}}`)) parts[key] = value;
  }
  if (fragment.includes('{{#rows}}')) parts.rows = WORST_CASE.rows;
  return parts;
}

(async () => {
  await connectDb();
  const { BrandKitModel, BusinessModel } = await import('../models');

  const faults: string[] = [];
  let measured = 0;

  for (const b of await BusinessModel.find({ name: { $not: /^__/ } }).lean()) {
    const kit = (await BrandKitModel.findOne({
      businessId: b._id,
      status: 'approved',
      recipe: { $exists: true },
    })
      .sort({ createdAt: -1 })
      .lean()) as { recipe?: BrandRecipe } | null;
    const recipe = kit?.recipe;
    const fragments = recipe?.fragments;
    if (!recipe || !fragments || !Object.keys(fragments).length) continue;

    console.log(`\n${b.name}`);
    const probe = await openRenderProbe(recipe, '1080x1350', [{ html: '<div></div>', role: 'statement' }]);
    try {
      for (const [role, fragment] of Object.entries(fragments)) {
        if (typeof fragment !== 'string') continue;
        const hasSlot = authoredSlots(fragment).length > 0;
        for (const photo of hasSlot ? [false, true] : [false]) {
          const out = substituteFragment(recipe, {
            role: role as never,
            parts: worstFor(fragment) as never,
            format: '1080x1350',
            photo,
          });
          if (!('html' in out)) {
            console.log(`  ${role.padEnd(10)} ${photo ? '+photo' : '     '}  could not be filled`);
            continue;
          }
          const [v] = await probe.measure([{ index: 0, html: out.html }]);
          measured += 1;
          const bad = [v?.state === 'overflows' ? 'OVERFLOW' : '', v?.collide ? 'COLLIDE' : ''].filter(Boolean);
          const label = `${b.name} ${role}${photo ? '+photo' : ''}`;
          if (bad.length) faults.push(`${label}: ${bad.join('+')}`);
          console.log(`  ${role.padEnd(10)} ${photo ? '+photo' : '     '}  ${bad.length ? bad.join(' ') : 'holds it'}`);
        }
      }
    } finally {
      await probe.close();
    }
  }

  console.log(`\n${faults.length} fault(s) in ${measured} measurement(s)`);

  if (process.argv.includes('--gate')) {
    const baseline = await readBaseline();
    const added = faults.filter((f) => !baseline.includes(f));
    const gone = baseline.filter((f) => !faults.includes(f));

    if (process.argv.includes('--update-baseline')) {
      await writeFile(BASELINE_PATH, `${JSON.stringify([...faults].sort(), null, 2)}\n`);
      console.log(`baseline updated: ${faults.length} known fault(s)`);
    } else if (added.length) {
      console.error(`\nFAILED: ${added.length} fragment(s) that held their worst case before now do not:`);
      added.forEach((f) => console.error(`    NEW  ${f}`));
      await closeBrowser().catch(() => {});
      await disconnectDb();
      process.exit(1);
    } else if (gone.length) {
      console.log(`${gone.length} baseline fault(s) no longer fire — re-run with --update-baseline:`);
      gone.forEach((f) => console.log(`    FIXED  ${f}`));
    } else {
      console.log(`gate: clean against ${baseline.length} known fault(s)`);
    }
  }

  console.log(`\n(rendered through ${config.webUrl})`);
  await closeBrowser().catch(() => {});
  await disconnectDb();
})().catch(async (e) => {
  console.error('FAILED', e);
  await closeBrowser().catch(() => {});
  await disconnectDb().catch(() => {});
  process.exit(1);
});
