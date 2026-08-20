/**
 * The slide-compose touchpoint: turn an idea into on-brand authored slides.
 *
 *   idea + recipe  --parse-->  slides (role + verbatim parts)
 *                  --compose-> authored HTML (brand classes only)  --sanitise-->
 *
 * Two cheap steps. The PARSE writes the copy (creative); the COMPOSE only
 * arranges it into the brand's classes (the formula's hard rules) and never
 * rewrites it — a mechanical verbatim guard enforces that, and REPAIRS a
 * violation (one targeted retry, then a deterministic splice) rather than
 * shipping it. Both run on the small model tier by default; the look comes
 * entirely from the recipe.
 */
import { z } from 'zod';
import {
  RECIPE_REVEAL_ORDER,
  SLOT_ATTR,
  SLOT_CLASS,
  authoredSlots,
  containsLock,
  currentVersions,
  ensureBrandMark,
  extractQuotedCopy,
  missingLocks,
  parseBrief,
  recipeEmphasisWrap,
  recipePatternVariant,
  roleHintFor,
  budgetAfterLessons,
  lessonsBlock,
  variantBiasFromLessons,
  slideCountFor,
  type BrandRecipe,
  type Lesson,
  type RecipeEmphasisWrap,
  assignArchetypes,
  planInversion,
} from '@contentbuilder/shared';
import { aiJson, aiMessage, modelFor, textOf, type AiJsonResult, type AiJsonTool } from '../ai';
import { config } from '../../config';
import { sanitizeAuthoredHtml } from '../htmlSanitize';
import { lintAuthored } from './lintAuthored';
import { pruneSlideMarkup, topLevelBlocks } from './dedupeBlocks';
import {
  escapeHtml,
  fillRecipeFragmentGaps,
  fragmentVerbatimGaps,
  stripFences,
  substituteFragment,
  unwrapCbSlide,
  readsAsReasoning,
  firstSlideBody,
} from './fragments';
import { renderCheckDeck, renderCheckEnabledByDefault, type OpenProbe } from './renderCheck';
import { repairByLooking } from './visionRepair';
import { balanceVertical } from './balance';
import { sourceBlock, type SourceDoc } from '../sourceIngest';
import {
  buildComposeMessages,
  variantIndexOf,
  type ComposeParts,
  type ComposeSlideInput,
  type SlideRole,
} from './prompt';

const SLIDE_ROLES = ['cover', 'statement', 'quote', 'feature', 'stat', 'list', 'cta'] as const;

/** Fallback slot appended when a photo slide came back without one. */
const DEFAULT_SLOT = `<figure class="${SLOT_CLASS}" ${SLOT_ATTR}="photo"></figure>`;

/** How many slide composes run at once. A 9-slide deck used to be 9 serial
 *  calls; a small pool keeps latency near the slowest slide without hammering
 *  the API. */
const COMPOSE_CONCURRENCY = 4;

const partsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string().optional(),
  emphasis: z.string().optional(),
  tagline: z.string().optional(),
  body: z.string().optional(),
  quote: z.string().optional(),
  attribution: z.string().optional(),
  stat: z.string().optional(),
  cta: z.string().optional(),
  handle: z.string().optional(),
  /**
   * An enumeration, one entry per item. The composer has always known how to
   * lay these out (see `rowLines` in prompt.ts) but this key did not exist on
   * the parse schema, so Zod stripped any list the model produced and every
   * enumeration arrived as a run-on paragraph instead.
   */
  rows: z
    .array(z.object({ text: z.string(), note: z.string().optional() }))
    .max(6)
    .optional(),
});
const parseResultSchema = z.object({
  slides: z
    .array(
      z.object({
        role: z.enum(SLIDE_ROLES),
        parts: partsSchema,
        /** Does this slide want a photograph? Drives the placeholder the user fills. */
        image: z.boolean().catch(false).default(false),
        /**
         * WHAT the photograph should be of, in the words you would type into a
         * stock library. The parse step already knows what the slide is about;
         * without this the Studio's stock picker opened on an empty box and the
         * user had to invent the search themselves.
         */
        imageQuery: z.string().max(80).optional(),
      }),
    )
    .min(1)
    .max(12),
});
type ParsedSlide = z.infer<typeof parseResultSchema>['slides'][number];

export interface ComposeOptions {
  format?: string;
  /**
   * Pin the deck length. Normally ABSENT: how many slides a brief is worth is
   * derived from the brief itself (`slideCountFor`), which is what replaced the
   * manual stepper. Still honoured so the eval harness can hold it constant.
   */
  slideCount?: number;
  /** Override the model (defaults to the small tier). */
  model?: string;
  handle?: string;
  /**
   * Pages the brief cited, already read (see `sourceIngest.ts`). The copywriter
   * writes FROM these — their headline, their structure, their actual lines —
   * instead of from a URL it has never opened.
   */
  sources?: readonly SourceDoc[];
  /**
   * One direction per slide, in order. Present when the user planned the deck
   * (the composer's slide-plan editor, or a "Slide 3: …" block in the brief);
   * it fixes both the slide count and what each slide is about.
   */
  plan?: readonly string[];
  /**
   * Copy the user quoted in the brief. Every one of these must survive into the
   * deck word for word — never reworded by the copywriter, never shortened by a
   * budget clamp.
   */
  locks?: readonly string[];
  /**
   * How many photographs this brand can actually put on the deck — the size of
   * its media library. ZERO means no slide may ask for one: an empty slot is a
   * dead grey box on the canvas, which is strictly worse than a slide composed
   * as pure type. Absent leaves the judgement to the copywriter alone (the
   * eval's behaviour, and every caller that has no library to consult).
   */
  photoBudget?: number;
  /**
   * Appended to the compose USER message. The overflow repair uses it to name
   * the failure ("the previous composition overflowed the canvas…"); nothing
   * else sets it, so a normal compose sends byte-identical messages.
   */
  note?: string;
  /**
   * Close the render loop: measure the composed deck through the real /render
   * route and repair slides that spill off the canvas. Defaults to
   * `renderCheckEnabledByDefault()` — ON in a server process, OFF under a test
   * runner, and overridable with `COMPOSE_RENDER_CHECK`. Degrades silently (one
   * log line, deck unchanged) when the web renderer is unreachable.
   */
  renderCheck?: boolean;
  /** Swap the measuring rig — tests inject a fake instead of a browser. */
  renderProbe?: OpenProbe;
  /**
   * Override the model for the PARSE step alone. `composeProject` resolves this
   * from the `parse` tier so the copywriting keeps the better model while the
   * per-slide typesetting runs cheap.
   */
  parseModel?: string;
  /**
   * WHAT THIS BRAND HAS TAUGHT THE COPYWRITER — corrections its owner has made
   * to previous posts, derived deterministically from what they edited (see
   * `packages/shared/src/learning.ts`). They ride in the USER message and they
   * move the copy budgets; nothing else about the pipeline changes.
   */
  lessons?: readonly Lesson[];
  /**
   * Per role, how far past the usual composition variant to start. Derived from
   * the brand's `rearranges-role` lessons — see `variantBiasFromLessons`.
   */
  variantBias?: Record<string, number>;
  /**
   * Called with the copywriter's USER message the moment it is built. The
   * message is assembled inside `parseForCompose` from a dozen inputs, and
   * rebuilding it afterwards to record it would be two sources of truth for the
   * one string that matters most — so it is reported rather than reconstructed.
   */
  onParsePrompt?: (user: string) => void;
  /**
   * WHERE THE PROMPTS GO. Called once per compose with the exact inputs that
   * produced this deck, so they can be recorded and later diffed against what
   * the user actually shipped. Absent by default: a caller that does not want
   * to remember anything pays nothing, and the eval passes no sink at all.
   */
  record?: (r: ComposeRecord) => void;
  /**
   * What the layout gates actually did. Absent by default, like `record`.
   * See the call site for why `unmeasured` is the number that matters.
   */
  onLayoutCheck?: (r: LayoutCheckSummary) => void;
  /**
   * Which phase compose is in, as it enters each one.
   *
   * `POST /compose` is synchronous and, until now, silent: it emitted nothing
   * between the request and the response, so a deck that took 300 seconds and
   * one that had wedged looked identical to the caller — and three runs did
   * wedge, persisting nothing. Reported per phase so a slow compose is
   * distinguishable from a stuck one, and so a wedge names the phase it stuck
   * in instead of leaving nothing behind at all.
   */
  onProgress?: (p: ComposeProgress) => void;
  /**
   * Copy problems that survived the corrective re-parse. Absent by default,
   * like `record` — see the call site for why anything survives at all.
   */
  onCopyCheck?: (r: CopyCheckSummary) => void;
}

/** What the copy checks still object to after compose has done what it can. */
export interface CopyCheckSummary {
  /** Lines that stop mid-thought. Empty is the expected answer. */
  unfinished: UnfinishedProse[];
}

/** Where a compose has got to. `done`/`total` are set only where there is a count. */
export interface ComposeProgress {
  phase: 'parsing' | 'composing' | 'checking-layout' | 'done';
  done?: number;
  total?: number;
}

/** What the render check learned about a deck, for the caller to report on. */
export interface LayoutCheckSummary {
  /** Slides the renderer measured. */
  measured: number;
  /** Slides it could not — these shipped with every gate off. */
  unmeasured: number;
  overflowed: number;
  repaired: number;
  /** Indices still faulty after the whole ladder. */
  unresolved: number[];
  notes: string[];
  ms: number;
}

/**
 * The prompts that made one deck, handed to the caller to store. The SYSTEM
 * halves are deliberately absent — they are identical for every brand, they
 * live in the prompt registry, and their versions are stamped here instead.
 */
export interface ComposeRecord {
  parseUser: string;
  models: { parse: string; compose: string };
  promptVersions: Record<string, number>;
  slides: Array<{
    role: string;
    parts: ComposeParts;
    html: string;
    path: ComposePath;
    /** Only when a model composed it; a substituted slide had no compose call. */
    composeUser?: string;
  }>;
}

function composeModel(opts?: ComposeOptions): string {
  return opts?.model ?? config.ai.modelSmall ?? config.ai.model!;
}

/**
 * The model that WRITES the copy. Falls back to the compose model when no parse
 * model was threaded in, so a direct `parseForCompose` call (the eval harness
 * pins one model for the whole run) behaves exactly as it always did.
 */
function parseModel(opts?: ComposeOptions): string {
  return opts?.parseModel ?? composeModel(opts);
}

/**
 * Extract the first JSON object from a model response (tolerates prose/fences).
 *
 * THE FALLBACK PATH ONLY. The parse step forces a tool, so its payload normally
 * arrives already parsed; this survives for replies that carry no tool_use block
 * — an older model, or a request the API declined to take tools on.
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in response');
  return JSON.parse(body.slice(start, end + 1));
}

/** The parse reply's payload: the forced tool's input, else the scraped text. */
function parsePayload(reply: AiJsonResult): unknown {
  if (reply.json) return reply.json;
  console.warn('[compose] parse: no tool_use block — falling back to reading JSON out of the text');
  return extractJson(reply.text);
}

/**
 * Validate the copywriter's deck, and FAIL IN ENGLISH.
 *
 * A raw `ZodError` carries its issues as a multi-line JSON array, and the route
 * shows callers the first line of an error message — so a deck that missed the
 * schema reached the user as, in full, `Compose failed: [`. The issues go to the
 * log where they can be read; the person gets a sentence.
 */
function readDeck(payload: unknown, where: string): ParsedSlide[] {
  const result = parseResultSchema.safeParse(payload);
  if (result.success) return result.data.slides;
  const issues = result.error.issues;
  for (const issue of issues.slice(0, 5)) {
    console.warn(`[compose] parse (${where}): ${issue.path.join('.') || '<root>'} — ${issue.message}`);
  }
  const first = issues[0];
  const where_ = first?.path.length ? `${first.path.join('.')}: ` : '';
  throw new Error(
    `the copywriter returned a deck this app cannot use (${where_}${first?.message ?? 'schema mismatch'})`,
  );
}

/**
 * Collapse to comparable plain text (tags out, entities + whitespace normalised).
 *
 * A tag becomes a SPACE, not nothing: a part's copy is regularly spread across
 * sibling elements (a panel's rows), and joining them without a separator turned
 * "begins. Repeat" into "begins.Repeat" — so the verbatim guard below could
 * report copy as missing that is plainly there. Adjacent whitespace collapses,
 * so nothing else changes.
 */
