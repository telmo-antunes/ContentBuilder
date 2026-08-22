/**
 * THE DESIGN PASS — the composer's one chance to see a slide and do better.
 *
 * `visionRepair` is the rung after the repair ladder: it fires when a gate
 * found something WRONG. This is its sibling and fires when nothing is wrong —
 * on the one or two slides a deck actually rides on (the cover earns the swipe,
 * the list is the slide people save), because "measures clean" and "good" are
 * different claims and only the second one sells anything.
 *
 * It is also the only place the product spends real money on a single slide, so
 * three rules keep the spend honest:
 *
 *   · IT NEVER TOUCHES THE WORDS. Every string was written, budgeted, clamped
 *     and checked upstream, and a slide that says something different from what
 *     was approved is a worse failure than a plain one. The guard below is
 *     mechanical, not a request: an improvement whose visible text differs from
 *     the original is discarded whatever else it got right.
 *   · IT MAY ONLY USE THE BRAND'S OWN VOCABULARY, exactly like the composer.
 *   · IT IS KEPT ONLY IF THE RENDER AGREES. The caller re-measures and throws
 *     the attempt away unless the slide still fits and still does not collide —
 *     so the worst case of a design pass is the slide you already had.
 */
import type { BrandRecipe } from '@contentbuilder/shared';
import { aiMessage, modelFor, textOf } from '../ai';
import { affordsUsd } from '../spend';
import { sanitizeAuthoredHtml } from '../htmlSanitize';

const SYSTEM = `You are an art director improving ONE rendered slide of a brand's Instagram carousel. You can see it. Nothing is broken — you are here to make it BETTER, and if it is already good you say so and change nothing.

WHAT "BETTER" MEANS HERE, in order:
1. HIERARCHY. Does the eye land on the one thing this slide is about, or does everything compete? Emphasis is spent, not sprinkled.
2. RHYTHM. Spacing is grouping: a lockup (an eyebrow and its headline, a button and the line under it) reads as ONE unit and sits tight; unrelated units sit noticeably further apart. Blocks that drift apart or crowd together are the commonest reason a slide looks amateur while measuring perfectly.
3. THE BRAND'S OWN DEVICES. If this brand defines a card, a badge, a chip, a split or verdict rows, and this slide's content is the kind of thing they exist for — a claim with evidence, a right way against a wrong way, a set of steps — USE them. A post by a business should look like the business's own artifact, not like editorial about its topic.
4. RESTRAINT. Negative space is a choice. Do not fill the frame because it is empty.

WHAT YOU MAY CHANGE
- The ORDER and GROUPING of blocks.
- Which structural elements are present: spacers (.fill), rules, panels, cards, badges.
- Which size variant a block uses, where the brand offers one (e.g. "headline sm").
- Wrapping existing content in a device the brand defines, or unwrapping it.

WHAT YOU MAY NOT CHANGE — AND THESE ARE CHECKED
- THE WORDS. Not one character of visible text. Every string was written, budgeted and approved long before it reached you. You may move text between elements; you may not edit, shorten, extend, translate, re-punctuate or improve it. An answer whose text differs is thrown away.
- The class vocabulary: ONLY classes this brand defines. An invented class renders unstyled.
- No inline styles, no <style>, no <script>, no <img>, no ids.

REPLY WITH STRICT JSON ONLY, no prose and no fences:
{"html": "<the improved fragment>", "change": "<one line naming what you changed and why>"}
To leave it alone, reply {"html": "", "change": "<why it is already right>"} — a decline is a real answer and a better one than a change you cannot justify.`;

export interface DesignPassResult {
  html: string;
  /** One line, for the compose notes: what changed and why. */
  change: string;
}

/** What one look-and-improve on a single slide costs, near enough to gate on. */
export const DESIGN_PASS_ESTIMATE_USD = 0.06;

/** The visible text of a fragment, normalised — what a reader actually sees. */
export function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * THE COPY FINGERPRINT — the words, as a multiset.
 *
 * Deliberately order-INDEPENDENT, because reordering and regrouping blocks is
 * the pass's whole job: leading with the headline instead of the eyebrow moves
 * text without changing a word of it, and a sequence comparison would reject
 * exactly the improvements this exists to buy. Sorting the words still catches
 * everything the guard is for — an edited word, an added sentence, a dropped
 * clause, a "punchier" rewrite — because any of those changes the multiset.
 */
