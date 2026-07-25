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
  ensureRecipeContrast,
  validateRecipeConsistency,
  recipeSurfaceCss,
  recipePhotoQuery,
  recipePatternVariant,
  recipePatternsForRole,
  migrateRecipe,
  RECIPE_VERSION,
  RECIPE_VAR_PREFIX,
} from './recipe';
import { contrastRatio } from './colorContrast';

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
    expect(r.version).toBe(RECIPE_VERSION);
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

describe('contrast gate (R4)', () => {
  const withTokens = (t: Record<string, unknown>) =>
    brandRecipeSchema.parse({ ...minimal, tokens: { ...minimal.tokens, ...t } });

  it('leaves an already-legible recipe untouched', () => {
    const r = withTokens({ ground: '#0f0b06', ink: '#ece4d3', accent: '#fcbc04' });
    const out = ensureRecipeContrast(r);
    expect(out.repairs).toEqual([]);
    expect(out.recipe.tokens.ink).toBe('#ece4d3');
  });

  it('repairs ink that fails AA on its own ground', () => {
    // near-black ink on a near-black ground — unreadable
    const r = withTokens({ ground: '#101010', ink: '#1a1a1a' });
    const out = ensureRecipeContrast(r);
    expect(out.repairs.length).toBeGreaterThan(0);
    expect(contrastRatio(out.recipe.tokens.ink, '#101010')).toBeGreaterThanOrEqual(4.5);
  });

  it('holds the accent to the large-text threshold', () => {
    const r = withTokens({ ground: '#0f0b06', ink: '#ffffff', accent: '#141007' });
    const out = ensureRecipeContrast(r);
    expect(contrastRatio(out.recipe.tokens.accent, '#0f0b06')).toBeGreaterThanOrEqual(3);
  });
});

describe('self-consistency (R9)', () => {
  it('drops component classes the stylesheet never defines', () => {
    const r = brandRecipeSchema.parse({
      ...minimal,
      stylesheet: '.cb-slide .headline{ font-size:100px } .cb-slide .eyebrow{ font-size:20px }',
      components: [
        { className: 'headline', use: 'the statement' },
        { className: 'panel', use: 'a card that does not exist in the CSS' },
      ],
    });
    const out = validateRecipeConsistency(r);
    expect(out.dropped).toEqual(['panel']);
    expect(out.recipe.components.map((c) => c.className)).toEqual(['headline']);
  });

  it('accepts a multi-class component when its first class is defined', () => {
    const r = brandRecipeSchema.parse({
      ...minimal,
      stylesheet: '.cb-slide .headline{ font-size:100px }',
      components: [{ className: 'headline sm', use: 'the small variant' }],
    });
    expect(validateRecipeConsistency(r).dropped).toEqual([]);
  });

  it('reports styled-but-unadvertised classes, ignoring SVG data-URI noise', () => {
    const r = brandRecipeSchema.parse({
      ...minimal,
      stylesheet:
        `.cb-slide{ background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E") } .cb-slide .ghost{ opacity:.2 }`,
      components: [],
    });
    const out = validateRecipeConsistency(r);
    expect(out.unlisted).toContain('ghost');
    expect(out.unlisted).not.toContain('org'); // url() payloads are stripped
    expect(out.unlisted).not.toContain('w3');
  });
});

describe('typography drives the CSS (R3)', () => {
  it('emits display case/weight/tracking + a density step', () => {
    const r = brandRecipeSchema.parse({
      ...minimal,
      typography: { displayCase: 'upper', displayWeight: 800, displayTracking: '0.02em', density: 'roomy' },
    });
    const vars = recipeCssVars(r.tokens, r.typography);
    expect(vars['--cb-display-case']).toBe('uppercase');
    expect(vars['--cb-display-weight']).toBe('800');
    expect(vars['--cb-display-tracking']).toBe('0.02em');
    expect(Number(vars['--cb-step'])).toBeGreaterThan(1); // roomy stretches the rhythm
  });

  it('omits them when no typography is passed (back-compat)', () => {
    const r = brandRecipeSchema.parse(minimal);
    expect(recipeCssVars(r.tokens)).not.toHaveProperty('--cb-display-case');
  });
});

