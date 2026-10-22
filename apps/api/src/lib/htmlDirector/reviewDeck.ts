/**
 * THE REVIEW — the owner's rubric, scored by a model that can see the deck.
 *
 * `deckCritique.ts` already looks at a finished deck and names what is wrong.
 * This is its sibling for the designer path, with two differences that make
 * it a decision rather than a report:
 *
 *   · it SCORES the eight dimensions of docs/audit/rubric.md, the same scale
 *     the owner scores decks on, so a round can be compared with another;
 *   · its answer decides whether a revision is earned and which deck ships.
 *
 * It repairs nothing. The designer revises; this only judges — which is also
 * why the same call can judge the revision on equal terms.
 */
import type { BrandRecipe, Format, ScoreDimension } from '@contentbuilder/shared';
import { SCORE_DIMENSIONS } from '@contentbuilder/shared';
import { aiJson, cachedSystem, modelFor, type AiJsonTool } from '../ai';
import { affordsUsd } from '../spend';
import type { ReferenceSheet } from '../inspo';
import type { DeckFinding } from './deckCritique';

export const REVIEW_ESTIMATE_USD = 0.08;
export const REVIEW_PROMPT_VERSION = 2;

export interface DeckReview {
  scores: Record<ScoreDimension, number>;
  /** Sum of the eight scores, 8–40. */
  total: number;
  findings: DeckFinding[];
  verdict: string;
  model: string;
}

export type ReviewSkip = 'no-budget' | 'model-failed' | 'unusable-reply';

export type ReviewOutcome = { status: 'ok'; review: DeckReview } | { status: 'skipped'; reason: ReviewSkip; detail?: string };

const RUBRIC = `THE RUBRIC — score each 1–5, whole numbers. A score is the number AND one named slide of evidence when it is 1, 2 or 5.
1. FIDELITY — does the deck teach what the brief teaches? 1: generic abstractions, claims the brief never makes, bare items with no reasoning. 3: the point survives; some slides paraphrase loosely. 5: a reader could reconstruct the argument; every fact is the brief's own.
2. HOOK — does slide 1 alone earn a swipe? 1: a title; restates the topic. 3: a real line you have read before. 5: a specific tension, number or contradiction in the reader's world, under ten words.
3. SPECIFICITY — concrete nouns, numbers, situations. 1: "quality matters". 3: mostly concrete. 5: nothing could be pasted into another brand's post.
4. VARIETY — do consecutive slides differ in composition? 1: seven re-skins of one skeleton. 3: two or three arrangements alternate. 5: each slide is composed for what it says and the deck still reads as one system.
5. HIERARCHY — does the eye know where to go first? 1: equal-weight blocks; the same stack on every slide. 3: one element dominates most frames. 5: one subject per slide at display size, supporting elements grouped tight, nothing floating in leftover space.
6. BRAND — unmistakably this brand? 1: could be any account in these colours. 3: type and colour right; the signature appears sometimes. 5: signature, type personality, imagery treatment and voice all present.
7. LEGIBILITY — at phone size, arm's length. 1: you would have to stop and read; body small against the headline; a screenshot you cannot make out. 3: the headline reads instantly; the body with effort on a slide or two. 5: every line reads in a second, pictures legible, story bands respected.
8. CTA — does the close say what to do, once, deliberately? 1: no button, or two asks, or a button buried under four other elements. 3: the right button; the close still reads as a form. 5: one sentence, one button, the brand's own, nothing else.`;

const SYSTEM = `You are the art director reviewing a finished Instagram carousel for a business, shown as one contact sheet at the size a reader sees it, in order, numbered. You also have the brief it was written from, so you can judge fidelity and specificity, and what the render probe measured.

THE BAR: a phone in one hand, one second per slide. Judge the pictures, not the code. Report only what you can see; do not guess at what a slide "probably" says.

${RUBRIC}

THE BRAND'S OWN MARK — its logo row, wordmark or handle line on a slide — is the house signature, not an ask; only a button, a keyword or an instruction to the reader counts as one.

FINDINGS: what is actually wrong, worst first, each naming the slide and the fix as a direction a designer can act on — not markup. "blocking" would embarrass the brand or lose the reader (a title cover, two asks, a clipped slide, an unreadable screenshot, a picture that contradicts its line); "notable" is a real fault worth a revision; "minor" is taste. A deck with nothing seriously wrong gets an empty list — a flag must mean something. Never ask for the words' meaning to change; the copy was approved upstream.

REFERENCES, when one or two strips from other accounts precede the deck: they are the bar for the FORMS (a number at poster size, a numbered set with room, one line on a field, an exhibit that carries information) — never for colours, type or words. Say in one clause what they do that this deck does not.

Deliver the review by CALLING THE "score_deck" TOOL.`;

const TOOL: AiJsonTool = {
  name: 'score_deck',
  description: 'The rubric scores, the findings and the verdict.',
  schema: {
    type: 'object',
    properties: {
      scores: {
        type: 'object',
        properties: Object.fromEntries(SCORE_DIMENSIONS.map(([k]) => [k, { type: 'integer', minimum: 1, maximum: 5 }])),
        required: SCORE_DIMENSIONS.map(([k]) => k),
      },
      verdict: { type: 'string', description: 'One line on the deck as a sequence, plain words.' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slide: { type: 'integer', description: '1-based slide, or 0 for the deck as a whole.' },
            fault: { type: 'string' },
            fix: { type: 'string' },
            severity: { type: 'string', enum: ['blocking', 'notable', 'minor'] },
          },
          required: ['slide', 'fault', 'fix', 'severity'],
        },
      },
    },
    required: ['scores', 'verdict', 'findings'],
  },
};

