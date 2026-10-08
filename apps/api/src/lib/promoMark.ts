import { findBrandMark, fragmentVariantsFor, type BrandRecipe } from '@contentbuilder/shared';

/**
 * THE MARK ON A PROMO STORY IS THE CAROUSEL'S OWN.
 *
 * It used to be one brand's markup typed into the route, with the accent half
 * as `<span class="it">` where that brand's recipe colours `.wordmark i`: the
 * story set "masters" white while the carousel it promotes set it gold
 * (2026-10-08), and any other brand got detailmasters' name on its story.
 *
 * Taken from the carousel's slides, the frame is recognised as the same post;
 * failing that, from the brand's own close fragment; failing both, undefined,
 * so the story carries no mark rather than a wrong one.
 */
export function promoStoryMark(slideHtmls: ReadonlyArray<string | undefined>, recipe: BrandRecipe): string | undefined {
  for (const html of slideHtmls) {
    const mark = html ? findBrandMark(html) : null;
    if (mark) return mark.outer;
  }
  for (const fragment of fragmentVariantsFor(recipe, 'cta')) {
    const mark = findBrandMark(fragment);
    if (mark) return mark.outer;
  }
  return undefined;
}