function plain(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ── A tiny concurrency pool (no deps) ───────────────────────────────────────

/**
 * Map with at most `limit` calls in flight, preserving input order in the
 * results. Error semantics match the serial loop this replaced: the first
 * failure fails the whole batch — but every worker CATCHES its own error, so
 * `Promise.all` never sees a rejection it hasn't handled and no in-flight
 * promise is left dangling. After a failure no NEW work is started; already
 * in-flight calls are allowed to settle before the error is rethrown.
 */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  // A holder object rather than a `let`: assignments made inside the worker
  // closures aren't visible to TS's control-flow analysis on a plain variable.
  const failure: { failed: boolean; err: unknown } = { failed: false, err: undefined };
  const worker = async (): Promise<void> => {
    while (!failure.failed) {
      const index = next;
      if (index >= items.length) return;
      next += 1;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (err) {
        if (!failure.failed) {
          failure.failed = true;
          failure.err = err;
        }
        return;
      }
    }
  };
  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  if (failure.failed) throw failure.err;
  return results;
}

// ── Copy budgets (the numbers PARSE_SYSTEM states, enforced in code) ────────

/** Per-part copy budgets, in characters, for one canvas. */
export interface ComposeBudgets {
  eyebrow: number;
  headline: number;
  body: number;
  /**
   * What a body may run to on a slide whose job is to EXPLAIN — see
   * {@link EXPLAIN_ROLES}. Always >= `body`.
   */
  explainBody: number;
  cta: number;
  /** One enumeration row's `text`. */
  rowText: number;
}

/**
 * The 4:5 post budgets — the exact numbers PARSE_SYSTEM promises.
 *
 * The eyebrow was 22, which is under a real 2–4 word kicker: "The cheapest
 * diagnostic" is 23 and "A workable rule of thumb" is 24, so the two best
 * kickers a blog post produced were both clamped into fragments. 26 is still
 * a kicker (uppercase, letter-spaced, it fills about two thirds of the canvas
 * width at the reference type scale) and stops eating whole words.
 */
const BASE_BUDGETS: ComposeBudgets = {
  eyebrow: 26,
  headline: 60,
  body: 90,
  explainBody: 150,
  cta: 24,
  rowText: 42,
};

/**
 * The roles whose job is to EXPLAIN. A cover hooks, a stat lands a number and a
 * quote carries a voice — each wants one short line under it. A `statement` or a
 * `feature` is where a deck makes its actual argument, and 90 characters is
 * under two rendered lines: every explanatory deck so far had its point
 * hand-authored back into panel rows afterwards, on five of eight slides in the
 * worst case.
 */
const EXPLAIN_ROLES = new Set<SlideRole>(['statement', 'feature']);

/**
 * A slide's body budget. Every other part is per-format; the body is also
 * per-role, because the roles differ in what a body is FOR.
 *
 * `explainBody` is MEASURED, not guessed — `src/scripts/measureBodyCeiling.ts`
 * renders one slide per body length through the production probe, across every
 * stored recipe, and reports where each first stops fitting. On a post, a slide
 * carrying eyebrow + headline + body fits 278 characters on every sound recipe.
 * The shape that breaks is the one that ALSO carries a tagline, a CTA and a
 * handle: there the tightest recipe fits 118 and overflows at 146.
 *
 * So the allowance is generous for a slide that only explains, and the base
 * budget applies again the moment a tagline shares the canvas with the body —
 * which the prompt's own "one supporting element per slide" rule asks for
 * anyway. A canvas the copy has to share is a canvas with less room on it.
 */
export function bodyBudgetFor(
  budgets: ComposeBudgets,
  slide: { role: string; parts: Pick<ComposeParts, 'tagline'> },
): number {
  if (!EXPLAIN_ROLES.has(slide.role as SlideRole)) return budgets.body;
  const tagline = slide.parts.tagline;
  if (typeof tagline === 'string' && tagline.trim().length > 0) return budgets.body;
  // A `shorter body` lesson lowers `body` for a brand whose copy kept
  // overflowing. That verdict is about this brand's type, not about one role, so
  // the explain allowance follows it down by the same proportion — otherwise the
  // brand that was told to write shorter keeps its 150 wherever it explains.
  const ratio = BASE_BUDGETS.explainBody / BASE_BUDGETS.body;
  return Math.min(budgets.explainBody, Math.round(budgets.body * ratio));
}

/**
 * The budgets for a format. A story's safe area is tighter (Instagram overlays
 * UI top and bottom), so its budgets shrink ~20%; a square canvas is shorter
 * than the 4:5 base, so it tightens ~10%. The same numbers drive the per-format
 * line in the parse USER message and the mechanical enforcement below — one
 * source of truth.
 */
export function composeBudgetsFor(format: string): ComposeBudgets {
  /**
   * A STORY TAKES NO CUT AT ALL — measured, part by part.
   *
   * The story budgets used to be the post's × 0.8, on the reasoning that
   * Instagram overlays its UI so the safe area is tighter. The reasoning
   * confuses a BAND with a proportional shrink: the UI takes a fixed strip off
   * the top and the bottom, which `enforceStoryReserve` now reserves in the
   * padding where it belongs, and what is left is a canvas 570px TALLER than a
   * post. `src/scripts/measurePartCeilings.ts` grows one part at a time on a
   * slide carrying the full furniture, across every stored recipe:
   *
   *              story budget   fits up to        post parity
   *   eyebrow         21          63  (3×)            26   ✓
   *   headline        48          72, fails at 96     60   ✓
   *   cta             19          57  (3×)            24   ✓
   *   rowText         34         102  (3×)            42   ✓
   *   body            72         175 (vs 146 on a post)     90   ✓ (since #58)
   *
   * Every part clears post parity with room over it, so the cut is removed
   * rather than re-tuned. Parity, not more: the post's numbers are the measured
   * ones, and where a budget is EDITORIAL rather than a fit limit — an eyebrow
   * is "a label, not a summary", a row is "scanned, not read" — the same rule
   * should hold on both canvases anyway. On the post those two fit at 3× their
   * budget and are still not raised, for exactly that reason.
   *
   * The square keeps its 0.9. It is genuinely a SHORTER canvas than the 4:5, so
   * that reasoning survives where the story's did not — and it has not been
   * measured.
   */
  const scale = format === '1080x1080' ? 0.9 : 1;
  return {
    eyebrow: Math.round(BASE_BUDGETS.eyebrow * scale),
    headline: Math.round(BASE_BUDGETS.headline * scale),
    body: Math.round(BASE_BUDGETS.body * scale),
    explainBody: Math.round(BASE_BUDGETS.explainBody * scale),
    cta: Math.round(BASE_BUDGETS.cta * scale),
    rowText: Math.round(BASE_BUDGETS.rowText * scale),
  };
}

interface BudgetViolation {
  slide: number;
  label: string;
  length: number;
  budget: number;
}

// ── Two slides making the same point ────────────────────────────────────────

