/**
 * ART DIRECTION — the deck gets a plan before any slide is written.
 *
 * The app already makes three deck-level decisions no per-slide call could:
 * which composition each slide gets (`assignArchetypes`), which one inverts
 * (`planInversion`), and which of a role's arrangements it uses (the variant
 * rotation). All three are deterministic, and two of them are deliberately
 * blind — the rotation picks by POSITION, so the fifth slide gets arrangement
 * two because it is fifth, not because of anything it says.
 *
 * That is right as a default and wrong as a ceiling. A deck whose slide 5 is a
 * right-way/wrong-way verdict wants the numbered or split treatment; a slide
 * that is one monumental line wants the arrangement built for one monumental
 * line. Only something that has read the whole deck can match arrangement to
 * content — and by the time the composer runs, it sees one slide at a time.
 *
 * So this runs ONCE, after the copy exists and before anything is composed,
 * and returns a plan the existing machinery consumes. Everything it returns is
 * an OVERRIDE of a decision the code would otherwise make correctly on its
 * own: an absent plan, a refusal, an unaffordable call or a nonsense answer all
 * land back on the deterministic default rather than on an error.
 */
import type { BrandRecipe } from '@contentbuilder/shared';
import { recipePatternsForRole } from '@contentbuilder/shared';
import { aiJson, modelFor, type AiJsonTool } from '../ai';
import { affordsUsd } from '../spend';

export interface SlidePlan {
  /** Which of the role's arrangements this slide should use (0-based). */
  variant?: number;
  /** Give this slide the brand's inverse surface — at most one per deck. */
  invert?: boolean;
}

export interface DeckPlan {
  slides: SlidePlan[];
  /** One line on the shape of the deck, for the compose notes. */
  note: string;
}

/** What one art-direction call costs, near enough to gate on. */
export const ART_DIRECTION_ESTIMATE_USD = 0.04;

const SYSTEM = `You are the art director for a brand's Instagram carousel. The copy is written and approved. Your job is to decide, for the deck as a whole, HOW each slide should be arranged — before anyone composes them.

You are choosing between arrangements this brand has already authored. You are not inventing layouts and you are not touching the words.

WHAT YOU ARE FOR. The app assigns arrangements by POSITION, which is a fair default and a poor ceiling: it gives slide 5 the second arrangement because it is fifth, not because of anything it says. You have read the whole deck, so you can match the arrangement to the CONTENT — and see the deck as a sequence, which no per-slide step ever does.

DECIDE:
1. VARIANT — for each slide, which of its role's arrangements suits what it actually says. A slide that enumerates a right way against a wrong way wants a treatment that shows the verdict; a single monumental line wants the arrangement built to carry one; a slide with a picture wants the one that gives the picture room. When the default is already right, say nothing for that slide — an override you cannot justify is worse than the default.
2. INVERT — at most ONE slide may sit on the brand's inverse surface, as a beat in the middle of the deck. Never the cover (it earns the swipe) and never the last slide (the close lands harder on the brand's own ground). Pick the slide whose content is the deck's turning point, or none at all.

RULES
- Vary deliberately, not decoratively. Two consecutive slides on the same arrangement is fine when the content matches; five in a row is the "every post looks the same" failure this exists to fix.
- A variant index you were not offered is ignored, so only use the ones listed.
- Say nothing about slides you would leave alone.

Deliver the plan by CALLING THE "plan_deck" TOOL.`;

const TOOL: AiJsonTool = {
  name: 'plan_deck',
  description: "The deck's arrangement plan.",
  schema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: 'One line on the shape you gave the deck and why. Plain words.',
      },
      slides: {
        type: 'array',
        description: 'Only the slides you are overriding. Omit the rest entirely.',
        items: {
          type: 'object',
          properties: {
            slide: { type: 'number', description: '1-based slide number.' },
            variant: {
              type: 'number',
              description: 'Which of this role\'s arrangements to use (0-based, from the list given).',
            },
            invert: {
              type: 'boolean',
              description: 'Put this slide on the inverse surface. At most one slide in the deck.',
            },
            why: { type: 'string', description: 'One short clause: what about this slide earns it.' },
          },
          required: ['slide'],
        },
      },
    },
    required: ['note', 'slides'],
  },
};

