import { describe, expect, it } from 'vitest';
import {
  APP_IMAGE_CLASSES,
  hiddenSlotCss,
  reservedSlotCss,
  PLATE_CLASS,
  SLOT_ATTR,
  SLOT_CLASS,
  SLOT_SHAPES,
  authoredSlots,
  slotOverrideCss,
  emptySlotCss,
  filledSlotCss,
  isSlotName,
  slideMediaCss,
} from './slidePhotos';
import { slidePhotoSchema, slideSchema } from './schemas';

describe('authoredSlots', () => {
  it('finds slots in document order', () => {
    const html = `<figure class="cb-shot" ${SLOT_ATTR}="before"></figure><p>x</p><figure ${SLOT_ATTR}="after"></figure>`;
    expect(authoredSlots(html)).toEqual(['before', 'after']);
  });

  it('de-dupes a repeated name', () => {
    const html = `<figure ${SLOT_ATTR}="hero"></figure><figure ${SLOT_ATTR}="hero"></figure>`;
    expect(authoredSlots(html)).toEqual(['hero']);
  });

  it('drops names outside the slot alphabet', () => {
    // A name that survived into markup unsanitised must not reach a selector.
    const html = `<figure ${SLOT_ATTR}='a"] , [x'></figure><figure ${SLOT_ATTR}="ok-1"></figure>`;
    expect(authoredSlots(html)).toEqual(['ok-1']);
  });

  it('is empty for markup with no slots', () => {
    expect(authoredSlots('<h1 class="headline">Hi</h1>')).toEqual([]);
    expect(authoredSlots('')).toEqual([]);
  });
});

describe('isSlotName', () => {
  it('accepts lowercase names with digits, hyphens and underscores', () => {
    expect(isSlotName('hero')).toBe(true);
    expect(isSlotName('before-2')).toBe(true);
    expect(isSlotName('a_b')).toBe(true);
  });

  it('rejects anything that could break out of a selector', () => {
    expect(isSlotName('Hero')).toBe(false); // uppercase
    expect(isSlotName('a"]')).toBe(false);
    expect(isSlotName('a b')).toBe(false);
    expect(isSlotName('')).toBe(false);
    expect(isSlotName('-lead')).toBe(false); // must start alphanumeric
    expect(isSlotName('x'.repeat(41))).toBe(false);
  });
});

/**
 * The shape guarantee. A `max-height` on a `width:100%` element with an
 * `aspect-ratio` does not shrink it, it RESHAPES it — which silently turned
 * `tall` (3:4 portrait) into 1.34:1 landscape on every post. These assert the
 * ratio survives on every canvas, by emulating what the browser resolves:
 * width = min(column, max-width), then height = width / ratio.
 */
describe('slot shapes survive their height budget', () => {
  const resolve = (css: string, cls: string, column: number, ratio: number) => {
    const sel = cls ? `\\.cb-shot\\.${cls}` : '\\.cb-shot(?!\\.)';
    const m = css.match(new RegExp(`${sel}\\{[^}]*max-width:(\\d+)px;max-height:(\\d+)px`));
    if (!m) throw new Error(`no rule for .cb-shot${cls ? '.' + cls : ''}`);
    const w = Math.min(column, Number(m[1]));
    return { w, h: Math.min(w / ratio, Number(m[2])) };
  };

  for (const [label, canvasH, column] of [
    ['post 4:5', 1350, 904],
    ['story 9:16', 1920, 904],
    ['square 1:1', 1080, 936],
  ] as const) {
    it(`holds every shape on ${label}`, () => {
      const css = slideMediaCss(canvasH);
      for (const [cls, { ratio }] of Object.entries(SLOT_SHAPES)) {
        const { w, h } = resolve(css, cls, column, ratio);
        expect(w / h).toBeCloseTo(ratio, 1);
        // …and still fits the canvas it was budgeted against.
        expect(h).toBeLessThanOrEqual(canvasH * 0.55);
      }
    });
  }

  it('caps the WIDTH, since capping the height is what broke the ratio', () => {
    const css = slideMediaCss(1350);
    expect(css).toMatch(/\.cb-shot\.tall\{[^}]*max-width:\d+px/);
  });

  it('sizes the budget against the canvas it is given', () => {
    const post = slideMediaCss(1350);
    const story = slideMediaCss(1920);
    const w = (css: string) => Number(css.match(/\.cb-shot\.tall\{[^}]*max-width:(\d+)px/)![1]);
    expect(w(story)).toBeGreaterThan(w(post));
  });

  it('centres pictures only for a centred brand', () => {
    expect(slideMediaCss(1350, 'center')).toContain('margin-inline:auto');
    expect(slideMediaCss(1350, 'flush-left')).not.toContain('margin-inline:auto');
  });
});

