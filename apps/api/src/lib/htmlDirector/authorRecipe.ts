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
import {
  clampText,
  migrateRecipe,
  ensureRecipeContrast,
  validateRecipeConsistency,
  type BrandRecipe,
} from '@contentbuilder/shared';
import { aiMessageLarge, textOf, modelFor, withOpusReasoning } from '../ai';
import { sanitizeRecipeCss } from '../cssSanitize';
import { dynatosRecipe, detailMastersRecipe } from './recipes';
import { verifyRecipeByRender } from './verifyRecipe';

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

const ENUMS = `Use EXACTLY these enum values: typography.displayCase ∈ {upper|title|sentence}; typography.density ∈ {roomy|balanced|dense}; composition.align ∈ {flush-left|center|flush-right}; imagery.photoRole ∈ {hero|accent|none}; motion.style ∈ {rise|fade|slide|punch|pop}; motion.pace ∈ {calm|balanced|punchy}; motion.ambient.style ∈ {parallax|push|drift|none}; motion.ambient.intensity ∈ {subtle|medium|strong}; motion.roles is an optional map of slide role → {style, pace} using those same values. typography.displayWeight is a number 300–900.`;

const SYSTEM = `You are an elite brand & art director. From a business's brand evidence you author its complete DESIGN SYSTEM — a "recipe" that EVERY future Instagram post is composed against, authored ONCE. Output STRICT JSON only (no prose, no fences), matching the shape of the worked examples EXACTLY.

THE BAR IS REFERENCE-GRADE: a stranger should see a rendered slide and assume a senior designer made it by hand for THIS brand. You are judged almost entirely on the "stylesheet" — real CSS scoped to .cb-slide, written against the --cb-* tokens, sized for the FULL 1080×1350 canvas. Both worked examples clear this bar; match it, do not copy them.

WHAT REFERENCE-GRADE MEANS (both examples do ALL of this):
1. TYPE SIZED FOR A PHONE, NOT FOR THE CANVAS. The canvas is 1080px wide but it is READ on a handset, where Instagram shows it about 393pt wide — so everything you author is seen at roughly a THIRD of the size you write. Divide by 2.75 to get what the reader actually gets, and design against THAT number. For reference: iOS body text is 17pt, Instagram's own caption is ~14pt, and under about 11pt people stop reading and the text becomes texture.
   Minimums (canvas px → what the phone shows). Go bigger freely; never go under:
     headline   88–130px  (32–47pt)   the hook — it must land at a glance
     stat       160–240px (58–87pt)   the one number worth showing off
     quote       72–96px  (26–35pt)
     body        44–56px  (16–20pt)   THE MESSAGE. Never smaller than 44.
     cta         48–60px  (17–22pt)   never among the smallest things on a slide
     tagline     44–56px  (16–20pt)
     panel       42–52px  (15–19pt)
     eyebrow     34–42px  (12–15pt)
     attr/handle/wordmark 34–40px (12–15pt)
   Body copy at 30px is a common and fatal mistake: it looks generous beside a 100px headline and arrives on the phone at 11pt. The gap between headline and body should come from making the HEADLINE big, never from making the body small.
2. A CINEMATIC, AUTHORED BACKGROUND — NEVER a flat gradient. Layer it: a directional light/glow, a deep vignette, subtle film grain (an inline SVG feTurbulence data: URI), and ONE restrained brand SIGNATURE graphic (a god-ray, a ghosted monogram via var(--cb-logo), a hairline motif). Position with % so it adapts to any canvas.
3. A SIGNATURE MOVE that recurs on every slide (e.g. a gold italic-serif payoff line; a two-tone headline with the emphasis phrase in accent italic). Name it + give a one-line composer instruction in "signature".
4. A RICH component vocabulary — 8–12 classes (eyebrow, headline + a .sm variant, body, a tagline or quote, a rule, a cta button, a handle, a stat, a LIST vocabulary — a .panel plus a .row for one enumerated item, since decks constantly need "three things" laid out as scannable lines rather than a paragraph — a logo/wordmark, a .fill spacer), each listed in "components" with a one-line use.
5. ONE rationed accent. Generous negative space. Bottom-anchor with a .fill flex-grow spacer.
6. PER-FORMAT tuning in "formats" — keys "1080x1920" (story) and "1080x1080" (square). Every IG format is 1080 WIDE, so only VERTICAL metrics change: append a small override stylesheet (safe-area padding for stories ~210px top / ~240px bottom + a size bump; tighter padding + smaller sizes for square). Copy the examples' "formats" approach.
7. A PHOTO TREATMENT — this brand's posts carry the user's own photographs, dropped into ".cb-shot" boxes the composer leaves in the layout. The app already sizes and crops those boxes; YOU decide what a photograph LOOKS LIKE on this brand. Add rules for ".cb-slide .cb-shot" (and "::after" for an overlay — never "::before", which carries the photograph itself) that make a plain snapshot read as this brand's imagery — e.g. the same film grain as the background, a duotone or warm/cool cast via a blend mode, a bottom scrim so type stays legible over it, a hairline edge or an inset shadow, a corner treatment consistent with --cb-radius. Keep it to 2–4 rules, and make it recognisably yours: two brands must not treat a photo the same way. Describe the intent in "imagery.treatment", and set "imagery.photoRole" honestly — "hero" if photography carries this brand, "accent" if it supports the type, "none" if this brand is purely typographic.
8. A MOTION signature in "motion" — how the brand MOVES when a post is exported as video. Pick the brand-default style + pace that match its character (e.g. a disciplined, forceful brand punches in punchy; a premium, unhurried one rises calm; an editorial one fades balanced), and describe it in one evocative line — as deliberate as its visual signature.
   Also set "motion.ambient" — the CONTINUOUS drift that runs under everything for the whole clip, which is what makes a still photograph read as footage instead of a slideshow. style ∈ {parallax|push|drift|none} (parallax = layers move at different depths; push = zoom only; drift = pan only), intensity ∈ {subtle|medium|strong}. Choose for the brand's character: a calm, premium brand wants "parallax"/"subtle"; an energetic one can take "medium". Ambient motion you consciously NOTICE is too strong — pick "strong" only for a deliberately restless brand, and "none" only if stillness is the point.
   Then make motion EDITORIAL with per-role overrides in "motion.roles" (keys: cover, statement, quote, feature, stat, list, cta — include only the ones worth differing). Each slide role has a different job, so it should move differently: a "stat" is the one moment to show off (use "pop"); a "quote" wants a calm "fade" so the words breathe; a "cta" should arrive decisively; a photo "cover" often reads best as a simple "fade" that lets the image work. Keep it coherent with the brand default — vary the accent, not the identity.

HARD RULES:
- Colours: derive ground/ink/accent from the brand palette; high contrast, text legible on the ground.
- Fonts: displayFamily / bodyFamily / accentFamily MUST come from the ALLOWED list, matched to the brand's character; reference as var(--cb-display) / var(--cb-body) / var(--cb-accent-family).
- No <script>, no @import, no external URLs except inline data: URIs (grain). The logo is var(--cb-logo).
- Do NOT set width/height/aspect-ratio/max-width/object-fit on .cb-shot — the app owns its geometry, and overriding it breaks the shape the composer asked for. Style its SURFACE only.
- Base stylesheet under ~4500 characters. ${ENUMS}
- INVENT this brand's own colours/fonts/voice/signature/graphic — never reuse the examples'.`;

