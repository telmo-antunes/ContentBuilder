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
  slideCountFor,
  type BrandRecipe,
  type RecipeEmphasisWrap,
} from '@contentbuilder/shared';
import { aiJson, aiMessage, modelFor, textOf, type AiJsonResult, type AiJsonTool } from '../ai';
import { config } from '../../config';
import { sanitizeAuthoredHtml } from '../htmlSanitize';
import { lintAuthored } from './lintAuthored';
import { pruneSlideMarkup, topLevelBlocks } from './dedupeBlocks';
import {
  escapeHtml,
  fragmentVerbatimGaps,
  stripFences,
  substituteFragment,
  unwrapCbSlide,
} from './fragments';
import { renderCheckDeck, renderCheckEnabledByDefault, type OpenProbe } from './renderCheck';
import { balanceVertical } from './balance';
import { sourceBlock, type SourceDoc } from '../sourceIngest';
import { buildComposeMessages, type ComposeParts, type ComposeSlideInput, type SlideRole } from './prompt';

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
const BASE_BUDGETS: ComposeBudgets = { eyebrow: 26, headline: 60, body: 90, cta: 24, rowText: 42 };

/**
 * The budgets for a format. A story's safe area is tighter (Instagram overlays
 * UI top and bottom), so its budgets shrink ~20%; a square canvas is shorter
 * than the 4:5 base, so it tightens ~10%. The same numbers drive the per-format
 * line in the parse USER message and the mechanical enforcement below — one
 * source of truth.
 */
