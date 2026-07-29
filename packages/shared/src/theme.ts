import type { BusinessCategory } from './profile';

/**
 * Theme presets vary the render chrome (e.g. the slide-counter styling) while
 * staying brand-colored. Stored per project (settings.theme) and per slide
 * (overrides.theme).
 */
export type ThemePreset = 'editorial' | 'bold' | 'minimal' | 'soft';

/** Sensible default theme for a business category (profile → visual default). */
export function defaultThemeForCategory(category?: BusinessCategory): ThemePreset {
  switch (category) {
    case 'personal-brand':
    case 'coach-creator':
    case 'nonprofit':
      return 'editorial';
    case 'saas-product':
    case 'agency':
      return 'bold';
    case 'local-service':
    case 'ecommerce':
      return 'soft';
    default:
      return 'editorial';
  }
}

/** How an attached image is treated for cohesion. */
export type ImageTreatment = 'none' | 'tint' | 'duotone';

/** How the logo is rendered on slides. */
export type LogoTreatment = 'original' | 'mono';
