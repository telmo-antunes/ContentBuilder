/**
 * The recipe-author touchpoint: generate a brand's design system (a BrandRecipe)
 * from its kit evidence — ONCE per brand. This is the expensive, high-taste call
 * (design tier); every per-project compose then runs cheap against the result.
 *
 * Quality is everything here: the auto-authored recipe must be indistinguishable
 * from a hand-crafted one. Three mechanisms get it there:
 *
 *   1. THE BRAND'S ACTUAL HOMEPAGE. Five hexes, two font names and a one-line
 *      style descriptor are a thin brief for the highest-taste call in the
 *      product. When the kit has a homepage screenshot it is downscaled and
 *      attached to the USER message, so the author can read the site's real
 *      density, spacing and photography mood. Entirely best-effort.
 *   2. TWO diverse worked examples — chosen per brand from THREE reference
 *      recipes so the pair brackets the brand's own ground (see
 *      `pairingFor`). A light brand must see the light exemplar, or it gets
 *      pulled toward the dark-moody-premium of the seeded two.
 *   3. A self-critique pass that returns a PATCH rather than a whole recipe.
 *
 * Output is validated by brandRecipeSchema and its stylesheet is CSS-sanitised.
 *
 * COST / CACHING: the system prompt and the exemplar pair are static, so they
 * live in a prompt-cached SYSTEM prefix (one breakpoint after the exemplars).
 * Only the per-brand evidence/draft/screenshot rides in the user message. Since
 * the exemplars now vary by pairing, there are THREE possible prefixes rather
 * than one — cache hits happen per pairing, and the pairings are deliberately a
 * fixed set of three (not a continuum) so each stays warm. The screenshot is
 * per-brand and therefore NEVER touches the prefix. See lib/ai.ts.
 */
import sharp from 'sharp';
import type Anthropic from '@anthropic-ai/sdk';
import {
  clampText,
  composeRecipeLayers,
  currentVersions,
  migrateRecipe,
  ensureListSkeleton,
  ensureRecipeContrast,
  validateRecipeConsistency,
  relativeLuminance,
  PHONE_SCALE,
  SLIDE_ROLES,
  elevationReport,
  recipeStylesheetFor,
  type BrandRecipe,
} from '@contentbuilder/shared';
import { aiJson, cachedSystem, modelFor, withOpusReasoning, type AiJsonResult, type AiJsonTool } from '../ai';
import { sanitizeRecipeCss } from '../cssSanitize';
import { PROMPT_VERSION } from '../promptVersion';
import { getStorage } from '../../storage';
import {
  FRAGMENT_CONVENTION,
  carryForwardFragments,
  fillRecipeFragmentGaps,
  fillRecipeFragmentGapsMeasured,
  validateRecipeFragments,
} from './fragments';
import { dynatosRecipe, detailMastersRecipe, halftonePressRecipe } from './recipes';
import { checkRecipeLayout } from './verifyRecipe';
import { openRenderProbe, renderCheckEnabledByDefault } from './renderCheck';
import { LAYER_REMIT, RECIPE_LAYERS } from './refineLayer';
import { verifyRecipeByRender } from './verifyRecipe';

export interface RecipeEvidence {
  name: string;
  category?: string;
  colors: { primary?: string; secondary?: string; accent?: string; background?: string; text?: string; palette?: string[] };
  fonts: { detected?: { heading?: string; body?: string }; render: { heading: string; body: string } };
  logoTreatment?: string;
  styleDescriptor?: string;
  voice?: string;
  /**
   * The kit's stored homepage screenshot (`kit.homepageScreenshot`). OPTIONAL
   * on purpose: every caller that predates it keeps working unchanged, and a
   * brand whose capture failed simply authors from the text evidence.
   */
  screenshot?: { key?: string } | null;
}

/** Render fonts the export can actually load (bundled). The recipe must use these. */
const ALLOWED_FONTS = [
  'Inter', 'Montserrat', 'Poppins', 'Roboto', 'Open Sans', 'Lato', 'Work Sans',
  'Raleway', 'Nunito', 'Archivo', 'Oswald', 'Bebas Neue', 'Playfair Display',
  'Merriweather', 'Lora', 'Source Serif 4',
];

/**
 * THE DISPLAY-TYPE RANGE, in ONE place.
 *
 * The author's type table said "headline 88–130px" while the critic asked "is
 * display type feed-huge (80–120px)" — two prompts, two numbers, so the critic
 * could mark a compliant 128px headline as oversized and a 82px one as fine.
 * Both prompts now quote these, exactly like they already share `ENUMS`. The
 * on-phone equivalent is derived from the app's real feed scale rather than
 * restated, so the prompt can never drift from `enforceTypeFloor`.
 */
const HEADLINE_PX = { min: 88, max: 130 } as const;
const HEADLINE_RANGE_PX = `${HEADLINE_PX.min}–${HEADLINE_PX.max}px`;
const HEADLINE_RANGE_PT = `${Math.round(HEADLINE_PX.min / PHONE_SCALE)}–${Math.round(HEADLINE_PX.max / PHONE_SCALE)}pt`;

const ENUMS = `Use EXACTLY these enum values: typography.displayCase ∈ {upper|title|sentence}; typography.density ∈ {roomy|balanced|dense}; composition.align ∈ {flush-left|center|flush-right}; imagery.photoRole ∈ {hero|accent|none}; motion.style ∈ {rise|fade|slide|punch|pop}; motion.pace ∈ {calm|balanced|punchy}; motion.ambient.style ∈ {parallax|push|drift|none}; motion.ambient.intensity ∈ {subtle|medium|strong}; motion.roles is an optional map of slide role → {style, pace} using those same values. typography.displayWeight is a number 300–900.`;

const LAYERS_CONTRACT = `THE STYLESHEET IS AUTHORED IN THREE LAYERS, NOT ONE BLOB. Emit "layers" with exactly these three keys, each a complete, self-contained block of .cb-slide-scoped CSS:
- background — ${LAYER_REMIT.background}
- type — ${LAYER_REMIT.type}
- components — ${LAYER_REMIT.components}
They are concatenated in that order (background → type → components) to form the brand's stylesheet, so between them they must be exactly the sheet you would otherwise have written as one blob: no rule stated twice, nothing left out, and every class you list in "components" defined in one of them. Do NOT also emit a "stylesheet" field — it is derived from your layers.
WHY THE SPLIT: it is what lets this brand's owner later say "make the backgrounds quieter" and have that ONE layer regenerated while the type, the components and the signature stay byte-identical. A rule filed under the wrong layer is silently moved or lost the first time they do.`;

const SLIDE_ROLE_LIST = SLIDE_ROLES.join(', ');

