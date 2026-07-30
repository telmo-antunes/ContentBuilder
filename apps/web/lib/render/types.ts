import type { BrandColors, BrandRecipe, LogoTreatment } from '@contentbuilder/shared';

/** The brand-kit fields the renderer actually needs (a full BrandKit satisfies this). */
export interface RenderBrandKit {
  colors: BrandColors;
  fonts: { render: { heading: string; body: string } };
  logo?: { url?: string };
  logoTreatment?: LogoTreatment;
  /** The brand's design system — present when the kit has an authored recipe. */
  recipe?: BrandRecipe;
}
