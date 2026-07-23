/**
 * LIVE compose test (cheap: small-model tier). Composes a fresh carousel from an
 * idea against a brand's stored recipe → authored slides → saved project.
 *   npx tsx apps/api/src/scripts/testCompose.ts
 */
import { randomUUID } from 'node:crypto';
import { connectDb, disconnectDb } from '../db';
import { BusinessModel, BrandKitModel, ProjectModel } from '../models';
import { brandRecipeSchema } from '@contentbuilder/shared';
import { config } from '../config';
import { composeProject } from '../lib/htmlDirector/compose';

const IDEA =
  'How to stay disciplined when motivation runs out — for men building their body, mind and business. Cover why motivation is unreliable, that discipline is a system not a feeling, the 2-minute rule to start, and that showing up on bad days is what compounds.';

async function main() {
  await connectDb();
  const biz = await BusinessModel.findOne({ name: 'Dynatós Program' });
  if (!biz) throw new Error('Dynatós Program not found');
  const kit = await BrandKitModel.findOne({ businessId: biz._id, status: 'approved' }).sort({ createdAt: -1 }).lean<any>();
  if (!kit?.recipe) throw new Error('no recipe on kit — run seedAuthoredDemo first');
  const recipe = brandRecipeSchema.parse(kit.recipe);

  console.log(`[compose] model=${config.ai.modelSmall ?? config.ai.model} · composing…`);
  const t0 = Date.now();
  const slides = await composeProject(recipe, IDEA, {
    model: config.ai.modelSmall ?? config.ai.model,
    slideCount: 5,
    handle: '@dynatos',
  });
  console.log(`[compose] ${slides.length} slides in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  slides.forEach((s, i) => console.log(`  ${i + 1}. ${s.role} · ${s.authored.html.length} chars${s.authored.bg ? ' · bg=' + s.authored.bg : ''}`));

  const title = 'Discipline when motivation runs out — auto';
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
  console.log(`[compose] saved → project ${String(proj._id)}`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[compose] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
