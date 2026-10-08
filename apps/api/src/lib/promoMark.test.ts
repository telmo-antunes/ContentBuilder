import { describe, expect, it } from 'vitest';
import type { BrandRecipe } from '@contentbuilder/shared';
import { promoStoryMark } from './promoMark';

const MARK = '<div class="logo-row"><div class="monogram"></div><div class="wordmark"><b>detail</b><i>masters</i></div></div>';
const recipe = (cta?: string) => ({ fragments: cta ? { cta } : {} }) as unknown as BrandRecipe;

describe('promoStoryMark', () => {
  it("takes the mark exactly as the carousel sets it", () => {
    const slides = ['<h1 class="headline">Cover</h1>', `${MARK}\n<div class="cta">DM us KIT</div>`];
    expect(promoStoryMark(slides, recipe())).toBe(MARK);
  });

  it("falls back to the brand's close fragment", () => {
    expect(promoStoryMark(['<h1 class="headline">Cover</h1>'], recipe(`${MARK}<div class="cta">{{cta}}</div>`))).toBe(MARK);
  });

  it('carries no mark rather than a wrong one', () => {
    expect(promoStoryMark(['<h1 class="headline">Cover</h1>', undefined], recipe())).toBeUndefined();
  });
});
