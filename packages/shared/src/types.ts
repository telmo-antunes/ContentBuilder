import type { Block, BlockFrame } from './blocks';
import type { LayoutType } from './layouts';
import type { AssetType, Format } from './formats';
import type { BusinessProfile } from './profile';
import type { ImageTreatment, LogoTreatment, ThemePreset } from './theme';

/**
 * Provider-agnostic media reference. Every stored asset (logo, upload,
 * screenshot, rendered PNG) is recorded as `{ key, url }` — never a raw disk
 * path — so DiskStorageProvider today and CloudinaryStorageProvider later
 * require no schema change.
 */
export interface StoredMedia {
  key: string;
  url: string;
}

export interface Business {
  _id: string;
  name: string;
  websiteUrl?: string;
  profile?: BusinessProfile;
  createdAt: string;
}

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  palette: string[];
}

export interface BrandFonts {
  detected: { heading: string; body: string };
  /** Bundled render fonts — what export actually uses. */
  render: { heading: string; body: string };
}

export interface BrandProvenance {
  colors: string; // "sampled"
  fonts: string; // "computed+mapped"
  roles: string; // "vision" | "heuristic"
  logo: string; // "dom" | "manual"
}

export type BrandKitStatus = 'draft' | 'approved';

export interface BrandKit {
  _id: string;
  businessId: string;
  colors: BrandColors;
  fonts: BrandFonts;
  logo?: { sourceUrl?: string } & Partial<StoredMedia>;
  /** How the logo is rendered on slides (default 'original'). */
  logoTreatment?: LogoTreatment;
  styleDescriptor: string;
  homepageScreenshot?: StoredMedia;
  provenance: BrandProvenance;
  status: BrandKitStatus;
  createdAt: string;
}

export interface MediaAsset {
  _id: string;
  businessId: string;
  type: 'upload';
  key: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
}

export type ImageNeed = 'none' | 'upload';

/** SplitImageText: which edge the image occupies — sets orientation AND order. */
export type SplitPlacement = 'image-left' | 'image-right' | 'image-top' | 'image-bottom';
export const SPLIT_PLACEMENTS: readonly SplitPlacement[] = [
  'image-left',
  'image-right',
  'image-top',
  'image-bottom',
];

/** Aspect ratio of a framed in-post image (CenteredHero). */
export type ImageAspect = 'square' | 'landscape' | 'wide' | 'portrait';
export const IMAGE_ASPECTS: readonly ImageAspect[] = ['square', 'landscape', 'wide', 'portrait'];

/** How large the framed image is within the slide (CenteredHero). */
export type ImageSizePreset = 'sm' | 'md' | 'lg';
export const IMAGE_SIZES: readonly ImageSizePreset[] = ['sm', 'md', 'lg'];

/** How an image fills its slot: 'cover' crops to fill, 'contain' shows it whole. */
export type ImageFit = 'cover' | 'contain';

/** A positioned image element on a FreePosition card (its own uploaded media). */
export interface ImageObject {
  id: string;
  mediaAssetId?: string;
  frame: BlockFrame;
  fit?: ImageFit;
  /** Crop: pan focal point in [0..1] + zoom (≥1 zooms in within the frame). */
  crop?: { x: number; y: number; zoom: number };
}

/** Optional per-slide manual tweaks. */
export interface SlideOverrides {
  /** Image focal point as fractions [0..1] for object-position when cropping. */
  focalPoint?: { x: number; y: number };
  /** Cohesion treatment applied to the slide's image (default 'none'). */
  imageTreatment?: ImageTreatment;
  /** Per-slide theme; falls back to the project theme when unset. */
  theme?: ThemePreset;
  /** SplitImageText: image placement (orientation + order). Defaults by format. */
  split?: SplitPlacement;
  /** CenteredHero: aspect ratio of the framed image (default 'square'). */
  imageAspect?: ImageAspect;
  /** CenteredHero: size of the framed image (default 'md'). */
  imageSize?: ImageSizePreset;
  /** How the image fills its slot (default 'cover'). 'contain' shows the whole image. */
  imageFit?: ImageFit;
  /** Zoom (≥1) for the slide's image; pairs with focalPoint for a crop. */
  imageZoom?: number;
  /** FreePosition: the canvas region (fractions) where the slide's image renders. */
  imageFrame?: BlockFrame;
  /** FreePosition: render the image full-bleed behind the elements (ignores imageFrame). */
  imageBackground?: boolean;
  /** FreePosition: additional positioned image elements, each with its own media. */
  imageObjects?: ImageObject[];
}

export interface Slide {
  id: string;
  order: number;
  layoutType: LayoutType;
  blocks: Block[];
  imageNeed: ImageNeed;
  mediaAssetId?: string;
  overrides?: SlideOverrides;
}

export type ProjectStatus = 'draft' | 'rendered';

/** Per-project render settings (theme + carousel cohesion). */
export interface ProjectSettings {
  theme?: ThemePreset;
  /** Show a "1 / N" counter on each slide. */
  slideCounter?: boolean;
}

export interface Project {
  _id: string;
  businessId: string;
  title: string;
  type: AssetType;
  format: Format;
  slides: Slide[];
  settings?: ProjectSettings;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}