const FRAGMENTS_CONTRACT = `YOU ALSO COMPOSE THE SLIDES, ONCE. Emit "fragments" — a map of slide role (${SLIDE_ROLE_LIST}) to ONE worked slide of that role, written in this brand's markup with the WORDS left as placeholders.
WHY: without them every future slide is re-invented by a cheap model reading your prose rules, which is where invented classes, drifting arrangements and duplicated copy come from. With them, a post is composed by SUBSTITUTION — your markup, this week's words, no model, no drift. Treat each fragment as the definitive layout of that role, not a hint: it is what the brand will actually look like.
${FRAGMENT_CONVENTION}
Cover every role you can lay out well. A role you leave out (or that names a class you never defined) simply falls back to the model, so a fragment you are unsure of costs nothing to omit — but a brand with all seven is a brand whose every post is composed exactly as you designed it.`;

export const RECIPE_AUTHOR_SYSTEM = `You are an elite brand & art director. From a business's brand evidence you author its complete DESIGN SYSTEM — a "recipe" that EVERY future Instagram post is composed against, authored ONCE. Deliver it by CALLING THE "author_recipe" TOOL with the whole design system as its argument, matching the shape of the worked examples EXACTLY. (If you cannot call the tool, output the same object as STRICT JSON only — no prose, no fences.)

THE BAR IS REFERENCE-GRADE: a stranger should see a rendered slide and assume a senior designer made it by hand for THIS brand. You are judged almost entirely on the CSS you author — real CSS scoped to .cb-slide, written against the --cb-* tokens, sized for the FULL 1080×1350 canvas. Both worked examples clear this bar; match it, do not copy them.

${LAYERS_CONTRACT}

${FRAGMENTS_CONTRACT}

THE IMAGE, WHEN ONE IS ATTACHED: if the user message opens with a screenshot, that is the brand's REAL HOMEPAGE — evidence no hex list can carry. Read it for how this brand actually behaves: its density (crowded and utilitarian, or acres of space), its rhythm and alignment, how big type is relative to everything else, how it uses its accent, the mood and treatment of its photography, whether it is flat and graphic or lit and atmospheric. INTERPRET it into a design system for a 1080×1350 Instagram slide; never transcribe it. A website is a wide, scrolling, interactive surface and a post is a single tall image read at arm's length, so nav bars, hero sections, buttons, cards and column grids do not carry across — the CHARACTER does. If no image is attached, author from the text evidence exactly as you otherwise would.

WHAT REFERENCE-GRADE MEANS (both examples do ALL of this):
1. TYPE SIZED FOR A PHONE, NOT FOR THE CANVAS. The canvas is 1080px wide but it is READ on a handset, where Instagram shows it about 393pt wide — so everything you author is seen at roughly a THIRD of the size you write. Divide by 2.75 to get what the reader actually gets, and design against THAT number. For reference: iOS body text is 17pt, Instagram's own caption is ~14pt, and under about 11pt people stop reading and the text becomes texture.
   Minimums (canvas px → what the phone shows). Go bigger freely; never go under:
     headline   ${HEADLINE_RANGE_PX} (${HEADLINE_RANGE_PT})   the hook — it must land at a glance
     stat       160–240px (58–87pt)   the one number worth showing off
     quote       72–96px  (26–35pt)
     body        44–56px  (16–20pt)   THE MESSAGE. Never smaller than 44.
     cta         48–60px  (17–22pt)   never among the smallest things on a slide
     tagline     44–56px  (16–20pt)
     panel       42–52px  (15–19pt)
     eyebrow     34–42px  (12–15pt)
     attr/handle/wordmark 34–40px (12–15pt)
   Body copy at 30px is a common and fatal mistake: it looks generous beside a 100px headline and arrives on the phone at 11pt. The gap between headline and body should come from making the HEADLINE big, never from making the body small.
2. A CINEMATIC, AUTHORED BACKGROUND — NEVER a flat gradient. Layer it: a directional light/glow, a deep vignette, subtle film grain (an inline SVG feTurbulence data: URI), and ONE restrained brand SIGNATURE graphic (a god-ray, a ghosted monogram via var(--cb-logo), a hairline motif). Position with % so it adapts to any canvas.\n   THE GLOW MUST NOT SIT IN THE SAME PLACE ON EVERY SLIDE. A single fixed position (e.g. "at 72% 0%") repeats identically down a seven-slide deck and reads as a rendering artifact rather than as art — worse when it clips at a frame edge. Author its position through custom properties with defaults, e.g. "radial-gradient(70% 48% at var(--cb-glow-x, 68%) var(--cb-glow-y, 4%), ...)", so the app can vary it per slide. Keep the glow fully inside the frame at its default, or let it bleed deliberately on more than one edge — never clipped hard at exactly one corner.
3. A SIGNATURE MOVE that recurs on every slide (e.g. a gold italic-serif payoff line; a two-tone headline with the emphasis phrase in accent italic). Name it + give a one-line composer instruction in "signature".
4. A RICH component vocabulary — 8–12 classes (eyebrow, headline + a .sm variant, body, a tagline or quote, a rule, a cta button, a handle, a stat, a LIST vocabulary — a .panel plus a .row for one enumerated item, since decks constantly need "three things" laid out as scannable lines rather than a paragraph — a logo/wordmark, a .fill spacer), each listed in "components" with a one-line use.
5. ONE rationed accent. Generous negative space. Bottom-anchor with a .fill flex-grow spacer.\n   ONE RADIUS SCALE AND ONE ELEVATION MODEL, applied to every surface you author. A real deck shipped three treatments side by side: a photo frame with a soft drop shadow, a list panel with a 1px stroke, and a cta button flat and hard-cornered. Two surfaces on one slide must never disagree about what "raised" looks like.\n   DECLARE IT AS A TOKEN, ONCE. Define "--cb-elev" in your ":root"/token block as this brand's single answer for a raised surface — e.g. "--cb-elev: 0 18px 40px rgba(0,0,0,.28)" for a shadow brand, "--cb-elev: none" for a flat one — and then have EVERY raised surface reference it: ".cb-shot", ".panel" and ".cta" each set "box-shadow: var(--cb-elev)" and take their corners from "var(--cb-radius)". A brand that reads as hairline-raised sets "--cb-elev: none" and declares "--cb-elev-line" for the stroke, used the same way. Writing a literal shadow or border directly onto one of those three classes is the failure this replaces: state the model once, reference it three times.
6. PER-FORMAT tuning in "formats" — keys "1080x1920" (story) and "1080x1080" (square). Every IG format is 1080 WIDE, so only VERTICAL metrics change: append a small override stylesheet (safe-area padding for stories ~210px top / ~240px bottom + a size bump; tighter padding + smaller sizes for square). Copy the examples' "formats" approach.
7. A PHOTO TREATMENT — this brand's posts carry the user's own photographs, dropped into ".cb-shot" boxes the composer leaves in the layout. The app already sizes and crops those boxes; YOU decide what a photograph LOOKS LIKE on this brand. Add rules for ".cb-slide .cb-shot" (and "::after" for an overlay — never "::before", which carries the photograph itself) that make a plain snapshot read as this brand's imagery — e.g. the same film grain as the background, a duotone or warm/cool cast via a blend mode, a bottom scrim so type stays legible over it, a hairline edge or an inset shadow, a corner treatment consistent with --cb-radius. Keep it to 2–4 rules, and make it recognisably yours: two brands must not treat a photo the same way. Describe the intent in "imagery.treatment", and set "imagery.photoRole" honestly — "hero" if photography carries this brand, "accent" if it supports the type, "none" if this brand is purely typographic.
8. A MOTION signature in "motion" — how the brand MOVES when a post is exported as video. Pick the brand-default style + pace that match its character (e.g. a disciplined, forceful brand punches in punchy; a premium, unhurried one rises calm; an editorial one fades balanced), and describe it in one evocative line — as deliberate as its visual signature.
   Also set "motion.ambient" — the OPENING CAMERA MOVE, which is what makes a still photograph read as footage instead of a slideshow. It runs for the first three seconds of a slide and then lands: every layer starts offset and arrives at the framing the user chose, so the picture is never left cropped by the motion. style ∈ {parallax|push|drift|none} (parallax = layers arrive at different depths; push = zoom only; drift = pan only), intensity ∈ {subtle|medium|strong} — how far from rest it starts. Choose for the brand's character: a calm, premium brand wants "parallax"/"subtle"; an energetic one can take "medium". Pick "strong" only for a deliberately restless brand, and "none" only if stillness is the point.
   Then make motion EDITORIAL with per-role overrides in "motion.roles" (keys: cover, statement, quote, feature, stat, list, cta — include only the ones worth differing). Each slide role has a different job, so it should move differently: a "stat" is the one moment to show off (use "pop"); a "quote" wants a calm "fade" so the words breathe; a "cta" should arrive decisively; a photo "cover" often reads best as a simple "fade" that lets the image work. Keep it coherent with the brand default — vary the accent, not the identity.

THE GROUND — BAD vs GOOD. A flat gradient is the single most common failure, so anchor on this pair rather than on adjectives:
BAD (one gradient; nothing to look at, nothing that says whose brand it is):
  .cb-slide{ background: linear-gradient(180deg,#101010,#242424); }
GOOD (a directional light, a vignette, grain, and ONE signature graphic):
  .cb-slide{ background:
    radial-gradient(80% 52% at 18% -6%, rgba(255,214,120,.22), transparent 60%),
    radial-gradient(120% 90% at 50% 124%, rgba(0,0,0,.60), transparent 56%),
    linear-gradient(172deg,#1d1a14,#0a0906); }
  .cb-slide::before{ content:""; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.07; mix-blend-mode:overlay;
    background-image:url("data:image/svg+xml,…feTurbulence…"); }
  .cb-slide::after{ content:""; position:absolute; right:-80px; bottom:-90px; width:560px; height:560px; z-index:0; pointer-events:none;
    background:var(--cb-logo) center/contain no-repeat; opacity:.05; }
On a LIGHT ground the same three layers apply but the recipe changes: grain must blend with "multiply" (an overlay blend disappears on paper), the vignette is a warm grey rather than black (black reads as dirt), and the "light" is a near-white bloom.

HARD RULES:
- Colours: derive ground/ink/accent from the brand palette; high contrast, text legible on the ground.
- Fonts: displayFamily / bodyFamily / accentFamily MUST come from the ALLOWED list, matched to the brand's character; reference as var(--cb-display) / var(--cb-body) / var(--cb-accent-family).
- No <script>, no @import, no external URLs except inline data: URIs (grain). The logo is var(--cb-logo).
- Do NOT set width/height/aspect-ratio/max-width/object-fit on .cb-shot — the app owns its geometry, and overriding it breaks the shape the composer asked for. Style its SURFACE only.
- Same for a LIST ROW: the app lays a row out as a marker in its own gutter with the item hanging off it and the detail on its own line beneath. Do NOT set display:flex on the row, and NEVER push the detail right with margin-left:auto — that reads fine at 26px and collapses into a right-drifting mess at the sizes a phone needs. Style the SURFACE: the row's colour and size, a hairline between rows, the detail's quieter tone. To choose the bullet, set the --cb-marker custom property on .cb-slide (e.g. --cb-marker: "\u00b7"), and do not author a marker element.
- The three layers together under ~4500 characters (the per-format overrides in "formats" are separate). ${ENUMS}
- INVENT this brand's own colours/fonts/voice/signature/graphic — never reuse the examples'.`;

