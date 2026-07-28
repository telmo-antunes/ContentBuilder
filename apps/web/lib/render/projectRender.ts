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
    recipe: kit.recipe,
  };
}

/** One of the user's photos, resolved to a URL the renderer can paint. */
export interface ResolvedPhoto {
  id: string;
  url: string;
  fit: 'cover' | 'contain';
  frame?: { x: number; y: number; w: number; h: number };
  z: number;
  alt?: string;
}

/** A slide's photos, split into the three layers the renderer paints. */
export interface SlidePhotoSet {
  /** Full-bleed behind the composition. */
  background?: ResolvedPhoto;
  /** Slot name → the photo filling that authored placeholder. */
  slots: Record<string, ResolvedPhoto>;
  /** Absolutely-positioned overlays, in paint order. */
  free: ResolvedPhoto[];
}

const EMPTY_PHOTOS: SlidePhotoSet = { slots: {}, free: [] };

/**
 * Resolve a slide's photos into the three render layers. Photos whose asset is
 * missing are skipped rather than rendered as broken images — an asset can be
 * deleted from the library while a slide still points at it.
 */
export function resolveSlidePhotos(slide: Slide, media: MediaAsset[]): SlidePhotoSet {
  const photos = slide.photos ?? [];
  if (!photos.length) return EMPTY_PHOTOS;
  const out: SlidePhotoSet = { slots: {}, free: [] };
  for (const p of photos) {
    const asset = media.find((m) => m._id === p.mediaAssetId);
    if (!asset?.url) continue;
    const resolved: ResolvedPhoto = {
      id: p.id,
      url: asset.url,
      fit: p.fit === 'contain' ? 'contain' : 'cover',
      frame: p.frame,
      z: p.z ?? 1,
      alt: p.alt,
    };
    if (p.placement === 'background') out.background = resolved;
    else if (p.placement === 'slot' && p.slot) out.slots[p.slot] = resolved;
    else if (p.frame) out.free.push(resolved);
  }
  out.free.sort((a, b) => a.z - b.z);
  return out;
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
