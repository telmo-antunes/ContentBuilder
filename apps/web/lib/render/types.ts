import type { BrandColors, BrandRecipe, ImageTreatment, LogoTreatment } from '@contentbuilder/shared';

/** The brand-kit fields the renderer actually needs (a full BrandKit satisfies this). */
export interface RenderBrandKit {
  colors: BrandColors;
  fonts: { render: { heading: string; body: string } };
  logo?: { url?: string };
  logoTreatment?: LogoTreatment;
  /** The brand's design system — present when the kit has an authored recipe. */
  recipe?: BrandRecipe;
}

/** A slide's attached image resolved to a paintable URL. */
export interface LayoutImage {
  url: string;
  /** Focal point in [0..1]; drives object-position when cropping. */
  focalPoint?: { x: number; y: number };
  /** Cohesion treatment (brand tint / duotone). */
  treatment?: ImageTreatment;
}
