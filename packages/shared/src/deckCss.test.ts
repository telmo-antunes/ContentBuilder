import { describe, expect, it } from 'vitest';
import { cleanDeckCss, deckCssFaults, scopeDeckCss, splitDeckRules } from './deckCss';

const brand = new Set(['headline', 'body', 'eyebrow', 'cta', 'panel']);

describe('deckCssFaults — the deck stylesheet contract', () => {
  it('accepts a scoped device in the brand tokens', () => {
    const css = `.cb-slide .dk-compare{display:grid;grid-template-columns:1fr 1fr;gap:24px;border-top:1px solid var(--cb-line)}
.cb-slide .dk-compare .headline{font-size:44px;color:var(--cb-ink)}`;
    expect(deckCssFaults(css, brand)).toEqual([]);
  });

  it('refuses a rule that restyles a brand class bare', () => {
    const faults = deckCssFaults('.cb-slide .headline{font-size:120px}', brand);
    expect(faults.map((f) => f.kind)).toContain('class-prefix');
  });

  it('refuses an unscoped selector', () => {
    expect(deckCssFaults('.dk-big{font-size:200px}', brand).map((f) => f.kind)).toContain('unscoped');
  });

  it('refuses literal colours but allows tokens and color-mix of tokens', () => {
    expect(deckCssFaults('.cb-slide .dk-x{color:#fff}', brand).map((f) => f.kind)).toContain('literal-colour');
    expect(deckCssFaults('.cb-slide .dk-x{background:rgba(0,0,0,.5)}', brand).map((f) => f.kind)).toContain('literal-colour');
    expect(deckCssFaults('.cb-slide .dk-x{color:var(--cb-accent);background:color-mix(in srgb, var(--cb-ground) 80%, var(--cb-ink))}', brand)).toEqual([]);
  });

  it('refuses anything that loads or escapes', () => {
    expect(deckCssFaults('.cb-slide .dk-x{background:url(https://x/y.png)}', brand).map((f) => f.kind)).toContain('loads');
    expect(deckCssFaults('@import "x.css"; .cb-slide .dk-x{color:var(--cb-ink)}', brand).map((f) => f.kind)).toContain('loads');
    expect(deckCssFaults('.cb-slide .dk-x{position:fixed}', brand).map((f) => f.kind)).toContain('escapes');
  });

  it('refuses a class neither the brand nor the deck defines, inside a device', () => {
    const faults = deckCssFaults('.cb-slide .dk-x .mystery{color:var(--cb-ink)}', brand);
    expect(faults.some((f) => f.detail.includes('.mystery'))).toBe(true);
  });

  it('reports unbalanced braces as syntax', () => {
    expect(deckCssFaults('.cb-slide .dk-x{color:var(--cb-ink)', brand).map((f) => f.kind)).toContain('syntax');
  });

  it('reads one level of at-rule nesting', () => {
    const rules = splitDeckRules('@media (min-width:0){.cb-slide .dk-a{gap:1px}.cb-slide .dk-b{gap:2px}}.cb-slide .dk-c{gap:3px}');
    expect(rules.map((r) => r.selector)).toEqual(['.cb-slide .dk-a', '.cb-slide .dk-b', '.cb-slide .dk-c']);
  });
});

describe('cleanDeckCss — keep the good rules, drop the bad', () => {
  it('keeps a valid device and drops the stray recolour', () => {
    const { css, dropped } = cleanDeckCss(
      '.cb-slide .dk-number{font-size:300px;line-height:.9;color:var(--cb-accent)}\n.cb-slide .headline{color:#f00}',
      brand,
    );
    expect(css).toContain('.dk-number');
    expect(css).not.toContain('#f00');
    expect(dropped).toHaveLength(1);
  });

  it('drops the whole sheet when braces are unbalanced', () => {
    expect(cleanDeckCss('.cb-slide .dk-x{', brand).css).toBe('');
  });

  it('returns nothing for nothing', () => {
    expect(cleanDeckCss('   ', brand)).toEqual({ css: '', dropped: [] });
  });
});

describe('scopeDeckCss', () => {
  it('scopes every .cb-slide to the instance, like the brand sheet', () => {
    expect(scopeDeckCss('.cb-slide .dk-x{gap:1px}.cb-slide .dk-y{gap:2px}', 's1')).toBe('.s1 .cb-slide .dk-x{gap:1px}.s1 .cb-slide .dk-y{gap:2px}');
  });
});
