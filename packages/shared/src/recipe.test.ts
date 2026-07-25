import { describe, it, expect } from 'vitest';
import {
  brandRecipeSchema,
  recipeCssVars,
  recipeFontFamilies,
  recipeStylesheetFor,
  recipePatternsFor,
  recipeMotionCss,
  recipeMotionMs,
  motionForRole,
  parseCountUp,
  statCountUp,
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

describe('motion signature', () => {
  const withMotion = (style: string, pace: string) =>
    brandRecipeSchema.parse({ ...minimal, motion: { style, pace, description: 'x' } });

  it('is optional — a recipe without one still produces a default choreography', () => {
    const r = brandRecipeSchema.parse(minimal);
    expect(r.motion).toBeUndefined();
    const css = recipeMotionCss(r);
    expect(css).toContain('cb-enter');
    expect(css).toContain('translateY(28px)'); // the default rise
    expect(recipeMotionMs(r)).toBeGreaterThan(0);
  });

  it('never emits a base opacity (it leaks into paused-seek frame capture)', () => {
    // Guards the video-export bug: a base `opacity: 0` made elements render
    // blank in captured frames even though computed opacity was 1.
    expect(recipeMotionCss()).not.toMatch(/>\s*\*\s*\{[^}]*opacity/);
  });

  it('varies the from-state by style', () => {
    expect(recipeMotionCss(withMotion('slide', 'balanced'))).toContain('translateX(-44px)');
    expect(recipeMotionCss(withMotion('punch', 'balanced'))).toContain('scale(0.92)');
    const fade = recipeMotionCss(withMotion('fade', 'balanced'));
    expect(fade).toContain('opacity:0;');
    expect(fade).not.toContain('translateY');
  });

  it('pace changes the tempo — punchy is quicker than calm', () => {
    expect(recipeMotionMs(withMotion('rise', 'punchy'))).toBeLessThan(
      recipeMotionMs(withMotion('rise', 'calm')),
    );
  });

  it('falls back to defaults on unknown enum values (AI drift)', () => {
    const r = brandRecipeSchema.parse({ ...minimal, motion: { style: 'zoom', pace: 'blazing' } });
    expect(r.motion?.style).toBe('rise');
    expect(r.motion?.pace).toBe('balanced');
  });
});

describe('per-role motion', () => {
  const r = brandRecipeSchema.parse({
    ...minimal,
    motion: {
      style: 'punch',
      pace: 'punchy',
      description: 'forceful',
      roles: { stat: { style: 'pop', pace: 'balanced' }, quote: { style: 'fade', pace: 'calm' } },
    },
  });

  it('uses the role override when the recipe defines one', () => {
    expect(motionForRole(r, 'stat')).toEqual({ style: 'pop', pace: 'balanced' });
    expect(motionForRole(r, 'quote')).toEqual({ style: 'fade', pace: 'calm' });
  });

  it('falls back to the brand default for roles without an override', () => {
    expect(motionForRole(r, 'statement')).toEqual({ style: 'punch', pace: 'punchy' });
    expect(motionForRole(r, undefined)).toEqual({ style: 'punch', pace: 'punchy' });
    expect(motionForRole(r, 'not-a-role')).toEqual({ style: 'punch', pace: 'punchy' });
  });

  it('emits different CSS + duration per role', () => {
    expect(recipeMotionCss(r, 'stat')).toContain('scale(0.55)'); // pop
    expect(recipeMotionCss(r, 'quote')).not.toContain('scale(');  // fade
    // the calm quote takes longer than the balanced stat
    expect(recipeMotionMs(r, 'quote')).toBeGreaterThan(recipeMotionMs(r, 'stat'));
  });

  it('drops unknown per-role enum values to safe defaults (AI drift)', () => {
    const drift = brandRecipeSchema.parse({
      ...minimal,
      motion: { style: 'rise', pace: 'calm', roles: { stat: { style: 'explode', pace: 'ludicrous' } } },
    });
    expect(motionForRole(drift, 'stat')).toEqual({ style: 'rise', pace: 'balanced' });
  });
});

describe('parseCountUp — when a stat should tick up', () => {
  it('counts a plain quantity, keeping its unit', () => {
    expect(parseCountUp('40%')).toEqual({ to: 40, prefix: '', suffix: '%' });
    expect(parseCountUp('150+')).toEqual({ to: 150, prefix: '', suffix: '+' });
    expect(parseCountUp('$29')).toEqual({ to: 29, prefix: '$', suffix: '' });
    expect(parseCountUp('12x')).toEqual({ to: 12, prefix: '', suffix: 'x' });
  });

  it('refuses things that only LOOK like quantities', () => {
    expect(parseCountUp('2024')).toBeNull();   // a year
    expect(parseCountUp('#1')).toBeNull();     // a rank
    expect(parseCountUp('1 in 5')).toBeNull(); // a ratio
    expect(parseCountUp('24/7')).toBeNull();   // an idiom
    expect(parseCountUp('14:30')).toBeNull();  // a time
    expect(parseCountUp('40–60%')).toBeNull(); // a range
    expect(parseCountUp('3rd')).toBeNull();    // an ordinal
  });

  it('refuses what a counter cannot render', () => {
    expect(parseCountUp('$1.5M')).toBeNull();  // decimal
    expect(parseCountUp('12,000')).toBeNull(); // grouped
  });

  it('refuses numbers too small to be worth animating, and phrases', () => {
    expect(parseCountUp('3')).toBeNull();
    expect(parseCountUp('40 bookings every week')).toBeNull();
    expect(parseCountUp('')).toBeNull();
    expect(parseCountUp('Zero')).toBeNull();
  });
});

describe('statCountUp — rewriting the slide', () => {
  const html = '<p class="eyebrow">Results</p><div class="stat">40%</div><p class="body">x</p>';

  it('swaps the number for a counter span and reports the target', () => {
    const out = statCountUp(html);
    expect(out?.to).toBe(40);
    expect(out?.html).toContain('<span class="cb-cnt"></span>%');
    expect(out?.html).toContain('class="eyebrow"'); // rest untouched
  });

  it('leaves the slide alone when counting does not suit the number', () => {
    expect(statCountUp('<div class="stat">2024</div>')).toBeNull();
    expect(statCountUp('<p class="body">no stat here</p>')).toBeNull();
  });

  it('respects a brand opting out via motion.countStats', () => {
    const off = brandRecipeSchema.parse({ ...minimal, motion: { style: 'rise', pace: 'calm', countStats: false } });
    expect(statCountUp(html, off)).toBeNull();
  });

  it('emits seekable count CSS only when a target is given', () => {
    expect(recipeMotionCss(undefined, 'stat', 40)).toContain('@keyframes cb-count');
    expect(recipeMotionCss(undefined, 'stat', 40)).toContain("syntax: '<integer>'");
    expect(recipeMotionCss(undefined, 'stat')).not.toContain('cb-count');
  });
});

describe('count-up holds its final value', () => {
  // The video capture removes `.cb-motion` for the settled/hold frames. If the
  // count target were scoped to that class the number would fall back to the
  // registered initial-value (0) and snap to zero for the rest of the clip.
  const css = recipeMotionCss(undefined, 'stat', 40);

  it('sets the final value on the BASE rule, not the .cb-motion rule', () => {
    const base = css.split('\n').find((l) => l.includes('.cb-cnt {') && !l.includes('cb-motion'));
    expect(base).toContain('--cb-n: 40');
    const motionRule = css.split('\n').find((l) => l.includes('cb-motion .cb-cnt'));
    expect(motionRule).toContain('animation:');
    expect(motionRule).not.toContain('--cb-n:'); // must NOT own the target value
  });

  it('animates 0 → the target', () => {
    expect(css).toContain('from { --cb-n: 0; }');
    expect(css).toContain('to { --cb-n: 40; }');
  });

  it('emits no count CSS when the stat is not countable', () => {
    expect(recipeMotionCss(undefined, 'stat')).not.toContain('--cb-n');
  });
});
