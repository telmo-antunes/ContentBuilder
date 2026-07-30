/**
 * COMPOSE EVAL RUNNER — `npm run eval:compose` (from the repo root or apps/api).
 *
 * A REAL-CALL harness: it runs the production parse+compose path
 * (parseForCompose + composeSlide, untouched) over the golden fixtures ×
 * reference brands, measures every mechanical guard, and writes a timestamped
 * JSON report (machine) plus a compact markdown summary (human). Editing
 * PARSE_SYSTEM or SLIDE_AUTHOR_INSTRUCTIONS then re-running against a
 * `--baseline` report turns a prompt change into a metric-by-metric diff.
 *
 *   npm run eval:compose                                # everything, serial
 *   npm run eval:compose -- --fixtures tips-list --brands dynatos
 *   npm run eval:compose -- --repeat 3 --concurrency 4 --yes
 *   npm run eval:compose -- --baseline eval-reports/compose-eval-<ts>.json
 *
 * Flags: --fixtures a,b · --brands a,b · --repeat N (default 1) · --out <dir>
 * (default <repo>/eval-reports, gitignored) · --baseline <report.json> ·
 * --concurrency N (default 1 — serial keeps warning attribution exact and the
 * report ordering deterministic either way) · --yes (required past ~$0.50).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config';
import { composeSlide, parseForCompose } from '../lib/htmlDirector/compose';
import { PROMPT_VERSION } from '../lib/promptVersion';
import {
  EVAL_BRANDS,
  EVAL_FIXTURES,
  pickBrands,
  pickFixtures,
  type EvalBrand,
  type EvalFixture,
} from './fixtures';
import {
  aggregate,
  diffAggregates,
  emptyComposerWarnings,
  estimateRunCostUsd,
  estimateUnitCostUsd,
  formatDiffTable,
  parseBudgetViolations,
  parseComposerWarnings,
  roleShapeViolations,
  slideMetrics,
  type AggregateMetrics,
  type RunResult,
} from './metrics';

/** Above this rough estimate the run refuses to start without `--yes`. */
export const COST_GATE_USD = 0.5;

// ── CLI arguments ────────────────────────────────────────────────────────────

export interface EvalArgs {
  fixtures?: string[];
  brands?: string[];
  repeat: number;
  out?: string;
  baseline?: string;
  concurrency: number;
  yes: boolean;
  help: boolean;
}

export const USAGE = `usage: npm run eval:compose -- [flags]
  --fixtures a,b     only these fixture ids (${EVAL_FIXTURES.map((f) => f.id).join(', ')})
  --brands a,b       only these brand ids (${EVAL_BRANDS.map((b) => b.id).join(', ')})
  --repeat N         run the matrix N times (default 1)
  --out <dir>        report directory (default <repo>/eval-reports, gitignored)
  --baseline <json>  a previous report to diff against, metric by metric
  --concurrency N    parallel fixture×brand units (default 1 = serial)
  --yes              proceed past the ~$${COST_GATE_USD.toFixed(2)} estimated-cost gate
  --help             this text`;

export function parseArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = { repeat: 1, concurrency: 1, yes: false, help: false };
  const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);
  const int = (flag: string, v: string | undefined) => {
    const n = Number(v);
    if (!v || !Number.isInteger(n) || n < 1) throw new Error(`${flag} needs a positive integer`);
    return n;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    switch (a) {
      case '--fixtures': args.fixtures = list(argv[++i] ?? ''); break;
      case '--brands': args.brands = list(argv[++i] ?? ''); break;
      case '--repeat': args.repeat = int(a, argv[++i]); break;
      case '--out': args.out = argv[++i]; break;
      case '--baseline': args.baseline = argv[++i]; break;
      case '--concurrency': args.concurrency = int(a, argv[++i]); break;
      case '--yes': args.yes = true; break;
      case '--help': case '-h': args.help = true; break;
      default: throw new Error(`unknown flag: ${a}\n${USAGE}`);
    }
  }
  if (args.out === undefined && argv.includes('--out')) throw new Error('--out needs a directory');
  if (args.baseline === undefined && argv.includes('--baseline')) throw new Error('--baseline needs a file');
  return args;
}

// ── Warning capture ──────────────────────────────────────────────────────────

/**
 * compose.ts reports its guard activity (dedupe drops, stripped inline stubs,
 * verbatim misses) through console.warn — the only observable surface that
 * needs no changes to production code. Warnings are routed to the current
 * unit's sink via AsyncLocalStorage, so attribution stays exact even when
 * `--concurrency` interleaves units.
 */
