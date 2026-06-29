import type { BlockType, Format } from '@contentbuilder/shared';
import type { ColorRole } from './color';

export type BlockVariant = 'default' | 'cta' | 'list' | 'quote';

export interface BlockStyle {
  /** Which bundled render font (heading vs body). */
  role: 'heading' | 'body';
  /** Min / max font size in px on the base 1080-wide canvas. */
  min: number;
  max: number;
  weight: number;
  lineHeight: number;
  transform?: 'uppercase' | 'none';
  italic?: boolean;
  letterSpacing?: string;
  color: ColorRole;
  variant?: BlockVariant;
  /** Render with a leading accent rule (used for the eyebrow kicker). */
  kicker?: boolean;
}

/**
 * THE brand type scale: one map from BlockType → typographic style, applied
 * identically everywhere a block appears. Changing a block's look = editing
 * this map once. Sizes are bounded (min/max) — text auto-fits within the range
 * and warns rather than shrinking past the minimum.
 */
const BASE_SCALE: Record<BlockType, BlockStyle> = {
  eyebrow: { role: 'body', min: 19, max: 26, weight: 700, lineHeight: 1.25, transform: 'uppercase', letterSpacing: '0.2em', color: 'accent', kicker: true },
  title: { role: 'heading', min: 54, max: 104, weight: 800, lineHeight: 1.02, letterSpacing: '-0.02em', color: 'text' },
  subtitle: { role: 'heading', min: 30, max: 48, weight: 600, lineHeight: 1.16, letterSpacing: '-0.01em', color: 'text' },
  paragraph: { role: 'body', min: 25, max: 35, weight: 400, lineHeight: 1.5, color: 'text' },
  quote: { role: 'heading', min: 44, max: 78, weight: 700, lineHeight: 1.18, letterSpacing: '-0.015em', italic: true, color: 'text', variant: 'quote' },
  attribution: { role: 'body', min: 22, max: 30, weight: 600, lineHeight: 1.3, letterSpacing: '0.01em', color: 'muted' },
  date: { role: 'body', min: 21, max: 29, weight: 600, lineHeight: 1.3, letterSpacing: '0.04em', color: 'muted' },
  price: { role: 'heading', min: 56, max: 96, weight: 800, lineHeight: 1.0, letterSpacing: '-0.02em', color: 'accent' },
  list: { role: 'body', min: 25, max: 37, weight: 500, lineHeight: 1.4, color: 'text', variant: 'list' },
  caption: { role: 'body', min: 19, max: 25, weight: 400, lineHeight: 1.4, color: 'muted' },
  cta: { role: 'heading', min: 28, max: 46, weight: 700, lineHeight: 1.05, letterSpacing: '0.01em', color: 'text', variant: 'cta' },
  footer: { role: 'body', min: 18, max: 24, weight: 500, lineHeight: 1.3, letterSpacing: '0.03em', color: 'muted' },
  handle: { role: 'body', min: 22, max: 30, weight: 700, lineHeight: 1.3, letterSpacing: '0.02em', color: 'primary' },
};

/** Slight per-format size multiplier (all formats are 1080 wide). */
const FORMAT_SCALE: Record<Format, number> = {
  '1080x1080': 1,
  '1080x1350': 1,
  '1080x1920': 1.08,
};

export function formatScale(format: Format): number {
  return FORMAT_SCALE[format];
}

/** The type scale with sizes scaled for a given format. */
export function typeScale(format: Format): Record<BlockType, BlockStyle> {
  const fs = FORMAT_SCALE[format];
  if (fs === 1) return BASE_SCALE;
  const out = {} as Record<BlockType, BlockStyle>;
  for (const key of Object.keys(BASE_SCALE) as BlockType[]) {
    const s = BASE_SCALE[key];
    out[key] = { ...s, min: Math.round(s.min * fs), max: Math.round(s.max * fs) };
  }
  return out;
}
