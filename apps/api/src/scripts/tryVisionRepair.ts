/**
 * Does the rung after the ladder actually fix a slide?
 *
 * Runs the real deck pass over a stored project with the vision rung wired the
 * way compose wires it, and reports what each slide's ladder did.
 *
 *   npx tsx src/scripts/tryVisionRepair.ts <projectId>
 */
import { connectDb, disconnectDb } from '../db';
import { renderCheckDeck } from '../lib/htmlDirector/renderCheck';
import { repairByLooking } from '../lib/htmlDirector/visionRepair';
import type { BrandRecipe } from '@contentbuilder/shared';
import type { ComposeSlideInput } from '../lib/htmlDirector/prompt';

(async () => {
  const id = process.argv[2];
  if (!id) throw new Error('usage: tryVisionRepair.ts <projectId>');
  await connectDb();
  const { ProjectModel, BrandKitModel } = await import('../models');
  const project = (await ProjectModel.findById(id).lean()) as
    | { businessId: unknown; format: string; slides?: Array<{ authored?: { html?: string; role?: string; archetype?: string } }> }
    | null;
  if (!project) throw new Error(`no project ${id}`);
  const kit = (await BrandKitModel.findOne({ businessId: project.businessId, status: 'approved' }).lean()) as
    | { recipe?: BrandRecipe }
    | null;
  const recipe = kit?.recipe;
  if (!recipe) throw new Error('no approved recipe');

  const slides = (project.slides ?? [])
    .filter((s) => s.authored?.html)
    .map((s) => ({
      html: s.authored!.html!,
      role: s.authored?.role,
      ...(s.authored?.archetype ? { archetype: s.authored.archetype } : {}),
    }));
  const inputs = slides.map((s) => ({
    role: (s.role ?? 'statement') as ComposeSlideInput['role'],
    parts: {},
    format: project.format,
    index: 0,
  })) as ComposeSlideInput[];

  console.log(`checking ${slides.length} slides with the vision rung wired\n`);
  const out = await renderCheckDeck(recipe, inputs, slides, project.format, {
    repairByLooking: (args) => repairByLooking(recipe, args),
  });
  console.log(`measured ${out.measured}, repaired ${out.repaired}, ai calls ${out.aiCalls}`);
  out.notes.forEach((n) => console.log(`  ${n}`));
  if (out.unresolved.length) console.log(`  still unresolved: slides ${out.unresolved.map((i) => i + 1).join(', ')}`);
  await disconnectDb();
})().catch(async (e) => {
  console.error('FAILED', e);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
