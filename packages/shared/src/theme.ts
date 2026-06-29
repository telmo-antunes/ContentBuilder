import type { BusinessCategory } from './profile';

/**
 * Theme presets swap the decorative *language* of the layouts (background
 * treatment, eyebrow style, accent rule, panels) while staying brand-colored —
 * so the same content can read editorial vs bold vs minimal vs soft.
 */
export type ThemePreset = 'editorial' | 'bold' | 'minimal' | 'soft';

export const THEME_PRESETS: ReadonlyArray<{ value: ThemePreset; label: string; hint: string }> = [
  { value: 'editorial', label: 'Editorial', hint: 'Thin rules, generous whitespace, refined' },
  { value: 'bold', label: 'Bold', hint: 'Filled accent blocks, big impact' },
  { value: 'minimal', label: 'Minimal', hint: 'Stripped back, lots of air' },
  { value: 'soft', label: 'Soft', hint: 'Rounded panels, gentle gradients' },
];

export function isThemePreset(v: unknown): v is ThemePreset {
  return v === 'editorial' || v === 'bold' || v === 'minimal' || v === 'soft';
}

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
