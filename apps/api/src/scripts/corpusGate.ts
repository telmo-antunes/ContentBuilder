/**
 * THE CORPUS GATE — the frozen briefs, re-run through the deterministic
 * pipeline at $0, so a prompt or recipe change that regresses them is caught
 * in CI before anyone pays a model to find out.
 *
 * For every stored brief the copywriter's own output is replayed against the
 * brand's reference recipe and held to the checks the pipeline itself runs:
 *
 *   · the parse gates — budgets, unfinished lines, the cover hook, repeats;
 *   · substitution — every slide composes from a fragment, no model needed;
 *   · no placeholder survives into the markup;
 *   · variety — a deck of five or more slides shows at least four skeletons.
 *
 * Findings that were already there are recorded in corpus-gate-baseline.json
 * so the gate fails only on NEW ones. Runs without a database, a browser or
 * an API key.
 *
 *   npm run corpus:gate                    # report
 *   npm run corpus:gate -- --gate          # exit 1 on a finding not in the baseline
 *   npm run corpus:gate -- --write-baseline
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCE_RECIPES } from '../lib/htmlDirector/recipes';
import {
  buildParseRequest,
  budgetViolationsOf,
  composeByFragment,
  coverHookFaults,
  finishParsedDeck,
  readDeck,
  repeatedSlides,
  stripMarkdownFromDeck,
  unfinishedProse,
} from '../lib/htmlDirector/compose';
import { fillRecipeFragmentGaps } from '../lib/htmlDirector/fragments';
import { corpusBriefs, optionsFor } from '../eval/lab';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(__dirname, 'corpus-gate-baseline.json');
const has = (f: string) => process.argv.includes(f);

function recipeForBrand(brand: string) {
  const key =
    Object.keys(REFERENCE_RECIPES).find((k) => k.toLowerCase() === brand.toLowerCase()) ??
    Object.keys(REFERENCE_RECIPES).find((k) => k.toLowerCase().startsWith(brand.toLowerCase().slice(0, 6)));
  return key ? REFERENCE_RECIPES[key] : undefined;
}

/** The skeleton of a composed slide: its class sequence with the words removed. */
const skeleton = (html: string) => (html.match(/class="[^"]+"/g) ?? []).join('>');

const quiet = console.warn;
const findings: string[] = [];
const say = (line: string) => process.stdout.write(`${line}\n`);

for (const b of corpusBriefs()) {
  // Gap-filled exactly as `composeProject` fills the live recipe before it composes.
  const reference = recipeForBrand(b.brand);
  const recipe = reference ? fillRecipeFragmentGaps(reference).recipe : undefined;
  if (!recipe) {
    findings.push(`${b.id}: no reference recipe for brand "${b.brand}"`);
    continue;
  }
  const opts = optionsFor(b);
  const req = buildParseRequest(recipe, b.brief.idea, opts);
  const payload = { slides: b.generated.map((g) => ({ role: g.role, parts: g.parts, image: /data-cb-slot=/.test(g.html ?? '') })) };
  console.warn = () => {};
  let composedHtml: string[] = [];
  try {
    const slides = stripMarkdownFromDeck(readDeck(payload, 'corpus'));
    for (const v of budgetViolationsOf(slides, req.budgets).filter((v) => (v.label === 'headline' || v.label === 'tagline' ? v.length > v.budget : v.length > v.budget * 1.1))) {
      findings.push(`${b.id}: slide ${v.slide + 1} ${v.label} ${v.length}/${v.budget} over budget`);
    }
    for (const u of unfinishedProse(slides)) findings.push(`${b.id}: slide ${u.slide + 1} ${u.label} ${u.reason}`);
    for (const h of coverHookFaults(slides, b.brief.idea, b.brief.sources)) findings.push(`${b.id}: ${h.reason}`);
    for (const r of repeatedSlides(slides)) findings.push(`${b.id}: slides ${r.a + 1} and ${r.b + 1} make the same point`);
    const inputs = finishParsedDeck(recipe, slides, req, { ...opts, photoBudget: 24 });
    for (const [i, input] of inputs.entries()) {
      const out = composeByFragment(recipe, input);
      if (!out) {
        findings.push(`${b.id}: slide ${i + 1} (${input.role}) cannot substitute from a fragment — it would cost a model call`);
        continue;
      }
      if (/\{\{[^}]*\}\}/.test(out.html)) findings.push(`${b.id}: slide ${i + 1} keeps a placeholder in its markup`);
      composedHtml.push(out.html);
    }
    if (inputs.length >= 5) {
      const distinct = new Set(composedHtml.map(skeleton)).size;
      if (distinct < 4) findings.push(`${b.id}: only ${distinct} distinct skeleton(s) across ${inputs.length} slides`);
    }
  } catch (err) {
    findings.push(`${b.id}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    console.warn = quiet;
  }
  say(`${b.id}: ${b.generated.length} slides · ${composedHtml.length} substitute`);
}

const baseline: string[] = (() => {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8')) as string[];
  } catch {
    return [];
  }
})();
const fresh = findings.filter((f) => !baseline.includes(f));
const fixed = baseline.filter((f) => !findings.includes(f));

say('');
say(`${findings.length} finding(s), ${fresh.length} new, ${fixed.length} fixed since the baseline`);
for (const f of findings) say(`  ${fresh.includes(f) ? 'NEW ' : '    '}${f}`);
if (has('--write-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify(findings, null, 2)}\n`);
  say(`baseline written → ${BASELINE}`);
}
if (has('--gate') && fresh.length) {
  say('\nNEW findings — the change above regressed the corpus. Fix it, or record it with --write-baseline and say why.');
  process.exit(1);
}
