import type { BrandKit, MediaAsset, Slide } from '@contentbuilder/shared';
import type { ImageLayoutConfig, LayoutImage, RenderBrandKit } from './types';

/** Neutral fallback kit (used only if a project somehow lacks an approved kit). */
const FALLBACK_KIT: RenderBrandKit = {
  colors: {
    primary: '#4f8cff',
    secondary: '#222831',
    accent: '#4f8cff',
    background: '#0e1116',
    text: '#f2f4f8',
    palette: ['#0e1116', '#222831', '#4f8cff', '#f2f4f8'],
  },
  fonts: { render: { heading: 'Montserrat', body: 'Inter' } },
};

/** Map the persisted brand kit to the shape the layout components consume. */
export function toRenderKit(kit: BrandKit | null | undefined): RenderBrandKit {
  if (!kit) return FALLBACK_KIT;
  return {
    colors: kit.colors,
    fonts: { render: kit.fonts.render },
    logo: kit.logo?.url ? { url: kit.logo.url } : undefined,
    logoTreatment: kit.logoTreatment,
  };
}

/** Resolve a slide's attached image (by mediaAssetId) into a LayoutImage. */
export function resolveSlideImage(slide: Slide, media: MediaAsset[]): LayoutImage | null {
  if (!slide.mediaAssetId) return null;
  const asset = media.find((m) => m._id === slide.mediaAssetId);
  if (!asset) return null;
  return {
    url: asset.url,
    focalPoint: slide.overrides?.focalPoint,
    treatment: slide.overrides?.imageTreatment,
    zoom: slide.overrides?.imageZoom,
  };
}

/** Image layout knobs for a slide (split orientation/order, aspect, size, fit). */
export function resolveImageLayout(slide: Slide, media: MediaAsset[] = []): ImageLayoutConfig {
  const objects = slide.overrides?.imageObjects?.map((o) => ({
    frame: o.frame,
    fit: o.fit,
    url: o.mediaAssetId ? media.find((m) => m._id === o.mediaAssetId)?.url : undefined,
    focalPoint: o.crop ? { x: o.crop.x, y: o.crop.y } : undefined,
    zoom: o.crop?.zoom,
  }));
  return {
    split: slide.overrides?.split,
    aspect: slide.overrides?.imageAspect,
    size: slide.overrides?.imageSize,
    fit: slide.overrides?.imageFit,
    imageFrame: slide.overrides?.imageFrame,
    background: slide.overrides?.imageBackground,
    backgroundUrl: slide.overrides?.backgroundMediaAssetId
      ? media.find((m) => m._id === slide.overrides?.backgroundMediaAssetId)?.url
      : undefined,
    objects,
    decorations: slide.overrides?.decorations,
  };
}