export const RECIPE_CRITIQUE_SYSTEM = `You are a ruthless design director reviewing a junior's brand recipe against a reference bar. Deliver your review by CALLING THE "review_recipe" TOOL. (If you cannot call the tool, output the same object as STRICT JSON only, no prose, no fences.)

Judge the recipe you are given on: (1) is the background CINEMATIC and layered, or a flat/timid gradient? (2) is there a real, named SIGNATURE move applied consistently? (3) is the display type feed-huge (${HEADLINE_RANGE_PX}) or timid? (4) is the component vocabulary rich (8–12 classes) or thin? (5) are per-format "formats" overrides present for story + square? (6) is ONE accent rationed with real negative space? (7) does "motion" carry a style+pace that genuinely matches the brand's character, with an evocative one-line description AND per-role overrides in "motion.roles" that give a stat, a quote and a cta their own distinct entrance?

REPLY WITH A VERDICT, AND A PATCH — NOT THE WHOLE RECIPE. Exactly one of:
  {"verdict":"pass"}
  {"verdict":"revise","patch":{ …ONLY the fields you are changing… }}

How the patch is applied: it is merged onto the recipe you were given. Nested objects merge KEY BY KEY, so {"patch":{"tokens":{"accent":"#c8992f"}}} changes the accent and nothing else, and {"patch":{"motion":{"roles":{"stat":{"style":"pop","pace":"punchy"}}}}} adds one role. Arrays and strings REPLACE wholesale, so a "components" or "stylesheet" patch must be the COMPLETE new value, and a "formats" patch must give each format you touch its complete stylesheet.

CSS LIVES IN LAYERS. When the recipe you are given has a "layers" object, its CSS is authored as three concatenated layers — background (the ground and its art), type (the text classes' scale and families), components (the boxes, rules, buttons, panels, the .cb-shot photo treatment). Patch the LAYER you are changing, with that layer's complete new CSS: {"patch":{"layers":{"background":"…the whole background layer…"}}}. The layers you leave alone stay byte-identical, which is the entire point — never patch "stylesheet" on such a recipe, it is derived from the layers. Only a recipe with NO "layers" object is patched through "stylesheet".

Never re-emit a field you did not change — copying back an unchanged stylesheet costs more than the review and risks corrupting CSS that was already right. If the recipe is already reference-grade, {"verdict":"pass"} is the correct answer and re-typing it is not.

Keep the brand's colours, fonts and voice — improve the CRAFT. ${ENUMS} No prose.`;

