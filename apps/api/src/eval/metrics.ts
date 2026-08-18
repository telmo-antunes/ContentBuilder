/**
 * PURE METRICS for the compose eval harness. No AI calls, no I/O — every
 * function here takes parse output / composed markup and returns numbers, so
 * a prompt edit to PARSE_SYSTEM or SLIDE_AUTHOR_INSTRUCTIONS becomes a
 * measurable before/after instead of a vibe.
 *
 * The checks deliberately mirror the production guards they measure:
 *   · budget limits come from compose.ts's own exported `composeBudgetsFor`
 *     (PARSE_SYSTEM's stated numbers, format-scaled) — one source of truth.
 *     parseForCompose clamps before returning, so a post-hoc violation here
 *     means the mechanical budget guard LEAKED, not merely that the model
 *     over-wrote; the clamp/re-parse activity itself is counted separately
 *     from the composer's warn lines.
 *   · `plain()` is a faithful copy of compose.ts's verbatim-guard normaliser
 *   · dedupe re-runs the real `pruneSlideMarkup`, sanitising re-runs the real
 *     `sanitizeAuthoredHtml` — on composeSlide's FINAL output both should be
 *     no-ops, so any delta means the production pipeline is unstable
 *   · the pipeline's own in-flight guard/repair activity (dedupe drops,
 *     budget clamps, corrective re-parses, verbatim retries, splices,
 *     emphasis wraps) is read from its console.warn lines, parsed by
 *     `parseComposerWarnings` — the only observable surface that doesn't
 *     require touching compose.ts internals. These are the PROMPT-QUALITY
 *     dials: a better prompt needs fewer mechanical rescues.
 *
 * TODO(render-overflow): a concurrent workstream owns the headless render
 * loop. When it lands, add a `overflowPx` field to SlideMetrics, populate it
 * in run.ts after composing (render the fragment at the fixture's format and
 * measure content vs canvas), then count it in aggregate() and surface it in
 * the markdown summary like every other metric.
 */
import { authoredSlots } from '@contentbuilder/shared';
import { bodyBudgetFor, composeBudgetsFor } from '../lib/htmlDirector/compose';
import { pruneSlideMarkup } from '../lib/htmlDirector/dedupeBlocks';
import { sanitizeAuthoredHtml } from '../lib/htmlSanitize';
import type { ComposeParts, ComposeSlideInput, SlideRole } from '../lib/htmlDirector/prompt';

// ── Parse budgets ────────────────────────────────────────────────────────────

export interface BudgetViolation {
  /** 0-based slide index. */
  slide: number;
  role: SlideRole;
  /** 'headline', 'body', … or 'rows[2].text'. */
  part: string;
  length: number;
  limit: number;
}

/**
 * Every budgeted part over its limit, per slide, at THAT slide's format-scaled
 * budgets (compose.ts's exported `composeBudgetsFor` — the same numbers
 * PARSE_SYSTEM states and clampSlidesToBudgets enforces). parseForCompose
 * clamps before returning, so on its output this should read 0; anything else
 * is a leak in the mechanical budget guard.
 */
export function parseBudgetViolations(slides: ComposeSlideInput[]): BudgetViolation[] {
  const out: BudgetViolation[] = [];
  slides.forEach((s, i) => {
    const budgets = composeBudgetsFor(s.format);
    for (const part of ['eyebrow', 'headline', 'body', 'cta'] as const) {
      const v = s.parts[part];
      // The body limit is per-role as well as per-format, so it is read the same
      // way production reads it — otherwise an explaining slide using the room
      // it is allowed would be counted here as a leak.
      const limit = part === 'body' ? bodyBudgetFor(budgets, s) : budgets[part];
      if (typeof v === 'string' && v.length > limit) {
        out.push({ slide: i, role: s.role, part, length: v.length, limit });
      }
    }
    (s.parts.rows ?? []).forEach((row, j) => {
      if (row.text.length > budgets.rowText) {
        out.push({ slide: i, role: s.role, part: `rows[${j}].text`, length: row.text.length, limit: budgets.rowText });
      }
    });
  });
  return out;
}

// ── Role shape ───────────────────────────────────────────────────────────────

