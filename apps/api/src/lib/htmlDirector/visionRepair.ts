/**
 * THE COMPOSER LOOKS AT ITS OWN WORK.
 *
 * Every deterministic guard in `renderCheck.ts` exists for one reason: the thing
 * that wrote the slide could not see it. The composer is handed a brand's class
 * vocabulary and a set of copy parts, and it arranges them blind — so the app
 * measures the result afterwards and repairs what it can with a ladder of moves
 * it knows are safe (a smaller headline, a dropped element, a re-compose).
 *
 * That ladder runs out. When it does, the slide has always shipped with a note
 * saying what is still wrong with it, which is honest and useless: the fault was
 * named, nothing fixed it, and a person had to hand-author the slide. Five of
 * eight on the worst deck.
 *
 * This is the rung after the ladder. The model is shown the RENDER — the actual
 * pixels — beside its own markup and the named faults, and asked for corrected
 * markup. It is the only step in the pipeline that judges a composition by
 * looking at it.
 *
 * Three rules keep it from making things worse, and they are the same rules
 * every other rung follows:
 *   · it may only rearrange, never rewrite the words (the copy was budgeted,
 *     clamped and checked long before it got here);
 *   · it may only use classes the brand already advertises;
 *   · its output is kept ONLY if the measured faults actually reduce.
 */
import type { BrandRecipe } from '@contentbuilder/shared';
import { aiMessage, modelFor, textOf } from '../ai';
import { recordUsage } from '../usage';
import { sanitizeAuthoredHtml } from '../htmlSanitize';

const SYSTEM = `You are a designer looking at ONE rendered Instagram slide that has a layout fault, and at the markup that produced it.

You are judging the picture, not the code. The measurements have already been taken and are given to you; your job is to decide what to CHANGE about the arrangement so the fault goes away.

WHAT YOU MAY CHANGE
- The ORDER of the blocks.
- Which structural elements are present: a spacer (.fill), a rule, a panel wrapper.
- Which size variant a block uses, where the brand offers one (e.g. "headline sm").
- Splitting one block into a panel of rows, or collapsing rows back into a line.

WHAT YOU MAY NOT CHANGE
- THE WORDS. Not one. Every string was written, budgeted and checked upstream; a slide that says something different from what was approved is a worse failure than the one you are fixing. Move text between elements if the arrangement needs it, but never edit, shorten, translate or improve it.
- The class vocabulary. Use ONLY classes that already appear in the markup you are given, plus the structural ones the brand advertises. Inventing a class produces an unstyled element.
- No inline styles, no <style>, no scripts, no images.

WHAT THE FAULTS MEAN
- "overflows" — the content is taller than the canvas. Something must go or get smaller.
- "collision" — two elements are touching. They need separating, usually by removing whatever sits between them or giving one a smaller variant.
- "slack N%" — an empty band covering N% of the frame. The slide reads as empty. Usually the fix is a spacer in the wrong place, or content bunched at one end.
- "headline N lines" — the headline has run past what this composition allows.

Reply with STRICT JSON only, no prose, no fences:
{"html":"<the corrected slide markup>","change":"<one sentence naming what you changed>"}

If you cannot see a change that would help, reply {"html":"","change":"<why not>"} — that is a useful answer, and far better than a guess that trades one fault for another.`;

export interface VisionRepairResult {
  html: string;
  change: string;
}

/**
 * Ask the model to fix a slide it can see. Returns null when there is nothing
 * usable — no image, no vision model, a refusal, or markup that does not survive
 * the sanitiser. Never throws: this is the last rung of a best-effort ladder.
 */
export async function repairByLooking(
  recipe: BrandRecipe,
  opts: {
    html: string;
    /** Base64 PNG of the rendered slide. */
    image: string;
    /** What the gates said, in their own words. */
    faults: readonly string[];
    role?: string;
    model?: string;
  },
): Promise<VisionRepairResult | null> {
  if (!opts.image || !opts.faults.length) return null;
  const classes = recipe.components.map((c) => c.className.split(/\s+/)[0]).filter(Boolean);
  try {
    const model = opts.model ?? (await modelFor('vision'));
    const resp = await aiMessage({
      model,
      max_tokens: 2000,
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
                `The gates report: ${opts.faults.join(', ')}`,
                `Classes this brand defines: ${classes.join(', ')}`,
                '',
                'Its markup:',
                opts.html,
              ].join('\n'),
            },
          ] as never,
        },
      ],
    });
    await recordUsage({
      feature: 'post:visionRepair',
      model,
      inputTokens: resp.usage?.input_tokens,
      outputTokens: resp.usage?.output_tokens,
    }).catch(() => {});

    const text = textOf(resp);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as { html?: unknown; change?: unknown };
    const html = typeof parsed.html === 'string' ? parsed.html.trim() : '';
    const change = String(parsed.change ?? '').slice(0, 200);
    if (!html) {
      /**
       * A DECLINE IS AN ANSWER, and the prompt asks for one: replying with no
       * markup rather than guessing is better than trading one fault for
       * another. Logged with its reason, because "returned nothing usable" read
       * identically whether the model had declined or the JSON had failed — and
       * those want completely different responses from whoever reads the log.
       */
      console.warn(`[vision-repair] the model saw no change worth making: ${change || '(no reason given)'}`);
      return null;
    }
    // The sanitiser is the same one compose runs; markup that does not survive
    // it would not have been allowed from the composer either.
    const safe = sanitizeAuthoredHtml(html);
    if (!safe.trim()) return null;
    return { html: safe, change: change || 'rearranged the slide' };
  } catch (err) {
    console.warn('[vision-repair]', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Did the model quietly rewrite the copy?
 *
 * The prompt forbids it and the model mostly obeys, but "mostly" is not a
 * guarantee and this is the one failure that must never ship: a slide saying
 * something nobody approved. Compares the visible text of both versions,
 * ignoring whitespace and element boundaries, so a pure REARRANGEMENT passes
 * and any edit to the words does not.
 */
export function saysTheSameThing(before: string, after: string): boolean {
  const words = (html: string) =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .sort()
      .join(' ');
  return words(before) === words(after);
}

/**
 * Is this still the SAME SLIDE, after being asked to say more?
 *
 * The rewrite rung deliberately allows new words — that is the whole point, and
 * `saysTheSameThing` would forbid it. But "add a line" and "become a different
 * slide" are not the same instruction, and the model will happily do the second
 * when it does not know what the first one said: asked to fill an empty
 * headliner slide, it returned the deck's COVER, headline and lockup and all.
 * Measured better. Completely wrong.
 *
 * So the headline is the anchor. A slide keeps its point if the words of its
 * headline survive the rewrite; everything else may grow. When the original had
 * no headline there is nothing to anchor to and the rung is not allowed to run
 * — which is the honest answer, not a permissive one.
 */
export function keepsThePoint(headline: string | undefined, html: string): boolean {
  const norm = (x: string) =>
    x
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const want = norm(headline ?? '');
  if (!want) return false;
  return norm(html).includes(want);
}