describe('slot CSS', () => {
  it('scopes the fill rule to the instance and the slot', () => {
    const css = filledSlotCss('cbs1', 'hero', 'https://x/y.jpg', 'contain');
    expect(css).toContain(`.cbs1 .cb-slide [${SLOT_ATTR}="hero"]`);
    expect(css).toContain('background-image:url("https://x/y.jpg")');
    expect(css).toContain('background-size:contain');
  });

  it('centres the crop by default and honours a focal point when set', () => {
    expect(filledSlotCss('cbs1', 'hero', 'u', 'cover')).toContain('background-position:50.0% 50.0%');
    const off = filledSlotCss('cbs1', 'hero', 'u', 'cover', { x: 0.25, y: 0.1 });
    expect(off).toContain('background-position:25.0% 10.0%');
  });

  it('gives an empty slot a visible target', () => {
    const css = emptySlotCss('cbs1', 'hero');
    expect(css).toContain('dashed');
    expect(css).toContain('Add photo');
  });

  it('ships the structural slot + overlay layer with every recipe', () => {
    const css = slideMediaCss();
    expect(css).toContain('.cb-slide .cb-shot');
    expect(css).toContain('aspect-ratio:16/9'); // the `wide` shape
    expect(css).toContain('.cb-free-layer');
    // The empty-slot look is emitted per slot by the renderer, never globally —
    // otherwise it would out-specify the fill and sit on top of the photo.
    expect(css).not.toContain('Add photo');
  });
});

describe('slidePhotoSchema', () => {
  const base = { id: 'p1', mediaAssetId: '65a000000000000000000001' };

  it('accepts a slot fill', () => {
    const r = slidePhotoSchema.parse({ ...base, placement: 'slot', slot: 'hero', fit: 'cover' });
    expect(r.placement).toBe('slot');
    expect(r.slot).toBe('hero');
  });

  it('accepts a free overlay with a fractional frame', () => {
    const r = slidePhotoSchema.parse({
      ...base,
      placement: 'free',
      frame: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
      z: -1,
    });
    expect(r.frame).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
    expect(r.z).toBe(-1);
  });

  it('accepts a focal point and rejects one off the image', () => {
    expect(slidePhotoSchema.parse({ ...base, placement: 'slot', slot: 'a', focal: { x: 0.2, y: 0.8 } }).focal)
      .toEqual({ x: 0.2, y: 0.8 });
    expect(() => slidePhotoSchema.parse({ ...base, focal: { x: 1.4, y: 0 } })).toThrow();
  });

  it('rejects a frame outside the canvas', () => {
    expect(() =>
      slidePhotoSchema.parse({ ...base, placement: 'free', frame: { x: -1, y: 0, w: 1, h: 1 } }),
    ).toThrow();
  });

  it('falls back rather than failing on placement/fit drift', () => {
    const r = slidePhotoSchema.parse({ ...base, placement: 'nonsense', fit: 'squish' });
    expect(r.placement).toBe('free');
    expect(r.fit).toBe('cover');
  });
});

describe('slideSchema photos', () => {
  it('defaults to an empty list so old slides still parse', () => {
    const r = slideSchema.parse({});
    expect(r.photos).toEqual([]);
  });

  it('carries photos through', () => {
    const r = slideSchema.parse({
      photos: [
        { id: 'a', mediaAssetId: '65a000000000000000000001', placement: 'background', fit: 'cover' },
      ],
    });
    expect(r.photos).toHaveLength(1);
    expect(r.photos[0]!.placement).toBe('background');
  });
});

