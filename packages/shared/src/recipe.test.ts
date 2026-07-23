import { describe, it, expect } from 'vitest';
import {
  brandRecipeSchema,
  recipeCssVars,
  recipeFontFamilies,
  recipeStylesheetFor,
  recipePatternsFor,
  RECIPE_VAR_PREFIX,
} from './recipe';

const minimal = {
  tokens: {
    ground: '#0f0b06',
    ink: '#ece4d3',
    accent: '#fcbc04',
    displayFamily: 'Oswald',
    bodyFamily: 'Inter',
  },
  signature: { name: 'gold italic tagline', description: 'A gold italic-serif line under each headline.' },
};

describe('brandRecipeSchema', () => {
  it('parses a minimal recipe and fills defaults', () => {
    const r = brandRecipeSchema.parse(minimal);
    expect(r.version).toBe(1);
    expect(r.tokens.radius).toBe(16); // default
    expect(r.typography.displayWeight).toBe(700);
    expect(r.composition.align).toBe('flush-left');
    expect(r.imagery.photoRole).toBe('none');
    expect(r.stylesheet).toBe('');
    expect(r.components).toEqual([]);
  });

  it('rejects a recipe missing required tokens', () => {
    expect(() => brandRecipeSchema.parse({ signature: minimal.signature })).toThrow();
  });

  it('rejects an oversized stylesheet', () => {
    expect(() => brandRecipeSchema.parse({ ...minimal, stylesheet: 'x'.repeat(24001) })).toThrow();
  });
});

describe('recipeCssVars', () => {
  it('emits --cb-* vars for required tokens and skips absent optionals', () => {
    const r = brandRecipeSchema.parse(minimal);
    const vars = recipeCssVars(r.tokens);
    expect(vars[`${RECIPE_VAR_PREFIX}-ground`]).toBe('#0f0b06');
    expect(vars[`${RECIPE_VAR_PREFIX}-accent`]).toBe('#fcbc04');
    expect(vars[`${RECIPE_VAR_PREFIX}-display`]).toBe("'Oswald'");
    expect(vars[`${RECIPE_VAR_PREFIX}-radius`]).toBe('16px');
    expect(vars).not.toHaveProperty(`${RECIPE_VAR_PREFIX}-accent-alt`);
  });

  it('emits optional vars when present', () => {
    const r = brandRecipeSchema.parse({
      ...minimal,
      tokens: { ...minimal.tokens, accentAlt: '#fddc7b', accentFamily: 'Source Serif 4', line: '#333' },
    });
    const vars = recipeCssVars(r.tokens);
    expect(vars[`${RECIPE_VAR_PREFIX}-accent-alt`]).toBe('#fddc7b');
    expect(vars[`${RECIPE_VAR_PREFIX}-accent-family`]).toBe("'Source Serif 4'");
    expect(vars[`${RECIPE_VAR_PREFIX}-line`]).toBe('#333');
  });
});

describe('recipeFontFamilies', () => {
  it('returns display + body (+ accent when set), skipping empties', () => {
    const r = brandRecipeSchema.parse(minimal);
    expect(recipeFontFamilies(r.tokens)).toEqual(['Oswald', 'Inter']);
    const r2 = brandRecipeSchema.parse({
      ...minimal,
      tokens: { ...minimal.tokens, accentFamily: 'Playfair Display' },
    });
    expect(recipeFontFamilies(r2.tokens)).toEqual(['Oswald', 'Inter', 'Playfair Display']);
  });
});

describe('per-format tuning', () => {
  const withFormats = brandRecipeSchema.parse({
    ...minimal,
    stylesheet: '.cb-slide{ padding:96px; } .cb-slide .headline{ font-size:112px; }',
    composition: { patterns: ['cover: logo → headline'] },
    formats: {
      '1080x1920': {
        stylesheet: '.cb-slide{ padding:210px 88px 240px; }',
        patterns: ['story-cover: logo → fill → headline'],
      },
      '1080x1080': { stylesheet: '.cb-slide{ padding:72px; }' },
    },
  });

  it('appends the format override after the base stylesheet', () => {
    const story = recipeStylesheetFor(withFormats, '1080x1920');
    expect(story).toContain('font-size:112px'); // base preserved
    expect(story).toContain('padding:210px 88px 240px'); // override appended
    // the override comes AFTER the base so it wins by cascade order
    expect(story.indexOf('padding:210px')).toBeGreaterThan(story.indexOf('padding:96px'));
  });

  it('returns the base stylesheet unchanged for the base format (no override)', () => {
    expect(recipeStylesheetFor(withFormats, '1080x1350')).toBe(withFormats.stylesheet);
  });

  it('returns the base stylesheet for a recipe with no formats at all', () => {
    const plain = brandRecipeSchema.parse({ ...minimal, stylesheet: '.cb-slide{}' });
    expect(recipeStylesheetFor(plain, '1080x1920')).toBe('.cb-slide{}');
  });

  it('uses format-specific patterns when present, else the base patterns', () => {
    expect(recipePatternsFor(withFormats, '1080x1920')).toEqual(['story-cover: logo → fill → headline']);
    expect(recipePatternsFor(withFormats, '1080x1080')).toEqual(['cover: logo → headline']); // falls back
    expect(recipePatternsFor(withFormats, '1080x1350')).toEqual(['cover: logo → headline']);
  });
});