const SYSTEM_CACHED = cachedSystem(SYSTEM);
const SEVERITIES = new Set(['blocking', 'notable', 'minor']);

export interface ReviewInput {
  /** The contact sheet, PNG. */
  sheet: Buffer;
  format: Format | string;
  /** The brief the copy was written from (truncated here). */
  brief?: string;
  /** The deck's copy, per slide, so fidelity is judged against words and not pixels alone. */
  copy?: readonly string[];
  measured?: readonly string[];
  references?: readonly ReferenceSheet[];
  slideCount: number;
  model?: string;
}

export async function reviewDeck(recipe: BrandRecipe, input: ReviewInput): Promise<ReviewOutcome> {
  if (!affordsUsd(REVIEW_ESTIMATE_USD, 'design-review')) return { status: 'skipped', reason: 'no-budget' };
  const model = input.model ?? (await modelFor('review'));
  const references = input.references ?? [];
  const content: Array<Record<string, unknown>> = [];
  for (const [i, r] of references.entries()) {
    content.push({ type: 'text', text: `REFERENCE ${i + 1} of ${references.length} — the bar, from ${r.label}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: r.buffer.toString('base64') } });
  }
  if (references.length) content.push({ type: 'text', text: 'THE DECK UNDER REVIEW follows.' });
  content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: input.sheet.toString('base64') } });
  content.push({
    type: 'text',
    text: [
      `This brand's voice: ${recipe.voice?.description ?? 'unstated'}.`,
      `Its signature move: ${recipe.signature.name} — ${recipe.signature.description}`,
      input.brief ? `\nTHE BRIEF it was written from:\n${input.brief.slice(0, 2500)}` : '',
      input.copy?.length ? `\nTHE COPY, per slide:\n${input.copy.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}` : '',
      input.measured?.length ? `\nWHAT THE PROBE MEASURED:\n${input.measured.map((m) => `  - ${m}`).join('\n')}` : '\nThe probe measured nothing wrong.',
      ``,
      `${input.slideCount} slides, in order, numbered on the sheet. Score and review them.`,
    ]
      .filter((x) => x !== '')
      .join('\n'),
  });
  let json: unknown;
  try {
    ({ json } = await aiJson(
      { model, max_tokens: 2500, system: SYSTEM_CACHED, messages: [{ role: 'user', content: content as never }] },
      TOOL,
      { feature: 'design-review' },
    ));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[design-review] failed: ${detail}`);
    return { status: 'skipped', reason: 'model-failed', detail: detail.slice(0, 200) };
  }
  const parsed = parseReview(json, model);
  return parsed ? { status: 'ok', review: parsed } : { status: 'skipped', reason: 'unusable-reply' };
}

/** A reply into a review, or null when it carries no usable scores. Pure, tested. */
export function parseReview(json: unknown, model: string): DeckReview | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as { scores?: Record<string, unknown>; verdict?: unknown; findings?: unknown };
  const scores = {} as Record<ScoreDimension, number>;
  for (const [k] of SCORE_DIMENSIONS) {
    const v = Number(o.scores?.[k]);
    if (!Number.isFinite(v)) return null;
    scores[k] = Math.min(5, Math.max(1, Math.round(v)));
  }
  const findings: DeckFinding[] = (Array.isArray(o.findings) ? o.findings : [])
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof (f as Record<string, unknown>).fault === 'string')
    .map((f) => ({
      slide: Number.isFinite(Number(f.slide)) ? Math.max(0, Math.round(Number(f.slide))) : 0,
      fault: String(f.fault).slice(0, 300),
      fix: typeof f.fix === 'string' ? f.fix.slice(0, 300) : '',
      severity: (SEVERITIES.has(String(f.severity)) ? String(f.severity) : 'notable') as DeckFinding['severity'],
    }));
  const rank = { blocking: 0, notable: 1, minor: 2 } as const;
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const total = Object.values(scores).reduce((n, v) => n + v, 0);
  return { scores, total, findings, verdict: typeof o.verdict === 'string' ? o.verdict.slice(0, 400) : '', model };
}

/**
 * Is a revision earned? A BLOCKING finding, or a slide the probe says
 * overflows or collides — faults a second look can fix and a reader would
 * notice. A low score alone does not earn one: on the first six live runs
 * the revision beat round one only twice when the trigger was a 2 on variety
 * or an empty frame, and cost $0.20 each time it lost — the designer
 * re-composes the whole deck for a verdict about one dimension, and the
 * reviewer's own run-to-run variance is about that size. The budget goes to
 * decks with something named to fix.
 */
export function shouldRevise(review: DeckReview, measured: readonly string[]): boolean {
  if (review.findings.some((f) => f.severity === 'blocking')) return true;
  if (measured.some((m) => /overflows|collide/.test(m))) return true;
  return false;
}

/**
 * Which of two reviewed rounds ships. The rubric total decides; on a tie the
 * one with fewer blocking findings; on a tie the first, which was cheaper.
 * A round without a review never beats one with (it was not judged).
 */
export function betterRound(a: DeckReview | null, b: DeckReview | null): 'a' | 'b' {
  if (!b) return 'a';
  if (!a) return 'b';
  if (b.total !== a.total) return b.total > a.total ? 'b' : 'a';
  const blocking = (r: DeckReview) => r.findings.filter((f) => f.severity === 'blocking').length;
  return blocking(b) < blocking(a) ? 'b' : 'a';
}
