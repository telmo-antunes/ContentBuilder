import { describe, it, expect } from 'vitest';
import type { BrandKit, MediaAsset, Slide } from '@contentbuilder/shared';
import { toRenderKit, resolveSlideImage } from './projectRender';

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

describe('resolveSlideImage', () => {
  it('returns null without a mediaAssetId', () => {
    expect(resolveSlideImage({ mediaAssetId: undefined } as Slide, media)).toBeNull();
  });
  it('resolves the asset url and threads focal/treatment overrides', () => {
    const slide = {
      mediaAssetId: 'm1',
      overrides: { focalPoint: { x: 0.3, y: 0.7 }, imageTreatment: 'tint' },
    } as unknown as Slide;
    const img = resolveSlideImage(slide, media);
    expect(img).toMatchObject({ url: 'http://x/a.png', treatment: 'tint' });
    expect(img!.focalPoint).toEqual({ x: 0.3, y: 0.7 });
  });
  it('returns null when the asset is missing', () => {
    expect(resolveSlideImage({ mediaAssetId: 'gone' } as unknown as Slide, media)).toBeNull();
  });
});