// ── The two structured-output tools ─────────────────────────────────────────

/**
 * THE AUTHOR'S OUTPUT SHAPE, as a tool the model is FORCED to call. The payload
 * then arrives already parsed, instead of being cut out of prose with
 * `indexOf('{')` … `lastIndexOf('}')`.
 *
 * Deliberately LOOSE — object-shaped fields carry a description rather than a
 * full sub-schema. The worked exemplars teach the shape far better than a schema
 * could, `brandRecipeSchema` (zod) remains the actual gate, and a tight schema
 * here would reject a good recipe over a field zod would have `.catch()`-ed.
 * What the schema IS for: naming the required fields — above all `layers`, which
 * the prompt now demands and which nothing previously produced.
 *
 * Module-level and constant: the tool list renders before `system`, so these
 * bytes are part of the cached prefix and must never vary per call.
 */
const AUTHOR_TOOL: AiJsonTool = {
  name: 'author_recipe',
  description:
    "Deliver the brand's finished design system. Every field takes the same shape as the worked examples, except that the CSS is delivered as the three layers rather than one flat stylesheet.",
  schema: {
    type: 'object',
    properties: {
      tokens: {
        type: 'object',
        description:
          'ground, groundAlt, ink, inkMuted, accent, accentAlt, line, displayFamily, bodyFamily, accentFamily, radius.',
      },
      typography: { type: 'object', description: 'displayCase, displayWeight, displayTracking, density.' },
      signature: {
        type: 'object',
        description: 'name, description, and emphasisWrap {tag, className} — the recurring signature move.',
      },
      layers: {
        type: 'object',
        description:
          'The brand stylesheet, split in three. Concatenated background → type → components to form the sheet, so together they are the complete CSS and no rule appears twice.',
        properties: {
          background: { type: 'string', description: LAYER_REMIT.background },
          type: { type: 'string', description: LAYER_REMIT.type },
          components: { type: 'string', description: LAYER_REMIT.components },
        },
        required: [...RECIPE_LAYERS],
      },
      components: {
        type: 'array',
        description:
          'The 8–12 brand classes the slide composer may use — each one defined in one of the layers.',
        items: {
          type: 'object',
          properties: {
            className: { type: 'string' },
            use: { type: 'string', description: 'One line on when a composer should reach for it.' },
          },
          required: ['className', 'use'],
        },
      },
      fragments: {
        type: 'object',
        description:
          'One worked slide per role, in this brand\'s markup with the copy left as {{placeholder}} holes — what every future post of that role is composed by substituting into. Keys are slide roles; each value is the inner markup of .cb-slide.',
        properties: Object.fromEntries(
          SLIDE_ROLES.map((role) => [
            role,
            { type: 'string', description: `The worked "${role}" slide, with {{…}} holes for its copy.` },
          ]),
        ),
      },
      composition: { type: 'object', description: 'align, and patterns[] (one arrangement per line).' },
      imagery: { type: 'object', description: 'treatment, photoRole, texture, subjects[].' },
      voice: { type: 'object', description: 'description, dos[], donts[].' },
      formats: {
        type: 'object',
        description: 'Per-format overrides keyed "1080x1920" and "1080x1080", each {stylesheet}.',
      },
      motion: { type: 'object', description: 'style, pace, description, ambient, roles.' },
      surfaces: { type: 'object', description: 'Optional inverse surface {ground, ink, accent, inkMuted}.' },
      rationale: { type: 'object', description: 'One line each on palette, type, signature, motion.' },
    },
    required: ['tokens', 'signature', 'layers', 'components', 'fragments', 'composition', 'imagery', 'voice'],
  },
};

/** The critique's `{verdict, patch}` envelope, as a forced tool. */
const CRITIQUE_TOOL: AiJsonTool = {
  name: 'review_recipe',
  description:
    'Deliver the review: a verdict, plus — only when revising — a patch carrying ONLY the fields that change.',
  schema: {
    type: 'object',
    properties: {
      verdict: {
        type: 'string',
        enum: ['pass', 'revise'],
        description: '"pass" when the recipe is already reference-grade, otherwise "revise".',
      },
      patch: {
        type: 'object',
        description:
          'Only the fields you are changing, merged onto the recipe key by key. Patch layers.<background|type|components> with that layer\'s complete new CSS; patch "stylesheet" only on a recipe that has no layers. Omit entirely when the verdict is "pass".',
      },
      notes: { type: 'string', description: 'Optional one line on what you changed and why.' },
    },
    required: ['verdict'],
  },
};

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

/** One exemplar, with the one-line label that tells the model what it is. */
interface Exemplar {
  label: string;
  recipe: BrandRecipe;
}

const DYNATOS: Exemplar = { label: 'dark ground, gold accent, condensed-caps coaching', recipe: dynatosRecipe };
const DETAILMASTERS: Exemplar = { label: 'dark ground, bronze accent, elegant-serif detailing SaaS', recipe: detailMastersRecipe };
const HALFTONE: Exemplar = { label: 'LIGHT paper ground, ink type, riso-blue accent, heavy-grotesque print studio', recipe: halftonePressRecipe };

/**
 * WHICH TWO EXAMPLES A BRAND SEES.
 *
 * The prompt promised "two diverse worked examples" and then showed everyone the
 * same two dark, premium, gold-on-black recipes — so every authored brand drifted
 * toward dark-moody-premium, and a brand whose own site is white paper had
 * nothing at all to learn from. The pair is now chosen from the brand's own
 * ground so it BRACKETS or MATCHES that ground.
 *
 * Deliberately THREE fixed pairings rather than a continuum. The exemplars sit
 * in the prompt-cached SYSTEM prefix, so every distinct pair is a distinct cache
 * entry: three keeps each one warm (many brands per entry), where a per-brand
 * selection would mean a cache write on every call and cost more than it saved.
 */
export type Pairing = 'dark' | 'mixed' | 'light';

