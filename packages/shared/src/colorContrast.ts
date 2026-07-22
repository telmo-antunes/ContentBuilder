/**
 * True WCAG relative-luminance + contrast math. Pure and dependency-free so the
 * API (background legibility gate), the web app, and tests can all share ONE
 * authoritative implementation.
 *
 * NOTE: `backgrounds.ts` has a cheaper, NON-gamma-corrected `luminance()` used
 * only to decide motif opacity lift on dark themes — that's a rendering knob,
 * not an accessibility check. Anything that must match WCAG (the 4.5:1 / 3:1
 * gates) uses THIS module.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` or `#rrggbb` (with or without `#`) into 0–255 channels. Invalid → black. */
export function hexToRgb(hex: string): Rgb {
  const h = (hex || '').trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** sRGB → linear channel (WCAG gamma expansion). */
function linearize(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance in [0,1] (gamma-corrected — the real one). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two colors: 1 (identical) … 21 (#000 vs #fff). */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text / meaningful graphics. */
export const AA_LARGE = 3;
