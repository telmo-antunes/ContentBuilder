import { describe, expect, it } from 'vitest';
import type { BrandRecipe } from '@contentbuilder/shared';
import {
  cleanDesignedHtml,
  deckClasses,
  describeMeasured,
  finishDesignedDeck,
  inventedWords,
  unknownClasses,
  validateDesignPhotos,
} from './designDeck';
import type { ComposeSlideInput } from './prompt';
import type { PoolAsset } from '../photoPool';

const recipe = {
  tokens: { ground: '#0D0D0F', ink: '#F5F1E9', accent: '#D4AD64', displayFamily: 'Inter', bodyFamily: 'Inter', radius: 16 },
  typography: { displayCase: 'sentence', displayWeight: 700, displayTracking: '-0.02em', density: 'balanced' },
  signature: { name: 'Gold line', description: 'A gold italic line.' },
  stylesheet: '.cb-slide .headline{font-size:64px}',
  components: [
    { className: 'eyebrow', use: 'label' },
    { className: 'headline', use: 'headline' },
    { className: 'body', use: 'body' },
    { className: 'cta', use: 'button' },
    { className: 'handle', use: 'handle' },
  ],
  composition: { align: 'flush-left', patterns: [] },
  imagery: {},
  voice: { description: '', dos: [], donts: [] },
  surfaces: { inverse: { ground: '#fff', ink: '#000' } },
} as unknown as BrandRecipe;

