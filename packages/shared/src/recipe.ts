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
import { AA_LARGE, AA_TEXT, contrastRatio, hexToRgb, relativeLuminance } from './colorContrast';

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
 * The brand's MOTION signature — how its posts move when exported as video.
 * Authored once per brand, exactly like the visual signature: `style` is the
 * character of each element's entrance, `pace` sets the tempo. Optional and
 * backwards-compatible — a recipe without it uses the balanced rise default.
 */
/** The slide roles the composer assigns — motion can differ per role. */
export const SLIDE_ROLES = ['cover', 'statement', 'quote', 'feature', 'stat', 'list', 'cta'] as const;
export type SlideRole = (typeof SLIDE_ROLES)[number];

export const MOTION_STYLES = ['rise', 'fade', 'slide', 'punch', 'pop'] as const;
export const MOTION_PACES = ['calm', 'balanced', 'punchy'] as const;

/** A style+pace pair — the brand default, or one role's override. */
const motionPairSchema = z.object({
  style: z.enum(MOTION_STYLES).catch('rise'),
  pace: z.enum(MOTION_PACES).catch('balanced'),
});

export const recipeMotionSchema = z.object({
  style: z.enum(MOTION_STYLES).catch('rise'),
  pace: z.enum(MOTION_PACES).catch('balanced'),
  /** One line describing the brand's motion, for the UI + the recipe screen. */
  description: z.string().max(200).default(''),
  /**
   * Optional PER-ROLE overrides, keyed by slide role. Motion becomes editorial
   * rather than decorative: a `stat` can pop while a `quote` fades in calmly and
   * a `cta` punches. Roles without an entry use the brand default above.
   */
  roles: z.record(z.string(), motionPairSchema).optional(),
  /**
   * Let a big number tick up to its value in video exports. ON by default —
   * but only ever applied when the number ACTUALLY reads as a countable
   * quantity (see `parseCountUp`), never blindly. Set false to opt a brand out.
   */
  countStats: z.boolean().default(true),
});
export type RecipeMotion = z.infer<typeof recipeMotionSchema>;

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

  /** How this brand MOVES in video exports (optional; defaults to a balanced rise). */
  motion: recipeMotionSchema.optional(),

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

/** text-transform for each authored display case. */
const CASE_TRANSFORM: Record<string, string> = {
  upper: 'uppercase',
  title: 'capitalize',
  sentence: 'none',
};

/** A leading/spacing multiplier per density — the recipe's vertical rhythm. */
const DENSITY_STEP: Record<string, string> = { roomy: '1.15', balanced: '1', dense: '0.86' };