/**
 * Words too common to mean anything when two slides share them. Deliberately
 * tiny and generic: a domain word ("coating", "beading") repeating across
 * slides is exactly the signal we want to keep, so only true function words go.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with',
  'is', 'are', 'was', 'were', 'be', 'it', 'its', 'that', 'this', 'these', 'those', 'you', 'your',
  'we', 'our', 'they', 'their', 'not', 'no', 'so', 'as', 'if', 'than', 'then', 'what', 'when',
]);

/** A slide's meaningful words — everything it says, deduplicated. */
function contentWords(parts: ComposeParts): Set<string> {
  const text = [
    parts.eyebrow, parts.headline, parts.tagline, parts.body, parts.quote, parts.stat, parts.cta,
    ...(parts.rows ?? []).flatMap((r) => [r.text, r.note ?? '']),
  ]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ')
    .toLowerCase();
  const out = new Set<string>();
  for (const w of text.split(/[^a-z0-9']+/)) {
    if (w.length > 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** Jaccard overlap of two word sets — 1 is identical, 0 shares nothing. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Above this two slides are saying the same thing in different words. */
const SAME_POINT = 0.5;

/**
 * Below this a slide has too little to say for the comparison to mean anything.
 * A pure statement slide — an eyebrow and one short line — can carry four
 * meaningful words, and two of those sharing three of them is a coincidence,
 * not a repetition. Judging them anyway spends a corrective re-parse on noise.
 */
const MIN_WORDS_TO_JUDGE = 6;

export interface RepeatedPair {
  a: number;
  b: number;
  score: number;
}

/**
 * WHICH SLIDES REPEAT EACH OTHER.
 *
 * A carousel earns a swipe by telling you something new on every frame, and the
 * copywriter — writing all of them in one pass from one article — regularly
 * spends two on the same point in different words. The system prompt asks for
 * variety; nothing checked. This is the check: cheap set overlap over each
 * slide's meaningful words, no model, no embedding.
 *
 * The COVER and the CTA are exempt on purpose. A cover restates the deck's
 * thesis and a call to action restates the offer — that is their job, and
 * flagging them would fire on every well-made deck forever.
 */
export function repeatedSlides(slides: ParsedSlide[]): RepeatedPair[] {
  const words = slides.map((s) => contentWords(s.parts));
  const out: RepeatedPair[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    for (let j = i + 1; j < slides.length; j += 1) {
      if (slides[i]!.role === 'cover' || slides[j]!.role === 'cta') continue;
      if (words[i]!.size < MIN_WORDS_TO_JUDGE || words[j]!.size < MIN_WORDS_TO_JUDGE) continue;
      const score = overlap(words[i]!, words[j]!);
      if (score >= SAME_POINT) out.push({ a: i, b: j, score });
    }
  }
  return out;
}

/** Every budgeted part that is over its budget (by any amount). */
function budgetViolationsOf(slides: ParsedSlide[], budgets: ComposeBudgets): BudgetViolation[] {
  const out: BudgetViolation[] = [];
  slides.forEach((s, i) => {
    const check = (label: string, value: string | undefined, budget: number) => {
      if (typeof value === 'string' && value.length > budget) {
        out.push({ slide: i, label, length: value.length, budget });
      }
    };
    check('eyebrow', s.parts.eyebrow, budgets.eyebrow);
    check('headline', s.parts.headline, budgets.headline);
    check('body', s.parts.body, bodyBudgetFor(budgets, s));
    check('cta', s.parts.cta, budgets.cta);
    (s.parts.rows ?? []).forEach((r, j) => check(`rows[${j}].text`, r.text, budgets.rowText));
  });
  return out;
}

/**
 * MARKDOWN IS NOT COPY.
 *
 * The copywriter is asked for an `emphasis` field naming the phrase to accent,
 * and it also, habitually, marks that phrase in the headline the way a chat
 * model marks emphasis anywhere: `*where is it now?*`. Those asterisks are not
 * a formatting instruction to anything downstream — the composer treats copy as
 * verbatim, quite correctly — so they were set in Playfair at 88px and printed
 * on the poster.
 *
 * They also broke the verbatim guard. The composer wraps the phrase in the
 * brand's emphasis element and drops the asterisks; the guard then compares its
 * output against a part that still had them, declared the headline missing, and
 * SPLICED A SECOND COPY of it onto the slide.
 *
 * So the markers are read for what they meant and removed: the marked phrase
 * becomes the `emphasis` when the copywriter named none, and the copy is the
 * words.
 */
const INLINE_MARK = /(\*\*|\*|__|_)(?=\S)([\s\S]*?\S)\1/g;

/** The scalar parts markdown can reach. `handle` is excluded: an underscore is
 *  a legal character in a handle, not emphasis around one. */
const MARKABLE_PARTS = ['eyebrow', 'headline', 'tagline', 'body', 'quote', 'attribution', 'cta', 'stat'] as const;

export function stripInlineMarks(text: string): { text: string; marked: string[] } {
  const marked: string[] = [];
  const out = text.replace(new RegExp(INLINE_MARK.source, 'g'), (_all, _mark: string, inner: string) => {
    if (inner.trim().length >= 2) marked.push(inner.trim());
    return inner;
  });
  return { text: out, marked };
}

/**
 * Take the markdown out of a parsed deck, and read what it was FOR.
 *
 * Runs before the budgets are checked, so a headline is measured in the words
 * that will be printed rather than in the asterisks that will not, and before
 * the verbatim-lock check, so a locked line is compared against real copy.
 */
function stripMarkdownFromDeck(slides: ParsedSlide[]): ParsedSlide[] {
  return slides.map((s, i) => {
    const parts = { ...s.parts };
    let touched = false;
    const marked: string[] = [];
    for (const key of MARKABLE_PARTS) {
      const v = parts[key];
      if (typeof v !== 'string') continue;
      const stripped = stripInlineMarks(v);
      if (stripped.text === v) continue;
      parts[key] = stripped.text;
      touched = true;
      if (key === 'headline') marked.push(...stripped.marked);
    }
    if (parts.rows) {
      parts.rows = parts.rows.map((r) => {
        const text = stripInlineMarks(r.text);
        const note = r.note === undefined ? undefined : stripInlineMarks(r.note).text;
        if (text.text !== r.text || note !== r.note) touched = true;
        return { ...r, text: text.text, ...(note === undefined ? {} : { note }) };
      });
    }
    if (typeof parts.emphasis === 'string') {
      const stripped = stripInlineMarks(parts.emphasis);
      if (stripped.text !== parts.emphasis) touched = true;
      parts.emphasis = stripped.text;
    }
    // The phrase the copywriter marked IS the accent it was asked to name.
    if (!parts.emphasis && marked.length) parts.emphasis = marked[0];
    if (touched) console.warn(`[compose] parse: slide ${i + 1} arrived with markdown emphasis — removed`);
    return touched ? { ...s, parts } : s;
  });
}

/**
 * Words that cannot END a clamped line. A cut at a word boundary is still an
 * ugly cut when the last word is a preposition or an article: "A workable rule
 * of" and "The cheapest" are what a 22-character eyebrow budget did to "A
 * workable rule of thumb" and "The cheapest diagnostic". Dropping the dangler
 * costs a word and buys a phrase that reads as though it were written short.
 */
const DANGLING_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from',
  'with', 'without', 'into', 'onto', 'over', 'under', 'as', 'is', 'are', 'was', 'were',
  'that', 'this', 'your', 'their', 'its', 'it', 'you', 'we', 'they', 'not', 'no', 'so',
  // Added when the same question — "can this word end a line?" — was asked of
  // copy the model WROTE rather than copy the clamp cut. See `unfinishedProse`.
  'nor', 'be', 'been', 'being', 'has', 'have', 'had', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'must', 'which', 'who', 'whose', 'than', 'then', 'our',
  'his', 'her', 'my', 'these', 'those', 'every', 'each',
]);

// ── Copy that stops mid-thought ─────────────────────────────────────────────

/**
 * Punctuation that finishes a line. A closing bracket or quote counts: the
 * sentence ended inside it.
 *
 * A COLON DOES NOT, and used to. A line ending in one promises something after
 * it, so treating it as an ending is precisely backwards — it let
 * `"Tight beads: healthy. Flat, clinging beads:"` through as finished, which is
 * a comparison cut off before its second half. Measured across every stored
 * string: exactly one ends with a colon, and it is that truncation. There is no
 * legitimate use of a trailing colon on a slide to protect.
 */
const TERMINAL_PUNCTUATION = /[.!?…)"'’”]$/;

/**
 * Parts that are meant to READ as language. An eyebrow is a 2-4 word label, a
 * CTA is button text and a handle is a name — none of them is a sentence, and
 * checking them produced nothing but false alarms ("Reframe this").
 */
const PROSE_PARTS = ['body', 'tagline', 'quote'] as const;

/** A part that stops mid-thought, with the reason. */
export interface UnfinishedProse {
  slide: number;
  label: string;
  text: string;
  reason: 'no terminal punctuation' | 'ends on a dangling word' | 'starts a sentence it never finishes';
}

/**
 * A sentence break with more words after it. A line containing one is PROSE,
 * whatever part it is written into — and prose that opens a second sentence has
 * to close it.
 *
 * This is the sharpest of the three rules and the one that catches what the
 * others cannot: "Miss the ducts. The smell finds" shipped past both of them,
 * because a headline is allowed to be a fragment and "finds" is a verb rather
 * than a dangling function word. Measured across 282 stored strings it fires
 * exactly once — on that line.
 */
const INTERNAL_SENTENCE_BREAK = /[.!?…]\s+\S/;

/**
 * Copy that stops mid-sentence.
 *
 * A deck shipped `"Enzymes break the source. Fragrance covers"` — 41 characters
 * against a 150-character budget, so nothing clamped it and nothing noticed. The
 * copywriter simply stopped, and the only gate that could have caught it was a
 * person reading the slide.
 *
 * Two rules, both measured against every string in the stored decks:
 *
 *   · A BODY or a row NOTE is prose and ends like prose. 50 of 51 stored bodies
 *     and 13 of 13 notes end with terminal punctuation.
 *   · A HEADLINE may be a fragment — 34 of 93 carry no full stop, by design —
 *     but no line may end on a word that leaves a phrase open.
 */
export function unfinishedProse(slides: ParsedSlide[]): UnfinishedProse[] {
  const out: UnfinishedProse[] = [];
  const dangles = (v: string) => {
    const last = v.replace(/[,;]+$/, '').split(/\s+/).pop()?.toLowerCase() ?? '';
    return DANGLING_WORDS.has(last);
  };
  const check = (slide: number, label: string, value: string | undefined, needsFullStop: boolean) => {
    const v = (value ?? '').trim();
    // One word is a label however it is punctuated; two words can still dangle.
    if (!v || v.split(/\s+/).length < 2) return;
    if (TERMINAL_PUNCTUATION.test(v)) return;
    // Whatever the part is FOR, a line that already broke a sentence is prose.
    if (INTERNAL_SENTENCE_BREAK.test(v)) {
      out.push({ slide, label, text: v, reason: 'starts a sentence it never finishes' });
      return;
    }
    if (needsFullStop) out.push({ slide, label, text: v, reason: 'no terminal punctuation' });
    else if (dangles(v)) out.push({ slide, label, text: v, reason: 'ends on a dangling word' });
  };
  slides.forEach((s, i) => {
    for (const part of PROSE_PARTS) check(i, part, s.parts[part], part === 'body');
    check(i, 'headline', s.parts.headline, false);
    (s.parts.rows ?? []).forEach((r, j) => {
      check(i, `rows[${j}].text`, r.text, false);
      check(i, `rows[${j}].note`, r.note, true);
    });
  });
  return out;
}

/** Drop trailing words that cannot end a line, down to a floor of one word. */
function dropDanglers(s: string): string {
  const words = s.split(' ');
  while (words.length > 1 && DANGLING_WORDS.has(words[words.length - 1]!.toLowerCase().replace(/[^a-z']/gi, ''))) {
    words.pop();
  }
  return words.join(' ');
}

/**
 * Trim to a budget at a word boundary with NO ellipsis — for the display parts
 * (headline / eyebrow / cta), where "…" reads worse than a shorter line.
 * Prefers to end on completed punctuation (drop the trailing clause) when that
 * keeps at least half the budget; never cuts mid-word, and never ends on a word
 * that was plainly leading somewhere.
 */
function clampNoEllipsis(raw: string, max: number): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const clause = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
    cut.lastIndexOf(', '),
    cut.lastIndexOf('; '),
    cut.lastIndexOf(': '),
    cut.lastIndexOf(' — '),
  );
  if (clause >= max * 0.5) {
    return dropDanglers(cut.slice(0, clause + 1).trim().replace(/[\s,;:—–-]+$/, ''));
  }
  const word = cut.lastIndexOf(' ');
  return dropDanglers((word > 0 ? cut.slice(0, word) : cut).replace(/[\s,;:—–-]+$/, ''));
}

/**
 * Clamp PROSE by dropping whole sentences.
 *
 * A body is not a headline: it is one or two finished thoughts, and the honest
 * way to shorten it is to publish fewer of them, not to stop halfway through
 * one. Cutting at the nearest word boundary shipped "A coating wears down
 * unevenly, starting where the car takes the most" — a sentence with its point
 * amputated — where dropping the second sentence entirely would have left
 * "Those numbers describe a best case." and read as though it were written that
 * way. Falls back to the word-boundary clamp only when not even the first
 * sentence fits.
 */
/**
 * The shortest completed sentence worth keeping on its own.
 *
 * The floor used to be `max * 0.35` alone, which reads as "don't leave a stub"
 * but scales the wrong way: raise the budget and a perfectly good short sentence
 * stops clearing the bar, so the clamp throws it away and cuts mid-clause
 * instead. "Those numbers describe a best case." is 35 characters — a line, not
 * a stub — and it cleared a 90-char budget's floor while failing a 150-char
 * one's. Whichever floor is LOWER applies, so a tight budget still refuses a
 * two-word fragment and a generous one stops preferring a severed clause to a
 * finished sentence.
 */
const MIN_KEPT_SENTENCE = 32;

function clampSentences(raw: string, max: number): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const sentences = s.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [s];
  let kept = '';
  for (const sentence of sentences) {
    const next = (kept + sentence).trimEnd();
    if (next.length > max) break;
    kept = next;
  }
  return kept.length >= Math.min(MIN_KEPT_SENTENCE, max * 0.35) ? kept : clampNoEllipsis(s, max);
}

/**
 * Deterministic last resort: clamp every part still over budget.
 *
 * NOTHING gets an ellipsis any more. The shared `clampText` marks a trim
 * visibly, which is right for evidence a human will read and wrong for a
 * poster: a body that shipped as "…correcting the paint, and starting…" reads
 * as a bug, not as a shortened line. On a slide the honest move is to end on a
 * completed clause and stop, which is what `clampNoEllipsis` does.
 *
 * Copy the user LOCKED (quoted in the brief) is never clamped. They asked for
 * those words; silently cutting them would break the one promise this feature
 * makes. It is left over budget and the render check's repair ladder — which
 * can shrink the type and drop furniture instead — deals with the consequences.
 */
function clampSlidesToBudgets(
  slides: ParsedSlide[],
  budgets: ComposeBudgets,
  locks: readonly string[] = [],
): ParsedSlide[] {
  const isLocked = (v: string) => locks.some((l) => containsLock(v, l));
  return slides.map((s, i) => {
    const parts = { ...s.parts };
    if (parts.rows) parts.rows = parts.rows.map((r) => ({ ...r }));
    let headlineClamped = false;
    const clamp = (key: 'eyebrow' | 'headline' | 'body' | 'cta', budget: number) => {
      const v = parts[key];
      if (typeof v !== 'string' || v.length <= budget) return;
      if (isLocked(v)) {
        console.warn(`[compose] parse: slide ${i + 1} ${key} is over budget but carries locked copy — kept whole`);
        return;
      }
      // Prose loses a whole sentence; a display line loses its trailing clause.
      const clamped = key === 'body' ? clampSentences(v, budget) : clampNoEllipsis(v, budget);
      console.warn(
        `[compose] parse: clamped slide ${i + 1} ${key} ${v.length} → ${clamped.length} chars (budget ${budget})`,
      );
      parts[key] = clamped;
      if (key === 'headline') headlineClamped = true;
    };
    clamp('eyebrow', budgets.eyebrow);
    clamp('headline', budgets.headline);
    clamp('cta', budgets.cta);
    clamp('body', bodyBudgetFor(budgets, s));
    parts.rows?.forEach((r, j) => {
      if (r.text.length <= budgets.rowText || isLocked(r.text)) return;
      const clamped = clampNoEllipsis(r.text, budgets.rowText);
      console.warn(
        `[compose] parse: clamped slide ${i + 1} rows[${j}].text ${r.text.length} → ${clamped.length} chars (budget ${budgets.rowText})`,
      );
      r.text = clamped;
    });
    // A clamped headline may have lost its emphasis phrase; an emphasis that is
    // no longer inside the headline can never be composed verbatim, so drop it
    // rather than sending the composer an impossible instruction.
    if (
      headlineClamped &&
      parts.emphasis &&
      parts.headline &&
      !parts.headline.toLowerCase().includes(parts.emphasis.toLowerCase())
    ) {
      console.warn(`[compose] parse: dropped slide ${i + 1} emphasis — no longer inside the clamped headline`);
      delete parts.emphasis;
    }
    return { ...s, parts };
  });
}

// ── The parse step ──────────────────────────────────────────────────────────

export const PARSE_SYSTEM = `You are a social-carousel copywriter + editor. Turn the user's brief — and the SOURCE material, when one is supplied — into a tight, scroll-stopping Instagram carousel, written in the brand's voice. Deliver it by CALLING THE "write_slides" TOOL. (If you cannot call the tool, return the same object as STRICT JSON only — no prose, no fences.)
{"slides":[{"role":"cover|statement|quote|feature|stat|list|cta","image":true|false,"parts":{...}}]}

WHAT YOU ARE GIVEN
- BRIEF — the angle, in the user's own words. Always obey it.
- SOURCE (optional) — the page the post is made from, already read for you. When it is present it is THE MATERIAL: take the real headline, the real structure and the strongest actual lines from it, and never assert a fact, number, promise or claim the source does not make. Never write about the link itself; write about what the page says.
- SLIDE PLAN (optional) — one direction per slide, in order. When it is present it FIXES the deck: exactly one slide per entry, in that order, each slide doing what its entry says. An entry that enumerates is a "list" slide with those items as rows.
- VERBATIM (optional) — exact strings the user quoted. Each must appear EXACTLY, character for character, inside the part it belongs to (usually a headline, a body line or a row). Never reword, retitle, re-punctuate, translate or shorten a verbatim string: build the slide around it.

RULES
- First slide role "cover" (a hook). Last slide role "cta". In between use statement / feature / stat / quote / list as the content wants.
- NEVER INVENT A CLAIM. This applies to the BRIEF exactly as it applies to a SOURCE: when the brief carries sentences, facts or list items, COMPRESS them — cut words, never substitute your own. Do not introduce a noun, cause, symptom or recommendation the brief does not contain. A slide built from a heading with no material under it states the heading and stops; it does not guess what the material would have said.
- THE SAME RULE BINDS EVERY SMALL LINE: row notes, taglines, bodies. A row's "note" exists ONLY when the brief explains that item; an unexplained item is a bare row, and a bare row is correct output, not a gap to fill. Plausible domain knowledge is still an invention — the readers most likely to notice are the ones who know the field.
- When the brief presents a list as ordered ("in order of impact", numbered), keep its order and do not add, drop or re-rank items — and never assert a ranking word ("fastest", "worst", "number one") the brief does not use.
- USE "list" WHEN THE CONTENT ENUMERATES. If a slide is "four things", "three ways", "what you get" — anything that is a set of parallel items — give it role "list" and put the items in "rows" (2–5 of them), NOT in "body". Never write a paragraph that is secretly a list: "Cash in the bank. Repeat visits secured. Slow weeks funded." is three rows, not one body. If your headline announces a number, the slide almost certainly wants rows.
- A "list" slide MUST carry rows. A list with no rows is an empty card — if you cannot fill it, the slide is not a list.
- rows entries are {"text": "the item", "note": "optional half-line of detail"}. Keep text under 42 characters — these are scanned, not read.
- parts keys (include only what a slide needs): eyebrow (2–4 word kicker), headline (the line — punchy), emphasis (the sub-phrase inside headline to accent), tagline (a short payoff line), body (1 short sentence — 2 on a statement or feature slide that is doing the explaining), rows (a list — see above), quote, attribution, stat (e.g. "40%"), cta (button text), handle.
- ONE IDEA PER SLIDE, and one supporting element at most: a body sentence, OR rows, OR a stat. Never a paragraph and a list on the same poster, and never a big number beside the list that already makes its point.
- "handle" is the brand's @name or web address and nothing else. It is set in the smallest, faintest type on the poster, so a sentence put there ships as an afterthought nobody can read. If you have something to say, it is a body, a tagline or a row.
- Every slide must tell the reader something the slide before it did not. If two slides make the same point, cut one.
- This is a POSTER read on a phone at arm's length, not an article. Hard budgets: eyebrow <= 26 characters, headline <= 60, body <= 90, cta <= 24. Going over does not get truncated — it pushes the design off the canvas.
- ONE EXCEPTION, and it is the important one: on a "statement" or a "feature" slide the body may run to 150 characters — two sentences — PROVIDED that slide carries no tagline. Those are the slides where the deck explains itself, and a deck of nine hooks with nothing under them is the most common way this comes out thin. Use the room when you have something to say; a slide that only needs six words still only gets six.
- The eyebrow is a LABEL, not a summary: 2–4 words naming what this slide is about. If you find yourself compressing the headline into it, drop it.
- HOW MANY SLIDES: you are told the range the material looks like it needs. Give the deck the number of slides the content actually earns inside that range — never pad a thin idea out to hit a quota, never cram two ideas onto one slide to come in under it.
- Write in the brand voice provided. No hashtags, no emoji.
- "image": set true when this slide would be genuinely STRONGER with a photograph — it shows a place, a product, a person, a result, a before/after. Set false when the slide is a pure typographic statement, a pulled quote, or a big number, where a photo would only decorate. Judge each slide on its own; a deck may have several, one, or none.
- With "image": true, also give "imageQuery" — 2–5 words naming the picture as you would search a stock library for it ("ceramic coating applied to car bonnet", not "a nice photo"). It is what the user's photo picker opens on.
- A slide marked "image": true gets an eyebrow and a headline ONLY. Omit "body" AND "rows" entirely on those slides — a photograph takes nearly half the canvas, and neither a paragraph nor a list can share what is left. If the content is a list, it is not a photo slide: keep the rows and set "image": false.`;

/**
 * THE PARSE STEP'S OUTPUT SHAPE, as a tool the model is FORCED to call — so the
 * deck arrives already parsed instead of being cut out of prose with a fence
 * regex and `indexOf('{')`.
 *
 * Deliberately LOOSE: it names the keys and the two enums, and leaves every
 * limit (the copy budgets, 1–12 slides, ≤6 rows) to `parseResultSchema`, which
 * is still the real gate and still `.catch()`es harmless drift.
 *
 * Module-level and constant: tools render before `system`, so these bytes are
 * part of the cached prefix and must never vary per call.
 */
const PARSE_TOOL: AiJsonTool = {
  name: 'write_slides',
  description:
    'Deliver the carousel — one entry per slide, in reading order, each carrying its role and the copy that goes on it.',
  schema: {
    type: 'object',
    properties: {
      slides: {
        type: 'array',
        description: 'The slides in order: the first is the cover (the hook), the last is the cta.',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: [...SLIDE_ROLES], description: "This slide's job in the deck." },
            image: {
              type: 'boolean',
              description: 'true only when this slide would be genuinely STRONGER with a photograph.',
            },
            imageQuery: {
              type: 'string',
              description:
                'Only when image is true: 2–5 words describing the picture, as you would type them into a stock photo library.',
            },
            parts: {
              type: 'object',
              description: 'Only the parts this slide actually needs — omit the rest entirely.',
              properties: {
                eyebrow: { type: 'string', description: 'A 2–4 word kicker.' },
                headline: { type: 'string', description: 'The line — punchy.' },
                emphasis: { type: 'string', description: 'The sub-phrase INSIDE headline to accent.' },
                tagline: { type: 'string', description: 'A short payoff line.' },
                body: { type: 'string', description: 'One short sentence.' },
                quote: { type: 'string' },
                attribution: { type: 'string' },
                stat: { type: 'string', description: 'One number, e.g. "40%".' },
                cta: { type: 'string', description: 'Button text.' },
                handle: { type: 'string' },
                rows: {
                  type: 'array',
                  description: 'An enumeration, one entry per item — never a paragraph that is secretly a list.',
                  items: {
                    type: 'object',
                    properties: {
                      text: { type: 'string', description: 'The item — scanned, not read.' },
                      note: { type: 'string', description: 'Optional half-line of detail.' },
                    },
                    required: ['text'],
                  },
                },
              },
            },
          },
          required: ['role', 'parts'],
        },
      },
    },
    required: ['slides'],
  },
};

