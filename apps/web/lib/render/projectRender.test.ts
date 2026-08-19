import { describe, it, expect } from 'vitest';
import type { BrandKit, MediaAsset, Slide } from '@contentbuilder/shared';
import { toRenderKit, resolveSlidePhotos } from './projectRender';

const kit = {
  _id: 'k1',
  businessId: 'b1',
  colors: {
    primary: '#C9A66B',
    secondary: '#4A5568',
    accent: '#E3C48D',
    background: '#0D1017',
    text: '#F5F3EF',
    palette: ['#0D1017', '#C9A66B'],
  },
  fonts: { detected: { heading: 'x', body: 'y' }, render: { heading: 'Playfair Display', body: 'Inter' } },
  logo: { url: 'http://x/logo.png', key: 'logo' },
  logoTreatment: 'mono',
  styleDescriptor: '',
  provenance: {},
  status: 'approved',
  createdAt: '',
} as unknown as BrandKit;

const media: MediaAsset[] = [
  { _id: 'm1', businessId: 'b1', type: 'upload', key: 'a', url: 'http://x/a.png', width: 100, height: 100, createdAt: '' },
  { _id: 'm2', businessId: 'b1', type: 'upload', key: 'b', url: 'http://x/b.png', width: 100, height: 100, createdAt: '' },
];

describe('toRenderKit', () => {
  it('maps colors/fonts/logo and falls back when kit is null', () => {
    const r = toRenderKit(kit);
    expect(r.colors.primary).toBe('#C9A66B');
    expect(r.fonts.render.heading).toBe('Playfair Display');
    expect(r.logo?.url).toBe('http://x/logo.png');
    expect(r.logoTreatment).toBe('mono');
    expect(toRenderKit(null).colors.background).toBe('#0e1116'); // fallback
  });
});

// `photos[]` is the only source of a slide's pictures — the slide-level
// `mediaAssetId` was migrated into it and retired.
describe('resolveSlidePhotos', () => {
  it('resolves a background photo onto the background layer', () => {
    const slide = {
      photos: [{ id: 'p1', mediaAssetId: 'm1', placement: 'background', fit: 'cover' }],
    } as unknown as Slide;
    expect(resolveSlidePhotos(slide, media).background).toMatchObject({ url: 'http://x/a.png', fit: 'cover' });
  });
  it('skips a photo whose asset is gone, and has no layers without photos', () => {
    const gone = { photos: [{ id: 'p1', mediaAssetId: 'nope', placement: 'background' }] } as unknown as Slide;
    expect(resolveSlidePhotos(gone, media).background).toBeUndefined();
    expect(resolveSlidePhotos({ photos: [] } as unknown as Slide, media).background).toBeUndefined();
  });
});

describe('a slot whose photo has no image behind it', () => {
  const slide = (photos: unknown[]) => ({ id: 's', order: 0, photos } as never);

  it('keeps the geometry so a measurement can reserve the right space', () => {
    // A layout measurement runs against a project with no media. Every slot came
    // back unresolved and was reserved at DEFAULT size, which over-reported the
    // slides someone had already hand-tuned: one shipped slide renders clean at
    // `wide`/`sm` and was flagged as overflowing for exactly that reason.
    const out = resolveSlidePhotos(
      slide([{ id: 'a', mediaAssetId: 'missing', placement: 'slot', slot: 'hero', shape: 'wide', size: 'sm' }]),
      [],
    );
    expect(out.slots.hero).toBeUndefined(); // no image — nothing to paint
    expect(out.reserve?.hero).toEqual({ shape: 'wide', size: 'sm' });
  });

  it('records nothing for a resolvable photo — that one is simply filled', () => {
    const out = resolveSlidePhotos(
      slide([{ id: 'a', mediaAssetId: 'm1', placement: 'slot', slot: 'hero', shape: 'wide', size: 'sm' }]),
      [{ _id: 'm1', url: 'http://x/y.png' }] as never,
    );
    expect(out.slots.hero?.url).toBe('http://x/y.png');
    expect(out.reserve).toBeUndefined();
  });

  it('ignores a missing background or free overlay — only a slot reserves space', () => {
    const out = resolveSlidePhotos(
      slide([{ id: 'a', mediaAssetId: 'missing', placement: 'background', shape: 'wide' }]),
      [],
    );
    expect(out.reserve).toBeUndefined();
  });
})
