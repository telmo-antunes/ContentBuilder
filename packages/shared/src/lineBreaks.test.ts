import { describe, expect, it } from 'vitest';
import { slideTypesettingCss } from './lineBreaks';
import { recipeStylesheetFor } from './recipe';
import { detailMastersRecipe } from '../../../apps/api/src/lib/htmlDirector/recipes';

describe('slideTypesettingCss', () => {
  const css = slideTypesettingCss();

  it('asks the browser to set the last lines, not the whole block', () => {
    // `pretty` fills each line to the measure and only reflows the tail.
    expect(css).toContain('text-wrap:pretty');
  });

  /**
   * `balance` equalises line lengths, which deliberately does NOT use the full
   * measure — the exact complaint that retired the hand-rolled binder.
   */
  it('never uses balance', () => {
    expect(css).not.toContain('balance');
  });

  it('covers display copy and body alike', () => {
    for (const c of ['headline', 'tagline', 'quote', 'stat', 'cta', 'body', 'row']) {
      expect(css).toContain(`.cb-slide .${c}`);
    }
  });

  it('carries no width, size or family — it cannot fight the recipe', () => {
    expect(css).not.toMatch(/width|font-size|font-family|max-width/);
  });

  it('is emitted after the brand sheet, so a brand default is overridden', () => {
    const sheet = recipeStylesheetFor(detailMastersRecipe, '1080x1350');
    expect(sheet).toContain('text-wrap:pretty');
    // Last layer wins: the app's typesetting must come after the authored CSS.
    expect(sheet.lastIndexOf('text-wrap:pretty')).toBeGreaterThan(sheet.indexOf('.cb-slide .headline'));
  });
});