/**
 * How photo-forward this brand is, in words the parse step can act on.
 *
 * `imagery.photoRole` is authored per brand and was left reading by nothing
 * when the old covers-only rule went away. This gives it a real job: it biases
 * the per-slide "would a photograph earn its place here?" judgement, so a
 * detailing shop is asked for pictures far more often than a brand whose whole
 * identity is typographic.
 */
function photoGuidance(recipe: BrandRecipe): string {
  switch (recipe.imagery.photoRole) {
    case 'hero':
      return 'PHOTOGRAPHY: this brand is carried by its images — most slides that show a place, a product, a person or a result should ask for one.';
    case 'accent':
      return 'PHOTOGRAPHY: this brand uses images sparingly, to support the type — ask for one only where it genuinely adds proof or atmosphere.';
    default:
      return 'PHOTOGRAPHY: this brand is typographic — set "image" to false unless a slide is meaningless without a picture.';
  }
}

/**
 * The per-format line of the parse USER message. PARSE_SYSTEM stays static
 * (identical bytes on every call, so it caches); the canvas-specific correction
 * — tighter safe areas, reduced budgets — travels in the user message only,
 * with the reduced numbers stated explicitly so the model isn't left to do the
 * ~20% arithmetic itself.
 */
export function formatGuidance(format: string): string {
  const b = composeBudgetsFor(format);
  const numbers =
    `eyebrow <= ${b.eyebrow}, headline <= ${b.headline}, body <= ${b.body} ` +
    `(<= ${b.explainBody} on a statement or feature slide that has no tagline), ` +
    `cta <= ${b.cta}, rows text <= ${b.rowText}`;
  if (format === '1080x1920') {
    return `FORMAT: 1080×1920 story (9:16). Instagram overlays its UI over the top and bottom, and the layout already reserves that band — what is left is a TALLER canvas than a post, so the copy budgets are the same, not smaller: ${numbers}. Use the height for air and scale, not for more words.`;
  }
  if (format === '1080x1080') {
    return `FORMAT: 1080×1080 square (1:1). A shorter canvas than the 4:5 post, so keep copy slightly tighter: ${numbers}.`;
  }
  return '';
}

/**
 * The deck-length instruction. A plan is an order and says so; without one the
 * copywriter is given the RANGE the material earns and told not to pad — which
 * is what replaced the manual "5 slides" stepper the user used to set by hand
 * before they had read the source themselves.
 */
export function countGuidance(range: { min: number; max: number; target: number; fixed: boolean }, planned: number): string {
  // `fixed` has TWO sources — a plan, and an explicit `slideCount` — and only
  // the first has entries to hang the count on. Reading `planned` in both cases
  // told a caller who passed `slideCount: 6` and no plan "SLIDES: exactly 0 —
  // one per SLIDE PLAN entry", which is not an instruction anything can follow;
  // the model ignored it and returned 8.
  if (range.fixed) {
    if (planned > 0) {
      return `SLIDES: exactly ${planned} — one per SLIDE PLAN entry, in that order. Do not add a slide the plan did not ask for, and do not merge two.`;
    }
    return `SLIDES: exactly ${range.target}. Not one more, not one fewer — split or merge your points to land on that number.`;
  }
  return `SLIDES: ${range.min}–${range.max} (about ${range.target} looks right for this much material). Use what the content earns; do not pad.`;
}

