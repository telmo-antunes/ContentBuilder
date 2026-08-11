/**
 * VERTICAL RHYTHM — the deterministic guard that stops a slide reading as
 * unfinished.
 *
 * A slide root is a flex column, and `.fill` is its zero-height flex-grow
 * spacer: where the fill sits decides where the slack goes. That makes one
 * arrangement silently worthless —
 *
 *     eyebrow → headline → rule → body → fill
 *
 * — because a spacer with nothing after it grows into empty canvas. The copy
 * piles up under the top edge and the bottom 40% of the poster is void. It is
 * the single most common way a technically-correct composition looks like a
 * draft, and it happens constantly: the recipe's fragment ends `… → fill →
 * cb-shot` or `… → fill → handle`, the slide has no photograph or no handle,
 * that last element is removed with its copy, and the fill it was there to
 * balance is left dangling.
 *
 * So the slack is MOVED rather than left where an absent element stranded it:
 *
 *     eyebrow → fill → headline → rule → body
 *
 * — the label pinned to the top edge, the statement settled on the baseline.
 * That is the composition the recipes' own `statement` pattern already uses
 * ("eyebrow → fill → headline → rule → body → fill"), so this is the brand's
 * own move applied where an element removal broke it.
 *
 * THE RULES, and why each is narrow:
 *
 *   · Only ever act when EVERY fill is trailing. A fill anywhere in the middle
 *     means the composition already decided where its slack goes, and moving it
 *     would overrule a deliberate arrangement.
 *   · Never insert a second fill. One spacer is an anchor; two are a centring,
 *     which is a different design decision and not ours to make.
 *   · The fill lands after the slide's LABEL RUN — the brand mark and the
 *     eyebrow, the elements whose job is to sit at the top edge. With no label
 *     run there is nothing to pin, so nothing happens: content already fills
 *     from the top and a leading fill would just push it all to the bottom.
 *   · Nothing moves when the slide is already full. A composition with enough
 *     blocks to fill the canvas has no slack for a spacer to redistribute, and
 *     the guard would only risk pushing it into overflow.
 *
 * Pure string work over the same top-level block scanner the dedupe and the
 * repair ladder use — no DOM, no measurement, no model.
 */
import { topLevelBlocks, type SlideBlock } from './dedupeBlocks';

/** The flex-grow spacer, named identically in every reference recipe. */
const FILL_CLASS = 'fill';

/**
 * A separator with nothing after it separates nothing. `.rule` is the hairline
 * every recipe draws between a headline and the copy beneath it; when that copy
 * is absent — no body was written, or a trim took it — the rule is left as a
 * stray dash hanging off the bottom of the composition. It is the tail-end twin
 * of the stranded spacer, so it is removed in the same pass.
 */
const DECORATION_CLASSES = new Set(['rule']);

/**
 * The elements whose job is the top edge: the brand's mark and the kicker above
 * the headline. A fill placed after these pins them and drops everything else to
 * the baseline; a fill placed before them would push the logo itself down.
 */
const LABEL_CLASSES = new Set(['logo', 'logo-row', 'wordmark', 'monogram', 'eyebrow']);

/**
 * Above this many top-level blocks the canvas is doing enough work already.
 * Six is a full composition in every reference recipe (mark, eyebrow, headline,
 * rule, body, panel) — past it the slack a spacer could redistribute is gone.
 */
const CROWDED_BLOCKS = 6;

const isFill = (b: SlideBlock): boolean => !b.text && b.classes.includes(FILL_CLASS);
const isLabel = (b: SlideBlock): boolean => b.classes.some((c) => LABEL_CLASSES.has(c));
const isDecoration = (b: SlideBlock): boolean => !b.text && b.classes.some((c) => DECORATION_CLASSES.has(c));

export interface BalanceResult {
  html: string;
  /** What was done, for the log. Absent when the markup was already balanced. */
  moved?: 'anchored' | 'trimmed' | 'anchored+trimmed';
}

/**
 * Drop separators that separate nothing: any run of decoration at the very end
 * of the composition, once the trailing spacers are discounted.
 */
function trimDanglingDecoration(blocks: readonly SlideBlock[]): Set<number> {
  const drop = new Set<number>();
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const b = blocks[i]!;
    if (isFill(b)) continue; // a spacer past the rule doesn't make it meaningful
    if (isDecoration(b)) {
      drop.add(b.order);
      continue;
    }
    break; // real content — everything before this is separating something
  }
  return drop;
}

/**
 * Tidy a composition's TAIL: drop decoration that trails off the end, and
 * re-anchor content whose only spacers sit behind it.
 *
 * Returns the markup byte-identical when there is nothing to do — already
 * balanced, already crowded, no spacer to move, or one in the middle — which is
 * the overwhelming majority of slides.
 */
export function balanceVertical(html: string): BalanceResult {
  const all = topLevelBlocks(html);
  const danglers = trimDanglingDecoration(all);
  if (danglers.size) {
    const kept = all.filter((b) => !danglers.has(b.order)).map((b) => b.html).join('\n');
    // Re-scan: removing the tail can turn a mid-composition spacer into a
    // trailing one, which is exactly the case the anchor pass below handles.
    const next = balanceVertical(kept);
    return { html: next.html, moved: next.moved ? 'anchored+trimmed' : 'trimmed' };
  }

  const blocks = all;
  if (blocks.length < 3 || blocks.length > CROWDED_BLOCKS) return { html };

  const fills = blocks.filter(isFill);
  if (!fills.length) return { html };

  // Every fill must sit after the last block that says something. One in the
  // middle is a deliberate anchor and is left exactly where the author put it.
  const lastContent = [...blocks].reverse().find((b) => !isFill(b));
  if (!lastContent) return { html };
  if (fills.some((f) => f.order < lastContent.order)) return { html };

  // Where the slack belongs: after the run of top-edge labels, which is
  // everything up to (and including) the last leading logo/eyebrow block.
  let insertAfter = -1;
  for (const b of blocks) {
    if (isFill(b)) break;
    if (!isLabel(b)) break;
    insertAfter = b.order;
  }
  // No label run → the content already starts at the top edge and a spacer
  // above it would merely swap one void for another.
  if (insertAfter < 0) return { html };
  // Nothing but labels and spacers — there is no statement to anchor.
  if (insertAfter >= lastContent.order) return { html };

  // Rebuild: drop the trailing fills, insert one after the label run.
  const drop = new Set(fills.map((f) => f.order));
  const anchor = blocks[insertAfter]!;
  let out = '';
  let kept = 0;
  for (const b of blocks) {
    if (drop.has(b.order)) continue;
    out += (kept++ ? '\n' : '') + b.html;
    if (b.order === anchor.order) out += `\n<div class="${FILL_CLASS}"></div>`;
  }
  return { html: out, moved: 'anchored' };
}
