import Anthropic from '@anthropic-ai/sdk';
import { categoryLabel, type BgColors } from '@contentbuilder/shared';
import type { BusinessCategory } from '@contentbuilder/shared';
import { config, aiDraftConfigured } from '../config';
import { sanitizeSvgBackground } from './svgSanitize';

export interface AiBgOptions {
  category?: BusinessCategory;
  tone?: string[];
  /** The brand's aesthetic descriptor — the single strongest brand-fit signal. */
  styleDescriptor?: string;
  businessName?: string;
  /** Rotates the composition brief so successive generations differ. */
  variant?: number;
}

// A rota of distinct abstract compositions. Rotating one in per call is what
// stops a small model from returning near-identical SVGs every time.
const COMPOSITIONS = [
  'large, soft, blurred colour fields drifting diagonally across the canvas',
  'fine geometric line-work that fades out toward one corner',
  'concentric arcs radiating from a point just off one corner',
  'a loose scatter of soft translucent orbs at varied sizes and depths',
  'gentle overlapping translucent bands or flowing waves',
  'a sparse constellation of small dots joined by a few thin lines',
  'two or three oversized rounded shapes cropped by the canvas edges',
  'a subtle halftone / dot-density gradient shifting across the frame',
  'long ribbon-like curves sweeping smoothly across the frame',
  'layered, offset rounded rectangles like abstract UI cards',
  'a soft diagonal sheen with a few small sparkle glints',
  'organic blurred blobs nestled into two opposite corners',
];

/**
 * Generate ONE brand background as sanitized SVG via a capable text model.
 * Cheap (text tokens, no image model). Returns null if AI is unconfigured or the
 * output can't be produced/sanitized — callers fall back to procedural.
 *
 * Quality levers vs the first version: it feeds the brand's *style descriptor*
 * (so it matches the aesthetic, not just the palette), rotates a distinct
 * composition each call (kills the "all the same" problem), and uses the larger
 * model when available.
 */
export async function generateAiBackground(colors: BgColors, opts: AiBgOptions = {}): Promise<string | null> {
  if (!aiDraftConfigured()) return null;

  const category = opts.category ?? 'other';
  const tone = (opts.tone ?? []).join(', ') || 'clean, modern';
  const aesthetic = (opts.styleDescriptor || '').trim() || tone;
  const brand = (opts.businessName || '').trim() || 'this brand';
  const pal = (colors.palette && colors.palette.length ? colors.palette : [colors.background, colors.primary, colors.secondary, colors.accent])
    .filter(Boolean)
    .join(', ');
  const variant = typeof opts.variant === 'number' ? opts.variant : Math.floor(Math.random() * COMPOSITIONS.length);
  const composition = COMPOSITIONS[((variant % COMPOSITIONS.length) + COMPOSITIONS.length) % COMPOSITIONS.length];
  const seed = Math.floor(Math.random() * 100000);

  const prompt =
    `You are an art director creating a SUBTLE abstract background for "${brand}"'s Instagram posts. ` +
    `It sits BEHIND headlines and body text, so it must be quiet and elegant — never busy, never competing with copy.\n\n` +
    `BRAND\n` +
    `- Category: ${categoryLabel(category)}\n` +
    `- Aesthetic to match closely: ${aesthetic}\n` +
    `- Tone: ${tone}\n\n` +
    `PALETTE — use ONLY these exact hex values: ${pal}.\n` +
    `The dominant fill MUST be the background colour ${colors.background}; the other colours appear only as low-opacity accents.\n\n` +
    `COMPOSITION — build this piece specifically around: ${composition}.\n` +
    `That structure MUST be the recognisable subject of the graphic. Do NOT fall back to generic soft blurred colour blobs or a plain gradient unless that IS the composition named above — each background must look structurally different from the others. ` +
    `Vary exact placement freely (composition seed ${seed}).\n\n` +
    `OUTPUT — return ONLY the SVG markup, no prose, no markdown fences:\n` +
    `- Root exactly: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"> … </svg>\n` +
    `- Vector only: rect, circle, ellipse, line, polygon, path, linearGradient/radialGradient, and feGaussianBlur for softness.\n` +
    `- SUBTLE but VISIBLE: accent shapes around 0.08–0.24 opacity — quiet enough that text on top stays readable, but defined enough that the composition is clearly recognisable, not a faint wash. Keep generous negative space.\n` +
    `- NO text, NO <image>, NO <use>, NO <script>, NO external URLs or fonts. Fully self-contained.\n` +
    `- Up to ~2800 characters of SVG.`;

  try {
    const client = new Anthropic({ apiKey: config.ai.apiKey });
    const resp = await client.messages.create({
      model: config.ai.modelLarge ?? config.ai.modelSmall!,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
    const part = resp.content.find((c) => c.type === 'text');
    const raw = part && 'text' in part ? part.text : '';
    return sanitizeSvgBackground(raw);
  } catch (err) {
    console.warn('[aiBackground] generation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