function parseUser(
  recipe: BrandRecipe,
  idea: string,
  format: string,
  opts: {
    range: { min: number; max: number; target: number; fixed: boolean };
    plan: readonly string[];
    locks: readonly string[];
    sources: readonly SourceDoc[];
    handle?: string;
    lessons?: readonly Lesson[];
  /**
   * Per role, how far past the usual composition variant to start. Derived from
   * the brand's `rearranges-role` lessons — see `variantBiasFromLessons`.
   */
  variantBias?: Record<string, number>;
  },
): string {
  // A plan entry that plainly asks for a shape — "as a list of two", "a pull
  // quote", "the close" — says so in the numbered line, so the copywriter does
  // not have to re-derive it from the prose it just read.
  const plan = opts.plan.length
    ? `SLIDE PLAN (one slide per entry, in this order):\n` +
      opts.plan
        .map((p, i) => {
          const hint = roleHintFor(p);
          return `  ${i + 1}. ${p}${hint ? `   [reads as role "${hint}"]` : ''}`;
        })
        .join('\n')
    : '';
  const locks = opts.locks.length
    ? `VERBATIM — use each of these EXACTLY, word for word, in the slide it belongs to:\n` +
      opts.locks.map((l) => `  · ${JSON.stringify(l)}`).join('\n')
    : '';
  return [
    `BRAND VOICE: ${recipe.voice.description || 'clear, confident'}`,
    photoGuidance(recipe),
    recipe.voice.dos.length ? `DO: ${recipe.voice.dos.join('; ')}` : '',
    recipe.voice.donts.length ? `DON'T: ${recipe.voice.donts.join('; ')}` : '',
    opts.handle ? `HANDLE: ${opts.handle}` : '',
    formatGuidance(format),
    countGuidance(opts.range, opts.plan.length),
    lessonsBlock(opts.lessons ?? []),
    ``,
    `BRIEF: ${idea || '(none — work from the source and the plan)'}`,
    plan,
    locks,
    sourceBlock(opts.sources),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The roles whose composition can actually HOLD a photograph.
 *
 * A recipe fragment is the brand's own worked example of a role, and a role
 * whose fragment has no `cb-shot` hole cannot take a picture without abandoning
 * the fragment entirely and asking a cheap model to invent an arrangement
 * instead — which is exactly how a cover ended up as a dead grey rectangle
 * above a squashed headline. A role with NO fragment is unconstrained: the
 * model composes it either way, so it may still be asked for one.
 */
function photoCapableRoles(recipe: BrandRecipe): Set<string> {
  const out = new Set<string>();
  for (const role of SLIDE_ROLES) {
    const fragment = recipe.fragments?.[role];
    if (typeof fragment !== 'string' || !fragment.trim() || authoredSlots(fragment).length > 0) {
      out.add(role);
    }
  }
  return out;
}

/**
 * Make the parsed deck STRUCTURALLY honest, before a single slide is composed.
 *
 * Four rules, all deterministic, all fixing a failure seen on a real deck:
 *
 *   1. Rows and a picture never share a slide. The system prompt says so; when
 *      the model does it anyway the rows are what the composer silently drops,
 *      so the slide ships as a headline over an empty box. The rows win — they
 *      are the content.
 *   2. A "list" with no rows is not a list. It becomes the role its remaining
 *      copy actually is, so it gets a composition built for that copy instead of
 *      an empty enumeration card.
 *   3. A photograph is only requested where the brand's own composition can hold
 *      one (see `photoCapableRoles`).
 *   4. A photograph is only requested when there IS one. `photoBudget` is the
 *      size of the brand's media library; past it, every remaining slide is
 *      composed as type. An empty slot is worse than no slot.
 */
function normalizeParsedDeck(
  slides: ParsedSlide[],
  recipe: BrandRecipe,
  photoBudget: number | undefined,
  handle?: string,
): ParsedSlide[] {
  const capable = photoCapableRoles(recipe);
  let remaining = photoBudget;
  return slides.map((s, i) => {
    let role = s.role;
    let image = s.image;
    const parts = { ...s.parts };
    const rows = parts.rows ?? [];

    /**
     * THE HANDLE IS THE BRAND'S, NOT THE COPYWRITER'S. Every recipe styles it as
     * the small muted line at the very bottom — an @name or a URL — and a
     * copywriter handed a free text field will put a footnote in it ("Check each
     * panel separately — the roof goes first"), which then ships as a whole
     * thought set in the smallest, faintest type on the poster. So it is either
     * the handle the caller supplied, or it is handle-shaped, or it is not a
     * handle.
     */
    if (typeof parts.handle === 'string') {
      const value = parts.handle.trim();
      const shaped = value.length <= 40 && !/\s/.test(value) && /^[@a-z0-9]/i.test(value);
      if (handle) parts.handle = handle;
      else if (!shaped) {
        console.warn(`[compose] parse: slide ${i + 1} put prose in the handle — dropped`);
        delete parts.handle;
      }
    }

    /**
     * THE EYEBROW IS FOR WHAT THE HEADLINE DOES NOT SAY. It is the one slot on
     * the slide that can add context, and a copywriter under pressure fills it
     * with the headline again — so the two largest lines on the poster say the
     * same thing and the slot is spent. Substring either way, because the echo
     * shows up as both a truncation ("Raise the average" over "Raise the
     * average ticket") and an expansion.
     */
    if (typeof parts.eyebrow === 'string' && typeof parts.headline === 'string') {
      const eb = parts.eyebrow.trim().toLowerCase().replace(/[.:—-]\s*$/, '');
      const hl = parts.headline.trim().toLowerCase();
      if (eb.length > 2 && (hl.startsWith(eb) || eb.startsWith(hl) || hl.includes(eb))) {
        console.warn(`[compose] parse: slide ${i + 1} echoed its headline in the eyebrow — dropped`);
        delete parts.eyebrow;
      }
    }

    /**
     * NO PART SAYS THE SAME THING TWICE. Two holes resolving to one string
     * renders as a repeat in two different type styles, which reads as a
     * rendering fault rather than a design. The bigger hole keeps the line:
     * a headline outranks the stat, the stat outranks the body.
     */
    const RANK = ['headline', 'stat', 'body', 'tagline', 'quote'] as const;
    const seenText = new Map<string, string>();
    for (const key of RANK) {
      const value = parts[key];
      if (typeof value !== 'string') continue;
      const norm = value.trim().toLowerCase().replace(/[.!?]\s*$/, '');
      if (!norm) continue;
      const owner = seenText.get(norm);
      if (owner) {
        console.warn(`[compose] parse: slide ${i + 1} put the same line in ${owner} and ${key} — dropped the ${key}`);
        delete parts[key];
      } else {
        seenText.set(norm, key);
      }
    }

    /**
     * A STAT SLIDE NEEDS A STAT. The role is chosen before the copy is read, so
     * a deck can end up with a `stat` poster whose stat hole never filled — it
     * then renders as an ordinary statement while the deck loses the beat of
     * variety the role was picked for, and per-role motion in a video export is
     * applied to a slide with nothing to animate.
     */
    if (role === 'stat' && typeof parts.stat !== 'string') {
      role = parts.body ? 'feature' : 'statement';
      console.warn(`[compose] parse: slide ${i + 1} is a stat with no stat — composing it as "${role}"`);
    }

    /**
     * ONE SUPPORTING ELEMENT. A giant number and a list of rows are two
     * different ways of making the same point, and a poster carrying both reads
     * as a slide that could not decide. The enumeration wins: it says more.
     */
    if (rows.length && parts.stat) {
      console.warn(`[compose] parse: slide ${i + 1} carried both a stat and rows — kept the rows`);
      delete parts.stat;
      if (role === 'stat') role = 'list';
    }

    if (rows.length && image) {
      console.warn(`[compose] parse: slide ${i + 1} asked for a photo AND ${rows.length} rows — keeping the rows`);
      image = false;
    }
    if (role === 'list' && !rows.length) {
      role = parts.stat ? 'stat' : parts.body ? 'feature' : 'statement';
      console.warn(`[compose] parse: slide ${i + 1} is a list with no rows — composing it as "${role}"`);
    }
    if (image && !capable.has(role)) {
      console.warn(
        `[compose] parse: slide ${i + 1} (${role}) wanted a photo, but this brand's ${role} composition has nowhere to put one — composing it as type`,
      );
      image = false;
    }
    if (image && remaining !== undefined) {
      if (remaining <= 0) {
        console.warn(`[compose] parse: slide ${i + 1} wanted a photo but the brand has none left to fill it — composing it as type`);
        image = false;
      } else {
        remaining -= 1;
      }
    }
    return { ...s, role, image, parts };
  });
}

/** Parse an idea into composed-slide inputs (role + verbatim parts). */
export async function parseForCompose(
  recipe: BrandRecipe,
  idea: string,
  opts?: ComposeOptions,
): Promise<ComposeSlideInput[]> {
  const format = opts?.format ?? '1080x1350';
  const plan = (opts?.plan ?? []).filter((p) => p.trim().length > 0);
  const locks = opts?.locks ?? [];
  const sources = opts?.sources ?? [];
  // HOW MANY SLIDES is derived, not dialled. A plan fixes it; otherwise the
  // volume of material decides, and an explicit `slideCount` (the eval) pins it.
  const range = opts?.slideCount
    ? { min: opts.slideCount, max: opts.slideCount, target: opts.slideCount, fixed: true }
    : slideCountFor({
        planLength: plan.length,
        ideaChars: idea.length,
        sourceChars: sources.reduce((n, s) => n + s.text.length, 0),
        story: format === '1080x1920',
      });
  // The copywriting tier — deliberately NOT the per-slide typesetting tier.
  const model = parseModel(opts);
  // A lesson that says "your headlines get cut by 14 characters" is a sentence
  // in the prompt AND a smaller number in the clamp. The sentence can be
  // ignored; the number cannot.
  const budgets = budgetAfterLessons(
    composeBudgetsFor(format) as unknown as Record<string, number>,
    opts?.lessons ?? [],
  ) as unknown as ComposeBudgets;
  const user = parseUser(recipe, idea, format, {
    range,
    plan,
    locks,
    sources,
    handle: opts?.handle,
    lessons: opts?.lessons,
  });
  opts?.onParsePrompt?.(user);
  // Source material makes the reply longer (more slides, richer copy) — a deck
  // truncated mid-JSON is a failed parse, so the ceiling follows the input.
  const maxTokens = sources.length || plan.length > 6 ? 2600 : 1600;
  const reply = await aiJson(
    { model, max_tokens: maxTokens, system: PARSE_SYSTEM, messages: [{ role: 'user', content: user }] },
    PARSE_TOOL,
  );
  let slides = stripMarkdownFromDeck(readDeck(parsePayload(reply), 'first pass'));

  // ONE corrective re-parse, carrying every complaint at once. Three things can
  // be wrong: a part that burst its budget flagrantly (>10% over — anything
  // milder is clamped below), copy the user LOCKED that came back reworded, and
  // two slides that make the same point in different words.
  // A clean parse pays for exactly one call.
  const flagrant = budgetViolationsOf(slides, budgets).filter((v) => v.length > v.budget * 1.1);
  const lost = missingLocks(JSON.stringify(slides), locks);
  const repeats = repeatedSlides(slides);
  // Nothing here can be repaired deterministically: the missing words are the
  // point, and appending a full stop to "Fragrance covers" only hides it.
  const unfinished = unfinishedProse(slides);
  if (flagrant.length || lost.length || repeats.length || unfinished.length) {
    if (flagrant.length) {
      console.warn(`[compose] parse: ${flagrant.length} part(s) burst their budgets — one corrective re-parse`);
    }
    if (lost.length) console.warn(`[compose] parse: ${lost.length} verbatim string(s) were not used — correcting`);
    for (const u of unfinished) {
      console.warn(`[compose] parse: slide ${u.slide + 1} ${u.label} stops mid-thought (${u.reason}) — correcting`);
    }
    for (const r of repeats) {
      console.warn(
        `[compose] parse: slides ${r.a + 1} and ${r.b + 1} make the same point (${Math.round(r.score * 100)}% of their words agree) — correcting`,
      );
    }
    const correction = [
      flagrant.length ? `Some parts exceed the hard copy budgets:` : '',
      ...flagrant.map((v) => `- slide ${v.slide + 1} ${v.label} is ${v.length} chars, budget ${v.budget}`),
      lost.length ? `These strings had to appear EXACTLY as written and do not:` : '',
      ...lost.map((l) => `- ${JSON.stringify(l)}`),
      unfinished.length ? `These lines stop mid-thought. Finish the sentence — do not simply add a full stop to what is there:` : '',
      ...unfinished.map((u) => `- slide ${u.slide + 1} ${u.label}: ${JSON.stringify(u.text)} (${u.reason})`),
      repeats.length ? `These pairs of slides make the same point twice — a reader learns nothing from the second:` : '',
      ...repeats.map(
        (r) =>
          `- slide ${r.a + 1} and slide ${r.b + 1}. Give one of them a different point from the material, or cut it and return one fewer slide.`,
      ),
      `Fix every flagged item, keep everything else identical. Return the corrected STRICT JSON only.`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const retry = await aiJson(
        {
          model,
          max_tokens: maxTokens,
          system: PARSE_SYSTEM,
          messages: [
            { role: 'user', content: user },
            { role: 'assistant', content: JSON.stringify({ slides }) },
            { role: 'user', content: correction },
          ],
        },
        PARSE_TOOL,
      );
      const corrected = stripMarkdownFromDeck(readDeck(parsePayload(retry), 'correction'));
      // Keep whichever attempt honours more of the user's own words — a retry
      // that fixed the budgets by dropping a locked line is not an improvement.
      // Repetition breaks a tie: same locks kept, fewer slides saying the same
      // thing wins.
      const before = locks.length - lost.length;
      const after = locks.length - missingLocks(JSON.stringify(corrected), locks).length;
      const better =
        after > before || (after === before && repeatedSlides(corrected).length <= repeats.length);
      slides = better ? corrected : slides;
    } catch {
      console.warn('[compose] parse: corrective re-parse failed — clamping the original instead');
    }
  }
  slides = clampSlidesToBudgets(slides, budgets, locks);

  /**
   * A hard count is a promise to the caller, so it is enforced rather than
   * merely asked for. Only trimming: the tail is where a copywriter puts the
   * slides it added of its own accord, and inventing a slide to reach a floor
   * would be padding — exactly what the range guidance tells it not to do.
   */
  if (range.fixed && slides.length > range.max) {
    console.warn(
      `[compose] parse: asked for ${range.max} slide(s), got ${slides.length} — dropping the last ${
        slides.length - range.max
      }`,
    );
    slides = slides.slice(0, range.max);
  }

  slides = normalizeParsedDeck(slides, recipe, opts?.photoBudget, opts?.handle);

  const stillLost = missingLocks(JSON.stringify(slides), locks);
  if (stillLost.length) {
    console.warn(`[compose] parse: ${stillLost.length} verbatim string(s) never made it into the deck`);
  }

  /**
   * DID THE CORRECTION TAKE?
   *
   * Asking once was not enough. A deck went out with "The car looks flawless.
   * The smell tells a different story" — flagged, corrected for, and shipped
   * anyway, because nothing looked again and nothing told the caller. The budget
   * path re-checks and clamps; the verbatim path warns. This had neither, so a
   * check that fired was indistinguishable from a check that passed.
   *
   * There is still nothing to repair deterministically — the missing words are
   * the point — so what survives is REPORTED, to the caller and not only to a
   * terminal nobody is reading.
   */
  const stillUnfinished = unfinishedProse(slides);
  for (const u of stillUnfinished) {
    console.warn(
      `[compose] parse: slide ${u.slide + 1} ${u.label} still stops mid-thought after the correction — ${JSON.stringify(u.text)}`,
    );
  }
  opts?.onCopyCheck?.({ unfinished: stillUnfinished });

  // Which slides get an image PLACEHOLDER is the parse step's judgement, per
  // slide — corrected by `normalizeParsedDeck` for what the brand's own
  // compositions and media library can actually deliver.
  return slides.map((s, index) => ({
    role: s.role as SlideRole,
    parts: s.parts as ComposeParts,
    format,
    photo: s.image,
    // Kept even on a slide whose slot was demoted: the photo panel can still
    // put a background or a free overlay there, and the search is just as good.
    ...(s.imageQuery ? { imageQuery: s.imageQuery } : {}),
    ...(opts?.variantBias?.[s.role] ? { variantBias: opts.variantBias[s.role] } : {}),
    index,
  }));
}

/**
 * Re-write ONE slide from a direction the user typed — the per-slide half of
 * the same brief language the whole deck speaks.
 *
 * The Studio's "Alternatives" could only ever REARRANGE a slide's existing copy;
 * there was no way to say "make this one about X" or "this line, exactly like
 * this" without re-composing the entire deck and losing the other six slides.
 * This is the parse step scoped to a single slide: same system prompt, same
 * tool, same budgets, same verbatim locks — one slide in, one slide out.
 */
export async function parseSlideDirection(
  recipe: BrandRecipe,
  direction: string,
  opts?: ComposeOptions & {
    role?: SlideRole;
    index?: number;
    /**
     * WHICH POST THIS SLIDE IS IN. Without it a direction is read in a vacuum:
     * "make this one about the roof and bonnet failing first", handed to a
     * copywriter that has never seen the deck, came back as a slide about a
     * building's roof membrane — every word defensible, the subject entirely
     * wrong. The post's title, its brief and what this slide says today are the
     * cheapest possible fix.
     */
    post?: { title?: string; idea?: string; says?: ComposeParts };
  },
): Promise<ComposeSlideInput> {
  const format = opts?.format ?? '1080x1350';
  const locks = opts?.locks ?? extractQuotedCopy(direction);
  const budgets = composeBudgetsFor(format);
  const says = Object.entries(opts?.post?.says ?? {})
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)
    .join('\n');
  const user = [
    parseUser(recipe, direction, format, {
      range: { min: 1, max: 1, target: 1, fixed: true },
      plan: [],
      locks,
      sources: opts?.sources ?? [],
      handle: opts?.handle,
    }),
    ``,
    `THIS IS ONE SLIDE OF AN EXISTING CAROUSEL, not a deck. Return exactly ONE slide.`,
    opts?.post?.title ? `  the post is titled: ${JSON.stringify(opts.post.title)}` : '',
    opts?.post?.idea ? `  the post was briefed as: ${JSON.stringify(clampNoEllipsis(opts.post.idea, 400))}` : '',
    says ? `  this slide currently says:\n${says}` : '',
    `Stay inside that post's subject: the BRIEF above directs this slide, it does not change what the carousel is about.`,
    opts?.role && opts.role !== 'cover' && opts.role !== 'cta'
      ? `It currently plays the "${opts.role}" role; keep that unless the direction plainly calls for another.`
      : '',
    `The "first slide is a cover, last is a cta" rule does not apply — this slide is neither unless the direction says so.`,
  ]
    .filter(Boolean)
    .join('\n');

  const reply = await aiJson(
    { model: parseModel(opts), max_tokens: 900, system: PARSE_SYSTEM, messages: [{ role: 'user', content: user }] },
    PARSE_TOOL,
  );
  const parsed = stripMarkdownFromDeck(readDeck(parsePayload(reply), 'one slide'));
  let slides = clampSlidesToBudgets(parsed.slice(0, 1), budgets, locks);
  slides = normalizeParsedDeck(slides, recipe, opts?.photoBudget, opts?.handle);
  const s = slides[0]!;
  return {
    role: s.role as SlideRole,
    parts: s.parts as ComposeParts,
    format,
    photo: s.image,
    ...(s.imageQuery ? { imageQuery: s.imageQuery } : {}),
    index: opts?.index ?? 0,
  };
}

/**
 * NEW WORDS FOR AN ARRANGEMENT THAT ALREADY WORKS.
 *
 * `parseSlideDirection` writes a whole slide and lets the composer arrange it.
 * This does the opposite: the arrangement is fixed and known — these part
 * names, this many rows — so the copywriter is asked for exactly that shape and
 * nothing else, and the result is spliced into the existing markup rather than
 * recomposed. It is the call behind the Studio's "New words".
 */
export async function parseSlideCopy(
  recipe: BrandRecipe,
  shape: { parts: string[]; rows: number },
  opts?: ComposeOptions & {
    role?: SlideRole;
    /** What the slide says today — the point to re-express, unless directed otherwise. */
    says?: ComposeParts;
    /** Optional instruction; without one this is simply "say it better". */
    direction?: string;
    post?: { title?: string; idea?: string };
  },
): Promise<ComposeParts> {
  const format = opts?.format ?? '1080x1350';
  const direction = (opts?.direction ?? '').trim();
  const locks = opts?.locks ?? extractQuotedCopy(direction);
  const budgets = composeBudgetsFor(format);
  const says = Object.entries(opts?.says ?? {})
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)
    .join('\n');

  const user = [
    parseUser(recipe, direction || 'Say the same thing better.', format, {
      range: { min: 1, max: 1, target: 1, fixed: true },
      plan: [],
      locks,
      sources: opts?.sources ?? [],
      handle: opts?.handle,
    }),
    ``,
    `THIS IS A REWRITE OF ONE SLIDE THAT IS ALREADY LAID OUT. Return exactly ONE slide.`,
    opts?.post?.title ? `  the post is titled: ${JSON.stringify(opts.post.title)}` : '',
    says ? `  it currently says:\n${says}` : '',
    ``,
    `THE LAYOUT IS FIXED AND YOU MUST FILL IT EXACTLY:`,
    `  - include these parts, all of them, and NOTHING else: ${shape.parts.join(', ') || 'headline'}`,
    shape.rows > 0
      ? `  - "rows" must have EXACTLY ${shape.rows} ${shape.rows === 1 ? 'entry' : 'entries'} — there is room for that many and no more.`
      : `  - do NOT use "rows": this layout has no list in it.`,
    `  - do not add a part the list above does not name; there is no element on this slide to put it in.`,
    direction
      ? `Follow the BRIEF above.`
      : `Keep the same point — this is a rewording, not a new slide. Find a sharper way to say it.`,
  ]
    .filter(Boolean)
    .join('\n');

  const reply = await aiJson(
    { model: parseModel(opts), max_tokens: 900, system: PARSE_SYSTEM, messages: [{ role: 'user', content: user }] },
    PARSE_TOOL,
  );
  const parsed = stripMarkdownFromDeck(readDeck(parsePayload(reply), 'slide copy'));
  const clamped = clampSlidesToBudgets(parsed.slice(0, 1), budgets, locks);
  const parts = { ...(clamped[0]!.parts as ComposeParts) };

  // Hold the reply to the shape, mechanically: a part the layout has no element
  // for would be silently lost, and a surplus row would leave an empty card.
  const allowed = new Set(shape.parts);
  for (const key of Object.keys(parts) as Array<keyof ComposeParts>) {
    if (key === 'emphasis' || key === 'rows') continue;
    if (!allowed.has(key)) delete parts[key];
  }
  if (shape.rows > 0) parts.rows = (parts.rows ?? []).slice(0, shape.rows);
  else delete parts.rows;
  return parts;
}

