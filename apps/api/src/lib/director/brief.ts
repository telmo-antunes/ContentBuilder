import type Anthropic from '@anthropic-ai/sdk';
import { aiMessage, modelFor, textOf } from '../ai';
import { recordUsage } from '../usage';
import type { ArtDirection } from '@contentbuilder/shared';
import { extractBrief } from './schema';
import { brandFactLines, loadDirectorPrompt, type DirectorInputs } from './prompt';

/**
 * Call 1 of the director: read the brand's homepage screenshot + facts and write
 * the ART-DIRECTION BRIEF that the composition and background calls both follow.
 * The screenshot is consumed ONLY here; everything downstream inherits it through
 * the brief text. This is the single vision call of the package pass.
 */

export const DIRECTOR_BRIEF_SYSTEM = `You are a senior brand art director. You are looking at a screenshot of this brand's homepage together with its extracted palette, typefaces, voice and category. Your job is to write the ART-DIRECTION BRIEF that a layout designer and a background artist will follow to build this brand's Instagram design system. They will never see the website — your brief is everything they get. Steal what is specific and true to THIS brand, not what is generic.

THE MEDIUM MATTERS MORE THAN THE WEBSITE. These are Instagram FEED posts — seen thumb-sized on a phone, for a split second, while someone scrolls. They must STOP THE SCROLL and educate at a glance: a single bold focal message, type large enough to read on a phone (a website's quiet 14px body copy is unreadable in feed), the canvas used with confidence. Translate the brand's CHARACTER (its colour, type personality, geometry) into an ENGAGING post — do NOT reproduce a website's sparse, airy hero treatment. Even a minimal, premium brand must feel punchy, legible, and full here. Favour big type and a filled canvas over generous emptiness.

Study the screenshot for: how type is set (large/confident or small/quiet — you will AMPLIFY it for feed either way); whether edges are sharp or rounded; whether colour is used in fields, lines, or accents; a photographic vs. flat-graphic sensibility; any recurring geometry (arches, grids, diagonals, hairlines, chips, cards).

Write for designers, in concrete visual language. BAD: "modern and clean". GOOD: "oversized headlines set tight and flush-left, filling the upper two-thirds; one hairline rule under a bold eyebrow; ink-navy fields bleeding off the left edge; the accent colour as one confident stroke".

OUTPUT: ONLY a JSON object (no prose, no code fences):
{
  "brief": string — 120-250 words. Cover, concretely: (1) the STRUCTURAL voice (density, scale contrast, alignment habits, where whitespace lives), (2) the TYPOGRAPHIC attitude, (3) how COLOUR is deployed (which hex plays base / field / accent / line), (4) ONE signature move that makes a post recognisably THIS brand at thumbnail size.
  "backgroundConcept": string — one paragraph describing a BACKGROUND SYSTEM in three intensities: "canvas" (near-silent, sits under dense text), "texture" (quiet pattern or field work, sits under normal content), "statement" (bold, sits under covers and CTAs). Describe the actual geometry to draw, not a mood.
  "do": [3-6 short imperatives],
  "dont": [3-6 short imperatives — include this brand's specific failure modes, e.g. "no centered symmetry" for an editorial brand, "no pastel washes" for an industrial one]
}

Ground every claim in the screenshot or the given facts. If the screenshot is weak (sparse, broken, monochrome) or absent, lean on category and tone conventions instead — never invent brand elements that are not evidenced.`;

/** Never-throws fallback brief synthesized from the text facts when the call fails. */
function synthesizeBrief(inp: DirectorInputs): ArtDirection {
  const tone = Array.isArray(inp.tone) ? inp.tone.join(', ') : inp.tone || 'clear and confident';
  const character = inp.styleDescriptor || `a ${tone} ${inp.category ?? 'brand'}`;
  return {
    brief: `${character}. These are Instagram feed posts, so set the hero message BIG and impossible to miss — an oversized headline filling the upper half — and anchor copy to a consistent edge rather than centering everything. Use ${inp.colors.background} as the base surface, ${inp.colors.text} for text, and ${inp.colors.accent} as one confident accent — an eyebrow, a rule, or a bold keyword. Fill the canvas with intent; leave breathing room only around the focal point, not vast dead zones. The signature move: one thin accent rule pairing a bold eyebrow to its oversized title.`,
    backgroundConcept: `A system in three intensities. "canvas": the base colour plus a barely-there corner gradient. "texture": a few low-opacity geometric lines concentrated at the edges, centre kept calm for copy. "statement": a larger diagonal field in the primary colour occupying one corner, leaving a clear zone for a big short title.`,
    do: ['Set the headline oversized and legible at thumbnail size', 'Anchor copy to one edge', 'Let the accent colour land one confident hit per slide'],
    dont: ['No tiny website-caption body copy', 'No busy backgrounds behind text', 'No centered-everything symmetry'],
    createdAt: new Date().toISOString(),
  };
}

export async function generateArtBrief(inp: DirectorInputs): Promise<ArtDirection> {
  const model = await modelFor('director');
  const system = await loadDirectorPrompt('directorBriefSystem', DIRECTOR_BRIEF_SYSTEM);
  const content: Anthropic.ContentBlockParam[] = [];
  if (inp.screenshotBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: inp.screenshotBase64 } });
  }
  content.push({ type: 'text', text: `Write the art-direction brief for this brand.\n\n${brandFactLines(inp)}` });

  try {
    const resp = await aiMessage({
      model,
      max_tokens: 3000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    });
    await recordUsage({
      feature: 'director:brief',
      model,
      inputTokens: resp.usage?.input_tokens,
      outputTokens: resp.usage?.output_tokens,
    });
    const parsed = extractBrief(textOf(resp));
    if (parsed) return { ...parsed, createdAt: new Date().toISOString() };
    console.warn('[director] brief returned unparseable output — using synthesized brief');
  } catch (err) {
    console.warn('[director] brief call failed:', err instanceof Error ? err.message : err);
  }
  return synthesizeBrief(inp);
}