export type RoleShapeIssue =
  | { type: 'first-not-cover'; role: SlideRole }
  | { type: 'last-not-cta'; role: SlideRole }
  /** A "list" slide without the 2+ rows PARSE_SYSTEM demands ("2–5 of them"). */
  | { type: 'list-without-rows'; slide: number };

/** First=cover, last=cta, and every list slide actually carries rows. */
export function roleShapeViolations(slides: ComposeSlideInput[]): RoleShapeIssue[] {
  const out: RoleShapeIssue[] = [];
  if (slides.length === 0) return out;
  const first = slides[0]!;
  const last = slides[slides.length - 1]!;
  if (first.role !== 'cover') out.push({ type: 'first-not-cover', role: first.role });
  if (last.role !== 'cta') out.push({ type: 'last-not-cta', role: last.role });
  slides.forEach((s, i) => {
    if (s.role === 'list' && (s.parts.rows ?? []).length < 2) {
      out.push({ type: 'list-without-rows', slide: i });
    }
  });
  return out;
}

// ── Verbatim guard (mirror of compose.ts) ────────────────────────────────────

/**
 * Collapse markup to comparable plain text. A FAITHFUL COPY of `plain()` in
 * apps/api/src/lib/htmlDirector/compose.ts (which is not exported, and which
 * this harness must not edit) — tags become spaces, the two entities the
 * composer's copy actually contains are decoded, whitespace collapses.
 * If compose.ts's `plain()` ever changes, change this in lockstep.
 */
export function plain(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Part keys whose copy did NOT survive verbatim in the composed fragment.
 * Same containment check as compose.ts's guard (string parts longer than 2
 * chars), extended to cover rows — compose's own guard skips them, but a
 * dropped row is lost copy all the same (reported as `rows[i].text`).
 */
export function verbatimViolations(parts: ComposeParts, html: string): string[] {
  const hay = plain(html);
  const missing: string[] = [];
  for (const [k, v] of Object.entries(parts)) {
    if (typeof v !== 'string' || v.length <= 2) continue;
    if (!hay.includes(plain(v))) missing.push(k);
  }
  (parts.rows ?? []).forEach((row, i) => {
    if (row.text.length > 2 && !hay.includes(plain(row.text))) missing.push(`rows[${i}].text`);
  });
  return missing;
}

// ── Dedupe guard / sanitizer stability ───────────────────────────────────────

export interface DedupeCheck {
  /** pruneSlideMarkup changed the markup — the fragment still held duplication. */
  changed: boolean;
  dropped: number;
  strippedInline: number;
}

/**
 * Re-run the production pruning guards on a fragment. composeSlide already
 * prunes before returning, so on its output any hit here means the guard is
 * not idempotent or the pipeline regressed; on RAW model output (unit tests)
 * it measures how often the composer duplicates.
 */
export function dedupeGuardCheck(html: string): DedupeCheck {
  const pruned = pruneSlideMarkup(html);
  return { changed: pruned.html !== html, dropped: pruned.dropped.length, strippedInline: pruned.strippedInline };
}

export interface SanitizerDelta {
  changed: boolean;
  /** sanitised length minus input length (negative = content was stripped). */
  charDelta: number;
}

/** Re-run the production sanitiser; composeSlide's output should be a fixed point. */
export function sanitizerDelta(html: string): SanitizerDelta {
  const safe = sanitizeAuthoredHtml(html);
  return { changed: safe !== html, charDelta: safe.length - html.length };
}

// ── Slot correctness ─────────────────────────────────────────────────────────

export type SlotIssue = 'missing-slot' | 'unexpected-slot' | 'too-many-slots';

/**
 * A photo slide must leave 1–2 holes (two only for a genuine pair, per
 * SLIDE_AUTHOR_INSTRUCTIONS); a non-photo slide must leave none.
 */
export function slotCheck(photo: boolean | undefined, html: string): { slots: string[]; issue?: SlotIssue } {
  const slots = authoredSlots(html);
  if (photo) {
    if (slots.length === 0) return { slots, issue: 'missing-slot' };
    if (slots.length > 2) return { slots, issue: 'too-many-slots' };
    return { slots };
  }
  return slots.length > 0 ? { slots, issue: 'unexpected-slot' } : { slots };
}

