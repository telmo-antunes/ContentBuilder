import type { Block, BlockFrame, BlockType } from './blocks';
import type { LayoutType } from './layouts';
import type { AssetType, Format } from './formats';
import type { BusinessProfile, BusinessGoal } from './profile';
import type { ImageTreatment, LogoTreatment, ThemePreset } from './theme';
import type { BrandRecipe } from './recipe';

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
  /** How the brand talks (register/person/energy) — grounds caption generation. */
  voice?: string;
  homepageScreenshot?: StoredMedia;
  provenance: BrandProvenance;
  status: BrandKitStatus;
  /** LEGACY (pre-package): AI-designed post compositions. Superseded by layoutLibrary. */
  templatePack?: BrandTemplateSkeleton[];
  /** The written art-direction brief the director followed (shown on the kit screen). */
  artDirection?: ArtDirection;
  /** The brand's OWN layout system — posts + stories, each layout with its matched background. */
  layoutLibrary?: LayoutLibrary;
  /**
   * The brand's design system — tokens + an authored stylesheet + composition,
   * imagery and voice — authored ONCE and applied to every AI-generated slide.
   * This is what the new HTML-authoring generation path composes against.
   */
  recipe?: BrandRecipe;
  createdAt: string;
}

/** One brand composition skeleton — a FreePosition layout without copy. */
export interface BrandTemplateSkeleton {
  name: string;
  purpose: 'cover' | 'content' | 'list' | 'quote' | 'image-feature' | 'cta';
  imageNeed: ImageNeed;
  blocks: Array<{ type: BlockType; frame: BlockFrame; z?: number }>;
  decorations?: SlideDecoration[];
  imageFrame?: BlockFrame;
  imageBackground?: boolean;
}

/**
 * Which intensity of the brand's background SYSTEM a layout sits on. The director
 * authors three variants per format; text-heavy layouts pick `canvas` (near
 * silent), normal copy `texture`, short-copy heroes `statement` (boldest).
 */
export type BackgroundRole = 'canvas' | 'texture' | 'statement';

/**
 * A brand layout: a composition skeleton PLUS its matched brand background
 * (an AI-authored or palette-rendered vector, stored as a media asset). Designed
 * together in one pass so structure and background feel like one system.
 */
export interface BrandLayout extends BrandTemplateSkeleton {
  /** The motif this layout's background was rendered from (for regenerate/swap UI). */
  backgroundMotif?: string;
  /** Which background-system intensity this layout uses (director path). */
  backgroundRole?: BackgroundRole;
  /** The stored background asset — lands in slide.overrides.backgroundMediaAssetId when applied. */
  backgroundMediaAssetId?: string;
}

/**
 * The written art-direction brief the Brand Design Director produces from the
 * brand evidence (incl. the homepage screenshot). It is the coherence contract
 * every downstream call follows, and is shown to the user on the kit screen.
 */
export interface ArtDirection {
  /** 120–250 words: structural voice, typographic attitude, colour deployment, signature move. */
  brief: string;
  /** One paragraph describing the three-intensity background system. */
  backgroundConcept: string;
  do: string[];
  dont: string[];
  createdAt?: string;
}

/** The per-business layout system, generated as ONE package on kit approval. */
export interface LayoutLibrary {
  /** One-line design rationale from the director pass (shown in the kit UI). */
  direction?: string;
  post: BrandLayout[];
  story: BrandLayout[];
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
  /** FreePosition: render the slide's image full-bleed behind the elements (legacy; ignores imageFrame). */
  imageBackground?: boolean;
  /** FreePosition: a full-bleed background image, independent of the region image + objects. */
  backgroundMediaAssetId?: string;
  /** FreePosition: additional positioned image elements, each with its own media. */
  imageObjects?: ImageObject[];
  /** FreePosition: brand chrome (logo, accent rule, divider, scrim) as positioned data. */
  decorations?: SlideDecoration[];
}

export type DecorationKind = 'logo' | 'rule' | 'divider' | 'scrim';

/**
 * A non-text, non-image slide element on the free canvas. Preset layouts draw
 * this chrome themselves; representing it as data is what lets any preset slide
 * convert to a free canvas without losing its logo/rules/scrims.
 */
export interface SlideDecoration {
  kind: DecorationKind;
  frame: BlockFrame;
  z?: number;
  /** scrim: which way the gradient fades (dark edge → transparent). */
  direction?: 'to-top' | 'to-bottom' | 'to-left' | 'to-right';
  /** scrim: peak opacity of the dark edge (default 0.55). */
  opacity?: number;
}

export interface Slide {
  id: string;
  order: number;
  layoutType: LayoutType;
  blocks: Block[];
  imageNeed: ImageNeed;
  mediaAssetId?: string;
  /** Stock-search phrase chosen by the AI art director (drives the stock picker). */
  imageQuery?: string;
  overrides?: SlideOverrides;
  /**
   * AI-authored slide markup (semantic HTML using the brand recipe's classes).
   * When present, the renderer mounts it instead of the block layout; `blocks`
   * is retained for free-canvas conversion and back-compat.
   */
  authored?: { html: string; bg?: string };
}

export type ProjectStatus = 'draft' | 'rendered';

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
  /** The campaign this post belongs to, if it was generated as part of a series. */
  campaignId?: string;
  settings?: ProjectSettings;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

/** One post idea in a campaign — cheap to plan; drafted into a Project on demand. */
export interface CampaignConcept {
  id: string;
  /** Short working title for the post. */
  title: string;
  /** One line: the angle/hook this post takes within the series. */
  angle: string;
  /** A paragraph ready to feed the draft engine (the post's raw copy source). */
  paragraph: string;
  /** Set once this concept has been drafted into a real project. */
  projectId?: string;
}

/** A themed series of posts: a brief → a plan of concepts → drafts on demand. */
export interface Campaign {
  _id: string;
  businessId: string;
  name: string;
  brief: string;
  goal?: BusinessGoal;
  type: AssetType;
  format: Format;
  concepts: CampaignConcept[];
  createdAt: string;
}
