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

/**
 * Counters of the deterministic slide tweaks ("Bigger headline", "Smaller
 * headline", "Invert") made against this brand's posts. Each press is a
 * labelled correction of the recipe; enough of them, netted, become a
 * suggestion on the brand-kit page instead of evaporating. "Un-invert"
 * withdraws an invert (decrements), so the counter is a net preference.
 */
export interface TweakSignals {
  biggerHeadline?: number;
  smallerHeadline?: number;
  invert?: number;
  updatedAt?: string;
  /** "Not now" — suppresses suggestions for 14 days without forgetting the counts. */
  dismissedAt?: string;
}

/**
 * A recipe adjustment derived from TweakSignals, served with GET
 * /businesses/:id/brandkit. Applying goes through the existing recipe-knobs
 * PATCH — the suggestion is only the nudge, never a new mechanism.
 */
export type TweakSuggestion =
  | {
      kind: 'density';
      from: 'roomy' | 'balanced' | 'dense';
      /** The one step to apply via the density knob. */
      to: 'roomy' | 'balanced' | 'dense';
      reason: 'smaller-headline' | 'bigger-headline';
      /** The net number of presses that earned the suggestion. */
      count: number;
    }
  | { kind: 'invert'; count: number };

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
  /** Net counts of manual slide tweaks — the raw material for TweakSuggestion. */
  tweakSignals?: TweakSignals;
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
  bleedAnchor?: 'top' | 'bottom';
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
  /** The user's own photos on this slide (slot fills, background, overlays). */
  photos?: SlidePhoto[];
  /** Stock-search phrase chosen by the AI art director (drives the stock picker). */
  imageQuery?: string;
  /** The parse step's one-line reasoning for this slide's calls — review insight. */
  rationale?: string;
  overrides?: SlideOverrides;
  /**
   * AI-authored slide markup (semantic HTML using the brand recipe's classes).
   * This is what the renderer mounts — slides are authored-first; a slide
   * without markup renders as a neutral branded field.
   */
  authored?: {
    html: string;
    bg?: string;
    role?: string;
    archetype?: string;
    pv?: Record<string, number>;
    source?: 'fragment' | 'ai';
    /** Per-slide alignment deviation, applied by the app's data-align layer. */
    align?: 'flush-left' | 'center' | 'flush-right';
  };
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
  /** The ONE DM keyword for this post — slide, caption and notes all read it. */
  dmKeyword?: string;
  /** Who reads this post; picks the voice register and shows on review. */
  audience?: 'car owner' | 'studio owner';
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
  /** One direction per slide, in order — the plan the deck was composed
   *  against. Absent when the copywriter was left to shape the deck itself. */
  plan?: string[];
  /**
   * The decision ledger from the last compose: consequential calls the CODE
   * took on the deck's behalf (e.g. a full-bleed photo dropped for fighting
   * the brand ground). Shown on the review page as info chips.
   */
  composeNotes?: Array<{ slide?: number; note: string }>;
  /**
   * The recipe this deck shipped under, pinned at first export — render paths
   * use it over the kit's live recipe so a recipe swap never re-skins a deck
   * that was already reviewed. Absent on unshipped decks.
   */
  recipeSnapshot?: unknown;
  recipeSnapshotAt?: string;
  /** What the last compose cost, and anything the ceiling turned down. */
  spend?: {
    spentUsd: number;
    ceilingUsd: number | null;
    calls: number;
    skipped: string[];
    byFeature: Array<{ feature: string; costUsd: number; calls: number }>;
  };
  /** The pages this post was written from, when the brief cited any. */
  sources?: Array<{ url: string; title?: string; byline?: string; published?: string; chars?: number }>;
  exportedAt?: string;
  postedAt?: string;
  createdAt: string;
  updatedAt: string;
}
