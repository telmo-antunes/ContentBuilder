import type { BrandKit, MediaAsset, PhotoMove, Slide } from '@contentbuilder/shared';
import type { RenderBrandKit } from './types';

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

/** Map the persisted brand kit to the shape the layout components consume.
 *  `recipeOverride` is the project's pinned `recipeSnapshot`, when it has one —
 *  a shipped deck keeps rendering under the recipe it was approved with, no
 *  matter what the kit's live recipe has since become. */
export function toRenderKit(kit: BrandKit | null | undefined, recipeOverride?: BrandKit['recipe']): RenderBrandKit {
  if (!kit) return FALLBACK_KIT;
  return {
    colors: kit.colors,
    fonts: { render: kit.fonts.render },
    logo: kit.logo?.url ? { url: kit.logo.url } : undefined,
    logoTreatment: kit.logoTreatment,
    recipe: recipeOverride ?? kit.recipe,
  };
}

/** One of the user's photos, resolved to a URL the renderer can paint. */
export interface ResolvedPhoto {
  id: string;
  url: string;
  fit: 'cover' | 'contain';
  /** Which part of the photo survives the crop; centre when unset. */
  focal?: { x: number; y: number };
  /** How it drifts in a video export; undefined follows the brand. */
  move?: PhotoMove;
  /** 'slot': a resize of the authored hole. */
  shape?: 'standard' | 'wide' | 'square' | 'tall';
  size?: 'sm' | 'md' | 'lg';
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
  /**
   * Slot name → the SHAPE a photo would occupy there, for slots whose photo
   * could not be resolved to an image.
   *
   * A layout measurement runs against a throwaway project that carries no media,
   * so every slot came back unresolved and was reserved at the DEFAULT geometry
   * — which over-reports any slide whose photo was deliberately shrunk. One
   * shipped slide rendered clean in production at `wide`/`sm` and was flagged as
   * overflowing by the check for exactly that reason. Keeping the geometry when
   * the image is missing lets the reserve match what actually ships.
   */
  reserve?: Record<string, { shape?: ResolvedPhoto['shape']; size?: ResolvedPhoto['size'] }>;
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
    if (!asset?.url) {
      // No image, but the slide still says how big one would be. Worth keeping:
      // a measurement pass reserves that space, and a slot whose asset was
      // deleted from the library holds its place instead of collapsing.
      if (p.placement === 'slot' && p.slot) {
        out.reserve = { ...(out.reserve ?? {}), [p.slot]: { shape: p.shape, size: p.size } };
      }
      continue;
    }
    const resolved: ResolvedPhoto = {
      id: p.id,
      url: asset.url,
      fit: p.fit === 'contain' ? 'contain' : 'cover',
      focal: p.focal,
      move: p.motion,
      shape: p.shape,
      size: p.size,
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

