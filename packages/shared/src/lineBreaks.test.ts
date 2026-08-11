import { describe, expect, it } from 'vitest';
import { slideTypesettingCss } from './lineBreaks';

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

  it('scopes every rule to the slide root', () => {
    for (const line of css.split('\n')) expect(line.startsWith('.cb-slide')).toBe(true);
  });
});