/** WCAG relative-luminance cuts: below 0.18 is a night ground, 0.5 and up is paper. */
const DARK_BELOW = 0.18;
const LIGHT_FROM = 0.5;

const PAIRINGS: Record<Pairing, [Exemplar, Exemplar]> = {
  // A dark brand learns most from the two dark recipes — but they are chosen to
  // differ in everything except tone (condensed caps vs elegant serif).
  dark: [DYNATOS, DETAILMASTERS],
  // A mid-tone ground is bracketed from both sides.
  mixed: [DETAILMASTERS, HALFTONE],
  // A light brand leads with the light recipe; the dark one keeps the range
  // open so it does not simply copy the paper brand.
  light: [HALFTONE, DYNATOS],
};

/** A usable `#rgb`/`#rrggbb` ground, or undefined (rgb()/named/absent colours). */
function groundHex(e: RecipeEvidence): string | undefined {
  const candidates = [e.colors.background, ...(e.colors.palette ?? [])];
  return candidates.find((c) => typeof c === 'string' && /^#?[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(c.trim()));
}

/**
 * The pairing for a brand, from the WCAG relative luminance of its ground.
 * Deterministic and model-free. An unreadable/absent ground falls back to
 * 'dark', which is both the historical behaviour and the common case.
 */
export function pairingFor(evidence: RecipeEvidence): Pairing {
  const hex = groundHex(evidence);
  if (!hex) return 'dark';
  const l = relativeLuminance(hex);
  if (l >= LIGHT_FROM) return 'light';
  if (l < DARK_BELOW) return 'dark';
  return 'mixed';
}

/**
 * The worked exemplars for one pairing, serialized ONCE at module load so each
 * is byte-identical on every call. They used to open the per-call USER message;
 * they now live in the SYSTEM prefix so a single prompt-cache breakpoint covers
 * SYSTEM + exemplars (the expensive ~90% of every author call). The model reads
 * the same content in the same order — system renders before messages — and
 * only per-brand content stays in the user turn.
 */
function exemplarsFor([a, b]: [Exemplar, Exemplar]): string {
  return [
    `TWO WORKED EXAMPLES (different brands — match this JSON shape + quality bar; DO NOT copy their colours/fonts/voice/signature).`,
    `NOTE ON SHAPE: both examples were hand-authored before the layer split and so show their CSS as a single flat "stylesheet". Read them for the CRAFT — the layering of the ground, the type scale, the component vocabulary — and then emit that same CSS as the THREE LAYERS described above. Everything else about their shape is exactly what your output should look like.`,
    `EXAMPLE A (${a.label}):`,
    exemplarJson(a.recipe),
    ``,
    `EXAMPLE B (${b.label}):`,
    exemplarJson(b.recipe),
  ].join('\n');
}

/**
 * Cached system arrays, built once — one per pairing. Everything inside is
 * brand-INDEPENDENT, so the candidates flow (2–3 concurrent author calls per
 * brand) and every later brand of the same tonality read the same cache entry
 * after the first write. Per-brand content NEVER goes in here — not the
 * evidence, and above all not the homepage screenshot. See lib/ai.ts.
 */
const AUTHOR_SYSTEMS: Record<Pairing, Anthropic.TextBlockParam[]> = {
  dark: cachedSystem(`${RECIPE_AUTHOR_SYSTEM}\n\n${exemplarsFor(PAIRINGS.dark)}`),
  mixed: cachedSystem(`${RECIPE_AUTHOR_SYSTEM}\n\n${exemplarsFor(PAIRINGS.mixed)}`),
  light: cachedSystem(`${RECIPE_AUTHOR_SYSTEM}\n\n${exemplarsFor(PAIRINGS.light)}`),
};
const CRITIQUE_SYSTEM_CACHED = cachedSystem(RECIPE_CRITIQUE_SYSTEM);

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

type Json = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The first JSON object in a model reply, or a throw.
 *
 * THE FALLBACK PATH ONLY. Both calls force a tool, so the payload normally
 * arrives already parsed; this string-scraping survives for the replies that
 * carry no tool_use block — an older model, a refusal retry that landed
 * elsewhere, a request the API declined to take tools on.
 */
function firstJsonObject(text: string, what: string): Json {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`recipe ${what}: no JSON in response`);
  const raw: unknown = JSON.parse(text.slice(start, end + 1));
  if (!isPlainObject(raw)) throw new Error(`recipe ${what}: JSON is not an object`);
  return raw;
}

/** The reply's payload: the forced tool's input, else the scraped text. */
function jsonOf(reply: AiJsonResult, what: string): Json {
  if (reply.json) return reply.json;
  console.warn(`[recipe] ${what}: no tool_use block — falling back to reading JSON out of the text`);
  return firstJsonObject(reply.text, what);
}

/**
 * Make raw model output safe to validate, IN PLACE. Runs on a whole authored
 * recipe and on a critique patch alike, so a stylesheet that arrives in a patch
 * is sanitised exactly like one that arrives in a full draft.
 */
function normalizeRaw(raw: Json): Json {
  if (typeof raw.stylesheet === 'string') raw.stylesheet = sanitizeRecipeCss(raw.stylesheet);
  // Each authored LAYER is CSS in its own right, so it is sanitised in its own
  // right — a `@import` smuggled into the type layer must die there, not survive
  // because only the composed sheet was ever checked.
  if (isPlainObject(raw.layers)) {
    for (const k of RECIPE_LAYERS) {
      const css = (raw.layers as Json)[k];
      if (typeof css === 'string') (raw.layers as Json)[k] = sanitizeRecipeCss(css);
    }
  }
  if (isPlainObject(raw.formats)) {
    for (const v of Object.values(raw.formats) as Array<{ stylesheet?: unknown }>) {
      if (v && typeof v.stylesheet === 'string') v.stylesheet = sanitizeRecipeCss(v.stylesheet);
    }
  }
  // The voice block is free text, and its zod limits REJECT rather than trim —
  // a model that writes one sentence too many would fail the entire recipe
  // parse over prose. Clamp it here so length can never cost a brand its
  // design system, and so what survives ends on a word.
  if (isPlainObject(raw.voice)) {
    const v = raw.voice as { description?: unknown; dos?: unknown; donts?: unknown };
    if (typeof v.description === 'string') v.description = clampText(v.description, 400);
    for (const k of ['dos', 'donts'] as const) {
      if (Array.isArray(v[k])) {
        v[k] = (v[k] as unknown[]).slice(0, 10).map((x) => clampText(String(x ?? ''), 120));
      }
    }
  }
  return raw;
}