// ── Composer warning lines (the in-flight guard activity) ───────────────────

export interface ComposerWarnings {
  /** `[compose] <role>: dropped duplicated …` — the composer said something twice. */
  droppedDuplicates: number;
  /** `[compose] <role>: dropped a now-redundant … spacer` */
  droppedSpacers: number;
  /** Total empty inline elements stripped (`stripped N empty inline element(s)`). */
  strippedInline: number;
  /** `[compose] <role>: parts not verbatim in output: …` — count of listed parts. */
  verbatimMissing: number;
}

export function emptyComposerWarnings(): ComposerWarnings {
  return { droppedDuplicates: 0, droppedSpacers: 0, strippedInline: 0, verbatimMissing: 0 };
}

/** Parse compose.ts's console.warn lines into guard-hit counts. */
export function parseComposerWarnings(lines: string[]): ComposerWarnings {
  const w = emptyComposerWarnings();
  for (const line of lines) {
    if (!line.startsWith('[compose]')) continue;
    if (line.includes('dropped duplicated')) w.droppedDuplicates += 1;
    else if (line.includes('now-redundant') && line.includes('spacer')) w.droppedSpacers += 1;
    else {
      const stripped = line.match(/stripped (\d+) empty inline/);
      if (stripped) w.strippedInline += Number(stripped[1]);
      const verbatim = line.match(/parts not verbatim in output: (.+)$/);
      if (verbatim) w.verbatimMissing += verbatim[1]!.split(',').length;
    }
  }
  return w;
}

// ── Per-slide roll-up ────────────────────────────────────────────────────────

export interface SlideMetrics {
  role: SlideRole;
  fragmentChars: number;
  verbatimMissing: string[];
  dedupe: DedupeCheck;
  sanitizer: SanitizerDelta;
  slots: string[];
  slotIssue?: SlotIssue;
  // TODO(render-overflow): `overflowPx?: number` plugs in here once the
  // render loop can measure a composed fragment against its canvas.
}

/** All per-slide metrics for one composed slide. */
export function slideMetrics(input: ComposeSlideInput, html: string): SlideMetrics {
  const { slots, issue } = slotCheck(input.photo, html);
  return {
    role: input.role,
    fragmentChars: html.length,
    verbatimMissing: verbatimViolations(input.parts, html),
    dedupe: dedupeGuardCheck(html),
    sanitizer: sanitizerDelta(html),
    slots,
    ...(issue ? { slotIssue: issue } : {}),
  };
}

// ── Run results + aggregate ──────────────────────────────────────────────────

export interface SlideResult {
  role: SlideRole;
  html: string;
  latencyMs: number;
  metrics: SlideMetrics;
  /**
   * WHICH PATH composed this slide: `fragment` = substituted into the recipe's
   * own reference fragment (no model call), `ai` = the per-slide compose call.
   * Optional so a report written before compose reported it still aggregates —
   * an absent value counts as the AI path, which is what it was.
   */
  source?: 'fragment' | 'ai';
}

export interface RunResult {
  fixture: string;
  brand: string;
  /** 1-based repeat number. */
  rep: number;
  /** Set when the unit failed (API error, unparseable parse output, …). */
  error?: string;
  parse?: {
    latencyMs: number;
    roles: SlideRole[];
    budget: BudgetViolation[];
    shape: RoleShapeIssue[];
  };
  slides: SlideResult[];
  warnings: ComposerWarnings;
  /** Raw captured console.warn lines, for the report's paper trail. */
  rawWarnings: string[];
  estCostUsd: number;
}

