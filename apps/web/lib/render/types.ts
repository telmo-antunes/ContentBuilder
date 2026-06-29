import type {
  BrandColors,
  Block,
  BlockFrame,
  Format,
  ImageTreatment,
  LogoTreatment,
  SplitPlacement,
  ImageAspect,
  ImageSizePreset,
  ImageFit,
} from '@contentbuilder/shared';

/** The brand-kit fields the renderer actually needs (a full BrandKit satisfies this). */
export interface RenderBrandKit {
  colors: BrandColors;
  fonts: { render: { heading: string; body: string } };
  logo?: { url?: string };
  logoTreatment?: LogoTreatment;
}

export interface LayoutImage {
  url: string;
  /** Focal point in [0..1]; drives object-position when cropping. */
  focalPoint?: { x: number; y: number };
  /** Cohesion treatment (brand tint / duotone). */
  treatment?: ImageTreatment;
}

/** Per-slide layout config for the in-post image (derived from slide overrides). */
export interface ImageLayoutConfig {
  /** SplitImageText: which edge the image occupies (orientation + order). */
  split?: SplitPlacement;
  /** CenteredHero: aspect ratio of the framed image. */
  aspect?: ImageAspect;
  /** CenteredHero: size of the framed image. */
  size?: ImageSizePreset;
  /** How the image fills its slot ('cover' crops, 'contain' shows it whole). */
  fit?: ImageFit;
  /** FreePosition: the canvas region (fractions) where the image renders. */
  imageFrame?: BlockFrame;
  /** FreePosition: render the image full-bleed behind everything. */
  background?: boolean;
}

export interface LayoutProps {
  brandKit: RenderBrandKit;
  blocks: Block[];
  image?: LayoutImage | null;
  format: Format;
  /** Image layout knobs (split/aspect/size/fit). */
  imageLayout?: ImageLayoutConfig;
  /** Called when text can't fit even at its minimum size (editor surfaces a warning). */
  onOverflow?: (overflow: boolean) => void;
}
