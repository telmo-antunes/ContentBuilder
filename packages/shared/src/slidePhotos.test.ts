import { describe, expect, it } from 'vitest';
import {
  SLOT_ATTR,
  authoredSlots,
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

describe('slot CSS', () => {
  it('scopes the fill rule to the instance and the slot', () => {
    const css = filledSlotCss('cbs1', 'hero', 'https://x/y.jpg', 'contain');
    expect(css).toContain(`.cbs1 .cb-slide [${SLOT_ATTR}="hero"]`);
    expect(css).toContain('background-image:url("https://x/y.jpg")');
    expect(css).toContain('background-size:contain');
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
    const r = slideSchema.parse({ layoutType: 'TextOnly' });
    expect(r.photos).toEqual([]);
  });

  it('carries photos through', () => {
    const r = slideSchema.parse({
      layoutType: 'TextOnly',
      photos: [
        { id: 'a', mediaAssetId: '65a000000000000000000001', placement: 'background', fit: 'cover' },
      ],
    });
    expect(r.photos).toHaveLength(1);
    expect(r.photos[0]!.placement).toBe('background');
  });
});