export function composeBudgetsFor(format: string): ComposeBudgets {
  const scale = format === '1080x1920' ? 0.8 : format === '1080x1080' ? 0.9 : 1;
  return {
    eyebrow: Math.round(BASE_BUDGETS.eyebrow * scale),
    headline: Math.round(BASE_BUDGETS.headline * scale),
    body: Math.round(BASE_BUDGETS.body * scale),
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
    check('body', s.parts.body, budgets.body);
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
]);

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
  return kept.length >= max * 0.35 ? kept : clampNoEllipsis(s, max);
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
    clamp('body', budgets.body);
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
- USE "list" WHEN THE CONTENT ENUMERATES. If a slide is "four things", "three ways", "what you get" — anything that is a set of parallel items — give it role "list" and put the items in "rows" (2–5 of them), NOT in "body". Never write a paragraph that is secretly a list: "Cash in the bank. Repeat visits secured. Slow weeks funded." is three rows, not one body. If your headline announces a number, the slide almost certainly wants rows.
- A "list" slide MUST carry rows. A list with no rows is an empty card — if you cannot fill it, the slide is not a list.
- rows entries are {"text": "the item", "note": "optional half-line of detail"}. Keep text under 42 characters — these are scanned, not read.
- parts keys (include only what a slide needs): eyebrow (2–4 word kicker), headline (the line — punchy), emphasis (the sub-phrase inside headline to accent), tagline (a short payoff line), body (1 short sentence), rows (a list — see above), quote, attribution, stat (e.g. "40%"), cta (button text), handle.
- ONE IDEA PER SLIDE, and one supporting element at most: a body sentence, OR rows, OR a stat. Never a paragraph and a list on the same poster, and never a big number beside the list that already makes its point.
- "handle" is the brand's @name or web address and nothing else. It is set in the smallest, faintest type on the poster, so a sentence put there ships as an afterthought nobody can read. If you have something to say, it is a body, a tagline or a row.
- Every slide must tell the reader something the slide before it did not. If two slides make the same point, cut one.
- This is a POSTER read on a phone at arm's length, not an article. Hard budgets: eyebrow <= 26 characters, headline <= 60, body <= 90, cta <= 24. Going over does not get truncated — it pushes the design off the canvas.
- The eyebrow is a LABEL, not a summary: 2–4 words naming what this slide is about. If you find yourself compressing the headline into it, drop it.
- HOW MANY SLIDES: you are told the range the material looks like it needs. Give the deck the number of slides the content actually earns inside that range — never pad a thin idea out to hit a quota, never cram two ideas onto one slide to come in under it.
- Write in the brand voice provided. No hashtags, no emoji.
- "image": set true when this slide would be genuinely STRONGER with a photograph — it shows a place, a product, a person, a result, a before/after. Set false when the slide is a pure typographic statement, a pulled quote, or a big number, where a photo would only decorate. Judge each slide on its own; a deck may have several, one, or none.
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
function formatGuidance(format: string): string {
  const b = composeBudgetsFor(format);
  const numbers = `eyebrow <= ${b.eyebrow}, headline <= ${b.headline}, body <= ${b.body}, cta <= ${b.cta}, rows text <= ${b.rowText}`;
  if (format === '1080x1920') {
    return `FORMAT: 1080×1920 story (9:16). Instagram overlays its UI over the top and bottom of a story, so the safe area is tighter than a post and the copy budgets shrink ~20%: ${numbers}.`;
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
function countGuidance(range: { min: number; max: number; target: number; fixed: boolean }, planned: number): string {
  if (range.fixed) {
    return `SLIDES: exactly ${planned} — one per SLIDE PLAN entry, in that order. Do not add a slide the plan did not ask for, and do not merge two.`;
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
  },
): string {
  const plan = opts.plan.length
    ? `SLIDE PLAN (one slide per entry, in this order):\n` +
      opts.plan.map((p, i) => `  ${i + 1}. ${p}`).join('\n')
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
  const budgets = composeBudgetsFor(format);
  const user = parseUser(recipe, idea, format, { range, plan, locks, sources, handle: opts?.handle });
  // Source material makes the reply longer (more slides, richer copy) — a deck
  // truncated mid-JSON is a failed parse, so the ceiling follows the input.
  const maxTokens = sources.length || plan.length > 6 ? 2600 : 1600;
  const reply = await aiJson(
    { model, max_tokens: maxTokens, system: PARSE_SYSTEM, messages: [{ role: 'user', content: user }] },
    PARSE_TOOL,
  );
  let slides = stripMarkdownFromDeck(readDeck(parsePayload(reply), 'first pass'));

  // ONE corrective re-parse, carrying every complaint at once. Two things can
  // be wrong: a part that burst its budget flagrantly (>10% over — anything
  // milder is clamped below), and copy the user LOCKED that came back reworded.
  // A clean parse pays for exactly one call.
  const flagrant = budgetViolationsOf(slides, budgets).filter((v) => v.length > v.budget * 1.1);
  const lost = missingLocks(JSON.stringify(slides), locks);
  if (flagrant.length || lost.length) {
    if (flagrant.length) {
      console.warn(`[compose] parse: ${flagrant.length} part(s) burst their budgets — one corrective re-parse`);
    }
    if (lost.length) console.warn(`[compose] parse: ${lost.length} verbatim string(s) were not used — correcting`);
    const correction = [
      flagrant.length ? `Some parts exceed the hard copy budgets:` : '',
      ...flagrant.map((v) => `- slide ${v.slide + 1} ${v.label} is ${v.length} chars, budget ${v.budget}`),
      lost.length ? `These strings had to appear EXACTLY as written and do not:` : '',
      ...lost.map((l) => `- ${JSON.stringify(l)}`),
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
      const before = locks.length - lost.length;
      const after = locks.length - missingLocks(JSON.stringify(corrected), locks).length;
      slides = after >= before ? corrected : slides;
    } catch {
      console.warn('[compose] parse: corrective re-parse failed — clamping the original instead');
    }
  }
  slides = clampSlidesToBudgets(slides, budgets, locks);
  slides = normalizeParsedDeck(slides, recipe, opts?.photoBudget, opts?.handle);

  const stillLost = missingLocks(JSON.stringify(slides), locks);
  if (stillLost.length) {
    console.warn(`[compose] parse: ${stillLost.length} verbatim string(s) never made it into the deck`);
  }

  // Which slides get an image PLACEHOLDER is the parse step's judgement, per
  // slide — corrected by `normalizeParsedDeck` for what the brand's own
  // compositions and media library can actually deliver.
  return slides.map((s, index) => ({
    role: s.role as SlideRole,
    parts: s.parts as ComposeParts,
    format,
    photo: s.image,
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
    index: opts?.index ?? 0,
  };
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
  const pattern = recipePatternVariant(recipe, input.format, input.role, input.index ?? 0);
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
  const pruned = pruneSlideMarkup(sanitizeAuthoredHtml(unwrapCbSlide(stripFences(raw))));
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
  return { html: withSlot, role: input.role, source: 'ai', pv: currentVersions('post') as Record<string, number> };
}

/** Full path: idea → authored slides (role + authored markup). */
export async function composeProject(
  recipe: BrandRecipe,
  idea: string,
  opts?: ComposeOptions,
): Promise<
  Array<{
    role: SlideRole;
    authored: { html: string; bg?: string; role?: string };
    /** Which path composed this slide — telemetry only; nothing stores it. */
    source: ComposePath;
  }>
> {
  // Resolve BOTH tiers once and thread them through: the parse writes the copy
  // (quality tier, once per deck), the per-slide composes typeset it (cheap
  // tier, once per slide). One lookup each, no per-slide Settings round-trip.
  const [composeM, parseM] = await Promise.all([modelFor('compose'), modelFor('parse')]);
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
  };
  const inputs = await parseForCompose(recipe, brief?.idea ?? idea, o);
  // Slides are independent of one another, so compose them through a small
  // pool rather than serially — deck latency drops from Σ(slides) to roughly
  // ⌈n / pool⌉ × slide. Output order and the fail-the-batch error semantics of
  // the old serial loop are preserved (see mapPool).
  const authored = await mapPool(inputs, COMPOSE_CONCURRENCY, (input) => composeSlide(recipe, input, o));
  const out: Array<{
    role: SlideRole;
    authored: { html: string; bg?: string; role?: string };
    source: ComposePath;
  }> = [];
  const kept: ComposeSlideInput[] = [];
  for (let i = 0; i < inputs.length; i += 1) {
    const a = authored[i]!;
    if (a.html) {
      // `source` is telemetry, not part of the slide: `authored` keeps exactly
      // the shape the Project schema stores.
      const { source, ...slide } = a;
      out.push({ role: inputs[i]!.role, authored: slide, source });
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
  if (opts?.renderCheck ?? (Boolean(opts?.renderProbe) || renderCheckEnabledByDefault())) {
    const checked = await renderCheckDeck(recipe, kept, out.map((s) => s.authored), o.format ?? '1080x1350', {
      openProbe: opts?.renderProbe,
      // Step 3 re-composes through the SAME model and options this deck used —
      // with the render check itself off, so a repair can never recurse.
      recompose: async (input, note) =>
        (await composeSlide(recipe, input, { ...o, note, renderCheck: false })).html,
    });
    checked.slides.forEach((s, i) => {
      out[i]!.authored = { ...out[i]!.authored, html: s.html };
    });
  }
  return out;
}