/**
 * KEEP `stylesheet` EQUAL TO THE COMPOSITION OF `layers`, IN PLACE.
 *
 * The renderer paints the layers when they exist (`recipeStylesheetFor`), but
 * `validateRecipeConsistency` discovers which classes the CSS defines by reading
 * ONLY `stylesheet` — so a layered recipe whose `stylesheet` was stale, empty or
 * flat would have every component class "dropped as undefined" and render a
 * slide of unstyled divs. Derived with the shared composition the renderer
 * itself uses, so the two can never disagree.
 *
 * A payload with no layers is untouched: every recipe authored before this, and
 * every stored one, keeps working exactly as it does today.
 */
function deriveStylesheet(raw: Json): Json {
  if (!isPlainObject(raw.layers)) return raw;
  const l = raw.layers as Json;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const composed = composeRecipeLayers({
    background: str(l.background),
    type: str(l.type),
    components: str(l.components),
  });
  if (composed) raw.stylesheet = composed;
  return raw;
}

/** Validate a model-authored payload into a recipe. */
function parseRecipe(raw: Json): BrandRecipe {
  // Route model output through the migrator as well, so a recipe authored
  // against an older prompt/shape is normalised the same way a stored one is.
  return migrateRecipe(deriveStylesheet(normalizeRaw(raw)));
}

/**
 * Merge a critique PATCH onto a draft.
 *
 * Objects merge key by key (so a patch may change one token, or add one motion
 * role, without restating its siblings); arrays and scalars REPLACE wholesale,
 * because there is no sane element-wise merge for a component vocabulary or a
 * list of composition patterns — a half-merged array would be a design nobody
 * authored. The critic's prompt states these semantics verbatim.
 */
function mergePatch(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = isPlainObject(v) && isPlainObject(cur) ? mergePatch(cur, v) : v;
  }
  return out;
}

/** Keys that belong to the verdict envelope rather than to the recipe itself. */
const VERDICT_KEYS = new Set(['verdict', 'patch', 'notes', 'reason', 'rationale_for_change']);

/**
 * Apply a critique reply to the draft.
 *
 * `{"verdict":"pass"}` returns the draft untouched — no merge, no re-validation,
 * no chance to corrupt CSS that was already right. `{"verdict":"revise","patch":…}`
 * merges only the fields the critic changed.
 *
 * FALLBACK: a model that ignores the protocol and returns a full recipe (the old
 * contract, or a future drift) still works — the whole object minus the envelope
 * keys is treated as the patch, and merging a complete recipe onto the draft
 * yields that complete recipe. Anything unparseable throws, and the caller keeps
 * the draft.
 */
function applyCritique(raw: Json, draft: BrandRecipe): BrandRecipe {
  const verdict = typeof raw.verdict === 'string' ? raw.verdict.trim().toLowerCase() : '';
  if (verdict === 'pass') return draft;

  const patch = isPlainObject(raw.patch)
    ? raw.patch
    : (Object.fromEntries(Object.entries(raw).filter(([k]) => !VERDICT_KEYS.has(k))) as Json);
  if (!Object.keys(patch).length) return draft;

  const merged = mergePatch(draft as unknown as Json, normalizeRaw(patch));
  /**
   * WHICH CSS WINS after a patch. A patch that touches `layers` is merged layer
   * by layer and `stylesheet` is then re-derived from the result — so patching
   * one layer leaves the other two byte-identical, which is the whole point.
   *
   * A patch that rewrites `stylesheet` WITHOUT layers is a whole-sheet rewrite:
   * the layer split no longer describes that CSS, and guessing a new split would
   * silently move rules between layers on the next refine. So the layers are
   * dropped and the flat sheet becomes the truth — the same honest choice
   * `refineLayer` makes for an unlayered recipe. Anything else would leave the
   * critic's fix in a field the renderer never reads.
   */
  if (isPlainObject(patch.layers)) return migrateRecipe(deriveStylesheet(merged));
  if (typeof patch.stylesheet === 'string' && isPlainObject(merged.layers)) {
    console.warn('[recipe] critique rewrote the whole stylesheet — dropping the layer split it no longer describes');
    delete merged.layers;
  }
  return migrateRecipe(merged);
}

/**
 * Deterministic quality gates applied to every authored recipe — no model, no
 * judgement, no cost. Legibility is guaranteed rather than hoped for, and the
 * recipe is held to its own promises (a component class the CSS never defines
 * would render as an unstyled element on a real slide).
 */
function gate(recipe: BrandRecipe, label: string, previous?: BrandRecipe): BrandRecipe {
  const contrast = ensureRecipeContrast(recipe);
  for (const r of contrast.repairs) console.warn(`[recipe:${label}] contrast repair — ${r}`);
  // A list row's SKELETON belongs to the app (see ensureListSkeleton). Strip the
  // brand's competing structure once, here, instead of overriding it at every
  // render — the recipe that gets stored is then already correct.
  const list = ensureListSkeleton(contrast.recipe);
  for (const sel of list.repairs) {
    console.warn(`[recipe:${label}] list skeleton stripped from "${sel}" — the app owns row layout`);
  }
  const consistency = validateRecipeConsistency(list.recipe);
  if (consistency.dropped.length) {
    console.warn(
      `[recipe:${label}] dropped undefined component classes: ${consistency.dropped.join(', ')}`,
    );
  }
  if (consistency.unlisted.length) {
    console.warn(`[recipe:${label}] styled but unadvertised: ${consistency.unlisted.join(', ')}`);
  }
  /**
   * Did the elevation rule actually bite? v6 asked for one elevation model and
   * the next re-author shipped three treatments again. The rule now names a
   * token, which makes compliance readable rather than aspirational — so read
   * it, and say so when a brand still writes a literal shadow onto a surface.
   */
  const elevation = elevationReport(recipeStylesheetFor(consistency.recipe, '1080x1350'));
  if (elevation.literal.length) {
    console.warn(
      `[recipe:${label}] elevation stated ${elevation.literal.length + elevation.usesToken.length} times, not once — ` +
        `${elevation.literal.join(', ')} raise themselves with a literal shadow/border instead of var(--cb-elev)`,
    );
  } else if (elevation.declaresToken && elevation.usesToken.length) {
    console.warn(`[recipe:${label}] one elevation model, referenced by ${elevation.usesToken.join(', ')}`);
  }
  // The same treatment for the reference fragments: a fragment that is not
  // sanitiser-clean, names a class the recipe never defined, or breaks the
  // placeholder convention is DROPPED, and that role composes the old way. Runs
  // after the consistency pass, so a fragment is judged against the component
  // vocabulary that actually survived.
  // Stamp WHAT MADE THIS. Every recipe leaving this function was designed by
  // today's prompts, so it carries today's versions; anything without a stamp
  // predates versioning and is treated as behind.
  const stamped = {
    ...consistency.recipe,
    promptVersions: currentVersions('brand') as Record<string, number>,
  };
  const fragments = validateRecipeFragments(stamped);
  for (const d of fragments.dropped) {
    console.warn(`[recipe:${label}] dropped the "${d.role}" reference fragment — ${d.reason}`);
  }
  /**
   * A fragment the replaced recipe had and this one does not is CARRIED, not
   * merely reported. Warning about the regression and storing the recipe anyway
   * is what cost every `statement` slide a model call for three weeks.
   *
   * BEFORE the gap fill, so a carried fragment is held to exactly the same
   * standard as an authored one — it gains the holes its role turns out to need
   * and a photo slot if its role should have one.
   */
  const carry = carryForwardFragments(fragments.recipe, previous);
  for (const d of carry.unusable) {
    console.warn(
      `[recipe:${label}] REGRESSION: the recipe being replaced had a "${d.role}" fragment, this one does not, ` +
        `and the old one no longer fits this recipe (${d.reason}) — that role costs a model call per slide`,
    );
  }
  if (carry.carried.length) {
    console.warn(
      `[recipe:${label}] carried the "${carry.carried.join('", "')}" fragment(s) forward from the recipe being replaced`,
    );
  }
  // A fragment with one fewer hole than its role turns out to need sends every
  // such slide to the composer — a real model call for an arrangement this
  // brand already wrote down. The gaps are filled with the brand's own classes,
  // in its own composition order, so that call is never paid again.
  const filled = fillRecipeFragmentGaps(carry.recipe);
  for (const r of filled.repairs) {
    console.warn(`[recipe:${label}] "${r.role}" fragment gained a hole for: ${r.added.join(', ')}`);
  }
  /**
   * FRAGMENT COVERAGE, named role by role. A role with no fragment falls back to
   * a per-slide model call: slower, less predictable, and the exact path that
   * once rendered the model's own reasoning onto a slide.
   */
  const roles = Object.keys(filled.recipe.fragments ?? {});
  const missing = SLIDE_ROLES.filter((r) => !roles.includes(r));
  if (roles.length) {
    console.warn(
      `[recipe:${label}] ${roles.length}/${SLIDE_ROLES.length} reference fragment(s): ${roles.join(', ')}` +
        (missing.length ? ` — no fragment for ${missing.join(', ')}, those roles cost a model call per slide` : ''),
    );
  }
  return filled.recipe;
}