const warnSink = new AsyncLocalStorage<string[]>();

function installWarnTap(): () => void {
  const original = console.warn;
  console.warn = (...parts: unknown[]) => {
    const sink = warnSink.getStore();
    if (sink) {
      sink.push(parts.map(String).join(' '));
      return;
    }
    original(...parts);
  };
  return () => {
    console.warn = original;
  };
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface EvalUnit {
  fixture: EvalFixture;
  brand: EvalBrand;
  rep: number;
}

/** fixtures × brands × repeat, in canonical (deterministic) report order. */
export function buildUnits(fixtures: EvalFixture[], brands: EvalBrand[], repeat: number): EvalUnit[] {
  const units: EvalUnit[] = [];
  for (const fixture of fixtures) {
    for (const brand of brands) {
      for (let rep = 1; rep <= repeat; rep += 1) units.push({ fixture, brand, rep });
    }
  }
  return units;
}

export interface EvalReport {
  meta: {
    generatedAt: string;
    model: string;
    /**
     * The prompt versions this run exercised — the parse step and the per-slide
     * composer, the only two touchpoints the harness calls. Purely additive
     * metadata: it is NOT a metric, takes no part in `aggregate`, and the
     * baseline diff never reads it. It exists so that "verbatim violations
     * doubled between these two reports" can be answered with "…and the compose
     * prompt went 2 → 3 in between" instead of a shrug.
     */
    promptVersion: { parse: number; compose: number };
    fixtures: string[];
    brands: string[];
    repeat: number;
    concurrency: number;
    runs: number;
    calls: number;
    wallMs: number;
    estCostUsd: number;
  };
  aggregate: AggregateMetrics;
  runs: RunResult[];
}

export interface RunEvalOptions {
  fixtures: EvalFixture[];
  brands: EvalBrand[];
  repeat: number;
  concurrency: number;
  /** Used for cost ESTIMATES only — the compose path resolves its own model. */
  model: string;
  /** Progress lines (silence in tests). Defaults to console.log. */
  log?: (line: string) => void;
}

async function executeUnit(unit: EvalUnit, model: string): Promise<RunResult> {
  const rawWarnings: string[] = [];
  const result: RunResult = {
    fixture: unit.fixture.id,
    brand: unit.brand.id,
    rep: unit.rep,
    slides: [],
    warnings: emptyComposerWarnings(),
    rawWarnings,
    estCostUsd: 0,
  };
  try {
    await warnSink.run(rawWarnings, async () => {
      const t0 = Date.now();
      const inputs = await parseForCompose(unit.brand.recipe, unit.fixture.idea, {
        format: unit.fixture.format,
        slideCount: unit.fixture.slideCount,
      });
      result.parse = {
        latencyMs: Date.now() - t0,
        roles: inputs.map((i) => i.role),
        budget: parseBudgetViolations(inputs),
        shape: roleShapeViolations(inputs),
      };
      for (const input of inputs) {
        const s0 = Date.now();
        const out = await composeSlide(unit.brand.recipe, input);
        result.slides.push({
          role: input.role,
          html: out.html,
          latencyMs: Date.now() - s0,
          metrics: slideMetrics(input, out.html),
          // Which path composed it — the substitution path costs no model call,
          // so a report can say how much of a deck the recipe composed itself.
          source: out.source,
        });
      }
    });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  result.warnings = parseComposerWarnings(rawWarnings);
  result.estCostUsd = Number(
    estimateUnitCostUsd(model, unit.fixture.idea.length, result.slides.length || unit.fixture.slideCount).toFixed(4),
  );
  return result;
}

/** A minimal promise pool; results land at their unit's index, so order is stable. */
async function pool<T>(items: T[], size: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await worker(items[i]!, i);
    }
  });
  await Promise.all(lanes);
}