const pool: PoolAsset[] = [
  { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', key: 'a', width: 1600, height: 1000, tags: { kind: 'photo', subjects: ['car'], tone: 'dark', caption: 'a car', taggedAt: new Date() } },
  { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', key: 'b', width: 1200, height: 900, tags: { kind: 'screenshot', subjects: ['app'], tone: 'light', caption: 'the app', taggedAt: new Date() } },
];
const byHandle = new Map<string, PoolAsset>([
  ['p1', pool[0]!],
  ['p2', pool[1]!],
]);

const inputs: ComposeSlideInput[] = [
  { role: 'cover', format: '1080x1350', parts: { headline: 'Your foam is lying to you', eyebrow: 'Prep' }, photo: true, imageQuery: 'a car' },
  { role: 'list', format: '1080x1350', parts: { headline: 'Three things', rows: [{ text: 'One pass' }, { text: 'Two buckets' }] } },
  { role: 'cta', format: '1080x1350', parts: { headline: 'Send FOAM', cta: 'DM us FOAM' } },
];

describe('inventedWords — the designer may not write copy', () => {
  it('finds nothing when only the parts, numerals and marks are on the slide', () => {
    const html = '<div class="eyebrow">Prep</div><div class="headline">Your foam is lying to you</div><div class="dk-n">01 →</div>';
    expect(inventedWords(html, inputs[0]!.parts)).toEqual([]);
  });
  it('catches a label the copywriter never wrote', () => {
    const html = '<div class="headline">Your foam is lying to you</div><span class="dk-tag">Before</span>';
    expect(inventedWords(html, inputs[0]!.parts)).toEqual(['before']);
  });
  it('treats rows as copy and the handle as allowed', () => {
    const html = '<div class="headline">Three things</div><ul><li>One pass</li><li>Two buckets</li></ul><div class="handle">@brand</div>';
    expect(inventedWords(html, inputs[1]!.parts, ['@brand'])).toEqual([]);
  });
  it('straightens curly quotes before comparing', () => {
    const html = '<div class="headline">Don’t rinse</div>';
    expect(inventedWords(html, { headline: "Don't rinse" })).toEqual([]);
  });
});

describe('validateDesignPhotos', () => {
  it('fills a slot the slide carries, contain for a screenshot', () => {
    const html = '<figure class="cb-shot" data-cb-slot="proof"></figure>';
    const r = validateDesignPhotos([{ asset: 'p2', placement: 'slot', slot: 'proof', shape: 'wide' }], html, byHandle, true);
    expect(r.faults).toEqual([]);
    expect(r.photos[0]).toMatchObject({ placement: 'slot', slot: 'proof', fit: 'contain', shape: 'wide', mediaAssetId: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
  });
  it('refuses a screenshot as the frame, an unknown asset, a slot the slide lacks, and reports an empty slot', () => {
    const html = '<figure class="cb-shot" data-cb-slot="a"></figure>';
    const r = validateDesignPhotos(
      [
        { asset: 'p2', placement: 'background' },
        { asset: 'p9', placement: 'slot', slot: 'a' },
        { asset: 'p1', placement: 'slot', slot: 'zzz' },
      ],
      html,
      byHandle,
      true,
    );
    expect(r.photos).toEqual([]);
    expect(r.faults.join(' ')).toMatch(/screenshot/);
    expect(r.faults.join(' ')).toMatch(/p9/);
    expect(r.faults.join(' ')).toMatch(/zzz/);
    expect(r.faults.join(' ')).toMatch(/slot "a" was left empty/);
  });
  it('allows one photograph to own the frame, not two', () => {
    const r = validateDesignPhotos([{ asset: 'p1', placement: 'background' }, { asset: 'p1', placement: 'background' }], '', byHandle, true);
    expect(r.photos).toHaveLength(1);
    expect(r.faults).toEqual(['a second background picture was ignored']);
  });
});

describe('cleanDesignedHtml / unknownClasses / deckClasses', () => {
  it('unwraps a cb-slide wrapper, strips img and fences, sanitises', () => {
    const raw = '```html\n<div class="cb-slide"><div class="headline" style="color:red" onclick="x()">Hi</div><img src="https://x/y.png"><script>1</script></div>\n```';
    expect(cleanDesignedHtml(raw)).toBe('<div class="headline">Hi</div>');
  });
  it('names classes neither the brand nor the deck defines', () => {
    expect(unknownClasses('<div class="headline dk-big mystery cb-shot">x</div>', new Set(['headline']))).toEqual(['mystery']);
  });
  it('lists the deck classes a sheet defines', () => {
    expect([...deckClasses('.cb-slide .dk-a{x:y}.cb-slide .dk-b .headline{x:y}')]).toEqual(['dk-a', 'dk-b']);
  });
});

describe('finishDesignedDeck — the validators in order', () => {
  const env = { byHandle, tagged: true, model: 'test' };

  it('keeps a clean deck: slides, photos, surface, one inverse, the deck sheet', async () => {
    const raw = {
      rationale: 'A beat in the middle.',
      deckCss: '.cb-slide .dk-num{font-size:200px;color:var(--cb-accent)}',
      slides: [
        { html: '<div class="eyebrow">Prep</div><div class="headline">Your foam is lying to you</div>', photos: [{ asset: 'p1', placement: 'background' }], note: 'picture owns the frame' },
        { html: '<div class="headline">Three things</div><div class="dk-num">01</div><ul><li>One pass</li><li>Two buckets</li></ul>', inverse: true, surface: 'deep' },
        { html: '<div class="headline">Send FOAM</div><div class="cta">DM us FOAM</div>', align: 'center' },
      ],
    };
    const deck = await finishDesignedDeck(raw, { recipe, format: '1080x1350', type: 'carousel', inputs, pool }, env);
    expect(deck.fallbacks).toEqual([]);
    expect(deck.slides[0]!.photos[0]).toMatchObject({ placement: 'background' });
    expect(deck.slides[0]!.source).toBe('designer');
    expect(deck.slides[1]!.bg).toBe('inverse');
    expect(deck.slides[1]!.surface).toBe('deep');
    expect(deck.slides[2]!.align).toBe('center');
    expect(deck.deckCss).toContain('.dk-num');
    expect(deck.rationale).toBe('A beat in the middle.');
  });

  it('refuses inverse on the cover and on a second slide', async () => {
    const raw = {
      slides: [
        { html: '<div class="eyebrow">Prep</div><div class="headline">Your foam is lying to you</div>', inverse: true },
        { html: '<div class="headline">Three things</div><ul><li>One pass</li><li>Two buckets</li></ul>', inverse: true },
        { html: '<div class="headline">Send FOAM</div><div class="cta">DM us FOAM</div>', inverse: true },
      ],
    };
    const deck = await finishDesignedDeck(raw, { recipe, format: '1080x1350', type: 'carousel', inputs, pool }, env);
    expect(deck.slides.map((s) => s.bg)).toEqual([undefined, 'inverse', undefined]);
    expect(deck.notes.filter((n) => n.includes('inverse refused'))).toHaveLength(2);
  });

  it('sends a slide that lost or invented copy to the classic path, and notes it', async () => {
    const raw = {
      slides: [
        { html: '<div class="headline">Your foam is lying to you</div>' }, // eyebrow missing
        { html: '<div class="headline">Three things</div><ul><li>One pass</li><li>Two buckets</li></ul><span>Bonus tip</span>' }, // invented
        { html: '<div class="headline">Send FOAM</div><div class="cta">DM us FOAM</div>' },
      ],
    };
    const classic = async (input: ComposeSlideInput) => ({ html: `<div class="headline">${input.parts.headline}</div><!--classic-->`, source: 'fragment' as const });
    const deck = await finishDesignedDeck(raw, { recipe, format: '1080x1350', type: 'carousel', inputs, pool, classic }, env);
    expect(deck.fallbacks).toEqual([1, 2]);
    expect(deck.slides[0]!.source).toBe('fragment');
    expect(deck.slides[1]!.source).toBe('fragment');
    expect(deck.slides[2]!.source).toBe('designer');
    expect(deck.notes.some((n) => n.includes('copy not verbatim: eyebrow'))).toBe(true);
    expect(deck.notes.some((n) => n.includes('invented words: bonus'))).toBe(true);
  });

  it('strips an empty slot and an unknown class, and drops a deck sheet nothing uses', async () => {
    const raw = {
      deckCss: '.cb-slide .dk-unused{gap:1px}',
      slides: [
        { html: '<div class="eyebrow">Prep</div><div class="headline mystery">Your foam is lying to you</div><figure class="cb-shot" data-cb-slot="hero"></figure>' },
        { html: '<div class="headline">Three things</div><ul><li>One pass</li><li>Two buckets</li></ul>' },
        { html: '<div class="headline">Send FOAM</div><div class="cta">DM us FOAM</div>' },
      ],
    };
    const deck = await finishDesignedDeck(raw, { recipe, format: '1080x1350', type: 'carousel', inputs, pool }, env);
    expect(deck.slides[0]!.html).not.toContain('cb-shot');
    expect(deck.slides[0]!.html).not.toContain('mystery');
    expect(deck.deckCss).toBe('');
    expect(deck.notes.some((n) => n.includes('slot "hero" was left empty'))).toBe(true);
  });
});

describe('describeMeasured', () => {
  it('speaks the probe\'s verdicts', () => {
    const out = describeMeasured(
      [{ state: 'fits', slack: 0.1 }, { state: 'overflows' }, { state: 'fits', collide: true }, { state: 'fits', slack: 0.6 }, null],
      0.5,
    );
    expect(out).toEqual([
      'slide 2 overflows the canvas — something must go or get smaller',
      'slide 3: two elements collide',
      'slide 4: 60% of the frame is empty',
    ]);
  });
});

describe('what the first live run taught', () => {
  it('the brand mark split across inline tags is one word, and the brand\'s words are allowed', async () => {
    const { brandWords, inventedWords: invented } = await import('./designDeck');
    const html = '<div class="logo-row"><div class="wordmark"><b>detail</b><i>masters</i></div></div><div class="headline">Your foam is lying to you</div><div class="handle">detailmasters.pro</div>';
    expect(invented(html, { headline: 'Your foam is lying to you' }, brandWords({ brandName: 'detailmasters CRM', handle: 'detailmasters.pro' }))).toEqual([]);
  });
  it('a modifier the stylesheet styles is a known class', async () => {
    const { brandStyledClasses } = await import('./designDeck');
    const r = { ...recipe, stylesheet: '.cb-slide .headline.sm{font-size:40px}.cb-slide .panel.numbered .row{display:flex}' } as BrandRecipe;
    const known = brandStyledClasses(r, '1080x1350');
    expect(known.has('sm')).toBe(true);
    expect(known.has('numbered')).toBe(true);
    expect(known.has('row')).toBe(true);
    expect(known.has('headline')).toBe(true);
  });
});

describe('a zoomed screenshot', () => {
  it('keeps zoom and focal, clamped, and implies cover', () => {
    const html = '<figure class="cb-shot" data-cb-slot="proof"></figure>';
    const r = validateDesignPhotos([{ asset: 'p2', placement: 'slot', slot: 'proof', fit: 'contain', zoom: 4, focal: { x: 1.4, y: 0.3 } }], html, byHandle, true);
    expect(r.faults).toEqual([]);
    expect(r.photos[0]).toMatchObject({ zoom: 2.4, focal: { x: 1, y: 0.3 }, fit: 'cover' });
  });
  it('ignores a zoom of 1 and a malformed focal', () => {
    const html = '<figure class="cb-shot" data-cb-slot="proof"></figure>';
    const r = validateDesignPhotos([{ asset: 'p2', placement: 'slot', slot: 'proof', zoom: 1, focal: { x: 'a' } }], html, byHandle, true);
    expect(r.photos[0]).not.toHaveProperty('zoom');
    expect(r.photos[0]).not.toHaveProperty('focal');
    expect(r.photos[0]).toMatchObject({ fit: 'contain' });
  });
});

describe('the deck-device rung', () => {
  it('strips only dk- classes', async () => {
    const { stripDeckClasses, needsDeckStrip } = await import('./designDeck');
    expect(stripDeckClasses('<div class="dk-poster"><div class="headline sm dk-x">A</div></div>')).toBe('<div class=""><div class="headline sm">A</div></div>');
    // A device whose text sits in deck-only leaves is left whole: stripped, its words would be unclassed body text.
    const fork = '<div class="dk-fork"><div class="dk-side">Enzymes</div><div class="dk-or">or</div><div class="dk-side dk-alt">fragrance?</div></div>';
    expect(stripDeckClasses(fork)).toBe(fork);
    expect(stripDeckClasses('<div class="dk-fork">\n  <div class="headline dk-side">Enzymes</div></div>')).toBe('<div class="">\n  <div class="headline">Enzymes</div></div>');
    expect(needsDeckStrip({ state: 'fits', headlineLines: 5 }, 3)).toBe(true);
    expect(needsDeckStrip({ state: 'fits', headlineLines: 3 }, 3)).toBe(false);
    expect(needsDeckStrip({ state: 'overflows' })).toBe(true);
  });
  it('assigns an archetype to every designed slide', async () => {
    const raw = { slides: [
      { html: '<div class="eyebrow">Prep</div><div class="headline">Your foam is lying to you</div>', photos: [{ asset: 'p1', placement: 'background' }] },
      { html: '<div class="headline">Three things</div><ul><li>One pass</li><li>Two buckets</li></ul>' },
      { html: '<div class="headline">Send FOAM</div><div class="cta">DM us FOAM</div>' },
    ] };
    const deck = await finishDesignedDeck(raw, { recipe, format: '1080x1350', type: 'carousel', inputs, pool }, { byHandle, tagged: true, model: 'test' });
    expect(deck.slides.map((s) => s.archetype)).toEqual(['showcase', 'list', 'cta']);
  });
});