/** A compact, readable description of one slide's copy — what the director reads. */
function describeSlide(
  index: number,
  slide: { role: string; parts: Record<string, unknown> },
  arrangements: number,
): string {
  const p = slide.parts;
  const bits: string[] = [];
  const take = (k: string) => (typeof p[k] === 'string' && p[k] ? String(p[k]) : '');
  for (const k of ['eyebrow', 'headline', 'body', 'stat', 'quote', 'cta']) {
    const v = take(k);
    if (v) bits.push(`${k}: ${v.slice(0, 120)}`);
  }
  const rows = Array.isArray(p.rows) ? (p.rows as Array<Record<string, unknown>>) : [];
  if (rows.length) {
    bits.push(
      `rows (${rows.length}): ` +
        rows
          .map((r) => `${String(r.text ?? '').slice(0, 40)}${r.state ? ` [${String(r.state)}]` : ''}`)
          .join(' | '),
    );
  }
  return [
    `Slide ${index + 1} — role ${slide.role}, ${arrangements} arrangement${arrangements === 1 ? '' : 's'} available (0–${Math.max(0, arrangements - 1)})`,
    ...bits.map((b) => `    ${b}`),
  ].join('\n');
}

/**
 * Plan a deck. Returns null when it could not or should not run — no budget, a
 * refusal, an unusable answer, or a brand with nothing to choose between.
 * Never throws: the deterministic plan is always a correct answer.
 */
export async function planDeck(
  recipe: BrandRecipe,
  slides: ReadonlyArray<{ role: string; parts: Record<string, unknown> }>,
  format: string,
  opts?: { model?: string },
): Promise<DeckPlan | null> {
  if (slides.length < 3) return null;

  const arrangements = slides.map((s) => recipePatternsForRole(recipe, format, s.role).length);
  // Nothing to direct: every role has one arrangement, so a plan could only
  // agree with the default. Spending a call to be told that is waste.
  if (arrangements.every((n) => n <= 1)) return null;
  if (!affordsUsd(ART_DIRECTION_ESTIMATE_USD, 'art-direction')) return null;

  try {
    const model = opts?.model ?? (await modelFor('recipe'));
    const { json } = await aiJson(
      {
        model,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              `This brand's voice: ${recipe.voice?.description ?? 'unstated'}.`,
              `Its inverse surface: ${recipe.surfaces?.inverse ? 'available' : 'NOT available — never set invert'}.`,
              '',
              'THE DECK, in order:',
              ...slides.map((s, i) => describeSlide(i, s, arrangements[i] ?? 1)),
            ].join('\n'),
          },
        ],
      },
      TOOL,
      { feature: 'art-direction' },
    );
    if (!json) return null;

    const plan: SlidePlan[] = slides.map(() => ({}));
    const rows = Array.isArray((json as { slides?: unknown }).slides)
      ? ((json as { slides: unknown[] }).slides as Array<Record<string, unknown>>)
      : [];
    let inverted = false;
    for (const row of rows) {
      const n = Number(row.slide);
      if (!Number.isFinite(n)) continue;
      const i = Math.round(n) - 1;
      if (i < 0 || i >= slides.length) continue;
      const available = arrangements[i] ?? 1;
      const variant = Number(row.variant);
      // An index the brand does not have would silently wrap to a different
      // arrangement, so it is ignored rather than modulo'd into a lie.
      if (Number.isFinite(variant) && variant >= 0 && variant < available) {
        plan[i]!.variant = Math.round(variant);
      }
      /**
       * ONE inversion, and never at the ends — the same rule `planInversion`
       * enforces deterministically, applied here because a model asked for a
       * beat will happily give three.
       */
      if (row.invert === true && !inverted && recipe.surfaces?.inverse && i > 0 && i < slides.length - 1) {
        plan[i]!.invert = true;
        inverted = true;
      }
    }
    const note = typeof (json as { note?: unknown }).note === 'string'
      ? String((json as { note: string }).note).slice(0, 300)
      : '';
    return { slides: plan, note };
  } catch (err) {
    console.warn(`[art-direction] planning failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