/** Run the matrix and build the full report object (no file I/O here). */
export async function runEval(opts: RunEvalOptions): Promise<EvalReport> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const units = buildUnits(opts.fixtures, opts.brands, opts.repeat);
  const results: RunResult[] = new Array(units.length);
  const t0 = Date.now();
  const restore = installWarnTap();
  try {
    await pool(units, opts.concurrency, async (unit, i) => {
      const label = `${unit.fixture.id} × ${unit.brand.id}${opts.repeat > 1 ? ` (rep ${unit.rep})` : ''}`;
      log(`[eval] ${i + 1}/${units.length} ${label}…`);
      results[i] = await executeUnit(unit, opts.model);
      const r = results[i]!;
      log(
        r.error
          ? `[eval]   ✗ ${label}: ${r.error}`
          : `[eval]   ✓ ${label}: ${r.slides.length} slides in ${((r.parse?.latencyMs ?? 0) + r.slides.reduce((s, x) => s + x.latencyMs, 0)) / 1000}s`,
      );
    });
  } finally {
    restore();
  }
  const runs = results.filter((r): r is RunResult => Boolean(r));
  const agg = aggregate(runs);
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      model: opts.model,
      promptVersion: { parse: PROMPT_VERSION.parse, compose: PROMPT_VERSION.compose },
      fixtures: opts.fixtures.map((f) => f.id),
      brands: opts.brands.map((b) => b.id),
      repeat: opts.repeat,
      concurrency: opts.concurrency,
      runs: runs.length,
      calls: agg.calls,
      wallMs: Date.now() - t0,
      estCostUsd: agg.estCostUsd,
    },
    aggregate: agg,
    runs,
  };
}

// ── Worst offenders + markdown summary ───────────────────────────────────────

export interface Offender {
  /** `fixture × brand (rep N)` */
  key: string;
  score: number;
  detail: string;
}

/** Rank runs by total violation weight; only offenders (score > 0) return. */
export function worstOffenders(runs: RunResult[], top = 5): Offender[] {
  const scored = runs.map((r) => {
    const parts: string[] = [];
    let score = 0;
    const add = (n: number, label: string, weight = 1) => {
      if (n > 0) {
        score += n * weight;
        parts.push(`${n} ${label}`);
      }
    };
    if (r.error) {
      score += 5;
      parts.push(`error: ${r.error.slice(0, 80)}`);
    }
    add(r.parse?.budget.length ?? 0, 'budget');
    add(r.parse?.shape.length ?? 0, 'shape');
    add(r.slides.reduce((n, s) => n + s.metrics.verbatimMissing.length, 0), 'verbatim');
    add(r.slides.filter((s) => s.metrics.slotIssue).length, 'slot');
    add(r.slides.filter((s) => s.metrics.dedupe.changed).length, 'dedupe');
    add(r.slides.filter((s) => s.metrics.sanitizer.changed).length, 'sanitizer');
    add(r.warnings.droppedDuplicates, 'composer-dup');
    add(r.warnings.droppedSpacers, 'composer-spacer');
    return {
      key: `${r.fixture} × ${r.brand}${r.rep > 1 ? ` (rep ${r.rep})` : ''}`,
      score,
      detail: parts.join(', '),
    };
  });
  return scored
    .filter((o) => o.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, top);
}

/** The compact human summary written next to the JSON report. */
export function buildMarkdownSummary(report: EvalReport): string {
  const m = report.meta;
  const a = report.aggregate;
  const offenders = worstOffenders(report.runs);
  const aggRows = (Object.entries(a) as Array<[string, number]>)
    .map(([k, v]) => `| ${k} | ${Number.isInteger(v) ? v : v.toFixed(4)} |`)
    .join('\n');
  const offenderBlock = offenders.length
    ? [
        '| run | score | violations |',
        '|---|---|---|',
        ...offenders.map((o) => `| ${o.key} | ${o.score} | ${o.detail} |`),
      ].join('\n')
    : '_No violations recorded._';
  const errors = report.runs.filter((r) => r.error);
  return [
    `# Compose eval — ${m.generatedAt}`,
    '',
    `- model: \`${m.model}\``,
    `- prompts: parse v${m.promptVersion.parse} · compose v${m.promptVersion.compose}`,
    `- matrix: ${m.fixtures.length} fixtures × ${m.brands.length} brands × ${m.repeat} repeat = ${m.runs} runs, ${m.calls} model calls`,
    // Compose-by-example, in one line: how much of the deck the recipe composed
    // itself. A brand whose every role has a usable fragment reads "N · 0".
    `- composition: ${a.fragmentSlides} slide(s) substituted from recipe fragments · ${a.aiSlides} composed by the model`,
    `- wall time: ${(m.wallMs / 1000).toFixed(1)}s · estimated cost: ~$${m.estCostUsd.toFixed(2)} (char-based estimate, not billing-grade)`,
    '',
    '## Aggregate',
    '',
    '| metric | value |',
    '|---|---|',
    aggRows,
    '',
    '## Worst offenders',
    '',
    offenderBlock,
    ...(errors.length
      ? [
          '',
          '## Errors',
          '',
          ...errors.map((r) => `- ${r.fixture} × ${r.brand} (rep ${r.rep}): ${r.error}`),
        ]
      : []),
    '',
    '_Render-overflow is not measured yet — see TODO(render-overflow) in `src/eval/metrics.ts`._',
    '',
  ].join('\n');
}

