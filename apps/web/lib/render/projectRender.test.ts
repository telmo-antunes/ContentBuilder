import { describe, it, expect } from 'vitest';
import type { BrandKit, MediaAsset, Slide } from '@contentbuilder/shared';
import { toRenderKit, resolveSlideImage, resolveImageLayout } from './projectRender';

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
  it('resolves the asset url and threads focal/treatment/zoom overrides', () => {
    const slide = {
      mediaAssetId: 'm1',
      overrides: { focalPoint: { x: 0.3, y: 0.7 }, imageTreatment: 'tint', imageZoom: 1.5 },
    } as unknown as Slide;
    const img = resolveSlideImage(slide, media);
    expect(img).toMatchObject({ url: 'http://x/a.png', treatment: 'tint', zoom: 1.5 });
    expect(img!.focalPoint).toEqual({ x: 0.3, y: 0.7 });
  });
  it('returns null when the asset is missing', () => {
    expect(resolveSlideImage({ mediaAssetId: 'gone' } as unknown as Slide, media)).toBeNull();
  });
});

describe('resolveImageLayout', () => {
  it('resolves a background media id to its url', () => {
    const slide = { overrides: { backgroundMediaAssetId: 'm2' } } as unknown as Slide;
    expect(resolveImageLayout(slide, media).backgroundUrl).toBe('http://x/b.png');
  });
  it('maps image objects with crop → focalPoint/zoom', () => {
    const slide = {
      overrides: { imageObjects: [{ id: 'o', mediaAssetId: 'm1', frame: { x: 0, y: 0, w: 0.5, h: 0.5 }, crop: { x: 0.2, y: 0.4, zoom: 2 } }] },
    } as unknown as Slide;
    const layout = resolveImageLayout(slide, media);
    expect(layout.objects?.[0]).toMatchObject({ url: 'http://x/a.png', zoom: 2 });
    expect(layout.objects?.[0]!.focalPoint).toEqual({ x: 0.2, y: 0.4 });
  });
});
