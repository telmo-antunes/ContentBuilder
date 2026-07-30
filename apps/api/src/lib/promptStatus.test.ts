import { describe, expect, it } from 'vitest';
import { currentVersion, type BrandRecipe } from '@contentbuilder/shared';
import { brandUpdateStatus, postUpdateStatus } from './promptStatus';

/**
 * A recipe that is fully CURRENT: phone-legible type, a list vocabulary the app
 * can lay out, and an authored ambient character. Nothing here should flag.
 */
const current = (over: Partial<BrandRecipe> = {}): BrandRecipe =>
  ({
    version: 2,
    tokens: { displayFamily: 'Oswald', bodyFamily: 'Inter', accent: '#fcbc04', ground: '#0f0b06', ink: '#ece4d3' },
    typography: { displayCase: 'upper', density: 'balanced', displayWeight: 700 },
    composition: { align: 'flush-left' },
    signature: { name: 'rule', description: 'a hairline rule under the eyebrow' },
    imagery: { treatment: 'documentary', subjects: ['training'], photoRole: 'accent' },
    voice: { description: 'direct' },
    motion: { style: 'rise', pace: 'balanced', ambient: { style: 'parallax', intensity: 'medium' } },
    components: [
      { className: 'headline', use: 'the main line' },
      { className: 'row', use: 'one entry in a list' },
    ],
    stylesheet: '.cb-slide .headline{font-size:110px}.cb-slide .body{font-size:44px}.cb-slide .row{font-size:40px}',
    patterns: {},
    promptVersions: {
      recipeAuthor: currentVersion('recipeAuthor'),
      recipeCritique: currentVersion('recipeCritique'),
      vision: currentVersion('vision'),
    },
    ...over,
  }) as unknown as BrandRecipe;

describe('brandUpdateStatus', () => {
  it('says nothing about a brand that has never been designed', () => {
    expect(brandUpdateStatus(undefined)).toBeNull();
  });

  it('does not flag a recipe that is current', () => {
    const s = brandUpdateStatus(current())!;
    expect(s.behind).toEqual([]);
    expect(s.flagged).toBe(false);
  });

  it('reports being behind WITHOUT flagging when nothing measurable is wrong', () => {
    // The whole point of the detector rule: an old stamp on a recipe that has
    // no actual problem is reported for the changelog and never badged. A badge
    // that is always lit is wallpaper.
    const s = brandUpdateStatus(current({ promptVersions: { recipeAuthor: 1 } } as never))!;
    expect(s.behind.map((b) => b.touchpoint)).toContain('recipeAuthor');
    expect(s.findings).toEqual([]);
    expect(s.flagged).toBe(false);
  });

  it('names the offending size in phone points when the type floor would move', () => {
    const s = brandUpdateStatus(
      current({
        promptVersions: { recipeAuthor: 1 },
        stylesheet: '.cb-slide .headline{font-size:110px}.cb-slide .cta{font-size:32px}',
      } as never),
    )!;
    expect(s.flagged).toBe(true);
    expect(s.findings.some((f) => f.detector === 'typeFloor' && /cta is 32px \(11\.6pt/.test(f.message))).toBe(true);
  });

  it('flags a brand with no ambient character, because its photos sit still', () => {
    const s = brandUpdateStatus(
      current({ promptVersions: { recipeAuthor: 3 }, motion: { style: 'rise', pace: 'balanced' } } as never),
    )!;
    expect(s.findings.map((f) => f.detector)).toContain('noAmbientMotion');
  });
});

const slide = (id: string, order: number, html: string, pv?: Record<string, number>) => ({
  id,
  order,
  authored: { html, ...(pv ? { pv } : {}) },
});

const CURRENT_POST = { parse: currentVersion('parse'), compose: currentVersion('compose'), caption: currentVersion('caption') };

describe('postUpdateStatus', () => {
  it('says nothing about a post with no composed slides', () => {
    expect(postUpdateStatus([{ id: 'a', order: 0 }], current())).toBeNull();
  });

  it('does not flag a post composed by the current prompts', () => {
    const s = postUpdateStatus(
      [slide('a', 0, '<h1 class="headline">Hi</h1><figure class="cb-shot" data-cb-slot="hero"></figure>', CURRENT_POST)],
      current(),
    )!;
    expect(s.flagged).toBe(false);
    expect(s.slides).toEqual([]);
  });

  it('is only as new as its OLDEST slide — one fresh slide does not carry the deck', () => {
    const s = postUpdateStatus(
      [
        slide('a', 0, '<h1 class="headline">A</h1>', CURRENT_POST),
        slide('b', 1, '<h1 class="headline">B</h1>', { ...CURRENT_POST, parse: 1 }),
      ],
      current(),
    )!;
    const parse = s.behind.find((b) => b.touchpoint === 'parse');
    expect(parse?.from).toBe(1);
  });

  it('treats an unstamped slide as predating versioning entirely', () => {
    const s = postUpdateStatus([slide('a', 0, '<h1 class="headline">A</h1>')], current())!;
    expect(s.behind.find((b) => b.touchpoint === 'parse')?.from).toBe(0);
  });

  it('does not claim there is nowhere for a photograph when one slide has a slot', () => {
    // `noImageSlots` is about the DECK: the complaint is "there is nowhere to
    // put your picture", and one slot anywhere answers it. Firing per slide
    // would flag every text slide in every post forever.
    const s = postUpdateStatus(
      [
        slide('a', 0, '<h1 class="headline">A</h1>'),
        slide('b', 1, '<figure class="cb-shot" data-cb-slot="hero"></figure>'),
      ],
      current(),
    )!;
    expect(s.findings.map((f) => f.detector)).not.toContain('noImageSlots');
    expect(s.flagged).toBe(false);
  });

  it('names every slide that writes an enumeration as a paragraph', () => {
    const para =
      '<div class="body">First you show up. Then you do the work. Then you do it again tomorrow.</div>';
    const s = postUpdateStatus(
      [
        slide('a', 0, '<h1 class="headline">A</h1><figure class="cb-shot" data-cb-slot="h"></figure>', {
          ...CURRENT_POST,
          parse: 2,
        }),
        slide('b', 1, para, { ...CURRENT_POST, parse: 2 }),
      ],
      current(),
    )!;
    expect(s.flagged).toBe(true);
    expect(s.slides.map((x) => x.id)).toEqual(['b']);
    expect(s.slides[0]!.reasons).toContain('an enumeration written as a paragraph');
  });
});
