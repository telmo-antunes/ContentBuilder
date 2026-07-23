/**
 * LIVE full-loop test: brand EVIDENCE → AI-authored recipe → composed slides →
 * saved project. Uses a mid-tier model to stay cheap. This proves the app can
 * design a brand's system itself (not just use hand-authored recipes).
 *   npx tsx apps/api/src/scripts/testRecipeAuthor.ts
 */
import { randomUUID } from 'node:crypto';
import { connectDb, disconnectDb } from '../db';
import { BusinessModel, BrandKitModel, ProjectModel } from '../models';
import { config } from '../config';
import { authorRecipe, type RecipeEvidence } from '../lib/htmlDirector/authorRecipe';
import { composeProject } from '../lib/htmlDirector/compose';

const IDEA =
  'Why detailing shops lose money to no-shows and manual admin, and how one CRM (bookings, reminders, deposits, reviews) fixes it. End on a free trial.';

async function main() {
  await connectDb();
  const biz = await BusinessModel.findOne({ name: 'detailmasters CRM' });
  if (!biz) throw new Error('detailmasters CRM not found');
  const kit = await BrandKitModel.findOne({ businessId: biz._id, status: 'approved' }).sort({ createdAt: -1 }).lean<any>();
  if (!kit) throw new Error('no kit');

  const evidence: RecipeEvidence = {
    name: biz.name,
    category: biz.profile?.category,
    colors: kit.colors,
    fonts: kit.fonts,
    logoTreatment: kit.logoTreatment,
    styleDescriptor: kit.styleDescriptor,
    voice: kit.voice || biz.profile?.tone?.join(', '),
  };

  const model = config.ai.model; // mid-tier for the test; production uses designModel() (Opus)
  console.log(`[recipe] authoring recipe for ${biz.name} on ${model}…`);
  let t0 = Date.now();
  const recipe = await authorRecipe(evidence, { model, reasoning: false });
  console.log(`[recipe] authored in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  tokens: ground ${recipe.tokens.ground} · accent ${recipe.tokens.accent} · display ${recipe.tokens.displayFamily} · body ${recipe.tokens.bodyFamily} · accentFam ${recipe.tokens.accentFamily}`);
  console.log(`  signature: ${recipe.signature.name}`);
  console.log(`  stylesheet ${recipe.stylesheet.length} chars · ${recipe.components.length} components`);

  // Persist the AI-authored recipe onto the kit(s), then compose from it.
  await BrandKitModel.updateMany({ businessId: biz._id }, { $set: { recipe } });

  console.log(`[recipe] composing a carousel from the authored recipe…`);
  t0 = Date.now();
  const slides = await composeProject(recipe, IDEA, { model, slideCount: 4, handle: '@detailmasters' });
  console.log(`[recipe] ${slides.length} slides in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const title = 'CRM for detailers — AI recipe';
  await ProjectModel.deleteMany({ businessId: biz._id, title });
  const proj = await ProjectModel.create({
    businessId: biz._id,
    title,
    type: 'carousel',
    format: '1080x1350',
    status: 'draft',
    settings: { theme: 'editorial', slideCounter: false },
    slides: slides.map((s, i) => ({
      id: randomUUID(),
      order: i + 1,
      layoutType: 'TextOnly',
      blocks: [],
      imageNeed: 'none',
      authored: s.authored,
    })),
  });
  console.log(`[recipe] saved → project ${String(proj._id)}`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[recipe] failed:', err?.message || err);
  if (err?.issues) console.error('zod issues:', JSON.stringify(err.issues.slice(0, 6)));
  await disconnectDb().catch(() => {});
  process.exit(1);
});