/**
 * A resize is emitted as an override on top of the base shape rule, so it has
 * to WIN the cascade. It first shipped without `.cb-shot` in the selector,
 * which made it (0,3,0) against the base rule's (0,4,0) — the CSS was emitted,
 * parsed, and silently ignored, and the size controls did nothing at all.
 */
describe('slotOverrideCss', () => {
  const specificity = (sel: string) => (sel.match(/\.[a-z-]+/g) ?? []).length + (sel.match(/\[/g) ?? []).length;

  it('out-specifies the base shape rule it has to override', () => {
    const override = slotOverrideCss('cbs1', 'hero', 'tall', 'md', 1350);
    const base = `.cbs1 .cb-slide .${SLOT_CLASS}.tall`;
    expect(specificity(override.split('{')[0]!)).toBeGreaterThanOrEqual(specificity(base));
    expect(override).toContain(`.${SLOT_CLASS}[${SLOT_ATTR}="hero"]`);
  });

  it('emits nothing when the photo has no resize of its own', () => {
    expect(slotOverrideCss('cbs1', 'hero', undefined, undefined, 1350)).toBe('');
  });

  it('keeps the requested ratio at every size step', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const css = slotOverrideCss('cbs1', 'hero', 'tall', size, 1350);
      const [, w, h] = css.match(/max-width:(\d+)px;max-height:(\d+)px/)!;
      expect(Number(w) / Number(h)).toBeCloseTo(3 / 4, 1);
    }
  });

  it('actually changes the size between steps', () => {
    const w = (size: 'sm' | 'md' | 'lg') =>
      Number(slotOverrideCss('cbs1', 'hero', 'square', size, 1350).match(/max-width:(\d+)px/)![1]);
    expect(w('sm')).toBeLessThan(w('md'));
    expect(w('md')).toBeLessThan(w('lg'));
  });
});

/**
 * The list layout. A flex row could not promise a hanging indent — the marker
 * and the item were siblings in one line box, so a long item wrapped back
 * underneath the bullet. Grid puts the marker in its own gutter, which is what
 * makes every line of the item (and its supporting detail) share a left edge.
 */
