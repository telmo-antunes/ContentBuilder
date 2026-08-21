/**
 * SOMEBODY LOOKS AT THE FINISHED DECK.
 *
 * Every gate in this pipeline judges ONE slide against a rule it can measure:
 * does it fit, do two blocks collide, is the headline four lines, does the
 * photo relate to the words. All of them can pass on a deck that is plainly
 * not good enough, and repeatedly have:
 *
 *   · a dashboard photo under a headline about the headliner — "related", so
 *     the image check passed it twice;
 *   · a slide that restated the cover instead of carrying its own beat;
 *   · seven frames that read as one slide repeated, because no per-slide call
 *     can see that it is composing the fourth near-identical statement;
 *   · a CTA whose spacing measured identically to the version a human liked.
 *
 * Each was caught the same way — by a person opening the contact sheet. That
 * is the step this module automates, and it is the cheapest quality in the
 * product: ONE vision call on ONE tiled image, after everything else has run.
 *
 * It repairs nothing. A critique that silently rewrote slides would be the
 * blind composer again, one level up; this returns a verdict the review page
 * shows and a human acts on, which is also what makes it safe to run on every
 * deck. The one exception is that its findings are ranked, so the caller can
 * spend a repair on the worst slide if the budget has room for it.
 */
import type { BrandRecipe, Format } from '@contentbuilder/shared';
import { aiJson, modelFor, type AiJsonTool } from '../ai';
import { affordsUsd } from '../spend';
import { buildContactSheet } from '../contactSheet';

export interface DeckFinding {
  /** 1-based slide number, or 0 for a finding about the deck as a whole. */
  slide: number;
  /** What is wrong, in the words a designer would use looking at it. */
  fault: string;
  /** What to do about it — a direction, not markup. */
  fix: string;
  severity: 'blocking' | 'notable' | 'minor';
}

export interface DeckCritique {
  findings: DeckFinding[];
  /** The one-line read on the deck as a sequence. */
  verdict: string;
}

const SYSTEM = `You are an art director reviewing a finished Instagram carousel for a business that is promoting its own guide. You are shown the whole deck as one contact sheet, at the size a reader sees it, in order.

WHAT YOU ARE FOR. Every mechanical check has already passed: nothing overflows, nothing collides, every picture is topically related to its words. You are here for what those checks cannot see — whether this is actually good, and whether it does its job.

JUDGE, IN THIS ORDER:
1. THE SEQUENCE. Does slide 1 earn a swipe? Does each slide carry its own beat, or does one restate another? Does the last slide close?
2. SAMENESS. Do these read as one slide repeated with different words? A deck of near-identical frames is the single most common failure here, and it is invisible on any one slide.
3. THE PAIRINGS. Is each photograph the RIGHT picture for its line — not merely a related one? A cabin photo under a headline about the headliner is wrong even though both are car interiors.
4. THE CRAFT. Cramped or floating elements, a lockup whose parts have drifted apart, type that has run long, a call to action that does not feel deliberate.
5. THE JOB. Would a reader know a business wrote this, and what it wants them to do?

RULES
- Report only what you can SEE in the picture. Do not invent copy, and do not guess at what a slide "probably" says.
- Be specific and name the slide: "slide 4's body sits so close to the photo they read as one block" beats "spacing issues".
- A deck with nothing seriously wrong gets an EMPTY findings list. Manufacturing a finding to look thorough is worse than saying it is fine — the whole value here is that a flag means something.
- Rank by what actually costs the post: "blocking" is something that would embarrass the brand or lose the reader, "notable" is a real fault worth fixing, "minor" is taste.
- Never suggest changing the WORDS' meaning — the copy was written, budgeted and approved upstream. Comment on arrangement, pairing, emphasis and sequence.

Deliver the review by CALLING THE "review_deck" TOOL.`;

const TOOL: AiJsonTool = {
  name: 'review_deck',
  description: 'The art-director review of this carousel.',
  schema: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        description:
          'One line on the deck AS A SEQUENCE — does it hold together and do its job. Plain words, no hedging.',
      },
      findings: {
        type: 'array',
        description: 'What is actually wrong, worst first. Empty when the deck is genuinely fine.',
        items: {
          type: 'object',
          properties: {
            slide: {
              type: 'number',
              description: 'The slide number as printed on the contact sheet; 0 for the deck as a whole.',
            },
            fault: { type: 'string', description: 'What you see that is wrong.' },
            fix: { type: 'string', description: 'The change you would make — a direction, not markup.' },
            severity: { type: 'string', enum: ['blocking', 'notable', 'minor'] },
          },
          required: ['slide', 'fault', 'fix', 'severity'],
        },
      },
    },
    required: ['verdict', 'findings'],
  },
};

/** What one vision pass over a tiled deck costs, near enough to gate on. */
export const CRITIQUE_ESTIMATE_USD = 0.04;

const SEVERITIES = new Set(['blocking', 'notable', 'minor']);

/**
 * Review a rendered deck. `shots` are the slides' PNGs in deck order — the same
 * captures the layout gates already take, so this adds a call, not a render.
 *
 * Returns null when it could not run (no shots, no budget, an unusable reply):
 * a critique is an improvement to the hand-off, never a gate on shipping.
 */
export async function critiqueDeck(
  recipe: BrandRecipe,
  shots: ReadonlyArray<Buffer | null>,
  format: Format,
  opts?: { model?: string },
): Promise<DeckCritique | null> {
  const usable = shots.filter((s): s is Buffer => Boolean(s));
  // One slide is not a sequence, and sequence is most of what this judges.
  if (usable.length < 2) return null;
  if (!affordsUsd(CRITIQUE_ESTIMATE_USD, 'deck-critique')) return null;

  let sheet: Buffer;
  try {
    sheet = await buildContactSheet(
      usable.map((buffer) => ({ buffer })),
      format,
    );
  } catch (err) {
    console.warn(`[critique] could not build the contact sheet: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  const model = opts?.model ?? (await modelFor('recipe'));
  try {
    const { json } = await aiJson(
      {
        model,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: sheet.toString('base64') },
              },
              {
                type: 'text',
                text: [
                  `This brand's voice: ${recipe.voice?.description ?? 'unstated'}.`,
                  `Its signature move: ${recipe.signature.name} — ${recipe.signature.description}`,
                  ``,
                  `${usable.length} slides, in order, numbered on the sheet. Review them.`,
                ].join('\n'),
              },
            ],
          },
        ],
      },
      TOOL,
      { feature: 'deck-critique' },
    );
    if (!json) return null;

    const rawFindings = Array.isArray((json as { findings?: unknown }).findings)
      ? ((json as { findings: unknown[] }).findings as Array<Record<string, unknown>>)
      : [];
    const findings: DeckFinding[] = rawFindings
      .filter((f) => typeof f?.fault === 'string' && String(f.fault).trim() !== '')
      .map((f) => ({
        slide: Number.isFinite(Number(f.slide)) ? Math.max(0, Math.round(Number(f.slide))) : 0,
        fault: String(f.fault).slice(0, 300),
        fix: typeof f.fix === 'string' ? f.fix.slice(0, 300) : '',
        severity: (SEVERITIES.has(String(f.severity)) ? String(f.severity) : 'notable') as DeckFinding['severity'],
      }));

    // Worst first: the caller may only be able to afford to act on one.
    const rank = { blocking: 0, notable: 1, minor: 2 } as const;
    findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

    const verdict = typeof (json as { verdict?: unknown }).verdict === 'string'
      ? String((json as { verdict: string }).verdict).slice(0, 400)
      : '';
    return { findings, verdict };
  } catch (err) {
    console.warn(`[critique] review failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
