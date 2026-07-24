/**
 * The recipe-author touchpoint: generate a brand's design system (a BrandRecipe)
 * from its kit evidence — ONCE per brand. This is the expensive, high-taste call
 * (design tier); every per-project compose then runs cheap against the result.
 *
 * Quality is everything here: the auto-authored recipe must be indistinguishable
 * from a hand-crafted one. Two mechanisms get it there — TWO diverse worked
 * examples (so the model learns the quality bar, not one brand's specifics) and
 * a self-critique/revise pass that holds the first draft to that bar. Output is
 * validated by brandRecipeSchema and its stylesheet is CSS-sanitised.
 */
import { brandRecipeSchema, type BrandRecipe } from '@contentbuilder/shared';
import { aiMessageLarge, textOf, modelFor, withOpusReasoning } from '../ai';
import { sanitizeRecipeCss } from '../cssSanitize';
import { dynatosRecipe, detailMastersRecipe } from './recipes';

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

const ENUMS = `Use EXACTLY these enum values: typography.displayCase ∈ {upper|title|sentence}; typography.density ∈ {roomy|balanced|dense}; composition.align ∈ {flush-left|center|flush-right}; imagery.photoRole ∈ {hero|accent|none}. typography.displayWeight is a number 300–900.`;

const SYSTEM = `You are an elite brand & art director. From a business's brand evidence you author its complete DESIGN SYSTEM — a "recipe" that EVERY future Instagram post is composed against, authored ONCE. Output STRICT JSON only (no prose, no fences), matching the shape of the worked examples EXACTLY.

THE BAR IS REFERENCE-GRADE: a stranger should see a rendered slide and assume a senior designer made it by hand for THIS brand. You are judged almost entirely on the "stylesheet" — real CSS scoped to .cb-slide, written against the --cb-* tokens, sized for the FULL 1080×1350 canvas. Both worked examples clear this bar; match it, do not copy them.

WHAT REFERENCE-GRADE MEANS (both examples do ALL of this):
1. TYPE THAT STOPS THE SCROLL — display headlines 80–120px in the display family (tight leading), body 30–34px, eyebrows 24–27px. Legible at feed-thumbnail size.
2. A CINEMATIC, AUTHORED BACKGROUND — NEVER a flat gradient. Layer it: a directional light/glow, a deep vignette, subtle film grain (an inline SVG feTurbulence data: URI), and ONE restrained brand SIGNATURE graphic (a god-ray, a ghosted monogram via var(--cb-logo), a hairline motif). Position with % so it adapts to any canvas.
3. A SIGNATURE MOVE that recurs on every slide (e.g. a gold italic-serif payoff line; a two-tone headline with the emphasis phrase in accent italic). Name it + give a one-line composer instruction in "signature".
4. A RICH component vocabulary — 8–12 classes (eyebrow, headline + a .sm variant, body, a tagline or quote, a rule, a cta button, a handle, a stat or a panel, a logo/wordmark, a .fill spacer), each listed in "components" with a one-line use.
5. ONE rationed accent. Generous negative space. Bottom-anchor with a .fill flex-grow spacer.
6. PER-FORMAT tuning in "formats" — keys "1080x1920" (story) and "1080x1080" (square). Every IG format is 1080 WIDE, so only VERTICAL metrics change: append a small override stylesheet (safe-area padding for stories ~210px top / ~240px bottom + a size bump; tighter padding + smaller sizes for square). Copy the examples' "formats" approach.

HARD RULES:
- Colours: derive ground/ink/accent from the brand palette; high contrast, text legible on the ground.
- Fonts: displayFamily / bodyFamily / accentFamily MUST come from the ALLOWED list, matched to the brand's character; reference as var(--cb-display) / var(--cb-body) / var(--cb-accent-family).
- No <script>, no @import, no external URLs except inline data: URIs (grain). The logo is var(--cb-logo).
- Base stylesheet under ~4500 characters. ${ENUMS}
- INVENT this brand's own colours/fonts/voice/signature/graphic — never reuse the examples'.`;

