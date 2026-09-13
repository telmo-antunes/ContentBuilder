/**
 * THE LAB BENCH — compose a deck from a parse result that did NOT come from the
 * model: a person's answer to the dumped copywriter prompt, or a stored parse
 * replayed. Everything downstream is the production path (`composeFromInputs`),
 * so what comes out is judged by the same gates, laid out by the same
 * archetypes, and — with `--save` — photographed with the brand's own pictures
 * attached exactly as the compose route attaches them.
 *
 *   npx tsx src/scripts/composeFromParse.ts --corpus <id-substring> --parse lab/x.json [flags]
 *   npx tsx src/scripts/composeFromParse.ts --brand "Dynatós Program" --idea idea.txt --parse lab/x.json
 *   npx tsx src/scripts/composeFromParse.ts --corpus <id> --replay          # the stored generated parts
 *
 * --parse <file>       {"slides":[{role, image?, imageQuery?, align?, why?, parts}]} — the write_slides shape
 * --parse live         call the REAL copywriter (Settings/env tier, or --parse-model) — Phase 2 validation
 * --critique           run the art-director critique on the saved render, under the same ledger
 * --replay             use the corpus brief's STORED parse output instead of --parse
 * --reference          compose against the code's REFERENCE recipe for the brand (recipes.ts), not the stored kit
 * --advertise a,b      add classes to the recipe's component list for this run (a class the stylesheet
 *                      already styles but the author never listed — `.tagline` on detailmasters)
 * --fragments <file>   {"<role>": "<fragment>" | ["<variant>", …]} merged over the recipe's fragments —
 *                      hand-composed skeletons, validated with the same checkFragment the author uses
 * --no-fragments       bypass substitution: the model composes every slide (costs money)
 * --no-model           refuse every model call: every role must have a fragment; art direction, design
 *                      pass and vision rungs are off (the API key is blanked for this process)
 * --no-render-check    skip the Puppeteer layout gates
 * --no-save            do not create a project; photograph through a scaffold (no photos attached)
 * --compose-model <id> / --parse-model <id>   override the tiers (tiering experiments)
 * --ceiling <usd>      lab spend ceiling (default 0.10) — vision passes are refused under it
 * --pins "2:1,6:0"     per-slide fragment VARIANT pins (1-based slide : 0-based variant), as the art director would
 * --photos <file>      {"<1-based slide>": {"placement":"background"|"slot","slot"?:"name","asset":"<mediaAssetId>","fit"?:"cover"|"contain","shape"?:"wide"|…}}
 *                      explicit pictures per slide; replaces the pool fill entirely (a lab wants control, not luck)
 * --label <name>       output name (default: <corpus id>--<parse file stem>)
 * --out <dir>          default <repo>/audit-out/lab
 *
 * Output: <out>/<label>.md (what the parse checks said, per-slide path/archetype/surface, layout
 * verdicts) and <out>/<label>.png (the contact sheet). With --save the deck is also a real project
 * titled "LAB · <label>" for the Studio.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const noModel = process.argv.includes('--no-model');
if (noModel) process.env.ANTHROPIC_API_KEY = '';

const { isFormat, missingLocks } = await import('@contentbuilder/shared');
type Format = import('@contentbuilder/shared').Format;
const { AUDIT_OUT, cliArg, cliHas, corpusBrief, optionsFor, recipeFor } = await import('../eval/lab');
const {
  buildParseRequest,
  budgetViolationsOf,
  composeByFragment,
  composeFromInputs,
  finishParsedDeck,
  parseForCompose,
  readDeck,
  repeatedSlides,
  stripMarkdownFromDeck,
  unfinishedProse,
} = await import('../lib/htmlDirector/compose');
const { checkFragment, fillRecipeFragmentGaps } = await import('../lib/htmlDirector/fragments');
const { buildContactSheet } = await import('../lib/contactSheet');
const { openRenderProbe, shootLiveDeck } = await import('../lib/htmlDirector/renderCheck');
const { closeBrowser } = await import('../lib/browser');
const { summarize, withLedger, withSpendLedger } = await import('../lib/spend');
const { modelFor } = await import('../lib/ai');

type ComposeOptions = import('../lib/htmlDirector/compose').ComposeOptions;
type ComposeSlideInput = import('../lib/htmlDirector/prompt').ComposeSlideInput;
type BrandRecipe = import('@contentbuilder/shared').BrandRecipe;

const asFormat = (f: string | undefined): Format => (isFormat(f) ? f : '1080x1350');

async function main(): Promise<void> {
  const corpusId = cliArg('--corpus');
  const parseFile = cliArg('--parse');
  const replay = cliHas('--replay');
  if (!parseFile && !replay) throw new Error('need --parse <file> or --replay');

  // ── the brief ──────────────────────────────────────────────────────────────
  let brand: string;
  let idea: string;
  let opts: ComposeOptions;
  let stored: ReturnType<typeof corpusBrief> | undefined;
  if (corpusId) {
    stored = corpusBrief(corpusId);
    brand = stored.brand;
    idea = stored.brief.idea;
    opts = optionsFor(stored);
  } else {
    brand = cliArg('--brand') ?? '';
    const ideaFile = cliArg('--idea');
    if (!brand || !ideaFile) throw new Error('without --corpus, give --brand and --idea <file>');
    idea = readFileSync(ideaFile, 'utf8');
    opts = { format: cliArg('--format') ?? '1080x1350' };
  }
  if (cliArg('--format')) opts.format = cliArg('--format');
  const format = asFormat(opts.format);
  const label = cliArg('--label') ?? `${stored?.id ?? brand.replace(/\W+/g, '-')}--${parseFile ? basename(parseFile).replace(/\.json$/, '') : 'replay'}`;
  const outDir = resolve(cliArg('--out') ?? resolve(AUDIT_OUT, 'lab'));
  mkdirSync(outDir, { recursive: true });
  const log: string[] = [];
  const say = (l: string) => {
    log.push(l);
    console.log(l);
  };

  // ── the recipe, plus any hand-composed fragments ──────────────────────────
  const resolved = await recipeFor(brand);
  let recipe: BrandRecipe = resolved.recipe;
  say(`# Lab — ${label}`);
  say('');
  say(`- brand ${brand} · recipe ${resolved.from} · format ${format}`);
  const advertise = (cliArg('--advertise') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (advertise.length) {
    const have = new Set(recipe.components.map((c) => c.className));
    const added = advertise.filter((c) => !have.has(c));
    recipe = { ...recipe, components: [...recipe.components, ...added.map((className) => ({ className, use: `(lab) advertised for this run — the stylesheet ${recipe.stylesheet.includes('.' + className) ? 'DOES' : 'does NOT'} style it` }))] };
    say(`- advertised ${added.join(', ') || 'nothing new'} as component classes for this run`);
  }
  const fragFile = cliArg('--fragments');
  if (fragFile) {
    const extra = JSON.parse(readFileSync(fragFile, 'utf8')) as Record<string, string | string[]>;
    const merged: Record<string, string | string[]> = { ...(recipe.fragments ?? {}) };
    for (const [role, frag] of Object.entries(extra)) {
      const variants = Array.isArray(frag) ? frag : [frag];
      const problems = variants.map((v) => checkFragment(recipe, role, v)).flatMap((c) => ('reason' in c ? [c.reason] : []));
      if (problems.length) say(`- fragment ${role}: REJECTED — ${problems.join('; ')}`);
      else {
        merged[role] = frag;
        say(`- fragment ${role}: ${variants.length} hand-composed variant(s) accepted`);
      }
    }
    recipe = { ...recipe, fragments: merged as BrandRecipe['fragments'] };
  }
  recipe = fillRecipeFragmentGaps(recipe).recipe;
  const useFragments = !cliHas('--no-fragments');

  // ── one ledger for the whole run ─────────────────────────────────────────
  // Production's ceiling is $0.40 (AI_POST_CEILING_USD); the lab defaults to
  // $0.10 so the vision passes are refused unless an experiment raises it.
  const ceilingUsd = Number(cliArg('--ceiling') ?? '0.10');
  const { ledger } = await withSpendLedger({ projectId: 'lab', ceilingUsd }, async () => undefined);
  const live = parseFile === 'live';
  const parseModel = cliArg('--parse-model') ?? (noModel ? 'none' : await modelFor('parse'));
  const composeModel = cliArg('--compose-model') ?? (noModel ? 'none' : await modelFor('compose'));
  let handle: string | undefined;
  let poolSize = 24;
  if (resolved.businessId) {
    try {
      const { connectDb } = await import('../db');
      await connectDb(1, 200);
      const { BusinessModel } = await import('../models');
      const { brandPhotoPool } = await import('../lib/photoPool');
      const { brandHandleFromWebsite } = await import('../lib/htmlDirector/compose');
      const biz = (await BusinessModel.findById(resolved.businessId).lean()) as { website?: string } | null;
      handle = brandHandleFromWebsite(biz?.website);
      poolSize = (await brandPhotoPool(resolved.businessId)).length;
    } catch {
      /* no db: defaults stand */
    }
  }

  // ── the parse result, held to the parse step's own checks ─────────────────
  const req = buildParseRequest(recipe, idea, { ...opts, parseModel, handle });
  const copyFaults: unknown[] = [];
  let inputs: ComposeSlideInput[];
  if (live) {
    if (noModel) throw new Error('--parse live needs the model; drop --no-model');
    // THE REAL COPYWRITER, exactly as the route calls it: the same request the
    // dump writes, the brand's handle, the photo budget the pool affords.
    say('');
    say(`## Live parse — ${parseModel}`);
    const t0 = Date.now();
    inputs = await withLedger(ledger, () =>
      parseForCompose(recipe, idea, { ...opts, parseModel, handle, photoBudget: poolSize, onCopyCheck: (c) => copyFaults.push(...c.unfinished) }),
    );
    say(`- ${inputs.length} slide(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    writeFileSync(
      resolve(outDir, `${label}.parse.json`),
      JSON.stringify({ slides: inputs.map((i) => ({ role: i.role, image: i.photo ?? false, imageQuery: i.imageQuery, align: i.align, why: i.rationale, parts: i.parts })) }, null, 2) + '\n',
    );
    say(`- parse saved → ${label}.parse.json`);
  } else {
    const payload = replay
      ? { slides: (stored?.generated ?? []).map((g) => ({ role: g.role, parts: g.parts, image: /data-cb-slot=/.test(g.html ?? '') })) }
      : JSON.parse(readFileSync(parseFile!, 'utf8'));
    const slides = stripMarkdownFromDeck(readDeck(payload, 'lab'));
    const flagrant = budgetViolationsOf(slides, req.budgets).filter((v) => v.length > v.budget * 1.1);
    const lost = missingLocks(JSON.stringify(slides), req.locks);
    const repeats = repeatedSlides(slides);
    const unfinished = unfinishedProse(slides);
    say('');
    say('## What the corrective re-parse would have complained about');
    say('');
    if (!flagrant.length && !lost.length && !repeats.length && !unfinished.length) say('- nothing — the parse passed every check first time');
    for (const v of flagrant) say(`- slide ${v.slide + 1} ${v.label} is ${v.length} chars against a budget of ${v.budget}`);
    for (const l of lost) say(`- verbatim string not used: ${JSON.stringify(l)}`);
    for (const u of unfinished) say(`- slide ${u.slide + 1} ${u.label} stops mid-thought (${u.reason}): ${JSON.stringify(u.text)}`);
    for (const r of repeats) say(`- slides ${r.a + 1} and ${r.b + 1} make the same point (${Math.round(r.score * 100)}% word overlap)`);
    const soft = budgetViolationsOf(slides, req.budgets).filter((v) => v.length <= v.budget * 1.1);
    for (const v of soft) say(`- (clamped silently) slide ${v.slide + 1} ${v.label} ${v.length}/${v.budget}`);
    inputs = finishParsedDeck(recipe, slides, req, {
      ...opts,
      photoBudget: poolSize,
      onCopyCheck: (c) => copyFaults.push(...c.unfinished),
    });
  }
  say('');
  say(`## Deck as the parse step hands it on — ${inputs.length} slide(s)`);
  say('');
  say('| # | role | image | parts | why |');
  say('|---|---|---|---|---|');
  for (const [i, s] of inputs.entries()) {
    say(`| ${i + 1} | ${s.role} | ${s.photo ? 'yes' : ''} | ${Object.entries(s.parts).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ').replace(/\|/g, '\\|').slice(0, 300)} | ${(s.rationale ?? '').replace(/\|/g, '\\|')} |`);
  }
  if (copyFaults.length) say(`\nCopy faults after repair: ${JSON.stringify(copyFaults)}`);
  // Variant pins: the art director's override, applied by hand.
  for (const pin of (cliArg('--pins') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [slide, variant] = pin.split(':').map(Number);
    const input = inputs[(slide ?? 0) - 1];
    if (input && Number.isFinite(variant)) {
      input.variantPin = variant;
      say(`- slide ${slide}: pinned to variant ${variant}`);
    }
  }

  // Which slides the recipe can stamp without a model, and why the rest cannot.
  // Archetypes first, as `composeFromInputs` does: a bleed cover has no slot by
  // design, and without its archetype the substitution reads that as "no slot".
  const { assignArchetypes } = await import('@contentbuilder/shared');
  const archetypes = assignArchetypes(inputs.map((s) => ({ role: s.role, hasPhoto: s.photo === true })));
  inputs.forEach((input, i) => {
    input.archetype = archetypes[i];
  });
  const quiet = console.warn;
  console.warn = () => {};
  const needsModel = inputs
    .map((s, i) => ({ i, role: s.role, ok: useFragments && Boolean(composeByFragment(recipe, s)) }))
    .filter((x) => !x.ok);
  console.warn = quiet;
  say('');
  say(needsModel.length
    ? `Slides the model would compose: ${needsModel.map((x) => `${x.i + 1} (${x.role})`).join(', ')} — the rest substitute from fragments.`
    : 'Every slide substitutes from a fragment — no model call needed.');
  if (noModel && needsModel.length) {
    throw new Error(`--no-model, but slides ${needsModel.map((x) => x.i + 1).join(', ')} need the model — supply --fragments that carry their parts (see the notes above for the missing placeholder)`);
  }

  // ── the production path from art direction to the layout ladder ──────────
  const o: ComposeOptions = {
    ...opts,
    model: composeModel,
    parseModel,
    useFragments,
    artDirection: !noModel && cliHas('--art-direction'),
    renderCheck: !cliHas('--no-render-check'),
    handle,
  };
  const notes: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    notes.push(args.map(String).join(' '));
    origWarn(...args);
  };
  let composed;
  try {
    composed = await withLedger(ledger, () =>
      composeFromInputs(recipe, inputs, { ...o, onLayoutCheck: (l) => notes.push(`[layout] ${JSON.stringify(l)}`) }, { idea, parseUser: req.user }),
    );
  } finally {
    console.warn = origWarn;
  }
  say('');
  say('## Composed');
  say('');
  say('| # | role | path | archetype | surface | bg | slots | text |');
  say('|---|---|---|---|---|---|---|---|');
  for (const [i, s] of composed.entries()) {
    const text = s.authored.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    say(`| ${i + 1} | ${s.role} | ${s.source} | ${s.authored.archetype ?? ''} | ${s.authored.surface ?? 'base'} | ${s.authored.bg ?? ''} | ${(s.authored.html.match(/data-cb-slot="([^"]+)"/g) ?? []).length} | ${text.replace(/\|/g, '\\|').slice(0, 200)} |`);
  }
  say('');
  say('## Pipeline notes');
  say('');
  for (const n of notes) say(`- ${n.replace(/\n/g, ' ')}`);

  // ── the pixels ────────────────────────────────────────────────────────────
  const save = !cliHas('--no-save');
  let savedProjectId: string | undefined;
  let shots: Array<string | null> = [];
  const flagsFor = (i: number) => [
    ...(notes.some((n) => n.includes(`slide ${i + 1}`) && /overflow|collid|slack|dropped/.test(n)) ? ['gate'] : []),
  ];
  if (save && resolved.businessId) {
    const { connectDb } = await import('../db');
    await connectDb(1, 200);
    const { ProjectModel } = await import('../models');
    const { attachPoolPhotos, brandPhotoPool } = await import('../lib/photoPool');
    const pool = await brandPhotoPool(resolved.businessId);
    const base = composed.map((s, i) => ({ id: randomUUID(), order: i, authored: s.authored }));
    const photosFile = cliArg('--photos');
    let attached: Awaited<ReturnType<typeof attachPoolPhotos>>;
    if (photosFile) {
      // Explicit pictures, chosen by hand: no pool, no tone check — the lab is
      // asking "what does the deck look like with THIS picture there", and a
      // background still gets its bleed anchor read from the pixels.
      const { bleedAnchorFor } = await import('../lib/bleedAnchor');
      const { getStorage } = await import('../storage');
      const { MediaAssetModel } = await import('../models');
      const spec = JSON.parse(readFileSync(photosFile, 'utf8')) as Record<string, { placement: 'background' | 'slot'; slot?: string; asset: string; fit?: 'cover' | 'contain'; shape?: 'standard' | 'wide' | 'square' | 'tall' }>;
      attached = { photos: base.map(() => []), used: 0, anchors: base.map(() => undefined), notes: [] };
      for (const [k, ph] of Object.entries(spec)) {
        const i = Number(k) - 1;
        if (!base[i]) continue;
        const asset = (await MediaAssetModel.findById(ph.asset).lean()) as { key?: string } | null;
        attached.photos[i]!.push({ id: randomUUID(), mediaAssetId: ph.asset, placement: ph.placement, fit: ph.fit ?? 'cover', ...(ph.slot ? { slot: ph.slot } : {}), ...(ph.shape ? { shape: ph.shape } : {}) } as any);
        attached.used += 1;
        if (ph.placement === 'background' && asset?.key) {
          try { attached.anchors[i] = await bleedAnchorFor(await getStorage().read(asset.key)); } catch { /* keep the archetype default */ }
        }
      }
    } else {
      attached = await attachPoolPhotos(base, pool, String(recipe.tokens?.ground ?? ''));
    }
    const project = await ProjectModel.create({
      businessId: resolved.businessId,
      title: `LAB · ${label}`,
      type: format === '1080x1920' ? 'story' : 'carousel',
      format,
      status: 'draft',
      stage: 'drafting',
      settings: { theme: 'editorial', slideCounter: false, ...(stored?.settings ?? {}) },
      slides: base.map((s, i) => ({
        ...s,
        imageNeed: 'none',
        ...(attached.anchors[i] ? { overrides: { bleedAnchor: attached.anchors[i] } } : {}),
        photos: attached.photos[i] ?? [],
        ...(composed[i]!.rationale ? { rationale: composed[i]!.rationale } : {}),
      })),
      composeNotes: attached.notes,
      // PIN THE RECIPE THIS DECK WAS COMPOSED WITH. The render route draws a
      // project against the kit's live recipe unless the project carries a
      // snapshot — so a lab deck composed against the reference recipe (or a
      // hand-advertised class) would otherwise be photographed in the wrong
      // CSS, and the first --reference run was: raw <b>/<em> where the exhibit
      // cells should have been. Same mechanism a shipped deck uses.
      recipeSnapshot: recipe,
      recipeSnapshotAt: new Date(),
    });
    savedProjectId = String(project._id);
    say('');
    say(`Saved as project ${project._id} ("LAB · ${label}") — ${attached.photos.flat().length} photo(s) attached from a pool of ${pool.length}${attached.notes.length ? `; ${attached.notes.length} bleed photo(s) dropped for tone` : ''}`);
    shots = await shootLiveDeck(String(project._id), base.map((s) => s.id), format);
  } else {
    const probe = await openRenderProbe(recipe, format, composed.map((s, i) => ({ index: i, role: s.role, html: s.authored.html, archetype: s.authored.archetype })) as any);
    try {
      shots = await Promise.all(composed.map((s, i) => (probe.shoot ? probe.shoot(i, s.authored.html) : Promise.resolve(null))));
    } finally {
      await probe.close();
    }
    say('');
    say('Photographed through a scaffold — no photos attached (use --save for the real look).');
  }
  // ── the critique, as the route runs it: after the save, on the real render ──
  let critiqueLine = '';
  if (cliHas('--critique') && !noModel && shots.some(Boolean)) {
    const { critiqueDeck } = await import('../lib/htmlDirector/deckCritique');
    const outcome = await withLedger(ledger, () =>
      critiqueDeck(recipe, shots.map((b64) => (b64 ? Buffer.from(b64, 'base64') : null)), format),
    );
    if (outcome.status === 'ok') {
      const r = outcome.critique;
      say('');
      say('## Critique');
      say('');
      say(`> ${r.verdict ?? ''}`);
      for (const f of r.findings ?? []) say(`- [${f.severity}] slide ${f.slide}: ${f.fault} — *${f.fix}*`);
      critiqueLine = `critique: ${(r.findings ?? []).length} finding(s)`;
      if (savedProjectId) {
        const { ProjectModel } = await import('../models');
        await ProjectModel.updateOne({ _id: savedProjectId }, { $set: { critique: { status: 'ok', ...r, at: new Date() } } }).catch(() => {});
      }
    } else {
      say(`\nCritique skipped: ${outcome.reason}${'detail' in outcome && outcome.detail ? ` — ${outcome.detail}` : ''}`);
    }
  }
  const spend = summarize(ledger);
  say(`\nSpend: $${spend.spentUsd.toFixed(4)} over ${spend.calls} call(s) of a $${ceilingUsd} ceiling${spend.skipped.length ? ` — refused: ${spend.skipped.join('; ')}` : ''}${critiqueLine ? ` · ${critiqueLine}` : ''}`);
  for (const f of spend.byFeature) say(`  - ${f.feature}: $${f.costUsd.toFixed(4)} × ${f.calls}`);

  const ok = shots.filter(Boolean).length;
  if (ok) {
    const sheet = await buildContactSheet(
      shots.map((b64, i) => ({ buffer: b64 ? Buffer.from(b64, 'base64') : Buffer.alloc(0), flags: flagsFor(i) })).filter((s) => s.buffer.length),
      format,
    );
    writeFileSync(resolve(outDir, `${label}.png`), sheet);
    say(`Contact sheet: ${label}.png (${ok}/${shots.length})`);
  } else say('No slide would photograph — is the web server up?');
  writeFileSync(resolve(outDir, `${label}.md`), log.join('\n') + '\n');
  console.log(`\nwrote ${resolve(outDir, `${label}.md`)}`);
}

try {
  await main();
} finally {
  try {
    const { disconnectDb } = await import('../db');
    await disconnectDb();
  } catch {
    /* never connected */
  }
  await closeBrowser().catch(() => {});
}
