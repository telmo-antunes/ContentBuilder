/**
 * CARRY LOST FRAGMENTS INTO THE KITS ALREADY STORED.
 *
 * `authorRecipe` now carries a dropped fragment forward at author time, but the
 * kits in the database were authored before it did. detailmasters' live recipe
 * lost `statement` on a re-author — the commonest role in the corpus — and has
 * paid a per-slide model call for it ever since, for an arrangement an earlier
 * kit of the same brand had already written down.
 *
 * Per business: walk its approved kits oldest to newest, and offer every
 * fragment any earlier kit had to the live one. `checkFragment` decides — a
 * fragment only lands if it still fits the live recipe's own component classes.
 *
 * Deterministic and additive: it can only ADD a fragment that validates, never
 * replace one the live recipe authored. Nothing already rendered changes; what
 * changes is that the next deck stops paying for those slides.
 *
 *   npm run fragments:carry --workspace=apps/api            # report
 *   npm run fragments:carry --workspace=apps/api -- --write # store it
 */
import { connectDb, disconnectDb } from '../db';
import { carryForwardFragments, fillRecipeFragmentGaps } from '../lib/htmlDirector/fragments';
import { SLIDE_ROLES, type BrandRecipe } from '@contentbuilder/shared';

const write = process.argv.includes('--write');

(async () => {
  await connectDb();
  const { BrandKitModel, BusinessModel } = await import('../models');

  let changed = 0;
  for (const b of await BusinessModel.find({ name: { $not: /^__/ } }).lean()) {
    const kits = (await BrandKitModel.find({
      businessId: b._id,
      status: 'approved',
      recipe: { $exists: true },
    })
      .sort({ createdAt: 1 })
      .lean()) as unknown as Array<{ _id: unknown; createdAt: Date; recipe: BrandRecipe }>;
    if (!kits.length) continue;

    const live = kits[kits.length - 1]!;
    const before = Object.keys(live.recipe.fragments ?? {});

    /**
     * Every earlier kit, newest first: a role dropped two re-authors ago is
     * still worth carrying, and the most recent version of it is the one whose
     * vocabulary is closest to the live recipe's.
     */
    let recipe = live.recipe;
    const carried: string[] = [];
    const unusable = new Map<string, string>();
    for (const older of kits.slice(0, -1).reverse()) {
      const out = carryForwardFragments(recipe, older.recipe);
      recipe = out.recipe;
      carried.push(...out.carried);
      for (const d of out.unusable) if (!unusable.has(d.role)) unusable.set(d.role, d.reason);
    }
    // A carried fragment is held to the same standard as an authored one.
    const filled = fillRecipeFragmentGaps(recipe);

    const after = Object.keys(filled.recipe.fragments ?? {});
    const missing = SLIDE_ROLES.filter((r) => !after.includes(r));
    console.log(`\n${b.name}  (${kits.length} approved kits, live ${String(live._id)})`);
    console.log(`  before: ${before.join(', ') || '(none)'}`);
    if (!carried.length) {
      console.log('  nothing to carry');
      for (const [role, reason] of unusable) console.log(`    "${role}" cannot be carried — ${reason}`);
      continue;
    }
    console.log(`  CARRIED: ${[...new Set(carried)].join(', ')}`);
    for (const r of filled.repairs) console.log(`    "${r.role}" gained a hole for: ${r.added.join(', ')}`);
    for (const [role, reason] of unusable) console.log(`    "${role}" cannot be carried — ${reason}`);
    console.log(`  after:  ${after.join(', ')}${missing.length ? `  (still none for ${missing.join(', ')})` : ''}`);

    if (write) {
      await BrandKitModel.updateOne({ _id: live._id }, { $set: { recipe: filled.recipe } });
      changed += 1;
    }
  }

  console.log(
    write
      ? `\nwrote ${changed} kit(s)`
      : '\nnothing written — re-run with --write to store it',
  );
  await disconnectDb();
})();
