/**
 * The recipe-author touchpoint: generate a brand's design system (a BrandRecipe)
 * from its kit evidence — ONCE per brand. This is the expensive, high-taste call
 * (design tier); every per-project compose then runs cheap against the result.
 *
 * Output is validated by brandRecipeSchema and its stylesheet is CSS-sanitised.
 * The reference Dynatós recipe is embedded as a worked example so the model
 * matches the exact shape + the 1080×1350, cinematic-background quality bar.
 */
import { brandRecipeSchema, type BrandRecipe } from '@contentbuilder/shared';
import { aiMessageLarge, textOf, designModel, withOpusReasoning } from '../ai';
import { sanitizeRecipeCss } from '../cssSanitize';
import { dynatosRecipe } from './recipes';

export interface RecipeEvidence {
  name: string;
  category?: string;
  colors: { primary?: string; secondary?: string; accent?: string; background?: string; text?: string; palette?: string[] };
  fonts: { detected?: { heading?: string; body?: string }; render: { heading: string; body: string } };
  logoTreatment?: string;
  styleDescriptor?: string;
  voice?: string;
}

/** Render fonts the export can actually load (bundled). The recipe must use these. */
const ALLOWED_FONTS = [
  'Inter', 'Montserrat', 'Poppins', 'Roboto', 'Open Sans', 'Lato', 'Work Sans',
  'Raleway', 'Nunito', 'Archivo', 'Oswald', 'Bebas Neue', 'Playfair Display',
  'Merriweather', 'Lora', 'Source Serif 4',
];

const SYSTEM = `You are a brand designer. From a business's brand evidence you author its DESIGN SYSTEM — a "recipe" that every future Instagram slide is composed against. You output STRICT JSON only (no prose, no fences), matching the shape of the worked example exactly.

The recipe's job is to make on-brand, premium, scroll-stopping 1080×1350 posts. The most important part is the "stylesheet": real CSS, scoped to .cb-slide, written against the --cb-* tokens, sized for the FULL 1080×1350 canvas (huge, legible type: headlines ~80–120px, body ~30–34px, eyebrows ~24px). The background must be AUTHORED with depth — layered light (a directional glow), a deep vignette, subtle film grain (an inline SVG data URI), and a restrained brand SIGNATURE graphic — never a flat gradient. Ration ONE accent. Use generous negative space.

Hard rules:
- Colours: derive ground/ink/accent tokens from the brand palette. High contrast; text must be legible on the ground.
- Fonts: displayFamily / bodyFamily / accentFamily MUST be chosen from the ALLOWED list, matched to the brand's character. Reference them in CSS as var(--cb-display) etc.
- The stylesheet defines the brand's component classes; list each in "components" with a one-line use. The slide composer may use ONLY these classes.
- No <script>, no @import, no external URLs except inline data: URIs (for grain). The logo is available as var(--cb-logo).
- Keep the stylesheet under ~4000 characters.
- Use EXACTLY these enum values: typography.displayCase ∈ {upper|title|sentence}; typography.density ∈ {roomy|balanced|dense}; composition.align ∈ {flush-left|center|flush-right}; imagery.photoRole ∈ {hero|accent|none}. typography.displayWeight is a number 300–900.`;

function exampleBlock(): string {
  // The reference recipe, trimmed to what teaches shape + quality.
  const ex = {
    tokens: dynatosRecipe.tokens,
    typography: dynatosRecipe.typography,
    signature: dynatosRecipe.signature,
    stylesheet: dynatosRecipe.stylesheet,
    components: dynatosRecipe.components,
    composition: dynatosRecipe.composition,
    imagery: dynatosRecipe.imagery,
    voice: dynatosRecipe.voice,
  };
  return JSON.stringify(ex);
}

function evidenceBlock(e: RecipeEvidence): string {
  return [
    `NAME: ${e.name}`,
    e.category ? `CATEGORY: ${e.category}` : '',
    `PALETTE: ${(e.colors.palette ?? []).join(', ') || [e.colors.background, e.colors.text, e.colors.accent].filter(Boolean).join(', ')}`,
    `ROLES: background ${e.colors.background ?? '?'} · text ${e.colors.text ?? '?'} · accent ${e.colors.accent ?? '?'}`,
    `FONTS (site): heading ${e.fonts.detected?.heading ?? '?'} · body ${e.fonts.detected?.body ?? '?'}`,
    `FONTS (render, bundled): heading ${e.fonts.render.heading} · body ${e.fonts.render.body}`,
    e.styleDescriptor ? `STYLE: ${e.styleDescriptor}` : '',
    e.voice ? `VOICE: ${e.voice}` : '',
    `ALLOWED FONT FAMILIES: ${ALLOWED_FONTS.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Author a BrandRecipe from kit evidence (validated + stylesheet sanitised). */
export async function authorRecipe(
  evidence: RecipeEvidence,
  opts?: { model?: string; reasoning?: boolean },
): Promise<BrandRecipe> {
  const model = opts?.model ?? designModel();
  const user = [
    `WORKED EXAMPLE (a different brand — match this JSON shape + quality, DO NOT copy its colours/fonts/voice):`,
    exampleBlock(),
    ``,
    `NOW AUTHOR THE RECIPE FOR THIS BRAND — output only the JSON object:`,
    evidenceBlock(evidence),
  ].join('\n');

  const params = {
    model,
    max_tokens: 6000,
    system: SYSTEM,
    messages: [{ role: 'user' as const, content: user }],
  };
  const resp = await aiMessageLarge(opts?.reasoning ? withOpusReasoning(params) : params);
  const text = textOf(resp);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('recipe author: no JSON in response');
  const raw = JSON.parse(text.slice(start, end + 1));
  if (typeof raw.stylesheet === 'string') raw.stylesheet = sanitizeRecipeCss(raw.stylesheet);
  return brandRecipeSchema.parse(raw);
}