/** Every field numeric, so a baseline diff is a mechanical key-by-key subtraction. */
export interface AggregateMetrics {
  runs: number;
  errors: number;
  slides: number;
  calls: number;
  budgetViolations: number;
  roleShapeViolations: number;
  verbatimViolations: number;
  /** Post-hoc pruneSlideMarkup still changed a FINAL fragment (should be 0). */
  dedupeGuardHits: number;
  composerDroppedDuplicates: number;
  composerDroppedSpacers: number;
  composerStrippedInline: number;
  composerVerbatimWarnings: number;
  sanitizerDeltas: number;
  slotViolations: number;
  /**
   * COMPOSE-BY-EXAMPLE, in two numbers: how many slides were SUBSTITUTED into
   * the recipe's own reference fragment (free) versus GENERATED by a per-slide
   * model call. Purely additive — no existing metric's meaning changes, and the
   * baseline diff reads a report that predates them as 0/0 like any other new
   * key. `calls` is deliberately left as it was (1 parse + 1 per slide): it is
   * the harness's cost ESTIMATE and every baseline was computed that way.
   */
  fragmentSlides: number;
  aiSlides: number;
  avgFragmentChars: number;
  maxFragmentChars: number;
  totalLatencyMs: number;
  avgCallLatencyMs: number;
  estCostUsd: number;
}

export function aggregate(runs: RunResult[]): AggregateMetrics {
  const agg: AggregateMetrics = {
    runs: runs.length,
    errors: 0,
    slides: 0,
    calls: 0,
    budgetViolations: 0,
    roleShapeViolations: 0,
    verbatimViolations: 0,
    dedupeGuardHits: 0,
    composerDroppedDuplicates: 0,
    composerDroppedSpacers: 0,
    composerStrippedInline: 0,
    composerVerbatimWarnings: 0,
    sanitizerDeltas: 0,
    slotViolations: 0,
    fragmentSlides: 0,
    aiSlides: 0,
    avgFragmentChars: 0,
    maxFragmentChars: 0,
    totalLatencyMs: 0,
    avgCallLatencyMs: 0,
    estCostUsd: 0,
  };
  let fragmentChars = 0;
  for (const run of runs) {
    if (run.error) agg.errors += 1;
    // Every unit that got as far as a parse made 1 call, plus one per slide.
    agg.calls += (run.parse ? 1 : run.error ? 1 : 0) + run.slides.length;
    agg.budgetViolations += run.parse?.budget.length ?? 0;
    agg.roleShapeViolations += run.parse?.shape.length ?? 0;
    agg.totalLatencyMs += run.parse?.latencyMs ?? 0;
    agg.composerDroppedDuplicates += run.warnings.droppedDuplicates;
    agg.composerDroppedSpacers += run.warnings.droppedSpacers;
    agg.composerStrippedInline += run.warnings.strippedInline;
    agg.composerVerbatimWarnings += run.warnings.verbatimMissing;
    agg.estCostUsd += run.estCostUsd;
    for (const slide of run.slides) {
      agg.slides += 1;
      agg.totalLatencyMs += slide.latencyMs;
      agg.verbatimViolations += slide.metrics.verbatimMissing.length;
      if (slide.metrics.dedupe.changed) agg.dedupeGuardHits += 1;
      if (slide.metrics.sanitizer.changed) agg.sanitizerDeltas += 1;
      if (slide.metrics.slotIssue) agg.slotViolations += 1;
      if (slide.source === 'fragment') agg.fragmentSlides += 1;
      else agg.aiSlides += 1;
      fragmentChars += slide.metrics.fragmentChars;
      agg.maxFragmentChars = Math.max(agg.maxFragmentChars, slide.metrics.fragmentChars);
    }
  }
  agg.avgFragmentChars = agg.slides ? Math.round(fragmentChars / agg.slides) : 0;
  agg.avgCallLatencyMs = agg.calls ? Math.round(agg.totalLatencyMs / agg.calls) : 0;
  agg.estCostUsd = Number(agg.estCostUsd.toFixed(4));
  return agg;
}

// ── Baseline diff ────────────────────────────────────────────────────────────

export interface DiffRow {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
}

/** Metric-by-metric numeric diff; metrics absent from the baseline read as 0. */
export function diffAggregates(baseline: Partial<AggregateMetrics>, current: AggregateMetrics): DiffRow[] {
  const base = baseline as Record<string, number>;
  return (Object.entries(current) as Array<[string, number]>).map(([metric, cur]) => {
    const prev = typeof base[metric] === 'number' ? base[metric]! : 0;
    return { metric, baseline: prev, current: cur, delta: Number((cur - prev).toFixed(4)) };
  });
}

