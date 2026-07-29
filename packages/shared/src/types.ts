import type { AssetType, Format } from './formats';
import type { BusinessProfile } from './profile';
import type { ImageTreatment, LogoTreatment, ThemePreset } from './theme';
import type { BrandRecipe } from './recipe';
import type { PhotoMove } from './slideMotion';

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

/**
 * One candidate design system from a multi-take recipe author run — the user
 * picks between 2–3 of these; selecting one promotes its recipe to the kit's
 * live `recipe` and clears the list.
 */
export interface RecipeCandidate {
  id: string;
  recipe: BrandRecipe;
  /** One-line label for the creative direction this candidate followed. */
  note: string;
  createdAt: string;
}

export interface BrandKit {
  _id: string;
  businessId: string;
  colors: BrandColors;
  fonts: BrandFonts;
  logo?: { sourceUrl?: string } & Partial<StoredMedia>;
  /** How the logo is rendered on slides (default 'original'). */
  logoTreatment?: LogoTreatment;
  styleDescriptor: string;
  /** How the brand talks (register/person/energy) — grounds caption generation. */
  voice?: string;
  homepageScreenshot?: StoredMedia;
  provenance: BrandProvenance;
  status: BrandKitStatus;
  /**
   * The brand's design system — tokens + an authored stylesheet + composition,
   * imagery and voice — authored ONCE and applied to every AI-generated slide.
   * This is what the HTML-authoring generation path composes against.
   */
  recipe?: BrandRecipe;
  /** Pending recipe candidates from a directions run (cleared on select). */
  recipeCandidates?: RecipeCandidate[];
  createdAt: string;
}

export interface MediaAsset {
  _id: string;
  businessId: string;
  type: 'upload' | 'generated';
  /** Human label for generated assets (e.g. brand backgrounds). */
  label?: string;
  key: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
}

export type ImageNeed = 'none' | 'upload';

/**
 * A rectangle on the slide canvas, as fractions [0..1] of the canvas
 * width/height — resolution-independent across all formats. Used for free
 * photo overlays (SlidePhoto.frame).
 */
export interface BlockFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How an image fills its slot: 'cover' crops to fill, 'contain' shows it whole. */
export type ImageFit = 'cover' | 'contain';

/**
 * Optional per-slide manual tweaks. Legacy block-era override fields
 * (split/imageAspect/imageZoom/imageObjects/decorations/…) are gone: stored
 * documents that still carry them are tolerated on read (Mongoose strict mode
 * ignores them) and stripped at the wire boundary (zod drops unknown keys).
 */
export interface SlideOverrides {
  /** Image focal point as fractions [0..1] for object-position when cropping. */
  focalPoint?: { x: number; y: number };
  /** Cohesion treatment applied to the slide's image (default 'none'). */
  imageTreatment?: ImageTreatment;
  /** Per-slide theme; falls back to the project theme when unset. */
  theme?: ThemePreset;
}

/** Where one of a slide's photos lands. See slidePhotos.ts for the layer model. */
export type SlidePhotoPlacement = 'slot' | 'background' | 'free';

export interface SlidePhoto {
  id: string;
  mediaAssetId: string;
  placement: SlidePhotoPlacement;
  /** 'slot': the authored placeholder this fills (its `data-cb-slot` name). */
  slot?: string;
  /** 'free': where it sits on the canvas, as fractions [0..1]. */
  frame?: BlockFrame;
  fit?: ImageFit;
  /** Which part of the photo survives the crop, as fractions [0..1]. */
  focal?: { x: number; y: number };
  /** How this photo moves in a video export; 'auto' follows the brand. */
  motion?: PhotoMove;
  /** 'slot': override the shape/size of the hole the composer authored. */
  shape?: 'standard' | 'wide' | 'square' | 'tall';
  size?: 'sm' | 'md' | 'lg';
  /** 'free': negative sends it behind the composition. */
  z?: number;
  alt?: string;
}

export interface Slide {
  id: string;
  order: number;
  imageNeed: ImageNeed;
  mediaAssetId?: string;
  /** The user's own photos on this slide (slot fills, background, overlays). */
  photos?: SlidePhoto[];
  /** Stock-search phrase chosen by the AI art director (drives the stock picker). */
  imageQuery?: string;
  overrides?: SlideOverrides;
  /**
   * AI-authored slide markup (semantic HTML using the brand recipe's classes).
   * This is what the renderer mounts — slides are authored-first; a slide
   * without markup renders as a neutral branded field.
   */
  authored?: { html: string; bg?: string; role?: string };
}

export type ProjectStatus = 'draft' | 'rendered';

/**
 * Where a post sits in YOUR workflow — deliberately separate from `status`,
 * which is a technical fact ("have PNGs been rendered"). Overloading status
 * would entangle the export/compose paths with a user-facing lifecycle.
 */
export type ProjectStage = 'idea' | 'drafting' | 'ready' | 'shipped';
export const PROJECT_STAGES: ProjectStage[] = ['idea', 'drafting', 'ready', 'shipped'];

/** Per-project render settings (theme + carousel cohesion). */
export interface ProjectSettings {
  theme?: ThemePreset;
  /** Show a "1 / N" counter on each slide. */
  slideCounter?: boolean;
}

/** The social caption + hashtags for a post, written in the brand voice. */
export interface Caption {
  text: string;
  hashtags: string[];
}

export interface Project {
  _id: string;
  businessId: string;
  title: string;
  type: AssetType;
  format: Format;
  slides: Slide[];
  /** Generated social caption for the post (optional until drafted). */
  caption?: Caption;
  settings?: ProjectSettings;
  status: ProjectStatus;
  /** Workflow stage (see ProjectStage). Absent on pre-Desk projects — derive it. */
  stage?: ProjectStage;
  /** The prompt this post was asked to be. Kept so an idea can exist before it
   *  is composed, and so you can see what a finished post was asked for. */
  idea?: string;
  exportedAt?: string;
  postedAt?: string;
  createdAt: string;
  updatedAt: string;
}
