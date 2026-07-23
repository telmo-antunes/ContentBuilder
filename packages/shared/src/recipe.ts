/**
 * The Brand Recipe — a brand's design system, authored ONCE per brand and then
 * applied to every slide the app generates. This is what makes AI generation
 * on-brand *by construction* rather than by luck:
 *
 *   recipe (authored once)  +  slide content  ->  authored HTML slide
 *
 * The recipe carries brand TOKENS (injected as CSS custom properties) and an
 * authored STYLESHEET (the brand's component classes + signature move, written
 * and sanitised once). Per-slide, the model writes only semantic markup that
 * *uses the brand classes* — so coherence and safety come from the recipe, not
 * from trusting the model to author good CSS on every call.
 *
 * Lives in shared so the API (generation + validation), the web renderer, and
 * tests all agree on one shape. Stored on BrandKit.recipe (Mongoose Mixed) and
 * validated with this zod schema at author time.
 */
import { z } from 'zod';

/** CSS custom-property prefix for every brand token the renderer injects. */
export const RECIPE_VAR_PREFIX = '--cb';

/**
 * Design tokens. Colours are any CSS colour string; families must be render
 * fonts the export can load (a bundled font, or the kit's mapped render font).
 * Each becomes a `--cb-*` custom property on the slide root.
 */
export const recipeTokensSchema = z.object({
  ground: z.string(), // page/base background
  groundAlt: z.string().optional(), // raised surface / secondary panel
  ink: z.string(), // primary text
  inkMuted: z.string().optional(), // secondary text
  accent: z.string(), // the single rationed accent
  accentAlt: z.string().optional(), // accent highlight / second tone
  line: z.string().optional(), // hairline / border colour
  displayFamily: z.string(), // headline font family
  bodyFamily: z.string(), // body / UI font family
  accentFamily: z.string().optional(), // e.g. serif italic for taglines
  radius: z.number().min(0).max(48).default(16),
});
export type RecipeTokens = z.infer<typeof recipeTokensSchema>;

/** One brand class the slide composer may use, with a one-line purpose. */
export const recipeComponentSchema = z.object({
  className: z.string().min(1).max(60),
  use: z.string().min(1).max(160),
});
export type RecipeComponent = z.infer<typeof recipeComponentSchema>;

/**
 * Per-format tuning for a recipe. Every Instagram format is 1080px WIDE
 * (1080×1080 square, 1080×1350 post, 1080×1920 story), so a brand's type scale
 * and horizontal rhythm carry across all of them — only VERTICAL metrics differ
 * (padding, safe-areas, how much the content spreads). A variant therefore only
 * needs to *append* a small override to the base (4:5) stylesheet, plus optional
 * format-specific composition patterns. Absent formats fall back to the base.
 */
export const recipeFormatVariantSchema = z.object({
  /** CSS appended after the base stylesheet for this format — same `.cb-slide`
   *  scope, overriding vertical padding / sizes for the canvas's aspect. */
  stylesheet: z.string().max(8000).default(''),
  /** Format-specific arrangement patterns; falls back to the base patterns when empty. */
  patterns: z.array(z.string().max(200)).max(12).default([]),
});
export type RecipeFormatVariant = z.infer<typeof recipeFormatVariantSchema>;

export const brandRecipeSchema = z.object({
  /** Bump when the recipe shape changes in a breaking way. */
  version: z.literal(1).default(1),

  tokens: recipeTokensSchema,

  // Enums use `.catch()` so AI-authored recipes never hard-fail on harmless value
  // drift (e.g. "spacious" for density) — they fall back to a sane default.
  typography: z
    .object({
      displayCase: z.enum(['upper', 'title', 'sentence']).catch('sentence'),
      displayWeight: z.number().min(300).max(900).catch(700),
      displayTracking: z.string().catch('-0.02em'),
      density: z.enum(['roomy', 'balanced', 'dense']).catch('balanced'),
    })
    .default({}),

  /** The signature move that recurs on every slide (e.g. a gold italic tagline,
   *  a reflection line). `description` is the instruction the composer follows. */
  signature: z.object({
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(400),
  }),

  /** The brand's authored, sanitised stylesheet: base + signature + component
   *  classes, written against the `--cb-*` tokens. Injected at render, scoped to
   *  the slide root. This is the "authored once" heart of the recipe. */
  stylesheet: z.string().max(24000).default(''),

  /** The class vocabulary the slide composer is allowed to use — its palette of
   *  brand components. Names must correspond to classes in `stylesheet`. */
  components: z.array(recipeComponentSchema).max(40).default([]),

  /** Per-format vertical tuning, keyed by format string ('1080x1920' story,
   *  '1080x1080' square). The base stylesheet targets 1080×1350; each entry
   *  appends an override so the OTHER canvases are on-brand too. Optional and
   *  backwards-compatible — a recipe without it renders every format from the
   *  base stylesheet (correct width, base vertical metrics). */
  formats: z.record(z.string(), recipeFormatVariantSchema).optional(),

  composition: z
    .object({
      align: z.enum(['flush-left', 'center', 'flush-right']).catch('flush-left'),
      /** Ordered arrangement recipes, e.g. "logo top-left → eyebrow → headline → rule → body". */
      patterns: z.array(z.string().max(200)).max(12).catch([]),
    })
    .default({}),

  /** Imagery & texture treatment — how photos/screenshots/graphics are handled
   *  for this brand. Added because real brands lean on imagery (portraits, car
   *  photography) that pure type/colour recipes miss. */
  imagery: z
    .object({
      treatment: z.string().max(280).catch(''),
      photoRole: z.enum(['hero', 'accent', 'none']).catch('none'),
      texture: z.string().max(120).catch('none'),
    })
    .default({}),

  voice: z
    .object({
      description: z.string().max(400).default(''),
      dos: z.array(z.string().max(120)).max(10).default([]),
      donts: z.array(z.string().max(120)).max(10).default([]),
    })
    .default({}),

  createdAt: z.string().optional(),
});
export type BrandRecipe = z.infer<typeof brandRecipeSchema>;