// ── Verbatim repair (retry, then deterministic splice) ──────────────────────

/**
 * part label → the brand class that carries it. The exact inverse of
 * `CLASS_TO_PART` in reparse.ts (which is itself derived from the reference
 * recipes' vocabulary). `emphasis` is deliberately absent: it is a sub-phrase
 * of the headline, not an element of its own — the emphasis wrap step below
 * owns it.
 */
const PART_TO_CLASS: Record<string, string> = {
  eyebrow: 'eyebrow',
  headline: 'headline',
  tagline: 'tagline',
  body: 'body',
  quote: 'quote',
  attribution: 'attr',
  stat: 'stat',
  cta: 'cta',
  handle: 'handle',
};

/**
 * The class order a splice positions against: the slide's own composition
 * pattern first (its "eyebrow → headline → rule → body" flow, when the recipe
 * authors one for this role), then the shared reveal ORDER for any class the
 * pattern doesn't mention — so every part always has a rank.
 */
function spliceOrderFor(recipe: BrandRecipe, input: ComposeSlideInput): string[] {
  const order: string[] = [];
  const pattern = recipePatternVariant(recipe, input.format, input.role, variantIndexOf(input));
  if (pattern) {
    const flow = pattern.slice(pattern.indexOf(':') + 1);
    for (const token of flow.split('→')) {
      const name = token.trim().toLowerCase().match(/^[a-z][\w-]*/)?.[0];
      if (name && !order.includes(name)) order.push(name);
    }
  }
  for (const sel of RECIPE_REVEAL_ORDER.flat()) {
    const cls = sel.replace(/^\./, '');
    if (!order.includes(cls)) order.push(cls);
  }
  return order;
}

/**
 * DETERMINISTIC SPLICE — the verbatim guard's last resort. Each still-missing
 * part is inserted as the recipe's matching component element at its
 * role-appropriate position: before the first top-level block that the
 * ordering above places AFTER it (headline lands after the eyebrow, body after
 * the headline/rule, cta before the handle), or at the end when nothing does.
 * Text is entity-escaped so the result is sanitizer-clean by construction; the
 * caller still re-runs sanitize + prune on the result.
 */
function spliceMissingParts(
  html: string,
  missing: Array<[string, string]>,
  recipe: BrandRecipe,
  input: ComposeSlideInput,
): string {
  const order = spliceOrderFor(recipe, input);
  const rankOf = (cls: string): number | undefined => {
    const i = order.indexOf(cls);
    return i === -1 ? undefined : i;
  };
  const sorted = [...missing]
    .filter(([part]) => PART_TO_CLASS[part] !== undefined)
    .sort(
      (a, b) =>
        (rankOf(PART_TO_CLASS[a[0]]!) ?? order.length) - (rankOf(PART_TO_CLASS[b[0]]!) ?? order.length),
    );
  let out = html;
  for (const [part, text] of sorted) {
    const cls = PART_TO_CLASS[part]!;
    const rank = rankOf(cls) ?? order.length;
    let at = out.length;
    for (const block of topLevelBlocks(out)) {
      const ranks = block.classes
        .map(rankOf)
        .filter((r): r is number => r !== undefined);
      if (ranks.length && Math.min(...ranks) > rank) {
        at = block.start;
        break;
      }
    }
    const el = `<div class="${cls}">${escapeHtml(text)}</div>`;
    out = at >= out.length ? (out ? `${out}\n${el}` : el) : `${out.slice(0, at)}${el}\n${out.slice(at)}`;
    console.warn(`[compose] ${input.role}: spliced missing ${part} in as .${cls}`);
  }
  return out;
}

// ── Mechanical emphasis ─────────────────────────────────────────────────────

/** Inline tags an emphasis wrap may use (the sanitizer's inline subset). */
const WRAP_TAGS = new Set(['span', 'em', 'i', 'b', 'strong', 'small', 'u']);

