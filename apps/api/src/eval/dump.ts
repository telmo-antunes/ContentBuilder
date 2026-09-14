/**
 * PROMPT DUMP — the exact requests the pipeline would send, written to disk,
 * with no model call made.
 *
 *   npx tsx src/eval/dump.ts                       # every corpus brief + every golden fixture
 *   npx tsx src/eval/dump.ts --only <id-substring> # a subset
 *   npx tsx src/eval/dump.ts --out <dir>           # default <repo>/audit-out/prompts
 *
 * For each unit it writes:
 *   <id>/parse.system.md   the copywriter system prompt (identical everywhere)
 *   <id>/parse.user.md     the copywriter USER message, exactly as sent
 *   <id>/parse.tool.json   the forced tool schema the reply must satisfy
 *   <id>/compose.<role>.md the composer system + user for ONE representative
 *                          slide per role, built from the brief's STORED parse
 *                          output when the unit came from the corpus (a golden
 *                          fixture has no stored parse, so only its parse
 *                          request is dumped).
 *
 * This is the lab bench: a person can answer these files by hand and feed the
 * answers back through `scripts/composeFromParse.ts`, so a prompt change is
 * judged by what it produces on the real corpus before a cent is spent.
 *
 * Brands resolve by name to the stored approved kit's recipe when Mongo is
 * reachable, else to the hand-authored reference recipe — the dump says which.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fillRecipeFragmentGaps } from '../lib/htmlDirector/fragments';
import { buildParseRequest, type ComposeOptions } from '../lib/htmlDirector/compose';
import { buildComposeMessages, type ComposeSlideInput, type SlideRole } from '../lib/htmlDirector/prompt';
import type { BrandRecipe } from '@contentbuilder/shared';
import { EVAL_BRANDS, EVAL_FIXTURES } from './fixtures';
import { AUDIT_OUT, cliArg, corpusBriefs, optionsFor, recipeFor } from './lab';

interface Unit {
  id: string;
  brand: string;
  idea: string;
  opts: ComposeOptions;
  /** Stored copywriter output, when the unit came from the corpus. */
  generated?: Array<{ role: string; parts: Record<string, unknown>; path?: string }>;
}

function corpusUnits(): Unit[] {
  return corpusBriefs().map((d) => ({ id: d.id, brand: d.brand, idea: d.brief.idea, opts: optionsFor(d), generated: d.generated }));
}

function fixtureUnits(): Unit[] {
  const out: Unit[] = [];
  for (const f of EVAL_FIXTURES) {
    for (const b of EVAL_BRANDS) {
      out.push({
        id: `fixture--${b.id}--${f.id}`,
        brand: b.name,
        idea: f.idea,
        opts: {
          format: f.format,
          ...(f.plan?.length ? { plan: f.plan } : { slideCount: f.slideCount }),
          ...(f.sources ? { sources: f.sources } : {}),
          ...(f.locks ? { locks: f.locks } : {}),
        },
      });
    }
  }
  return out;
}

(async () => {
  const outDir = resolve(cliArg('--out') ?? resolve(AUDIT_OUT, 'prompts'));
  const only = cliArg('--only');
  const units = [...corpusUnits(), ...fixtureUnits()].filter((u) => !only || u.id.includes(only));
  const recipes = new Map<string, { recipe: BrandRecipe; from: string }>();
  for (const u of units) {
    if (!recipes.has(u.brand)) recipes.set(u.brand, await recipeFor(u.brand));
    const { recipe: raw, from } = recipes.get(u.brand)!;
    const recipe = fillRecipeFragmentGaps(raw).recipe;
    const dir = resolve(outDir, u.id);
    mkdirSync(dir, { recursive: true });
    const req = buildParseRequest(recipe, u.idea, u.opts);
    writeFileSync(resolve(dir, 'parse.system.md'), req.system + '\n');
    writeFileSync(
      resolve(dir, 'parse.user.md'),
      `<!-- brand: ${u.brand} · recipe: ${from} · model: ${req.model} · max_tokens: ${req.maxTokens} · range: ${JSON.stringify(req.range)} -->\n` +
        req.user +
        '\n',
    );
    writeFileSync(resolve(dir, 'parse.tool.json'), JSON.stringify(req.tool, null, 2) + '\n');
    const seen = new Set<string>();
    for (const [i, g] of (u.generated ?? []).entries()) {
      if (seen.has(g.role)) continue;
      seen.add(g.role);
      const input: ComposeSlideInput = {
        role: g.role as SlideRole,
        parts: g.parts as ComposeSlideInput['parts'],
        format: u.opts.format ?? '1080x1350',
        index: i,
        photo: /data-cb-slot|"image":true/.test(JSON.stringify(g)) || undefined,
      };
      const m = buildComposeMessages(recipe, input);
      const system = m.system.map((b) => b.text).join('\n\n---\n\n');
      writeFileSync(
        resolve(dir, `compose.${g.role}.md`),
        `<!-- slide ${i + 1} · stored path: ${g.path ?? '?'} — the fragment path makes NO call; this is what the model would see if it did -->\n\n# SYSTEM\n\n${system}\n\n# USER\n\n${m.user}\n`,
      );
    }
    console.log(`${u.id}  (${from}; ${seen.size} compose role(s))`);
  }
  console.log(`\n${units.length} unit(s) → ${outDir}`);
  try {
    const { disconnectDb } = await import('../db');
    await disconnectDb();
  } catch {
    /* never connected */
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
