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
  /**
   * The parts matter. Reading only the stored HTML and passing `parts: {}` is
   * what let the rewrite rung return the deck's cover: with nothing to anchor
   * to, "fill this slide" is read as "write a slide". The headline is recovered
   * from the markup so the rung has the slide's own point in hand.
   */
  const headlineOf = (html: string) =>
    /<[^>]*class="[^"]*\bheadline\b[^"]*"[^>]*>([\s\S]*?)<\//.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim();
  const inputs = slides.map((s) => ({
    role: (s.role ?? 'statement') as ComposeSlideInput['role'],
    parts: { ...(headlineOf(s.html) ? { headline: headlineOf(s.html) } : {}) },
    format: project.format,
    index: 0,
  })) as ComposeSlideInput[];

  console.log(`checking ${slides.length} slides with the vision rung wired\n`);
  const out = await renderCheckDeck(recipe, inputs, slides, project.format, {
    repairByLooking: (args) => repairByLooking(recipe, args),
    // The writing end of the loop, wired the way compose wires it.
    ...(process.argv.includes('--rewrite')
      ? {
          rewriteForFault: async (input, faults) => {
            const gap = faults.find((f) => f.startsWith('slack'));
            if (!gap) return null;
            const { parseSlideDirection, composeSlide } = await import('../lib/htmlDirector/compose');
            const direction =
              `This slide rendered with ${gap.replace('slack ', '')} of the frame empty — it reads as unfinished. ` +
              'Give it the substance it is missing, taking it ONLY from the material this post was briefed with: ' +
              'a body line that earns its place, or an enumeration if the material is a set of things. ' +
              'Keep the headline and the point exactly as they are. Invent nothing.';
            const richer = await parseSlideDirection(recipe, direction, {
              role: input.role,
              index: input.index,
              post: { idea: process.env.CB_IDEA ?? '', says: input.parts },
            });
            return (await composeSlide(recipe, richer, { renderCheck: false })).html;
          },
        }
      : {}),
  });
  out.slides.forEach((s, i) => {
    const t = s.html.replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ').trim();
    console.log(`  slide ${i + 1}: ${t.slice(0, 120)}`);
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