describe('structured imagery (R7)', () => {
  it('prefers subjects over the prose treatment for the photo query', () => {
    const r = brandRecipeSchema.parse({
      ...minimal,
      imagery: { treatment: 'Moody warm-lit portraits, with a dark overlay', subjects: ['gym portrait', 'sunrise run'] },
    });
    expect(recipePhotoQuery(r)).toBe('gym portrait sunrise run');
  });

  it('falls back to the treatment when no subjects are authored', () => {
    const r = brandRecipeSchema.parse({
      ...minimal,
      imagery: { treatment: 'Cinematic premium-car photography, dusk-lit' },
    });
    expect(recipePhotoQuery(r)).toBe('Cinematic premium car photography');
  });
});

describe('inverse surface (R8)', () => {
  it('emits nothing when the recipe has no inverse', () => {
    expect(recipeSurfaceCss(brandRecipeSchema.parse(minimal))).toBe('');
  });

  it('re-points the colour tokens inside .cb-slide.inverse', () => {
    const r = brandRecipeSchema.parse({
      ...minimal,
      surfaces: { inverse: { ground: '#ece4d3', ink: '#171208', accent: '#8a6a06' } },
    });
    const css = recipeSurfaceCss(r);
    expect(css).toContain('.cb-slide.inverse');
    expect(css).toContain('--cb-ground: #ece4d3');
    expect(css).toContain('--cb-ink: #171208');
    // and it must reach the rendered stylesheet
    expect(recipeStylesheetFor(r, '1080x1350')).toContain('.cb-slide.inverse');
  });
});

describe('composition variants (R5)', () => {
  const r = brandRecipeSchema.parse({
    ...minimal,
    composition: {
      patterns: [
        'cover: logo → headline',
        'cover: headline → rule (blunter)',
        'cta: logo → headline → cta',
      ],
    },
  });

  it('returns only the patterns for a role', () => {
    expect(recipePatternsForRole(r, '1080x1350', 'cover')).toHaveLength(2);
    expect(recipePatternsForRole(r, '1080x1350', 'cta')).toHaveLength(1);
  });

  it('rotates variants by slide index, deterministically', () => {
    const a = recipePatternVariant(r, '1080x1350', 'cover', 0);
    const b = recipePatternVariant(r, '1080x1350', 'cover', 1);
    expect(a).not.toBe(b);                                            // real variety
    expect(recipePatternVariant(r, '1080x1350', 'cover', 2)).toBe(a);  // wraps
    expect(recipePatternVariant(r, '1080x1350', 'cover', 0)).toBe(a);  // stable
  });

  it('falls back to all patterns for an unknown role', () => {
    expect(recipePatternsForRole(r, '1080x1350', 'nope')).toHaveLength(3);
  });
});

describe('layered stylesheet (R6)', () => {
  it('concatenates layers background → type → components', () => {
    const r = brandRecipeSchema.parse({
      ...minimal,
      stylesheet: '.cb-slide{ ignored:1 }',
      layers: { background: '.cb-slide{ bg:1 }', type: '.cb-slide .headline{ t:1 }', components: '.cb-slide .cta{ c:1 }' },
    });
    const css = recipeStylesheetFor(r, '1080x1350');
    expect(css.indexOf('bg:1')).toBeLessThan(css.indexOf('t:1'));
    expect(css.indexOf('t:1')).toBeLessThan(css.indexOf('c:1'));
    expect(css).not.toContain('ignored'); // layers replace the blob
  });

  it('uses the single stylesheet when no layers are authored', () => {
    const r = brandRecipeSchema.parse({ ...minimal, stylesheet: '.cb-slide{ solo:1 }' });
    expect(recipeStylesheetFor(r, '1080x1350')).toContain('solo:1');
  });
});

describe('versioning + migration (R10)', () => {
  it('stamps new recipes with the current version', () => {
    expect(brandRecipeSchema.parse(minimal).version).toBe(RECIPE_VERSION);
  });

  it('migrates a v1 payload and derives photo subjects from its prose', () => {
    const v1 = { ...minimal, version: 1, imagery: { treatment: 'Cinematic premium-car photography, dusk-lit', photoRole: 'hero' } };
    const out = migrateRecipe(v1);
    expect(out.version).toBe(2);
    expect(out.imagery.subjects).toEqual(['Cinematic premium car photography']);
  });

  it('does not clobber subjects that are already present', () => {
    const out = migrateRecipe({ ...minimal, version: 1, imagery: { treatment: 'x', subjects: ['kept'] } });
    expect(out.imagery.subjects).toEqual(['kept']);
  });

  it('survives a bogus version instead of throwing (documents outlive code)', () => {
    expect(() => migrateRecipe({ ...minimal, version: 'banana' })).not.toThrow();
  });
});
