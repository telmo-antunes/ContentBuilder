import Anthropic from '@anthropic-ai/sdk';
import { categoryLabel, type BgColors } from '@contentbuilder/shared';
import type { BusinessCategory } from '@contentbuilder/shared';
import { config, aiDraftConfigured } from '../config';
import { sanitizeSvgBackground } from './svgSanitize';

export interface AiBgOptions {
  category?: BusinessCategory;
  tone?: string[];
}

// Steer the model toward vertical-appropriate abstract motifs — mirrors the
// procedural motif families so AI + procedural stay on the same design language.
const CATEGORY_HINT: Record<BusinessCategory, string> = {
  'local-service': 'dynamic diagonal lines, sweeping arcs, and subtle shine/sparkle glints',
  'saas-product': 'a faint dot grid, connected nodes, or soft rounded UI panels',
  ecommerce: 'a soft grid of rounded cards or lightly scattered confetti shapes',
  'personal-brand': 'concentric spotlight rings or soft organic blobs',
  'coach-creator': 'flowing waves, soft organic blobs, or concentric rings',
  agency: 'bold overlapping geometric blocks or a halftone dot gradient',
  nonprofit: 'gentle flowing waves and soft organic shapes',
  other: 'soft blurred color fields and subtle geometric accents',
};

/**
 * Generate ONE brand background as sanitized SVG via the small text model.
 * Cheap (text tokens, no image model). Returns null if AI is unconfigured or the
 * output can't be produced/sanitized — callers fall back to procedural.
 */
export async function generateAiBackground(colors: BgColors, opts: AiBgOptions = {}): Promise<string | null> {
  if (!aiDraftConfigured()) return null;

  const category = opts.category ?? 'other';
  const hint = CATEGORY_HINT[category] ?? CATEGORY_HINT.other;
  const tone = (opts.tone ?? []).join(', ') || 'clean, modern';
  const pal = (colors.palette && colors.palette.length ? colors.palette : [colors.background, colors.primary, colors.secondary, colors.accent])
    .filter(Boolean)
    .join(', ');

  const prompt =
    `Generate a single abstract background graphic as SVG for a "${categoryLabel(category)}" brand.\n\n` +
    `Return ONLY the SVG markup — no explanation, no markdown fences.\n\n` +
    `Hard requirements:\n` +
    `- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"> … </svg>\n` +
    `- Use ONLY these exact hex colors: ${pal}. The dominant fill MUST be the background color ${colors.background}.\n` +
    `- Motif idea for this vertical: ${hint}.\n` +
    `- Tone: ${tone}.\n` +
    `- SUBTLE and tasteful: shapes at low opacity (roughly 0.06–0.22) so text placed on top stays readable. Not busy, plenty of quiet space.\n` +
    `- Vector shapes only: rect, circle, ellipse, line, polygon, path, and linear/radial gradients or a gaussian blur filter for softness.\n` +
    `- NO text, NO <image>, NO <use>, NO <script>, NO external URLs or fonts. Self-contained only.\n` +
    `- Keep it compact (under ~1500 characters of SVG).`;

  try {
    const client = new Anthropic({ apiKey: config.ai.apiKey });
    const resp = await client.messages.create({
      model: config.ai.modelSmall!,
      max_tokens: 2000,
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