/**
 * Re-derive the fragment holes against a real render, and report what changed.
 *
 * One probe for the whole recipe: a scaffold per candidate would cost a
 * throwaway business, kit and project each, and the fragments of one brand all
 * measure against the same stylesheet anyway.
 */
async function measureFragmentGaps(recipe: BrandRecipe, label: string): Promise<BrandRecipe> {
  const roles = Object.keys(recipe.fragments ?? {});
  if (!roles.length) return recipe;

  const probe = await openRenderProbe(recipe, '1080x1350', [{ html: '<div></div>', role: 'statement' }]);
  try {
    const out = await fillRecipeFragmentGapsMeasured(recipe, async (_role, html) => {
      const [verdict] = await probe.measure([{ index: 0, html }]);
      if (!verdict || verdict.state === 'unknown') return 'unknown';
      return verdict.state === 'overflows' ? 'overflows' : 'fits';
    });

    for (const r of out.repairs)
      console.warn(`[recipe:${label}] "${r.role}" fragment gained a hole for: ${r.added.join(', ')}`);
    for (const d of out.declined)
      console.warn(
        `[recipe:${label}] "${d.role}" does NOT get a "${d.part}" hole — the slide overflows with it filled, ` +
          `so that slide composes through the model when the copy needs it`,
      );
    if (out.unmeasured.length)
      console.warn(
        `[recipe:${label}] could not measure the candidate hole(s) for: ${out.unmeasured.join(', ')} — kept as filled`,
      );
    return out.recipe;
  } finally {
    await probe.close().catch(() => {});
  }
}

/**
 * THE HOMEPAGE SCREENSHOT, sized for a prompt.
 *
 * The stored capture is a full 1366×900 PNG — several times more tokens than
 * the design needs, since the author is reading density, rhythm and mood rather
 * than pixels. It is downscaled to a ~1000px long edge and re-encoded as JPEG,
 * which is where the cost actually lives, and refused outright above a ceiling
 * so a pathological asset can never blow up an author call.
 */
const SHOT_LONG_EDGE = 1000;
const SHOT_JPEG_QUALITY = 75;
/** Hard ceiling on the ENCODED bytes we will attach. A real capture lands ~10× under it. */
const SHOT_MAX_BYTES = 900_000;

/**
 * The brand's homepage as an image content block, or null.
 *
 * BEST-EFFORT BY CONSTRUCTION: no screenshot, a key storage cannot read, bytes
 * sharp cannot decode, or an oversized encode all return null, and the author
 * call then goes out exactly as it did before this existed. A brand must never
 * lose its design system because a screenshot went missing.
 */