export function copyFingerprint(html: string): string {
  return visibleText(html).toLowerCase().split(' ').filter(Boolean).sort().join(' ');
}

/**
 * Improve one slide the model can see. Returns null when there is nothing
 * usable — no image, no budget, a decline, markup that fails the sanitiser, or
 * an answer that changed the copy. Never throws.
 */
export async function improveByLooking(
  recipe: BrandRecipe,
  opts: {
    html: string;
    /** Base64 PNG of the rendered slide. */
    image: string;
    role?: string;
    model?: string;
    /** Label for the spend ledger, e.g. 'design-pass:cover'. */
    label?: string;
  },
): Promise<DesignPassResult | null> {
  if (!opts.image || !opts.html.trim()) return null;
  const label = opts.label ?? `design-pass:${opts.role ?? 'slide'}`;
  if (!affordsUsd(DESIGN_PASS_ESTIMATE_USD, label)) return null;

  const classes = recipe.components.map((c) => c.className.split(/\s+/)[0]).filter(Boolean);
  try {
    // The design tier, deliberately: this is the one call per deck where the
    // model is asked for taste rather than obedience.
    const model = opts.model ?? (await modelFor('recipe'));
    const resp = await aiMessage(
      {
        model,
        max_tokens: 2500,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: opts.image } },
              {
                type: 'text',
                text: [
                  `This slide's role: ${opts.role ?? 'statement'}`,
                  `This brand's signature: ${recipe.signature.name} — ${recipe.signature.description}`,
                  `Classes this brand defines: ${classes.join(', ')}`,
                  '',
                  'Its markup:',
                  opts.html,
                ].join('\n'),
              },
            ] as never,
          },
        ],
      },
      { feature: label },
    );

    const text = textOf(resp);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as { html?: unknown; change?: unknown };
    const change = String(parsed.change ?? '').slice(0, 200);
    const proposed = typeof parsed.html === 'string' ? parsed.html.trim() : '';
    if (!proposed) {
      // A decline is the prompt's own suggestion and a good outcome: the slide
      // was already right and the deck keeps what it had.
      console.warn(`[design-pass] left ${opts.role ?? 'the slide'} alone: ${change || '(no reason given)'}`);
      return null;
    }

    const safe = sanitizeAuthoredHtml(proposed);
    if (!safe.trim()) return null;

    /**
     * THE COPY GUARD. Mechanical on purpose: the prompt asks for verbatim text
     * and the prompt is not what makes it true. Every upstream guarantee —
     * budgets, verbatim locks, the unfinished-prose check, the human who
     * approved the words — depends on this being enforced rather than requested.
     */
    if (copyFingerprint(safe) !== copyFingerprint(opts.html)) {
      console.warn(
        `[design-pass] discarded an improvement to ${opts.role ?? 'a slide'}: it changed the copy`,
      );
      return null;
    }
    if (safe === opts.html) return null;
    return { html: safe, change };
  } catch (err) {
    console.warn(`[design-pass] failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * WHICH SLIDES ARE WORTH THE MONEY.
 *
 * A deck rides on the cover (it decides whether anyone swipes) and on the
 * slides that carry a PHOTOGRAPH — a picture plus type is a two-body layout
 * problem, and the only faults that have shipped past every measuring gate
 * (a small inset floating in a dead middle band, an eyebrow crowding a
 * screenshot) were on exactly these slides: the numbers-only gates cannot see
 * a composition that is wrong while fitting. Type-only slides between them are
 * carried perfectly well by the brand's own fragments, for free.
 *
 * Returns deck indices, at most three, in the order they should be attempted
 * so a half-affordable budget still buys the most valuable ones.
 */
export function slidesWorthDesigning(
  slides: ReadonlyArray<{ role: string; photo?: boolean }>,
): number[] {
  const out: number[] = [];
  const CAP = 3;
  const push = (i: number) => {
    if (i !== -1 && !out.includes(i) && out.length < CAP) out.push(i);
  };
  push(slides.findIndex((s) => s.role === 'cover'));
  // Every slide holding a photo slot, in deck order — the two-body layouts.
  slides.forEach((s, i) => {
    if (s.photo) push(i);
  });
  push(slides.findIndex((s) => s.role === 'list'));
  // Nothing but the cover so far? The closing slide is the next-most-seen frame.
  if (out.length < 2) push(slides.map((s) => s.role).lastIndexOf('cta'));
  return out;
}