export function recipeCssVars(tokens: RecipeTokens, typography?: BrandRecipe['typography']): Record<string, string> {
  const vars: Record<string, string> = {
    [`${RECIPE_VAR_PREFIX}-ground`]: tokens.ground,
    [`${RECIPE_VAR_PREFIX}-ink`]: tokens.ink,
    [`${RECIPE_VAR_PREFIX}-accent`]: tokens.accent,
    [`${RECIPE_VAR_PREFIX}-display`]: quoteFamily(tokens.displayFamily),
    [`${RECIPE_VAR_PREFIX}-body`]: quoteFamily(tokens.bodyFamily),
    [`${RECIPE_VAR_PREFIX}-radius`]: `${tokens.radius}px`,
  };
  // The typography block was authored, stored and displayed — but emitted NO
  // CSS, so it drove nothing while stylesheets hardcoded their own type. These
  // make it real: the stylesheet consumes them, so type is tunable without
  // re-authoring, and there is one source of truth.
  if (typography) {
    vars[`${RECIPE_VAR_PREFIX}-display-case`] = CASE_TRANSFORM[typography.displayCase] ?? 'none';
    vars[`${RECIPE_VAR_PREFIX}-display-weight`] = String(typography.displayWeight);
    vars[`${RECIPE_VAR_PREFIX}-display-tracking`] = typography.displayTracking;
    vars[`${RECIPE_VAR_PREFIX}-step`] = DENSITY_STEP[typography.density] ?? '1';
  }
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

// ── Motion ──────────────────────────────────────────────────────────────────

/** Tempo per pace: entrance duration + the stagger step between elements (s). */
const PACE: Record<RecipeMotion['pace'], { dur: number; step: number }> = {
  calm: { dur: 0.9, step: 0.26 },
  balanced: { dur: 0.72, step: 0.2 },
  punchy: { dur: 0.5, step: 0.13 },
};

/** The `from` state per style — the character of each element's entrance. */
const STYLE_FROM: Record<RecipeMotion['style'], string> = {
  rise: 'opacity:0; transform: translateY(28px);',
  fade: 'opacity:0;',
  slide: 'opacity:0; transform: translateX(-44px);',
  punch: 'opacity:0; transform: scale(0.92);',
  // A dramatic swell — reads best on a single hero element (a big stat).
  pop: 'opacity:0; transform: scale(0.55);',
};

/** Styles that want an overshoot easing to land with character. */
const OVERSHOOT = new Set<RecipeMotion['style']>(['punch', 'pop']);

/** Reveal order — element groups keyed by the recipe's component classes. */
const ORDER: string[][] = [
  ['.logo', '.logo-row', '.wordmark', '.monogram'],
  ['.eyebrow'],
  ['.headline', '.quote'],
  ['.stat', '.rule'],
  ['.tagline', '.body', '.panel'],
  ['.attr'],
  ['.cta'],
  ['.handle'],
];

const LEAD_IN = 0.12;

export const DEFAULT_MOTION: RecipeMotion = {
  style: 'rise',
  pace: 'balanced',
  description: '',
  countStats: true,
};

// ── Legibility ──────────────────────────────────────────────────────────────

/** Nudge a hex toward white or black by `amount` (0–1). */
function shift(hex: string, toward: 'light' | 'dark', amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const target = toward === 'light' ? 255 : 0;
  const mix = (c: number) => Math.round(c + (target - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Guarantee the recipe is READABLE before it is ever composed against. The app
 * measures contrast and shows it, but nothing previously stopped a recipe whose
 * ink fails on its own ground — the model just had to get lucky. Here ink is
 * held to AA body text and the accent to AA large text, repaired by walking the
 * colour toward white or black (whichever the ground is further from) until it
 * passes. Returns the repairs so they can be logged/surfaced.
 */
export function ensureRecipeContrast(recipe: BrandRecipe): {
  recipe: BrandRecipe;
  repairs: string[];
} {
  const ground = recipe.tokens.ground;
  if (!/^#[0-9a-f]{6}$/i.test(ground)) return { recipe, repairs: [] };
  const toward = relativeLuminance(ground) < 0.4 ? 'light' : 'dark';
  const repairs: string[] = [];
  const tokens = { ...recipe.tokens };

  const fix = (key: 'ink' | 'inkMuted' | 'accent', min: number) => {
    const start = tokens[key];
    if (!start || !/^#[0-9a-f]{6}$/i.test(start)) return;
    if (contrastRatio(start, ground) >= min) return;
    for (let step = 1; step <= 10; step++) {
      const candidate = shift(start, toward, step / 10);
      if (contrastRatio(candidate, ground) >= min) {
        tokens[key] = candidate;
        repairs.push(
          `${key} ${start} → ${candidate} (was ${contrastRatio(start, ground).toFixed(1)}:1, needs ${min}:1)`,
        );
        return;
      }
    }
    // Nothing in between worked — fall back to the extreme, which always passes.
    const extreme = toward === 'light' ? '#ffffff' : '#000000';
    tokens[key] = extreme;
    repairs.push(`${key} ${start} → ${extreme} (forced; could not reach ${min}:1)`);
  };

  fix('ink', AA_TEXT);
  fix('inkMuted', AA_TEXT);
  fix('accent', AA_LARGE);

  return { recipe: repairs.length ? { ...recipe, tokens } : recipe, repairs };
}

// ── Self-consistency ────────────────────────────────────────────────────────

/** Every class selector the stylesheet (plus any format overrides) defines. */
function definedClasses(recipe: BrandRecipe): Set<string> {
  const css = [
    recipe.stylesheet,
    ...Object.values(recipe.formats ?? {}).map((f) => f.stylesheet),
  ]
    .join('\n')
    // Strip url(...) payloads first — inline SVG data URIs contain dotted names
    // (www.w3.org) that would otherwise read as class selectors.
    .replace(/url\([^)]*\)/gi, '');
  const found = new Set<string>();
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) found.add(m[1]!);
  return found;
}

/**
 * Hold the recipe to its own promises. The composer may use ONLY the classes in
 * `components`, so a class advertised there but never defined in the CSS yields
 * an unstyled element on a real slide — a silent, ugly failure. Drop those, and
 * report styled-but-unadvertised classes so the vocabulary can be completed.
 * Deterministic: no model call, no judgement.
 */
export function validateRecipeConsistency(recipe: BrandRecipe): {
  recipe: BrandRecipe;
  dropped: string[];
  unlisted: string[];
} {
  const defined = definedClasses(recipe);
  const dropped: string[] = [];
  const kept = recipe.components.filter((c) => {
    // A component may name several classes ("headline sm"); the first must exist.
    const first = c.className.trim().split(/\s+/)[0] ?? '';
    if (defined.has(first)) return true;
    dropped.push(c.className);
    return false;
  });

  // Structural/base classes the composer never names directly.
  const IGNORE = new Set(['cb-slide', 'cb-motion', 'cb-cnt', 'photo', 'inverse', 'sm', 'em', 'it', 'row', 'tick']);
  const listed = new Set(recipe.components.flatMap((c) => c.className.trim().split(/\s+/)));
  const unlisted = [...defined].filter((c) => !listed.has(c) && !IGNORE.has(c)).sort();

  return {
    recipe: dropped.length ? { ...recipe, components: kept } : recipe,
    dropped,
    unlisted,
  };
}

// ── Counting a stat up ──────────────────────────────────────────────────────

/**
 * Decide whether a stat should TICK UP to its value — and to what.
 *
 * This is the judgement, not a blanket effect: counting only reads well when the
 * number is a single countable QUANTITY. It is deliberately refused when the
 * text is really something else wearing a number:
 *   "2024" a year · "#1" a rank · "1 in 5" a ratio · "24/7" an idiom ·
 *   "14:30" a time · "40–60%" a range · "3" too small to be worth it ·
 *   "$1.5M"/"12,000" formatted decimals & separators a counter can't render.
 * Returns null whenever counting would look silly, which is most of the time.
 */
export function parseCountUp(raw: string): { to: number; prefix: string; suffix: string } | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // Exactly ONE run of digits — kills ratios, times, ranges, dates, "24/7".
  const runs = text.match(/\d+/g) ?? [];
  if (runs.length !== 1) return null;
  // A digit next to a decimal point or thousands separator can't be countered.
  if (/\d[.,]\d/.test(text)) return null;

  const m = text.match(/^([^\d]*)(\d+)([^\d]*)$/);
  if (!m) return null;
  const prefix = (m[1] ?? '').trim();
  const suffix = (m[3] ?? '').trim();
  const to = Number(m[2]);
  if (!Number.isFinite(to)) return null;

  // Below ~5 the tick is over before it registers; not worth the motion.
  if (to < 5) return null;
  // Ranks/ordinals are positions, not amounts.
  if (prefix.includes('#') || /^(st|nd|rd|th)$/i.test(suffix)) return null;
  // A bare 4-digit number in calendar range reads as a year.
  if (!prefix && !suffix && to >= 1000) return null;
  // Anything wordier than a unit (%, +, x, k, M, $, €) is a phrase, not a stat.
  if (prefix.length > 2 || suffix.length > 3) return null;

  return { to, prefix, suffix };
}

/** The lone `.stat` element in an authored fragment, if there is exactly one. */
const STAT_RE = /<([a-z][a-z0-9]*)\b([^>]*\bclass="[^"]*\bstat\b[^"]*"[^>]*)>([\s\S]*?)<\/\1>/i;

/**
 * Rewrite a `.stat` element so its number can tick up, IF counting suits it.
 * Applied only in motion mode — the still PNG export keeps the plain text, so
 * there is no way for this to affect image exports.
 */
export function statCountUp(
  html: string,
  recipe?: BrandRecipe,
): { html: string; to: number } | null {
  const motion = recipe?.motion ?? DEFAULT_MOTION;
  if (motion.countStats === false) return null;
  const m = html.match(STAT_RE);
  if (!m) return null;
  const inner = (m[3] ?? '').replace(/<[^>]+>/g, ''); // plain text only
  const parsed = parseCountUp(inner);
  if (!parsed) return null;
  const replaced = `<${m[1]}${m[2]}>${parsed.prefix}<span class="cb-cnt"></span>${parsed.suffix}</${m[1]}>`;
  return { html: html.replace(STAT_RE, replaced), to: parsed.to };
}

/**
 * The motion that applies to a slide: the role's override when the recipe
 * defines one, else the brand default. This is what makes motion editorial —
 * a `stat` slide can pop while a `quote` fades.
 */
export function motionForRole(
  recipe?: BrandRecipe,
  role?: string,
): { style: RecipeMotion['style']; pace: RecipeMotion['pace'] } {
  const m = recipe?.motion ?? DEFAULT_MOTION;
  const override = role ? m.roles?.[role] : undefined;
  return { style: override?.style ?? m.style, pace: override?.pace ?? m.pace };
}

/** How long a slide's full reveal takes, in ms (what the video capture window needs). */
export function recipeMotionMs(recipe?: BrandRecipe, role?: string): number {
  const { dur, step } = PACE[motionForRole(recipe, role).pace];
  return Math.round((LEAD_IN + (ORDER.length - 1) * step + dur) * 1000);
}

/**
 * Build the motion stylesheet for a slide — the reveal choreography, scoped to
 * `.cb-slide.cb-motion`. Keyed on the recipe's own component classes so every
 * brand animates on-brand with no per-slide authoring, and tuned by the slide's
 * ROLE when the recipe defines an override for it.
 */
export function recipeMotionCss(recipe?: BrandRecipe, role?: string, countTo?: number): string {
  const m = motionForRole(recipe, role);
  const { dur, step } = PACE[m.pace];
  const ease = OVERSHOOT.has(m.style)
    ? 'cubic-bezier(0.2,1.5,0.4,1)'
    : m.pace === 'punchy'
      ? 'cubic-bezier(0.2,1.2,0.4,1)'
      : 'cubic-bezier(0.16,1,0.3,1)';

  const lines: string[] = [
    // NOTE: no base `opacity: 0` — `animation-fill-mode: both` supplies the
    // from-state, and a redundant base opacity leaks into the PAINTED output
    // when frames are captured from a paused, seeked animation.
    `.cb-slide.cb-motion > * { animation: cb-enter ${dur}s ${ease} both; }`,
    `.cb-slide.cb-motion > .fill { animation: none; }`,
    `@keyframes cb-enter { from { ${STYLE_FROM[m.style]} } to { opacity:1; transform: none; } }`,
  ];
  ORDER.forEach((group, i) => {
    const delay = (LEAD_IN + i * step).toFixed(2);
    const sel = group.map((c) => `.cb-slide.cb-motion > ${c}`).join(', ');
    lines.push(`${sel} { animation-delay: ${delay}s; }`);
  });
  // The brand's accent word warms in just after its headline lands.
  const accentDelay = (LEAD_IN + 2 * step + dur * 0.65).toFixed(2);
  lines.push(
    `.cb-slide.cb-motion .headline .em, .cb-slide.cb-motion .headline .it { display:inline-block; animation: cb-accent ${(dur * 1.1).toFixed(2)}s ease-out ${accentDelay}s both; }`,
    `@keyframes cb-accent { from { opacity:0.25; filter: saturate(0.4); } to { opacity:1; filter:none; } }`,
  );

  // A countable stat ticks up to its value. Driven by an ANIMATED registered
  // custom property + counter(), so it lives on the CSS timeline and stays
  // seekable — which is what keeps deterministic frame capture working (a
  // JS-driven counter could not be stepped frame-by-frame).
  if (typeof countTo === 'number' && countTo > 0) {
    const statDelay = LEAD_IN + 3 * step; // .stat sits in the 4th reveal group
    lines.push(
      `@property --cb-n { syntax: '<integer>'; initial-value: 0; inherits: false; }`,
      // The FINAL value lives on the base rule, NOT on `.cb-motion`: the video
      // capture removes `.cb-motion` for the settled/hold frames, and a target
      // scoped to that class would fall back to the registered initial-value (0)
      // — the number would count up and then snap back to zero for the rest of
      // the clip. The animation (fill `both`) drives 0→N while it is active.
      `.cb-slide .cb-cnt { --cb-n: ${countTo}; counter-reset: cbn var(--cb-n); }`,
      `.cb-slide .cb-cnt::after { content: counter(cbn); }`,
      `.cb-slide.cb-motion .cb-cnt { animation: cb-count ${(dur * 1.7).toFixed(2)}s ease-out ${statDelay.toFixed(2)}s both; }`,
      `@keyframes cb-count { from { --cb-n: 0; } to { --cb-n: ${countTo}; } }`,
    );
  }
  return lines.join('\n');
}