async function screenshotBlock(evidence: RecipeEvidence): Promise<Anthropic.ImageBlockParam | null> {
  const key = evidence.screenshot?.key;
  if (!key) return null;
  try {
    const raw = await getStorage().read(key);
    const jpeg = await sharp(raw)
      .resize(SHOT_LONG_EDGE, SHOT_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: SHOT_JPEG_QUALITY })
      .toBuffer();
    if (jpeg.byteLength > SHOT_MAX_BYTES) {
      console.warn(`[recipe] homepage screenshot too large after resize (${jpeg.byteLength}B) — authoring without it`);
      return null;
    }
    return {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') },
    };
  } catch (err) {
    console.warn(
      '[recipe] homepage screenshot unavailable — authoring from text evidence:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * First draft: author a recipe from evidence, shown TWO diverse reference
 * examples chosen for this brand's ground (see `pairingFor`). The examples ride
 * in the cached SYSTEM prefix; the user message carries only what varies per
 * brand — the evidence, the direction, and the homepage screenshot.
 *
 * The image goes in the USER message and NEVER in the system prefix: it is the
 * most per-brand thing in the whole call, and a cached prefix that varied per
 * brand would never be read twice.
 */
async function authorOnce(
  model: string,
  evidence: RecipeEvidence,
  reasoning?: boolean,
  direction?: string,
): Promise<BrandRecipe> {
  const shot = await screenshotBlock(evidence);
  const user = [
    `NOW AUTHOR THE RECIPE FOR THIS BRAND — output only the JSON object:`,
    evidenceBlock(evidence),
    ...(shot ? [``, `The image above is this brand's actual homepage. Interpret its density, spacing, type scale, accent use and photography mood — do not transcribe its layout.`] : []),
    // A candidate run authors SEVERAL takes on the same evidence; the direction
    // is what makes each take a different design, not the same one re-rolled.
    ...(direction
      ? [``, `DIRECTION FOR THIS TAKE (one of several candidate systems — commit to it): ${direction}`]
      : []),
  ].join('\n');
  // Without a screenshot the content stays a plain string — byte-for-byte the
  // request this made before the image existed.
  const content = shot ? [shot, { type: 'text' as const, text: user }] : user;
  const params = {
    model,
    max_tokens: 7000,
    system: AUTHOR_SYSTEMS[pairingFor(evidence)],
    messages: [{ role: 'user' as const, content }],
  };
  const reply = await aiJson(reasoning ? withOpusReasoning(params) : params, AUTHOR_TOOL, { large: true });
  return parseRecipe(jsonOf(reply, 'author'));
}

/**
 * Second pass: hold the first draft to the reference bar and PATCH it.
 *
 * The critic used to have to re-emit the entire recipe — ~7k tokens of verbatim
 * copying even to say "this is already excellent", which is both the most
 * expensive possible way to pass and a fresh chance to mangle working CSS. It
 * now returns a verdict plus only the fields it changed; `applyCritique` merges
 * them onto the draft and the result is gated exactly as before.
 */
async function critiqueAndRevise(
  model: string,
  evidence: RecipeEvidence,
  draft: BrandRecipe,
  reasoning?: boolean,
  direction?: string,
): Promise<BrandRecipe> {
  const user = [
    `BRAND: ${evidence.name}${evidence.category ? ` (${evidence.category})` : ''}`,
    // Without this the critique would sand a deliberately bold or quiet take
    // back toward the middle — improve the craft, keep the direction.
    ...(direction ? [`THIS TAKE'S INTENDED DIRECTION (preserve it while improving craft): ${direction}`] : []),
    `RECIPE TO REVIEW:`,
    JSON.stringify(draft),
    ``,
    `Review it against the reference bar. Reply {"verdict":"pass"} or {"verdict":"revise","patch":{…only what you changed…}}.`,
  ].join('\n');
  const params = { model, max_tokens: 7000, system: CRITIQUE_SYSTEM_CACHED, messages: [{ role: 'user' as const, content: user }] };
  const reply = await aiJson(reasoning ? withOpusReasoning(params) : params, CRITIQUE_TOOL, { large: true });
  return applyCritique(jsonOf(reply, 'critique'), draft);
}

/**
 * Author a BrandRecipe from kit evidence (validated + stylesheet sanitised).
 * By default runs a self-critique/revise pass; set opts.critique = false to skip
 * it (e.g. to halve cost in tests). The critique is best-effort — if it fails,
 * the first draft ships.
 */
export async function authorRecipe(
  evidence: RecipeEvidence,
  opts?: {
    model?: string;
    reasoning?: boolean;
    critique?: boolean;
    verify?: boolean;
    /**
     * A one-line creative direction appended to the prompt — used by the
     * candidates flow to make several takes on the same evidence meaningfully
     * DIFFERENT designs rather than temperature noise. Absent for the normal
     * single-shot author.
     */
    direction?: string;
    /**
     * The recipe this one is REPLACING, when there is one. Used only to notice a
     * regression: a re-author that silently returns fewer role fragments than
     * the recipe it replaces trades free deterministic composition for a model
     * call on whichever role it dropped.
     */
    previous?: BrandRecipe;
    /**
     * Measure what the recipe produces before storing it. Defaults to the same
     * switch compose uses, so it is on in production and off under test.
     */
    checkLayout?: boolean;
  },
): Promise<BrandRecipe> {
  const model = opts?.model ?? (await modelFor('recipe'));
  let recipe = gate(await authorOnce(model, evidence, opts?.reasoning, opts?.direction), 'draft', opts?.previous);
  let critiqued = false;

  if (opts?.critique !== false) {
    try {
      const reviewed = await critiqueAndRevise(model, evidence, recipe, opts?.reasoning, opts?.direction);
      critiqued = true;
      // A "pass" returns the very object it was given, so there is nothing to
      // re-gate — the draft already cleared these gates on the way in.
      if (reviewed !== recipe) recipe = gate(reviewed, 'revised', opts?.previous);
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
    if (seen.verdict === 'revised') recipe = gate(seen.recipe, 'verified', opts?.previous);
  }

  /**
   * MEASURE WHAT IT PRODUCES, before it is stored. Free and deterministic — the
   * same gate compose runs — and it never blocks: a recipe that cannot be
   * measured is authored exactly as it was before this existed.
   */
  // Gated on the same switch compose uses, so a unit test never reaches for a
  // browser: `try/catch` protects against a THROW, and this one would HANG.
  /**
   * MEASURE THE GAP FILL. `gate` has already added a hole for every part each
   * role allows, checking only that the markup still VALIDATES — and a fragment
   * can validate perfectly and still overflow the moment a copywriter fills what
   * it was given. Dynatós' `list` was handed a tagline and a body on top of its
   * panel and overflowed every canvas; its `statement` was handed a photo slot
   * that overflows against its own display headline.
   *
   * So the holes are re-derived here WITH a renderer: each is filled with the
   * longest copy its part allows and measured, and one that does not fit is
   * reverted and recorded. Same switch as the layout check below, so a unit test
   * never reaches for a browser.
   */
  if (opts?.checkLayout ?? renderCheckEnabledByDefault()) try {
    const measured = await measureFragmentGaps(recipe, 'authored');
    recipe = measured;
  } catch (err) {
    console.warn(
      '[recipe] could not measure the fragment gaps — keeping them as filled:',
      err instanceof Error ? err.message : err,
    );
  }

  if (opts?.checkLayout ?? renderCheckEnabledByDefault()) try {
    const layout = await checkRecipeLayout(recipe);
    if (layout.faults.length) {
      console.warn(
        `[recipe] LAYOUT: this recipe fails its own gate on a full slide — ${layout.faults.join(', ')}. ` +
          'Every deck built on it starts from a failing layout.',
      );
    } else if (layout.measured) {
      console.warn('[recipe] layout: a full slide fits');
    }
  } catch {
    // Never let a check stop a recipe being authored.
  }

  // STAMP WHICH PROMPTS WROTE THIS. Purely additive, and last so it survives
  // every gate: when a cohort of brands regresses, this is what attributes it to
  // a specific prompt edit instead of leaving it a mystery. The critique version
  // is recorded when that pass actually ran — pass or revise, the prompt was used.
  return {
    ...recipe,
    promptVersion: {
      author: PROMPT_VERSION.author,
      ...(critiqued ? { critique: PROMPT_VERSION.critique } : {}),
    },
  };
}
