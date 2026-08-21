/**
 * Re-author ONE brand's design recipe from its stored evidence, exactly as
 * `POST /brandkits/:kitId/recipe` would — same evidence assembly, same
 * `previous` hand-over (the fragment-regression guard), same critique pass —
 * but in a fresh process, so a re-author can run the CURRENT prompt code while
 * a long-lived dev API is still serving an older build.
 *
 * The old recipe is written to a timestamped backup file first; nothing here
 * is destructive beyond replacing `kit.recipe`, which is the point of the run.
 *
 *   npx tsx apps/api/src/scripts/reauthorRecipe.ts --business "detailmasters CRM"
 *   npx tsx apps/api/src/scripts/reauthorRecipe.ts --business "…" --verify
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectDb, disconnectDb } from '../db';
import { BusinessModel, BrandKitModel } from '../models';
import { authorRecipe, type RecipeEvidence } from '../lib/htmlDirector/authorRecipe';
import { fragmentVariantsFor, SLIDE_ROLES, type BrandRecipe } from '@contentbuilder/shared';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

/** One line per role: how many arrangements + fragment variants it carries. */
function varietyReport(recipe: BrandRecipe | undefined): string {
  if (!recipe) return '  (no recipe)';
  const patterns = recipe.composition?.patterns ?? [];
  return SLIDE_ROLES.map((role) => {
    const p = patterns.filter((x) => x.trim().toLowerCase().startsWith(role)).length;
    const f = fragmentVariantsFor(recipe, role).length;
    const align = recipe.composition?.roles?.[role];
    return `  ${role.padEnd(9)} patterns ${p} · fragments ${f}${align ? ` · align ${align}` : ''}`;
  }).join('\n');
}

async function main() {
  const name = arg('business');
  if (!name) throw new Error('Pass --business "<name>"');
  await connectDb();
  const biz = await BusinessModel.findOne({ name });
  if (!biz) throw new Error(`Business "${name}" not found`);
  const kit = await BrandKitModel.findOne({ businessId: biz._id, status: 'approved' }).sort({ createdAt: -1 });
  if (!kit) throw new Error(`No approved kit for "${name}"`);

  const previous = kit.get('recipe') as BrandRecipe | undefined;
  if (previous) {
    const dir = join(process.cwd(), 'storage', 'recipe-backups');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${String(biz._id)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(previous, null, 2));
    console.log(`[reauthor] previous recipe backed up → ${file}`);
    console.log(`[reauthor] BEFORE:\n${varietyReport(previous)}`);
  }

  const profile = (biz as unknown as { profile?: Record<string, unknown> }).profile ?? {};
  const evidence: RecipeEvidence = {
    name: biz.name,
    category: profile.category as string | undefined,
    colors: kit.get('colors'),
    fonts: kit.get('fonts'),
    logoTreatment: kit.get('logoTreatment'),
    styleDescriptor: kit.get('styleDescriptor'),
    voice:
      kit.get('voice') || (Array.isArray(profile.tone) ? (profile.tone as string[]).join(', ') : undefined),
    screenshot: kit.get('homepageScreenshot'),
  };

  console.log(`[reauthor] authoring for ${biz.name}…`);
  const t0 = Date.now();
  const recipe = await authorRecipe(evidence, { previous, verify: process.argv.includes('--verify') });
  console.log(`[reauthor] authored in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[reauthor] AFTER:\n${varietyReport(recipe)}`);
  console.log(`  signature: ${recipe.signature.name}`);
  console.log(`  align: ${recipe.composition.align}`);
  console.log(`  numbered list support used: ${JSON.stringify(recipe.fragments ?? {}).includes('numbered')}`);

  kit.set('recipe', recipe);
  await kit.save();
  console.log('[reauthor] saved as the live recipe.');
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