const HEADLINE_RE = /<([a-z][a-z0-9]*)\b([^>]*\bclass="[^"]*\bheadline\b[^"]*"[^>]*)>([\s\S]*?)<\/\1>/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Guarantee the emphasis phrase inside the headline is wrapped in the brand's
 * emphasis element. Belt and braces: the prompt still instructs the composer
 * to apply the signature move, and when it did, the fragment comes back
 * byte-identical. When it forgot, the phrase is found in the headline
 * (case-insensitive, whitespace-tolerant) and wrapped mechanically; when the
 * phrase isn't in the headline at all (or would cross a tag boundary), nothing
 * happens.
 */
function ensureEmphasisWrap(html: string, emphasis: string | undefined, wrap: RecipeEmphasisWrap): string {
  const phrase = (emphasis ?? '').trim();
  if (phrase.length < 2) return html;
  const m = html.match(HEADLINE_RE);
  if (!m || m.index === undefined) return html;
  const inner = m[3] ?? '';

  // Already wrapped? Accept the wrap class or the em/it vocabulary reparse.ts
  // reads back — if any such element's text carries the phrase, leave the
  // fragment byte-identical.
  const classAlt = [...new Set(['em', 'it', wrap.className])].map(escapeRegExp).join('|');
  const wrappedRe = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*\\bclass="[^"]*\\b(?:${classAlt})\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>`,
    'gi',
  );
  for (const s of inner.matchAll(wrappedRe)) {
    if (plain(s[2] ?? '').includes(plain(phrase))) return html;
  }

  // Find the phrase in the headline's markup, whitespace-tolerant.
  const phraseRe = new RegExp(phrase.split(/\s+/).map(escapeRegExp).join('\\s+'), 'i');
  const hit = inner.match(phraseRe);
  if (!hit || hit.index === undefined) return html;
  // Never wrap inside a tag (the match must sit in text, not an attribute).
  const before = inner.slice(0, hit.index);
  const lastOpen = before.lastIndexOf('<');
  if (lastOpen !== -1 && before.indexOf('>', lastOpen) === -1) return html;

  const tag = WRAP_TAGS.has(wrap.tag.toLowerCase()) ? wrap.tag.toLowerCase() : 'span';
  const wrapped =
    inner.slice(0, hit.index) +
    `<${tag} class="${wrap.className.replace(/"/g, '')}">${hit[0]}</${tag}>` +
    inner.slice(hit.index + hit[0].length);
  const headline = `<${m[1]}${m[2]}>${wrapped}</${m[1]}>`;
  return html.slice(0, m.index) + headline + html.slice(m.index + m[0].length);
}

// ── The compose step ────────────────────────────────────────────────────────

/**
 * The vertical-rhythm guard, applied and logged.
 *
 * Runs LAST on both compose paths — after the dedupe, after any splice, after
 * the lint — because every one of those can remove the element a spacer was
 * balancing and strand it at the end of the composition, which is precisely the
 * arrangement this fixes.
 */
function balanced(html: string, role: SlideRole): string {
  const out = balanceVertical(html);
  if (out.moved) {
    console.warn(`[compose] ${role}: content was stranded under the top edge — re-anchored to the baseline`);
  }
  return out.html;
}

/** Sanitised + pruned markup, with the prune guards' telemetry logged. */
function cleanFragment(raw: string, role: SlideRole): string {
  // A reply that carried the slide twice is cut to its first frame BEFORE the
  // wrapper is stripped — after it, the two bodies are indistinguishable from
  // one long one.
  const single = firstSlideBody(stripFences(raw));
  const pruned = pruneSlideMarkup(sanitizeAuthoredHtml(unwrapCbSlide(single)));
  /**
   * Reasoning is not copy. Returning '' is the existing signal for "this reply
   * is unusable": the caller retries, and failing that the deck ships the slide
   * empty rather than shipping the model's private thoughts in body type.
   * Better a missing slide someone notices than a shipped one nobody reads.
   */
  if (readsAsReasoning(plain(pruned.html))) {
    console.warn(
      `[compose] ${role}: reply reads as the model's own reasoning, not slide copy — discarding it`,
    );
    return '';
  }

  for (const d of pruned.dropped) {
    console.warn(
      d.spacer
        ? `[compose] ${role}: dropped a now-redundant ${d.label} spacer`
        : `[compose] ${role}: dropped duplicated ${d.label} (already said by ${d.keptLabel}): "${d.text.slice(0, 80)}"`,
    );
  }
  if (pruned.strippedInline) {
    console.warn(`[compose] ${role}: stripped ${pruned.strippedInline} empty inline element(s)`);
  }
  return pruned.html;
}

/**
 * Run one model reply through the mechanical guards and report which provided
 * copy parts did NOT survive verbatim in the final fragment. The pruning
 * guards run BEFORE the verbatim check so it reports on the FINAL markup —
 * and would catch it if a dedupe took the last copy of a part with it.
 */
function digestReply(raw: string, input: ComposeSlideInput): { html: string; missing: Array<[string, string]> } {
  const html = cleanFragment(raw, input.role);
  const hay = plain(html);
  const missing: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(input.parts)) {
    if (typeof v !== 'string' || v.length <= 2) continue;
    if (!hay.includes(plain(v))) missing.push([k, v]);
  }
  return { html, missing };
}

/**
 * How a slide's markup was produced: SUBSTITUTED into the recipe's own reference
 * fragment (free, deterministic) or GENERATED by the per-slide model call.
 */
export type ComposePath = 'fragment' | 'ai';

export interface ComposedSlide {
  html: string;
  bg?: string;
  role?: string;
  /** Which path produced `html`. Never stored — telemetry for callers + the eval. */
  source: ComposePath;
  /** Prompt versions in force when this slide was written and arranged. */
  pv?: Record<string, number>;
  /**
   * The USER message the composer was actually sent, when one was. Absent on
   * the substituted path, which makes no call at all — the difference matters
   * to anything replaying this later.
   */
  composeUser?: string;
}

/**
 * SUBSTITUTION — the free path.
 *
 * When the recipe carries a reference fragment for this slide's role, the copy is
 * spliced into the brand's own markup deterministically and NO model is called.
 * The same guard chain then runs over the result (sanitise → prune → verbatim →
 * emphasis wrap → slot); the deck-level render check runs later, unchanged.
 *
 * The one difference from the generated path is what a guard's complaint MEANS.
 * There, a missing part is a model that disobeyed, so it is retried and then
 * spliced. Here the fill is verbatim by construction, so a missing part can only
 * mean a downstream guard swallowed copy — and the honest response is to hand
 * the slide to the model rather than to repair markup nobody wrote. Returns
 * undefined for every such case, and the caller composes it the old way.
 */
function composeByFragment(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
): { html: string } | undefined {
  const filled = substituteFragment(recipe, input);
  if (!('html' in filled)) {
    // 'no-fragment' is the overwhelmingly common case (no stored recipe has
    // fragments yet) and says nothing worth a line in the log.
    if (filled.kind !== 'no-fragment') {
      console.warn(
        `[compose] ${input.role}: recipe fragment cannot carry this slide (${
          filled.kind === 'no-placeholder' ? `no {{${filled.part}}} placeholder` : filled.kind
        }) — composing with the model`,
      );
    }
    return undefined;
  }

  const cleaned = cleanFragment(filled.html, input.role);
  const gaps = fragmentVerbatimGaps(cleaned, input.parts);
  if (!cleaned || gaps.length) {
    console.warn(
      `[compose] ${input.role}: substituted fragment lost ${
        gaps.join(', ') || 'everything'
      } — composing with the model instead`,
    );
    return undefined;
  }

  // The signature's headline accent, guaranteed exactly as on the model path —
  // and always mechanical here, since a fragment carries no {{emphasis}} hole.
  let html = ensureEmphasisWrap(cleaned, input.parts.emphasis, recipeEmphasisWrap(recipe));
  // The twin slot guard. `substituteFragment` already refuses a photo slide whose
  // fragment has no hole, so this can only fire if a prune took the slot with it.
  if (input.photo && authoredSlots(html).length === 0) html += DEFAULT_SLOT;
  return { html: balanced(html, input.role) };
}

/** Compose one slide's authored HTML from its parts (arrange-only; sanitised). */
export async function composeSlide(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
  opts?: ComposeOptions,
): Promise<ComposedSlide> {
  // A repair NOTE means the deterministic composition already failed on the
  // canvas (the render check's ladder), so re-substituting would hand back the
  // very markup that overflowed. Those — and only those — always go to the model.
  if (!opts?.note) {
    const substituted = composeByFragment(recipe, input);
    if (substituted) {
      console.warn(`[compose] ${input.role}: composed from the recipe fragment — no model call`);
      return {
        html: substituted.html,
        role: input.role,
        source: 'fragment',
        pv: currentVersions('post') as Record<string, number>,
      };
    }
  }

  const model = composeModel(opts);
  const built = buildComposeMessages(recipe, input);
  const { system } = built;
  // An extra instruction (today: the overflow repair's) rides on the USER
  // message so the system prompt stays byte-identical and cache-friendly, and
  // so the verbatim retry below inherits it too.
  const user = opts?.note ? `${built.user}\n\n${opts.note}` : built.user;
  const resp = await aiMessage({
    model,
    max_tokens: 1400,
    system,
    messages: [{ role: 'user', content: user }],
  });
  let result = digestReply(textOf(resp), input);

  // Mechanical verbatim guard — REPAIR, not just warn. One targeted retry that
  // names each violated part; if copy is still missing after that, splice it in
  // deterministically. Only parts an element can carry are retried: a missing
  // `emphasis` is a sub-phrase of the headline (no retry can conjure it into a
  // headline that doesn't contain it), so it is warned about and left to the
  // wrap step. A clean compose never pays for a second call.
  if (result.missing.length) {
    console.warn(
      `[compose] ${input.role}: parts not verbatim in output: ${result.missing.map(([k]) => k).join(', ')}`,
    );
  }
  const retryable = result.missing.filter(([k]) => PART_TO_CLASS[k] !== undefined);
  if (retryable.length) {
    console.warn(`[compose] ${input.role}: retrying once with an explicit correction`);
    const violation =
      `VIOLATION: these copy parts must appear verbatim and were missing or altered:\n` +
      retryable.map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n');
    const retryResp = await aiMessage({
      model,
      max_tokens: 1400,
      system,
      messages: [{ role: 'user', content: `${user}\n\n${violation}` }],
    });
    const retried = digestReply(textOf(retryResp), input);
    // Keep whichever attempt lost less copy (the retry on a tie — it followed
    // the correction), then splice whatever is still missing.
    const better = retried.missing.length <= result.missing.length ? retried : result;
    const still = better.missing.filter(([k]) => PART_TO_CLASS[k] !== undefined);
    if (still.length) {
      console.warn(
        `[compose] ${input.role}: still not verbatim after retry (${still.map(([k]) => k).join(', ')}) — splicing deterministically`,
      );
      const spliced = spliceMissingParts(better.html, still, recipe, input);
      result = { html: cleanFragment(spliced, input.role), missing: [] };
    } else {
      result = better;
    }
  }
  let safe = result.html;

  // Mechanical emphasis: the signature's headline accent is guaranteed, not
  // hoped for. Runs after any splice so a repaired headline gets its wrap too;
  // a fragment the composer already wrapped comes back byte-identical.
  const emphasized = ensureEmphasisWrap(safe, input.parts.emphasis, recipeEmphasisWrap(recipe));
  if (emphasized !== safe) {
    console.warn(`[compose] ${input.role}: wrapped the emphasis phrase mechanically`);
    safe = emphasized;
  }

  /**
   * STRUCTURAL LINT — the third mechanical guard, alongside the verbatim guard
   * above and the placeholder guard below.
   *
   * Those two check that the COPY survived and that a photo slide has a hole.
   * Neither looked at the SHAPE of the markup, which is how an empty bullet
   * marker — styled by the recipe as though it held a character — shipped as a
   * phantom gap and made every list look broken.
   */
  const lint = lintAuthored(safe, {
    hasListVocabulary: recipe.components.some((c) => /row|item|list/i.test(c.className)),
    // The class this brand sets a paragraph in — where a sentence the composer
    // dropped into the handle actually belongs.
    proseClass: recipe.components.some((c) => c.className.trim() === 'body') ? 'body' : undefined,
  });
  if (lint.findings.length) {
    for (const f of lint.findings) console.warn(`[compose] ${input.role}: ${f.kind} — ${f.detail}`);
  }

  // Mechanical placeholder guard, the twin of the verbatim guard above: if this
  // slide was meant to hold a photograph, it must LEAVE A HOLE for one. A model
  // that forgets the slot would silently produce a slide the user can't put an
  // image on, so append one rather than trusting the prompt.
  const linted = lint.html;
  const withSlot = balanced(
    input.photo && authoredSlots(lint.html).length === 0 ? linted + DEFAULT_SLOT : linted,
    input.role,
  );
  // The role travels WITH the slide so the renderer can apply the recipe's
  // per-role motion (a stat pops, a quote fades) in animated exports.
  // `bg` is no longer set here: a full-bleed photo is the USER's choice now,
  // and the renderer derives it from whether they set a background photo.
  // Stamp WHAT MADE THIS SLIDE — the copywriter and the composer versions in
  // force right now — so a post can later be told what a newer prompt improves.
  return {
    html: withSlot,
    role: input.role,
    source: 'ai',
    pv: currentVersions('post') as Record<string, number>,
    composeUser: user,
  };
}