describe('enumeration rows', () => {
  const css = slideMediaCss(1350);

  it('lays a row out as a grid, not a flex line', () => {
    expect(css).toMatch(/\.row\.row\{[^}]*display:grid/);
    expect(css).toMatch(/\.row\.row\{[^}]*grid-template-columns:auto minmax\(0,1fr\)/);
  });

  it('supplies the gutter marker itself, so a row with no marker still aligns', () => {
    // The gutter is ours; the glyph is the brand's to choose.
    expect(css).toMatch(/\.row\.row::before\{[^}]*content:var\(--cb-marker,"—"\)/);
    expect(css).toMatch(/\.row\.row::before\{[^}]*grid-column:1/);
  });

  it('steps aside for a brand that authored a real marker — named as one', () => {
    // By CLASS, not by tag. "Any non-empty <span> is a bullet" also swallowed
    // the quiet detail `<span class="sm">`, which is the commonest way a recipe
    // writes one.
    expect(css).toMatch(/\.row\.row:has\(> \.tick:not\(:empty\)\)::before[^{]*\{content:none\}/);
    expect(css).toContain('.cb-slide .row.row:has(> .bullet:not(:empty))::before');
    expect(css).not.toContain(':has(> span:not(:empty))');
  });

  it('puts a marker element in the gutter, whatever the brand calls it', () => {
    const rule = css.match(/\.cb-slide \.row\.row > \.tick[^{]*\{([^}]*)\}/)![1]!;
    expect(rule).toContain('grid-column:1');
    expect(rule).toContain('grid-row:1');
  });

  it('gives an empty marker element no space — it was a phantom gap', () => {
    expect(css).toContain('.cb-slide .row.row > span:empty{display:none}');
  });

  it('puts the supporting detail in the ITEM column, never pushed right', () => {
    const rule = css.match(/\.cb-slide \.row\.row > em[^{]*\{([^}]*)\}/)![1]!;
    expect(rule).toContain('grid-column:2');
    // The brand's own `margin-left:auto` is what made it drift.
    expect(rule).toContain('margin-left:0');
  });

  it('recognises a detail named by class, not only one written as <em>', () => {
    // The real failure: `<div class="row">Item<span class="sm">detail</span></div>`
    // auto-placed the detail into the marker's narrow gutter column, where it
    // wrapped a word or two at a time down the right-hand side of the panel.
    const rule = css.match(/\.cb-slide \.row\.row > \.sm[^{]*\{([^}]*)\}/)![1]!;
    expect(rule).toContain('grid-column:2');
    expect(rule).toContain('margin-left:0');
    for (const cls of ['.note', '.detail', '.sub', '.meta']) {
      expect(css).toContain(`.cb-slide .row.row > ${cls}`);
    }
    // …and it must NOT be forced upright: only the <em>/<i> tags carry an
    // italic the row never asked for.
    expect(rule).not.toContain('font-style');
  });

  it('out-specifies the brand rule it has to override', () => {
    // `.cb-slide .panel .row` is (0,3,0); a bare `.cb-slide .row` would lose.
    expect(css).not.toMatch(/\.cb-slide \.row\{/);
  });
});

describe('plate slots', () => {
  const css = slideMediaCss(1920);

  /**
   * The brand's own treatment is `.cb-slide .cb-shot::after` at (0,2,1) and a
   * brand may write something more specific, so the override is doubled to
   * (0,4,1) rather than relying on source order alone.
   */
  it('kills the brand photo treatment for a plate, at higher specificity', () => {
    expect(css).toContain(`.cb-slide .${SLOT_CLASS}.${PLATE_CLASS}.${PLATE_CLASS}::after`);
    expect(css).toMatch(/\.cb-plate\.cb-plate::after\{display:none;content:none\}/);
  });

  it('gives the plate an edge, so it reads as a card without a scrim', () => {
    expect(css).toMatch(/\.cb-slide \.cb-shot\.cb-plate\{[^}]*box-shadow/);
  });

  it('declares the plate class as app-owned, so consistency checks ignore it', () => {
    expect(APP_IMAGE_CLASSES).toContain(PLATE_CLASS);
  });
})

describe('an unfilled slot outside the editor', () => {
  /**
   * Suppressing the "Add photo" label was not enough, and an export proved it:
   * the slot still painted its own box — the base tint from `slideMediaCss` and
   * the brand's `.cb-shot::after` treatment — so a cover with an empty slot
   * exported as a translucent rectangle across the middle of the photograph
   * behind it.
   */
  it('is removed outright, not merely unlabelled', () => {
    const css = hiddenSlotCss('cb1', 'hero');
    expect(css).toContain('display:none');
  });

  it('reserves the box, without painting it, for a measurement pass', () => {
    // A layout measurement has no photos attached. With the slot removed the
    // deck was gated as if its pictures did not exist: the same feature slide
    // measured `overflow: false` with the slot hidden and `overflow: true` with
    // it reserved, its 459px shot landing 51px past the content bottom.
    const css = reservedSlotCss('cb1', 'hero');
    expect(css).toContain('visibility:hidden');
    expect(css).not.toContain('display:none');
    expect(css).toContain(`[${SLOT_ATTR}="hero"]`);
  });

  it('reserves no vertical space either', () => {
    // `display:none` rather than transparency: a picture that was never
    // supplied should cost the layout nothing.
    expect(hiddenSlotCss('cb1', 'hero')).not.toMatch(/opacity|visibility|transparent/);
  });

  it('targets exactly one slot in exactly one slide scope', () => {
    const css = hiddenSlotCss('cb1', 'hero');
    expect(css).toContain(`.cb1 .cb-slide [${SLOT_ATTR}="hero"]`);
    expect(css).not.toContain('"art"');
  });

  it('is a different rule from the editor affordance', () => {
    // The editor still wants the dashed box and the label — that is how someone
    // knows a slot is there to fill.
    expect(emptySlotCss('cb1', 'hero')).toContain('Add photo');
    expect(hiddenSlotCss('cb1', 'hero')).not.toContain('Add photo');
  });
})