/**
 * Build the `--cb-*` custom-property declarations for a recipe's tokens, to set
 * on the slide root at render. Only defined tokens are emitted. Values are used
 * verbatim (they are authored/sanitised brand data, not user free-text).
 */
/** Quote a font-family value so multi-word / digit-containing names (e.g.
 *  "Source Serif 4") are valid when used bare in `font-family: var(--cb-…)`. */
function quoteFamily(f: string): string {
  return /^['"]/.test(f.trim()) ? f : `'${f}'`;
}

export function recipeCssVars(tokens: RecipeTokens): Record<string, string> {
  const vars: Record<string, string> = {
    [`${RECIPE_VAR_PREFIX}-ground`]: tokens.ground,
    [`${RECIPE_VAR_PREFIX}-ink`]: tokens.ink,
    [`${RECIPE_VAR_PREFIX}-accent`]: tokens.accent,
    [`${RECIPE_VAR_PREFIX}-display`]: quoteFamily(tokens.displayFamily),
    [`${RECIPE_VAR_PREFIX}-body`]: quoteFamily(tokens.bodyFamily),
    [`${RECIPE_VAR_PREFIX}-radius`]: `${tokens.radius}px`,
  };
  if (tokens.groundAlt) vars[`${RECIPE_VAR_PREFIX}-ground-alt`] = tokens.groundAlt;
  if (tokens.inkMuted) vars[`${RECIPE_VAR_PREFIX}-ink-muted`] = tokens.inkMuted;
  if (tokens.accentAlt) vars[`${RECIPE_VAR_PREFIX}-accent-alt`] = tokens.accentAlt;
  if (tokens.line) vars[`${RECIPE_VAR_PREFIX}-line`] = tokens.line;
  if (tokens.accentFamily) vars[`${RECIPE_VAR_PREFIX}-accent-family`] = quoteFamily(tokens.accentFamily);
  return vars;
}

/** The render-font families a recipe needs loaded (display + body + accent). */
export function recipeFontFamilies(tokens: RecipeTokens): string[] {
  return [tokens.displayFamily, tokens.bodyFamily, tokens.accentFamily].filter(
    (f): f is string => typeof f === 'string' && f.length > 0,
  );
}

/** The recipe's canvas dimensions per Instagram format (all 1080 wide). */
export const RECIPE_FORMAT_DIMS: Record<string, { w: number; h: number; label: string }> = {
  '1080x1080': { w: 1080, h: 1080, label: 'square 1:1' },
  '1080x1350': { w: 1080, h: 1350, label: 'portrait 4:5' },
  '1080x1920': { w: 1080, h: 1920, label: 'story 9:16' },
};

/**
 * The stylesheet to inject for a given format: the base (4:5) sheet, with the
 * format's override appended when one exists. Both are `.cb-slide`-scoped, so
 * the later rules win by cascade order. Unknown/absent formats use the base.
 */
export function recipeStylesheetFor(recipe: BrandRecipe, format: string): string {
  const extra = recipe.formats?.[format]?.stylesheet?.trim();
  return extra ? `${recipe.stylesheet}\n/* format ${format} */\n${extra}` : recipe.stylesheet;
}

/** The composition patterns for a format (format-specific if given, else base). */
export function recipePatternsFor(recipe: BrandRecipe, format: string): string[] {
  const fmt = recipe.formats?.[format]?.patterns;
  return fmt && fmt.length ? fmt : recipe.composition.patterns;
}