const CRITIQUE_SYSTEM = `You are a ruthless design director reviewing a junior's brand recipe against a reference bar. Output STRICT JSON only — the SAME recipe shape, nothing else.

Judge the recipe you are given on: (1) is the background CINEMATIC and layered, or a flat/timid gradient? (2) is there a real, named SIGNATURE move applied consistently? (3) is the display type feed-huge (80–120px) or timid? (4) is the component vocabulary rich (8–12 classes) or thin? (5) are per-format "formats" overrides present for story + square? (6) is ONE accent rationed with real negative space? (7) does "motion" carry a style+pace that genuinely matches the brand's character, with an evocative one-line description AND per-role overrides in "motion.roles" that give a stat, a quote and a cta their own distinct entrance?

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
    motion: r.motion,
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
  // The voice block is free text, and its zod limits REJECT rather than trim —
  // a model that writes one sentence too many would fail the entire recipe
  // parse over prose. Clamp it here so length can never cost a brand its
  // design system, and so what survives ends on a word.
  if (raw.voice && typeof raw.voice === 'object') {
    const v = raw.voice as { description?: unknown; dos?: unknown; donts?: unknown };
    if (typeof v.description === 'string') v.description = clampText(v.description, 400);
    for (const k of ['dos', 'donts'] as const) {
      if (Array.isArray(v[k])) {
        v[k] = (v[k] as unknown[]).slice(0, 10).map((x) => clampText(String(x ?? ''), 120));
      }
    }
  }
  // Route model output through the migrator as well, so a recipe authored
  // against an older prompt/shape is normalised the same way a stored one is.
  return migrateRecipe(raw);
}

/**
 * Deterministic quality gates applied to every authored recipe — no model, no
 * judgement, no cost. Legibility is guaranteed rather than hoped for, and the
 * recipe is held to its own promises (a component class the CSS never defines
 * would render as an unstyled element on a real slide).
 */
function gate(recipe: BrandRecipe, label: string): BrandRecipe {
  const contrast = ensureRecipeContrast(recipe);
  for (const r of contrast.repairs) console.warn(`[recipe:${label}] contrast repair — ${r}`);
  const consistency = validateRecipeConsistency(contrast.recipe);
  if (consistency.dropped.length) {
    console.warn(
      `[recipe:${label}] dropped undefined component classes: ${consistency.dropped.join(', ')}`,
    );
  }
  if (consistency.unlisted.length) {
    console.warn(`[recipe:${label}] styled but unadvertised: ${consistency.unlisted.join(', ')}`);
  }
  return consistency.recipe;
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
  opts?: { model?: string; reasoning?: boolean; critique?: boolean; verify?: boolean },
): Promise<BrandRecipe> {
  const model = opts?.model ?? (await modelFor('recipe'));
  let recipe = gate(await authorOnce(model, evidence, opts?.reasoning), 'draft');

  if (opts?.critique !== false) {
    try {
      recipe = gate(await critiqueAndRevise(model, evidence, recipe, opts?.reasoning), 'revised');
    } catch (err) {
      console.warn(
        '[recipe] critique pass failed — keeping the draft:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // RENDER-VERIFY: actually look at what the recipe produces. Requires the web
  // renderer to be reachable, so it is opt-in (verify: true) and best-effort —
  // it can only ever improve the recipe, never block it.
  if (opts?.verify) {
    const seen = await verifyRecipeByRender(recipe, { format: '1080x1350' });
    console.warn(`[recipe] render-verify: ${seen.verdict} — ${seen.notes}`);
    if (seen.verdict === 'revised') recipe = gate(seen.recipe, 'verified');
  }

  return recipe;
}
