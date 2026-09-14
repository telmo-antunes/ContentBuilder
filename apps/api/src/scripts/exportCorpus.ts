/**
 * FREEZE THE CORPUS — every distinct brief the app has ever been asked to
 * compose, exported from the stored `Generation` records into JSON files the
 * prompt lab and the eval can replay without a model call.
 *
 *   npx tsx src/scripts/exportCorpus.ts            # writes src/eval/corpus/<slug>.json
 *   npx tsx src/scripts/exportCorpus.ts --list     # prints what it would write
 *
 * One file per DISTINCT brief (the latest generation for that idea), because a
 * brief re-composed nine times while a bug was being chased is one brief, not
 * nine. The file carries the structured brief (idea, plan, locks, source
 * metadata), the project's format/type/settings, the exact copywriter USER
 * message that was sent, and the parts + markup that came back — so a replay
 * can compare a new copywriter against what shipped, part by part.
 *
 * Deliberately excludes the recipe: it is looked up by brand name at replay
 * time (the stored kit or the reference recipe), so a re-authored brand is
 * measured against the same briefs.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { connectDb, disconnectDb } from '../db';

const OUT_DIR = resolve(__dirname, '../eval/corpus');

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** The line of the idea that names the post — a CRM payload leads with "Headline: …". */
function titleOf(idea: string): string {
  const m = idea.match(/^\s*Headline:\s*(.+)$/m);
  if (m) return m[1]!.trim();
  return idea.split('\n').find((l) => l.trim().length > 12)?.trim() ?? idea.slice(0, 60);
}

(async () => {
  const list = process.argv.includes('--list');
  await connectDb();
  const { GenerationModel, ProjectModel, BusinessModel } = await import('../models');
  const gens = (await GenerationModel.find({ kind: 'deck' }).sort({ createdAt: -1 }).lean()) as any[];
  const seen = new Map<string, any>();
  for (const g of gens) {
    const idea = String(g.brief?.idea ?? '');
    const key = createHash('sha1')
      .update(idea + '\n' + JSON.stringify(g.brief?.plan ?? []) + JSON.stringify(g.brief?.locks ?? []))
      .digest('hex')
      .slice(0, 10);
    if (!seen.has(key)) seen.set(key, { ...g, key, runs: 1 });
    else seen.get(key).runs += 1;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  let n = 0;
  for (const g of seen.values()) {
    const project = (await ProjectModel.findById(g.projectId).lean()) as any;
    const business = (await BusinessModel.findById(g.businessId).lean()) as any;
    const idea = String(g.brief?.idea ?? '');
    const title = titleOf(idea);
    const id = `${slugify(business?.name ?? 'brand').slice(0, 16)}--${slugify(title)}--${g.key}`;
    const doc = {
      id,
      title,
      brand: business?.name ?? null,
      businessId: String(g.businessId),
      projectId: String(g.projectId),
      type: project?.type ?? null,
      format: project?.format ?? null,
      settings: project?.settings ?? null,
      brief: {
        idea,
        plan: g.brief?.plan ?? undefined,
        locks: g.brief?.locks ?? undefined,
        sources: g.brief?.sources ?? undefined,
      },
      models: g.models ?? null,
      promptVersions: g.promptVersions ?? null,
      /** The copywriter's exact USER message — replayable as-is. */
      parseUser: g.parseUser ?? null,
      /** What came back, per slide, as generated (before any hand edit). */
      generated: (g.slides ?? []).map((s: any) => ({
        id: s.id,
        role: s.role,
        path: s.path,
        parts: s.parts,
        html: s.html,
      })),
      /** What the user then did to it, if recorded. */
      outcome: g.outcome ?? null,
      generationId: String(g._id),
      generatedAt: g.createdAt,
      runsOfThisBrief: g.runs,
    };
    n += 1;
    if (list) {
      console.log(`${id}  ${doc.type ?? '?'} ${doc.format ?? '?'}  slides ${doc.generated.length}  runs ${g.runs}`);
      continue;
    }
    writeFileSync(resolve(OUT_DIR, `${id}.json`), JSON.stringify(doc, null, 2) + '\n');
    console.log(`wrote ${id}.json  (${doc.generated.length} slides, ${g.runs} run(s) of this brief)`);
  }
  console.log(`${n} distinct brief(s) from ${gens.length} generation(s)`);
  await disconnectDb();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
