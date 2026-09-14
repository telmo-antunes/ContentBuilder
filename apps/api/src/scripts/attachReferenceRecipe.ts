/**
 * ATTACH A REFERENCE RECIPE TO A LIVE BRAND — the $0 re-author.
 *
 *   npx tsx src/scripts/attachReferenceRecipe.ts --business "detailmasters CRM"          # dry run: reports
 *   npx tsx src/scripts/attachReferenceRecipe.ts --business "detailmasters CRM" --write
 *
 * The hand-authored reference recipes in `lib/htmlDirector/recipes.ts` are the
 * exemplars the author prompt teaches from AND the seeds of the live kits; when
 * an exemplar is upgraded (2026-09: phone-sized type, the seven slide forms),
 * the live brand can take it directly instead of paying a design-tier model to
 * re-derive it. The recipe it replaces is backed up first to
 * `storage/recipe-backups/<businessId>-<ts>-before-reference.json`, the way
 * `reauthorRecipe.ts` does, so the swap is reversible.
 *
 * Decks already exported keep rendering as approved: they carry a
 * `recipeSnapshot` and the render paths prefer it (see FEEDBACK.md, "Replacing
 * a recipe silently re-skinned every deck already reviewed").
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectDb, disconnectDb } from '../db';
import { REFERENCE_RECIPES } from '../lib/htmlDirector/recipes';
import { fragmentVariantsFor, currentVersions, SLIDE_ROLES } from '@contentbuilder/shared';

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

(async () => {
  const name = arg('--business');
  if (!name) throw new Error('usage: attachReferenceRecipe.ts --business "<name>" [--write]');
  const write = process.argv.includes('--write');
  const key = Object.keys(REFERENCE_RECIPES).find((k) => k.toLowerCase() === name.toLowerCase());
  const recipe = key ? REFERENCE_RECIPES[key] : undefined;
  if (!recipe) throw new Error(`no reference recipe for "${name}" (have: ${Object.keys(REFERENCE_RECIPES).join(', ')})`);

  await connectDb();
  const { BusinessModel, BrandKitModel } = await import('../models');
  const biz = (await BusinessModel.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean()) as any;
  if (!biz) throw new Error(`no business named "${name}"`);
  const kit = (await BrandKitModel.findOne({ businessId: biz._id, status: 'approved' }).sort({ createdAt: -1 })) as any;
  if (!kit) throw new Error(`"${name}" has no approved kit`);

  const before = kit.recipe as Record<string, unknown> | undefined;
  const coverage = (r: any) =>
    SLIDE_ROLES.map((role) => `${role}:${fragmentVariantsFor(r, role).length}`).join(' ');
  console.log(`business ${biz._id} · kit ${kit._id}`);
  console.log(`  live recipe:      ${before ? `fragments ${coverage(before)} · ${(before as any).components?.length ?? 0} components` : 'none'}`);
  console.log(`  reference recipe: fragments ${coverage(recipe)} · ${recipe.components.length} components`);
  if (!write) {
    console.log('dry run — pass --write to attach');
    await disconnectDb();
    return;
  }
  if (before) {
    const dir = join(process.cwd(), 'storage', 'recipe-backups');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${String(biz._id)}-${new Date().toISOString().replace(/[:.]/g, '-')}-before-reference.json`);
    writeFileSync(file, JSON.stringify(before, null, 2));
    console.log(`  backed up the live recipe → ${file}`);
  }
  const stamped = { ...recipe, promptVersions: currentVersions('brand') as Record<string, number> };
  await BrandKitModel.updateOne({ _id: kit._id }, { $set: { recipe: stamped } });
  console.log(`  attached "${key}" to kit ${kit._id}`);
  await disconnectDb();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
