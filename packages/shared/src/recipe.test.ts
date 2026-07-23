import { describe, it, expect } from 'vitest';
import { brandRecipeSchema, recipeCssVars, recipeFontFamilies, RECIPE_VAR_PREFIX } from './recipe';

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