const CRITIQUE_SYSTEM = `You are a ruthless design director reviewing a junior's brand recipe against a reference bar. Output STRICT JSON only — the SAME recipe shape, nothing else.

Judge the recipe you are given on: (1) is the background CINEMATIC and layered, or a flat/timid gradient? (2) is there a real, named SIGNATURE move applied consistently? (3) is the display type feed-huge (80–120px) or timid? (4) is the component vocabulary rich (8–12 classes) or thin? (5) are per-format "formats" overrides present for story + square? (6) is ONE accent rationed with real negative space?

If ANY answer is below reference-grade, output an IMPROVED full recipe JSON that fixes it (keep the brand's colours/fonts/voice — improve the CRAFT). If it is already excellent, output it unchanged. Same JSON shape, ${ENUMS} STRICT JSON only, no prose.`;

/** Serialize a reference recipe as a worked example (the fields that teach shape + quality). */
function exemplarJson(r: BrandRecipe): string {
  return JSON.stringify({
    tokens: r.tokens,
    typography: r.typography,
    signature: r.signature,
    stylesheet: r.stylesheet,
    components: r.components,
    composition: r.composition,
    imagery: r.imagery,
    voice: r.voice,
    formats: r.formats,
  });
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

/** Pull the first JSON object out of a model response and validate it into a recipe. */
function parseRecipe(text: string): BrandRecipe {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('recipe author: no JSON in response');
  const raw = JSON.parse(text.slice(start, end + 1));
  if (typeof raw.stylesheet === 'string') raw.stylesheet = sanitizeRecipeCss(raw.stylesheet);
  if (raw.formats && typeof raw.formats === 'object') {
    for (const v of Object.values(raw.formats) as Array<{ stylesheet?: unknown }>) {
      if (v && typeof v.stylesheet === 'string') v.stylesheet = sanitizeRecipeCss(v.stylesheet);
    }
  }
  return brandRecipeSchema.parse(raw);
}

/** First draft: author a recipe from evidence, shown TWO diverse reference examples. */
async function authorOnce(model: string, evidence: RecipeEvidence, reasoning?: boolean): Promise<BrandRecipe> {
  const user = [
    `TWO WORKED EXAMPLES (different brands — match this JSON shape + quality bar; DO NOT copy their colours/fonts/voice/signature):`,
    `EXAMPLE A (dark, gold, condensed-caps coaching):`,
    exemplarJson(dynatosRecipe),
    ``,
    `EXAMPLE B (dark, bronze, elegant-serif detailing SaaS):`,
    exemplarJson(detailMastersRecipe),
    ``,
    `NOW AUTHOR THE RECIPE FOR THIS BRAND — output only the JSON object:`,
    evidenceBlock(evidence),
  ].join('\n');
  const params = { model, max_tokens: 7000, system: SYSTEM, messages: [{ role: 'user' as const, content: user }] };
  const resp = await aiMessageLarge(reasoning ? withOpusReasoning(params) : params);
  return parseRecipe(textOf(resp));
}

/** Second pass: hold the first draft to the reference bar and revise. */
async function critiqueAndRevise(
  model: string,
  evidence: RecipeEvidence,
  draft: BrandRecipe,
  reasoning?: boolean,
): Promise<BrandRecipe> {
  const user = [
    `BRAND: ${evidence.name}${evidence.category ? ` (${evidence.category})` : ''}`,
    `RECIPE TO REVIEW:`,
    JSON.stringify(draft),
    ``,
    `Review it against the reference bar and output the improved (or unchanged) recipe JSON.`,
  ].join('\n');
  const params = { model, max_tokens: 7000, system: CRITIQUE_SYSTEM, messages: [{ role: 'user' as const, content: user }] };
  const resp = await aiMessageLarge(reasoning ? withOpusReasoning(params) : params);
  return parseRecipe(textOf(resp));
}

/**
 * Author a BrandRecipe from kit evidence (validated + stylesheet sanitised).
 * By default runs a self-critique/revise pass; set opts.critique = false to skip
 * it (e.g. to halve cost in tests). The critique is best-effort — if it fails,
 * the first draft ships.
 */
export async function authorRecipe(
  evidence: RecipeEvidence,
  opts?: { model?: string; reasoning?: boolean; critique?: boolean },
): Promise<BrandRecipe> {
  const model = opts?.model ?? (await modelFor('recipe'));
  const draft = await authorOnce(model, evidence, opts?.reasoning);
  if (opts?.critique === false) return draft;
  try {
    return await critiqueAndRevise(model, evidence, draft, opts?.reasoning);
  } catch (err) {
    console.warn('[recipe] critique pass failed — shipping first draft:', err instanceof Error ? err.message : err);
    return draft;
  }
}
