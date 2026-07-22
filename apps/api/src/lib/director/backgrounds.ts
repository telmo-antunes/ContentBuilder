import {
  FORMAT_DIMENSIONS,
  renderMotif,
  type ArtDirection,
  type BackgroundRole,
  type BgColors,
  type Format,
} from '@contentbuilder/shared';
import { aiMessageLarge, modelFor, textOf, withOpusReasoning } from '../ai';
import { recordUsage } from '../usage';
import { sanitizeSvgBackground } from '../svgSanitize';
import { checkBackgroundLegibility } from '../svgContrast';
import { extractBackgroundSet } from './schema';
import { loadDirectorPrompt } from './prompt';

/**
 * Call 3 of the director: paint the brand's background SYSTEM as hand-authored
 * SVG — three intensities of ONE idea (canvas/texture/statement). Every returned
 * SVG is sanitized and legibility-gated; anything unsafe or illegible is swapped
 * for a safe procedural motif so the package ALWAYS ships three usable
 * backgrounds. Called once per format (post + story).
 */

export const BACKGROUND_ROLES: BackgroundRole[] = ['canvas', 'texture', 'statement'];

/** Safe procedural fallback per role (used when the authored SVG is rejected). */
const ROLE_MOTIF: Record<BackgroundRole, string> = { canvas: 'mesh', texture: 'halftone', statement: 'geoblocks' };

export const DIRECTOR_BACKGROUND_SYSTEM = `You are a vector artist painting a brand's background system as hand-authored SVG, following the art-direction brief and background concept you are given. You paint three intensities of ONE idea — not three unrelated images.

CANVAS: {{width}}x{{height}} (viewBox "0 0 {{width}} {{height}}"). Text will be set on top of these backgrounds in the brand's text colour {{textHex}} — legibility beats beauty every time.

HARD CONTRACT (a validator rejects violations, not a person):
- Output ONLY a JSON object: { "canvas": "<svg...>", "texture": "<svg...>", "statement": "<svg...>" }
- Each SVG: the FIRST element MUST be a full-canvas <rect x="0" y="0" width="{{width}}" height="{{height}}"> filled with {{backgroundHex}} (your base coat). Then draw with rect / circle / ellipse / path / polygon / line / g, linearGradient / radialGradient, clipPath / mask, and feGaussianBlur only.
- NO text, NO images, NO <style>, no style="" attributes, no href, no scripts, no animation. Presentation attributes only (fill, stroke, opacity, transform, ...).
- Use ONLY these hexes: {{palette}}. Opacity is your main instrument.
- Keep each SVG under 12KB. Fewer, larger, more deliberate shapes — not confetti noise.

INTENSITY LADDER:
- "canvas": a whisper. Base coat plus at most 2-3 near-invisible moves (a 3-6% opacity field, one hairline, a soft corner gradient). A paragraph must be able to sit anywhere on it.
- "texture": quiet pattern or field work at 8-20% opacity, concentrated toward edges and corners; keep the middle 60% of the canvas calm for copy.
- "statement": the BOLDEST background, and it must be unmistakably PRESENT — it carries short-copy slides (covers, CTAs) so they never look empty. Fill a large part of the canvas with the brand's signature move: a sweeping field, arc, diagonal, or large geometric form covering ROUGHLY 40-60% of the area, in brand colour at strong opacity (a gradient down to the base is fine). A single thin line or a faint wash is NOT a statement — commit to a large, confident form. Still leave one clear zone (~40% of the canvas) where a big short title lands legibly.

Draw the brand in the brief — its geometry, its edges, its colour deployment. Do not default to generic blurred blobs unless the brief asks for softness.`;

function fill(tpl: string, tokens: Record<string, string | number>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(tokens[k] ?? ''));
}

function motifBackground(role: BackgroundRole, colors: BgColors, seed: string): string {
  const bg = renderMotif(ROLE_MOTIF[role], colors, { seed });
  return (
    bg?.svg ??
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${colors.background}"/></svg>`
  );
}

/** Sanitize + legibility-gate an authored SVG; null if it can't be trusted. */
function gate(role: BackgroundRole, authored: string, colors: BgColors, format: Format): string | null {
  const dims = FORMAT_DIMENSIONS[format];
  const clean = sanitizeSvgBackground(authored, { width: dims.width, height: dims.height });
  if (!clean) return null;
  const leg = checkBackgroundLegibility(clean, colors.text ?? '#ffffff', { baseOnly: role === 'statement' });
  return leg.ok ? clean : null;
}

/**
 * Resolve ONE role's background: the authored SVG if it sanitizes + passes the
 * legibility gate, else a safe procedural motif. Always returns usable SVG.
 */
export function resolveBackground(
  role: BackgroundRole,
  authored: string | undefined,
  colors: BgColors,
  format: Format,
  seed: string,
): { svg: string; source: 'authored' | 'motif' } {
  const safe = authored ? gate(role, authored, colors, format) : null;
  if (safe) return { svg: safe, source: 'authored' };
  return { svg: motifBackground(role, colors, seed), source: 'motif' };
}

export interface BackgroundSet {
  canvas: string;
  texture: string;
  statement: string;
  /** Provenance per role, for logging / the kit UI. */
  sources: Record<BackgroundRole, 'authored' | 'motif'>;
}

export async function generateBackgroundSet(
  brief: ArtDirection,
  colors: BgColors,
  format: Format,
  businessId: string,
): Promise<BackgroundSet> {
  const dims = FORMAT_DIMENSIONS[format];
  const palette = (colors.palette?.length
    ? colors.palette
    : [colors.background, colors.primary, colors.secondary, colors.accent, colors.text ?? '#ffffff']
  ).join(', ');
  const model = await modelFor('director');
  const system = fill(await loadDirectorPrompt('directorBackgroundSystem', DIRECTOR_BACKGROUND_SYSTEM), {
    width: dims.width,
    height: dims.height,
    textHex: colors.text ?? '#ffffff',
    backgroundHex: colors.background,
    palette,
  });

  let raw: { canvas: string; texture: string; statement: string } | null = null;
  try {
    const resp = await aiMessageLarge(
      withOpusReasoning({
        model,
        max_tokens: 30000,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: `Paint the three background intensities for this brand.\n\nBRIEF: ${brief.brief}\n\nBACKGROUND CONCEPT: ${brief.backgroundConcept}`,
          },
        ],
      }),
    );
    await recordUsage({
      feature: `director:backgrounds:${format}`,
      model,
      inputTokens: resp.usage?.input_tokens,
      outputTokens: resp.usage?.output_tokens,
    });
    raw = extractBackgroundSet(textOf(resp));
  } catch (err) {
    console.warn('[director] background set call failed:', err instanceof Error ? err.message : err);
  }

  const sources = {} as Record<BackgroundRole, 'authored' | 'motif'>;
  const svgs = {} as Record<BackgroundRole, string>;
  for (const role of BACKGROUND_ROLES) {
    const { svg, source } = resolveBackground(role, raw?.[role], colors, format, `${businessId}:${format}:${role}`);
    svgs[role] = svg;
    sources[role] = source;
  }
  return { canvas: svgs.canvas, texture: svgs.texture, statement: svgs.statement, sources };
}