// ── CLI entry ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let args: EvalArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[eval] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  // This harness spends real money: refuse to start half-configured.
  if (!config.ai.apiKey) {
    console.error(
      '[eval] ANTHROPIC_API_KEY is not set — this harness makes REAL model calls.\n' +
        '[eval] Set it in the repo-root .env (see config.ts), then re-run.',
    );
    process.exit(1);
  }
  const model = config.ai.modelSmall ?? config.ai.model;
  if (!model) {
    console.error(
      '[eval] No compose model configured — set ANTHROPIC_MODEL_SMALL (or ANTHROPIC_MODEL) in the repo-root .env.',
    );
    process.exit(1);
  }

  let fixtures: EvalFixture[];
  let brands: EvalBrand[];
  try {
    fixtures = pickFixtures(args.fixtures);
    brands = pickBrands(args.brands);
  } catch (err) {
    console.error(`[eval] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const units = buildUnits(fixtures, brands, args.repeat);
  const estimate = estimateRunCostUsd(
    model,
    units.map((u) => ({ ideaChars: u.fixture.idea.length, slideCount: u.fixture.slideCount })),
  );
  console.log(
    `[eval] plan: ${fixtures.length} fixtures × ${brands.length} brands × ${args.repeat} repeat = ` +
      `${units.length} runs (~${estimate.calls} model calls) on ${model}` +
      (args.concurrency > 1 ? ` · concurrency ${args.concurrency}` : ' · serial'),
  );
  console.log(
    `[eval] estimated cost: ~$${estimate.estCostUsd.toFixed(2)} (rough, char-based; thinking tokens can push it higher)`,
  );
  if (estimate.estCostUsd > COST_GATE_USD && !args.yes) {
    console.error(
      `[eval] estimate exceeds the $${COST_GATE_USD.toFixed(2)} gate — re-run with --yes to spend it, ` +
        'or narrow the matrix with --fixtures / --brands.',
    );
    process.exit(1);
  }

  const report = await runEval({
    fixtures,
    brands,
    repeat: args.repeat,
    concurrency: args.concurrency,
    model,
  });

  const outDir = args.out ? resolve(process.cwd(), args.out) : resolve(config.repoRoot, 'eval-reports');
  mkdirSync(outDir, { recursive: true });
  const stamp = report.meta.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = resolve(outDir, `compose-eval-${stamp}.json`);
  const mdPath = resolve(outDir, `compose-eval-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, buildMarkdownSummary(report));
  console.log(`[eval] report: ${jsonPath}`);
  console.log(`[eval] summary: ${mdPath}`);

  const a = report.aggregate;
  console.log(
    `[eval] done: ${a.runs} runs (${a.errors} errors) · ${a.slides} slides · ` +
      `${a.budgetViolations} budget · ${a.roleShapeViolations} shape · ${a.verbatimViolations} verbatim · ` +
      `${a.slotViolations} slot · ${a.composerDroppedDuplicates} composer-dup · ~$${a.estCostUsd.toFixed(2)}`,
  );

  if (args.baseline) {
    const baselinePath = resolve(process.cwd(), args.baseline);
    let baseline: Partial<AggregateMetrics>;
    try {
      const parsed = JSON.parse(readFileSync(baselinePath, 'utf8')) as { aggregate?: AggregateMetrics };
      baseline = parsed.aggregate ?? (parsed as unknown as AggregateMetrics);
    } catch (err) {
      console.error(`[eval] could not read baseline ${baselinePath}: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
    console.log(`\n[eval] diff vs baseline ${baselinePath}:\n`);
    console.log(formatDiffTable(diffAggregates(baseline, report.aggregate)));
  }
}

// Run only when invoked as a script (tsx src/eval/run.ts), never under vitest.
if (process.argv[1] && /[\\/]run\.(ts|mts|js|mjs)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('[eval] failed:', err);
    process.exit(1);
  });
}