/** Full path: idea → authored slides (role + authored markup). */
export async function composeProject(
  recipeIn: BrandRecipe,
  idea: string,
  opts?: ComposeOptions,
): Promise<
  Array<{
    role: SlideRole;
    authored: { html: string; bg?: string; role?: string; archetype?: string };
    /** The parse step's stock-search phrase for this slide's picture, if any. */
    imageQuery?: string;
    /** Which path composed this slide — telemetry only; nothing stores it. */
    source: ComposePath;
  }>
> {
  // Resolve BOTH tiers once and thread them through: the parse writes the copy
  // (quality tier, once per deck), the per-slide composes typeset it (cheap
  // tier, once per slide). One lookup each, no per-slide Settings round-trip.
  const [composeM, parseM] = await Promise.all([modelFor('compose'), modelFor('parse')]);
  /**
   * FILL THE FRAGMENT GAPS FIRST. A hole the brand's author happened not to
   * write sends every slide that needs that part to the composer — a paid model
   * call for an arrangement the recipe already describes. Adding the hole is
   * free, deterministic, idempotent, and uses only classes the brand advertises,
   * so it is done here rather than left to a migration: every brand already in
   * the database composes cheaper on its very next deck.
   */
  const filled = fillRecipeFragmentGaps(recipeIn);
  for (const r of filled.repairs) {
    console.warn(`[compose] recipe: filled the "${r.role}" fragment's missing hole(s): ${r.added.join(', ')}`);
  }
  const recipe = filled.recipe;
  // A caller that did not pre-parse the brief still gets the brief LANGUAGE: an
  // inline "Slide 3: …" plan and any "quoted" copy are lifted out here, so a
  // script or a script-shaped call behaves exactly like the composer screen.
  const brief = opts?.plan || opts?.locks ? undefined : parseBrief(idea);
  const o: ComposeOptions = {
    ...opts,
    model: opts?.model ?? composeM,
    parseModel: opts?.parseModel ?? parseM,
    plan: opts?.plan ?? brief?.plan,
    locks: opts?.locks ?? brief?.locks,
    // "You keep re-arranging the feature slides" is only actionable if the
    // composer reaches past the arrangement they keep rejecting.
    variantBias: opts?.variantBias ?? variantBiasFromLessons(opts?.lessons ?? []),
  };
  let lastParseUser = '';
  opts?.onProgress?.({ phase: 'parsing' });
  const inputs = await parseForCompose(recipe, brief?.idea ?? idea, {
    ...o,
    onParsePrompt: (u) => {
      lastParseUser = u;
      o.onParsePrompt?.(u);
    },
  });
  /**
   * ARCHETYPES BEFORE COMPOSITION, NOT AFTER.
   *
   * `assignArchetypes` needs a role and whether the slide has a photo — both
   * decided by the parse, neither by the composer. It ran afterwards only
   * because that is where the render check needed it, which meant every slide
   * was written without knowing the composition it was being written FOR, and
   * that anything looking at a slide before this point was looking at a slide
   * that does not ship: the archetype layer owns where a slide's leftover space
   * lands, so the same markup reads 34% empty under one and 66% under none.
   *
   * Deciding it here is what makes an early check honest, and it is the half of
   * that idea which pays for itself immediately.
   */
  const archetypes = assignArchetypes(
    inputs.map((input) => ({ role: input.role, hasPhoto: input.photo === true })),
  );
  const invertAt = planInversion(archetypes, Boolean(recipe.surfaces?.inverse));
  /**
   * Written onto the INPUT, not passed at one call site. Every path that
   * composes this slide — the first pass, the overflow ladder's re-compose, the
   * rewrite rung, the Studio's variants — reads the same object, so a repaired
   * slide cannot come back violating the arrangement it will be laid out under.
   */
  inputs.forEach((input, i) => {
    input.archetype = archetypes[i];
  });

  // Slides are independent of one another, so compose them through a small
  // pool rather than serially — deck latency drops from Σ(slides) to roughly
  // ⌈n / pool⌉ × slide. Output order and the fail-the-batch error semantics of
  // the old serial loop are preserved (see mapPool).
  let composedCount = 0;
  opts?.onProgress?.({ phase: 'composing', done: 0, total: inputs.length });
  const authored = await mapPool(inputs, COMPOSE_CONCURRENCY, async (input) => {
    const slide = await composeSlide(recipe, input, o);
    composedCount += 1;
    opts?.onProgress?.({ phase: 'composing', done: composedCount, total: inputs.length });
    return slide;
  });
  const out: Array<{
    role: SlideRole;
    authored: { html: string; bg?: string; role?: string; archetype?: string; source?: ComposePath };
    imageQuery?: string;
    source: ComposePath;
  }> = [];
  const kept: ComposeSlideInput[] = [];
  for (let i = 0; i < inputs.length; i += 1) {
    const a = authored[i]!;
    if (a.html) {
      // `source` is BOTH: telemetry for the caller and a stored field, because
      // the finished markup cannot be asked which path made it.
      const { source, ...slide } = a;
      out.push({
        role: inputs[i]!.role,
        authored: { ...slide, source },
        ...(inputs[i]!.imageQuery ? { imageQuery: inputs[i]!.imageQuery } : {}),
        source,
      });
      kept.push(inputs[i]!);
    }
  }
  /**
   * ONE BRAND MARK PER DECK. The composer works a slide at a time and has no
   * memory of the last one, which is right for a headline and wrong for a logo
   * — it assembled the same brand's mark two different ways in one two-slide
   * post. The prompt asks for consistency; this guarantees it.
   */
  const marks = ensureBrandMark(out.map((s) => s.authored.html));
  if (marks.repaired) {
    out.forEach((s, i) => {
      s.authored.html = marks.htmls[i]!;
    });
    console.warn(`[compose] deck: brand mark normalised on ${marks.repaired} slide(s)`);
  }

  const substituted = out.filter((s) => s.source === 'fragment').length;
  if (substituted) {
    console.warn(
      `[compose] deck: ${substituted}/${out.length} slide(s) substituted from recipe fragments · ` +
        `${out.length - substituted} composed by the model`,
    );
  }

  /**
   * THE LOOP CLOSES HERE. Until now compose shipped whatever it produced and
   * the renderer's overflow measurement was read by nobody, so slides that
   * spill off the canvas reached the user with a badge instead of a fix. Now
   * the deck is rendered through the real /render route, and anything that
   * overflows climbs a deterministic-first repair ladder (see renderCheck.ts).
   *
   * Best-effort by construction: `renderCheckDeck` never throws, and with no
   * web server every slide reports "unknown" and the deck ships exactly as
   * composed. A compose must never fail because a check could not run.
   */
  /**
   * HAND THE PROMPTS BACK. Everything that made this deck — the copywriter's
   * user message, the per-slide composer messages, the parts it wrote and the
   * markup it produced — goes to the caller's sink so it can be recorded and,
   * later, diffed against whatever the user actually ships. Emitted BEFORE the
   * render check so the record is of what compose produced; the check's repairs
   * are a separate, deterministic step and are visible in the saved deck.
   */
  opts?.record?.({
    parseUser: lastParseUser,
    models: { parse: o.parseModel ?? '', compose: o.model ?? '' },
    promptVersions: currentVersions('post') as Record<string, number>,
    slides: out.map((slide, i) => ({
      role: slide.role,
      parts: kept[i]?.parts ?? {},
      html: slide.authored.html,
      path: slide.source,
      ...(authored[i]?.composeUser ? { composeUser: authored[i]!.composeUser } : {}),
    })),
  });

  /**
   * ARCHETYPES, before the render check rather than after it.
   *
   * Composition is decided here, so the archetype belongs here — and the render
   * check needs it: the layout ladder enforces a per-archetype headline cap, and
   * without one it can only see collisions and holes.
   *
   * Keyed off `input.photo` rather than off an attached picture. That is the
   * honest signal at this point: the parse stage already decided whether this
   * slide gets a photo slot, having been told how many pictures the brand
   * actually has. Waiting for the fill would mean waiting until after the check.
   */
  kept.forEach((_, i) => {
    const a = out[i]?.authored;
    if (a) a.archetype = archetypes[i];
  });

  /**
   * ONE INVERTED SLIDE, chosen here for the same reason the archetypes are:
   * a composer looking at one slide cannot judge a deck's rhythm. `bg:'inverse'`
   * has existed as a per-slide opt-in the composer almost never took.
   */
  if (invertAt !== undefined) {
    const a = out[invertAt]?.authored;
    // Never overrides a surface the composer chose deliberately.
    if (a && !a.bg) a.bg = 'inverse';
  }

  if (opts?.renderCheck ?? (Boolean(opts?.renderProbe) || renderCheckEnabledByDefault())) {
    opts?.onProgress?.({ phase: 'checking-layout', done: 0, total: out.length });
    const checked = await renderCheckDeck(recipe, kept, out.map((s) => s.authored), o.format ?? '1080x1350', {
      openProbe: opts?.renderProbe,
      // Step 3 re-composes through the SAME model and options this deck used —
      // with the render check itself off, so a repair can never recurse.
      recompose: async (input, note) =>
        (await composeSlide(recipe, input, { ...o, note, renderCheck: false })).html,
      /**
       * The rung after the ladder: show the model the render. Wired here rather
       * than imported inside renderCheck so a caller that does not want to
       * spend a vision call — the eval, the tests — simply does not pass it.
       */
      repairByLooking: (args) => repairByLooking(recipe, args),
      /**
       * THE LOOP, CLOSED AT THE WRITING END.
       *
       * A slide the gates call empty is a copy problem, not a layout one, and
       * the composer cannot fix it — it may only arrange what it was given.
       * This hands the verdict back to the copywriter, with the post's own
       * brief and what the slide says today, and asks for the missing line.
       *
       * `parseSlideDirection` is the same helper the Studio's per-slide
       * rewrite uses, so this inherits its rules: the material is the brief,
       * the budgets still apply, and nothing may be invented. The result is
       * typeset through the ordinary composer with the render check OFF, so a
       * repair can never recurse.
       */
      rewriteForFault: async (input, faults) => {
        const gap = faults.find((f) => f.startsWith('slack'));
        if (!gap) return null;
        const direction =
          `This slide rendered with ${gap.replace('slack ', '')} of the frame empty — it reads as unfinished. ` +
          'Give it the substance it is missing, taking it ONLY from the material this post was briefed with: ' +
          'a body line that earns its place, or an enumeration if the material is a set of things. ' +
          'Keep the headline and the point exactly as they are. Invent nothing.';
        const richer = await parseSlideDirection(recipe, direction, {
          ...o,
          role: input.role,
          index: input.index,
          post: { idea: brief?.idea ?? idea, says: input.parts },
        });
        return (await composeSlide(recipe, richer, { ...o, renderCheck: false })).html;
      },
    });
    checked.slides.forEach((s, i) => {
      out[i]!.authored = { ...out[i]!.authored, html: s.html };
    });
    /**
     * Hand the verdict to the caller, not just to the console.
     *
     * `unmeasured` is the one that matters: with no web server every slide
     * reports "unknown" and the deck ships exactly as composed, which is the
     * right behaviour — a compose must never fail because a check could not
     * run — but until now it was indistinguishable from a deck that passed
     * every gate. The only trace was a `console.warn` on the API's stdout.
     */
    opts?.onLayoutCheck?.({
      measured: checked.measured,
      unmeasured: checked.unmeasured,
      overflowed: checked.overflowed,
      repaired: checked.repaired,
      unresolved: checked.unresolved,
      notes: checked.notes,
      ms: checked.ms,
    });
    opts?.onProgress?.({ phase: 'checking-layout', done: out.length, total: out.length });
  }
  opts?.onProgress?.({ phase: 'done' });
  return out;
}
