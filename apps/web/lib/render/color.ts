import type { RenderBrandKit } from './types';

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [Number.isNaN(r) ? 0 : r, Number.isNaN(g) ? 0 : g, Number.isNaN(b) ? 0 : b];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function channelLin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLin(r) + 0.7152 * channelLin(g) + 0.0722 * channelLin(b);
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear-interpolate between two hex colors (t in [0,1]). */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

/** CSS rgba() string from a hex color + alpha. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Pick whichever candidate has the highest contrast against `bg`. */
export function bestContrastColor(bg: string, candidates: string[]): { color: string; ratio: number } {
  let best = { color: candidates[0] ?? '#000000', ratio: 0 };
  for (const c of candidates) {
    const r = contrast(bg, c);
    if (r > best.ratio) best = { color: c, ratio: r };
  }
  return best;
}

const MIN_TEXT_CONTRAST = 4.5;

/**
 * Resolve a readable text color against `bg`: prefer the brand text color when
 * it clears the WCAG minimum, otherwise fall back to whichever of near-white /
 * near-black reads best. Never returns a low-contrast color.
 */
export function resolveTextColor(bg: string, kit: RenderBrandKit): string {
  if (contrast(bg, kit.colors.text) >= MIN_TEXT_CONTRAST) return kit.colors.text;
  const fallback = bestContrastColor(bg, ['#FFFFFF', '#0B0B0B', kit.colors.text]);
  return fallback.color;
}

export type ColorRole = 'text' | 'muted' | 'accent' | 'primary' | 'secondary' | 'background';

/**
 * Resolve a type-scale color role to a concrete color for text on `bg`.
 * Emphasis roles (accent/primary/secondary) are used only when they remain
 * legible; otherwise they degrade to the auto text color.
 */
export function resolveColor(role: ColorRole, kit: RenderBrandKit, bg: string): string {
  const auto = resolveTextColor(bg, kit);
  switch (role) {
    case 'text':
      return auto;
    case 'muted':
      return mix(auto, bg, 0.42);
    case 'accent':
    case 'primary':
    case 'secondary':
    case 'background': {
      const col = kit.colors[role];
      return contrast(bg, col) >= 3 ? col : auto;
    }
    default:
      return auto;
  }
}

/** Text color for a filled accent button/pill. */
export function onColor(bg: string, kit: RenderBrandKit): string {
  return bestContrastColor(bg, ['#FFFFFF', '#0B0B0B', kit.colors.background, kit.colors.text]).color;
}

/**
 * Scrim opacity for text over an image: a fixed brand-tinted overlay strong
 * enough that the effective background is the scrim color, so text contrast can
 * be computed deterministically against that color (we can't sample the image).
 */
export const IMAGE_SCRIM_OPACITY = 0.62;