/** A plain fixed-width table (stdout-friendly) of a baseline diff. */
export function formatDiffTable(rows: DiffRow[]): string {
  const header = { metric: 'metric', baseline: 'baseline', current: 'current', delta: 'delta' };
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4));
  const cells = rows.map((r) => ({
    metric: r.metric,
    baseline: fmt(r.baseline),
    current: fmt(r.current),
    delta: r.delta > 0 ? `+${fmt(r.delta)}` : fmt(r.delta),
  }));
  const width = (key: keyof typeof header) =>
    Math.max(header[key].length, ...cells.map((c) => c[key].length));
  const w = { metric: width('metric'), baseline: width('baseline'), current: width('current'), delta: width('delta') };
  const line = (c: typeof header) =>
    `${c.metric.padEnd(w.metric)}  ${c.baseline.padStart(w.baseline)}  ${c.current.padStart(w.current)}  ${c.delta.padStart(w.delta)}`;
  return [line(header), '-'.repeat(w.metric + w.baseline + w.current + w.delta + 6), ...cells.map(line)].join('\n');
}

// ── Cost estimation ──────────────────────────────────────────────────────────

/**
 * Approximate list prices in USD per 1M tokens, matched by model-family
 * substring — mirrors apps/api/src/lib/usage.ts (not imported: that module
 * drags in mongoose + the model registry, and these metrics stay pure).
 */
const PRICES: Array<{ match: RegExp; in: number; out: number }> = [
  { match: /fable|mythos/i, in: 10, out: 50 },
  { match: /haiku/i, in: 1, out: 5 },
  { match: /sonnet/i, in: 3, out: 15 },
  { match: /opus/i, in: 5, out: 25 },
];
const DEFAULT_PRICE = { in: 3, out: 15 };

/** chars → tokens at the usual ~4 chars/token. Rough by design. */
const tokens = (chars: number) => Math.ceil(chars / 4);

/**
 * Rough per-call input sizes, in characters (prompt scaffolding only; the idea
 * is added on top). Derived from the real prompts: PARSE_SYSTEM ≈ 2.6K chars +
 * brand voice block; SLIDE_AUTHOR_INSTRUCTIONS ≈ 3.6K + the recipe spec block.
 */
const PARSE_IN_BASE_CHARS = 3400;
const PARSE_OUT_PER_SLIDE_CHARS = 550;
const COMPOSE_IN_CHARS = 7000;
const COMPOSE_OUT_CHARS = 900;

/** Fable/Mythos think before answering; thinking bills as output tokens. */
const thinkFactor = (model: string) => (/fable|mythos/i.test(model) ? 3 : 1);

export function estimateCallCostUsd(model: string, inChars: number, outChars: number): number {
  const p = PRICES.find((x) => x.match.test(model)) ?? DEFAULT_PRICE;
  return (tokens(inChars) / 1e6) * p.in + ((tokens(outChars) * thinkFactor(model)) / 1e6) * p.out;
}

/** One fixture×brand unit = 1 parse call + slideCount compose calls. */
export function estimateUnitCostUsd(model: string, ideaChars: number, slideCount: number): number {
  const parse = estimateCallCostUsd(model, PARSE_IN_BASE_CHARS + ideaChars, slideCount * PARSE_OUT_PER_SLIDE_CHARS);
  const compose = estimateCallCostUsd(model, COMPOSE_IN_CHARS, COMPOSE_OUT_CHARS) * slideCount;
  return parse + compose;
}

export interface RunCostEstimate {
  calls: number;
  estCostUsd: number;
}

/** Whole-run estimate, printed BEFORE any money is spent. */
export function estimateRunCostUsd(
  model: string,
  units: Array<{ ideaChars: number; slideCount: number }>,
): RunCostEstimate {
  let cost = 0;
  let calls = 0;
  for (const u of units) {
    cost += estimateUnitCostUsd(model, u.ideaChars, u.slideCount);
    calls += 1 + u.slideCount;
  }
  return { calls, estCostUsd: Number(cost.toFixed(4)) };
}
