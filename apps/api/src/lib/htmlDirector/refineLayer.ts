/**
 * Refine ONE LAYER of a brand recipe instead of re-authoring the whole design.
 *
 * `recipe.layers { background, type, components }` exists in shared/recipe.ts
 * precisely so a single concern can be regenerated while everything else stays
 * byte-identical, so that "the backgrounds are too busy" costs one design-tier
 * call rather than a full ~60s re-author that changes the type, the components
 * and the signature too. The recipe AUTHOR now emits those layers (see
 * `LAYERS_CONTRACT` in authorRecipe.ts), so this is the live path for every
 * newly authored brand: one call, one layer rewritten, the rest untouched.
 *
 * TWO PATHS, and the difference is honest rather than papered over:
 *
 *   LAYERED (recipe.layers present) — the model is asked for the replacement
 *   CSS of that layer ONLY. The other two layers are carried across verbatim
 *   and the stylesheet is recomposed exactly as `recipeStylesheetFor` composes
 *   it (background → type → components, empties dropped, '\n'-joined), so what
 *   renders is identical to what the layer contract already promised.
 *
 *   FLAT (no layers — everything authored before the split existed, plus the
 *   three hand-written reference recipes, plus any recipe whose whole sheet was
 *   rewritten since) — there is no split to swap, and inventing one is a lie: a
 *   guessed split would silently move rules between layers on the next refine.
 *   So the model is asked for the FULL stylesheet with ONLY the requested
 *   concern changed, and the result reports `mode: 'sheet'` so callers can say
 *   so. It is a whole-sheet rewrite scoped by the instruction, not a layer swap.
 *
 * Either way the reply is CSS-sanitised and run through the SAME deterministic
 * gates the author uses (legibility + self-consistency), so a refinement can
 * never leave a brand less readable or advertising classes its CSS dropped.
 */
import {
  clampText,
  composeRecipeLayers,
  ensureRecipeContrast,
  migrateRecipe,
  validateRecipeConsistency,
  type BrandRecipe,
} from '@contentbuilder/shared';
import { aiMessageLarge, cachedSystem, modelFor, textOf } from '../ai';
import { sanitizeRecipeCss } from '../cssSanitize';

/** The layers a refinement may target — the keys of `recipe.layers`. */
export const RECIPE_LAYERS = ['background', 'type', 'components'] as const;
export type RecipeLayer = (typeof RECIPE_LAYERS)[number];

/** A user's refinement is one sentence, not a brief. */
export const REFINE_INSTRUCTION_MAX = 200;

/** The per-layer / whole-sheet caps from `brandRecipeSchema` — a reply longer
 *  than its slot could never be stored, so it is trimmed to a whole rule. */
const LAYER_MAX: Record<RecipeLayer, number> = { background: 10000, type: 10000, components: 14000 };
const SHEET_MAX = 24000;

/** What a refinement did, for the log and for the UI's confirmation. */
export interface RecipeRefineDiff {
  layer: RecipeLayer;
  /** 'layer' — only that layer's CSS was swapped (the others are byte-identical).
   *  'sheet' — the recipe has no layer split, so the whole stylesheet was
   *  rewritten with only this concern changed. */
  mode: 'layer' | 'sheet';
  /** Size of what was replaced, before → after (the layer, or the whole sheet). */
  charsBefore: number;
  charsAfter: number;
  /** Legibility repairs the gate had to make (normally none). */
  repairs: string[];
  /** Component classes dropped because the refined CSS no longer defines them. */
  dropped: string[];
}

export interface RecipeRefineResult {
  recipe: BrandRecipe;
  diff: RecipeRefineDiff;
}

/**
 * What each layer owns — stated once, and now shared: the recipe AUTHOR quotes
 * these same three sentences when it asks for `layers`, so the split a brand is
 * authored with is exactly the split a later refinement assumes.
 */
export const LAYER_REMIT: Record<RecipeLayer, string> = {
  background:
    'the slide GROUND — `.cb-slide` itself and its layered background art (directional glow, vignette, grain, the brand signature graphic, background-only pseudo-elements). NOT type sizes, NOT component boxes, NOT the photo treatment.',
  type:
    'the TYPE SYSTEM — family / size / weight / line-height / letter-spacing / text-transform / colour of the text classes (.headline and its variants, .eyebrow, .body, .quote, .stat, .tagline, .attr, .handle, the emphasis span). NOT the background art, NOT component boxes or spacing.',
  components:
    'the COMPONENT BOXES — layout, spacing, borders, radii, rules, buttons, panels and rows, the logo lockup, the `.cb-shot` photo treatment and the `.fill` spacer. NOT the background art, NOT the type scale.',
};

const SYSTEM = `You are an elite brand & art director making ONE surgical change to a brand's EXISTING design system. You are given the brand's tokens, its full current stylesheet, the single LAYER you may rewrite, and one line of direction from the brand's owner.

OUTPUT CONTRACT — this is absolute:
- Output CSS and NOTHING else. No prose, no explanation, no commentary, no markdown fences, no <style> tag.
- Your output REPLACES what you were given, in full. Anything you leave out is deleted, so restate every rule that should survive — changed where the instruction asks, byte-for-byte where it does not.
- Stay inside the named layer's remit. Rules that belong to the other layers are NOT yours to emit; they are shown to you only as context.

THE LAYERS:
- background: ${LAYER_REMIT.background}
- type: ${LAYER_REMIT.type}
- components: ${LAYER_REMIT.components}

WHEN THE RECIPE HAS NO LAYER SPLIT you are told so, and then — and only then — you return the FULL stylesheet, with ONLY the named concern changed and every other rule reproduced exactly as given.

HARD RULES:
- Everything stays scoped to \`.cb-slide\`. Write against the brand's tokens — var(--cb-ground), var(--cb-ink), var(--cb-ink-muted), var(--cb-accent), var(--cb-accent-alt), var(--cb-line), var(--cb-display), var(--cb-body), var(--cb-accent-family), var(--cb-radius), var(--cb-step) — never hardcode a colour or family a token already carries.
- Keep the class VOCABULARY intact: every class the current CSS defines in this layer must still be defined afterwards, or slides composed against this recipe render unstyled elements.
- No @import, no <script>, no external URLs. Inline data: URIs only (e.g. an feTurbulence grain).
- Do NOT set width/height/aspect-ratio/max-width/object-fit on .cb-shot — the app owns its geometry.
- The canvas is 1080×1350 and is READ on a handset at roughly a third of that size. Floors you may never go under to satisfy an instruction: headline 88px, stat 160px, quote 72px, body 44px, cta 48px, tagline 44px, panel 42px, eyebrow 34px. If the instruction implies smaller type, achieve it with space, weight or contrast instead.
- Do what was asked, and nothing else. This is a refinement of a design someone already approved — every property the instruction does not implicate keeps its current value.`;

/** Static across every refine call, so one cache breakpoint covers it. */
const REFINE_SYSTEM = cachedSystem(SYSTEM);

/** The brand's tokens, as the model needs to see them (only what is set). */
function tokenBlock(recipe: BrandRecipe): string {
  const t = recipe.tokens;
  return [
    `ground ${t.ground}`,
    t.groundAlt ? `groundAlt ${t.groundAlt}` : '',
    `ink ${t.ink}`,
    t.inkMuted ? `inkMuted ${t.inkMuted}` : '',
    `accent ${t.accent}`,
    t.accentAlt ? `accentAlt ${t.accentAlt}` : '',
    t.line ? `line ${t.line}` : '',
    `display ${t.displayFamily}`,
    `body ${t.bodyFamily}`,
    t.accentFamily ? `accent-family ${t.accentFamily}` : '',
    `radius ${t.radius}px`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Pull CSS out of a model reply that may be wrapped however the model felt like
 * wrapping it — a ```css fence, a "Here's the updated background:" preamble, a
 * closing remark. Keeps from the line the first rule opens on to the last
 * closing brace, then sanitises. Returns '' when there is no CSS at all.
 */
export function extractCss(raw: string): string {
  let text = (raw ?? '').trim();
  // A fenced block is the commonest wrapper — take the first one whole. An
  // unterminated fence simply doesn't match, and the brace scan below copes.
  const fence = text.match(/```(?:[a-zA-Z]*[ \t]*\r?\n)?([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1];
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open === -1 || close === -1 || close < open) return '';
  // Rewind to the start of the line the first rule opens on, so its selector
  // (or `@media (...)` prelude) survives while any preamble above it doesn't.
  text = text.slice(text.lastIndexOf('\n', open) + 1, close + 1);
  return sanitizeRecipeCss(text);
}

/** Trim CSS to a storable length without leaving a half-written rule. */
function capCss(css: string, max: number): string {
  if (css.length <= max) return css;
  const end = css.slice(0, max).lastIndexOf('}');
  return end === -1 ? '' : css.slice(0, end + 1);
}

/**
 * The SAME deterministic quality gates every authored recipe passes: legibility
 * is guaranteed rather than hoped for, and the recipe is held to its own
 * promises (a component class the CSS no longer defines would render as an
 * unstyled element on a real slide).
 *
 * Deliberately a small LOCAL copy of `authorRecipe.ts`'s private `gate()`
 * rather than an import — that module owns the author pipeline and its gate is
 * not exported; the behaviour here is identical, and both call the same two
 * shared functions, which are the actual single source of truth.
 */
function gate(recipe: BrandRecipe, label: string): {
  recipe: BrandRecipe;
  repairs: string[];
  dropped: string[];
} {
  const contrast = ensureRecipeContrast(recipe);
  for (const r of contrast.repairs) console.warn(`[recipe:refine:${label}] contrast repair — ${r}`);
  const consistency = validateRecipeConsistency(contrast.recipe);
  if (consistency.dropped.length) {
    console.warn(
      `[recipe:refine:${label}] dropped undefined component classes: ${consistency.dropped.join(', ')}`,
    );
  }
  if (consistency.unlisted.length) {
    console.warn(`[recipe:refine:${label}] styled but unadvertised: ${consistency.unlisted.join(', ')}`);
  }
  return { recipe: consistency.recipe, repairs: contrast.repairs, dropped: consistency.dropped };
}

/**
 * Rewrite ONE layer of a recipe from a one-line instruction.
 *
 * @param recipe      the brand's current (already migrated) recipe
 * @param layer       which concern to rewrite — background | type | components
 * @param instruction the owner's sentence, clamped to 200 chars
 */
export async function refineRecipeLayer(
  recipe: BrandRecipe,
  layer: RecipeLayer,
  instruction: string,
  opts?: { model?: string },
): Promise<RecipeRefineResult> {
  const note = clampText(instruction ?? '', REFINE_INSTRUCTION_MAX);
  if (!note) throw new Error('recipe refine: an instruction is required');

  const l = recipe.layers;
  const layered = Boolean(l && (l.background || l.type || l.components));
  const currentLayer = layered ? (l![layer] ?? '') : '';
  const fullSheet = layered ? composeRecipeLayers(l!) : recipe.stylesheet;
  const vocabulary = recipe.components.map((c) => `.${c.className.trim().split(/\s+/).join('.')}`).join(' ');

  const user = [
    `BRAND TOKENS: ${tokenBlock(recipe)}`,
    `SIGNATURE MOVE (must survive): ${recipe.signature.name} — ${recipe.signature.description}`,
    vocabulary ? `COMPONENT VOCABULARY (classes slides are composed from): ${vocabulary}` : '',
    ``,
    `LAYER TO CHANGE: ${layer} — ${LAYER_REMIT[layer]}`,
    `INSTRUCTION: ${note}`,
    ``,
    layered
      ? [
          `THIS RECIPE IS LAYERED. Return ONLY the replacement CSS for the "${layer}" layer.`,
          ``,
          `CURRENT "${layer}" LAYER (this is what your output replaces):`,
          currentLayer || '/* this layer is currently empty */',
          ``,
          `THE FULL CURRENT STYLESHEET, for context only — do NOT restate the other layers:`,
          fullSheet,
        ].join('\n')
      : [
          `THIS RECIPE HAS NO LAYER SPLIT, so a single layer cannot be swapped out. Return the FULL stylesheet below with ONLY the "${layer}" concern changed — every other rule reproduced exactly as given.`,
          ``,
          `THE FULL CURRENT STYLESHEET (this is what your output replaces):`,
          fullSheet,
        ].join('\n'),
    ``,
    layered
      ? `Output only the replacement CSS for the "${layer}" layer.`
      : `Output only the full replacement stylesheet.`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const model = opts?.model ?? (await modelFor('recipe'));
  const resp = await aiMessageLarge({
    model,
    max_tokens: 7000,
    system: REFINE_SYSTEM,
    messages: [{ role: 'user' as const, content: user }],
  });
  const css = extractCss(textOf(resp));
  if (!css) throw new Error('recipe refine: no CSS in the response');

  let next: BrandRecipe;
  let charsBefore: number;
  let charsAfter: number;

  if (layered) {
    const capped = capCss(css, LAYER_MAX[layer]);
    if (!capped) throw new Error('recipe refine: the replacement CSS was empty after sanitising');
    // Every other layer is carried across by identity — byte-identical, which
    // is the whole point of the split.
    const layers = {
      background: layer === 'background' ? capped : l!.background,
      type: layer === 'type' ? capped : l!.type,
      components: layer === 'components' ? capped : l!.components,
    };
    // `stylesheet` is the fallback the renderer ignores while layers exist, but
    // it is what `validateRecipeConsistency` reads to find defined classes — so
    // keep it EQUAL to the composed layers. Both paths then render the same CSS.
    next = { ...recipe, layers, stylesheet: capCss(composeRecipeLayers(layers), SHEET_MAX) };
    charsBefore = currentLayer.length;
    charsAfter = capped.length;
  } else {
    const capped = capCss(css, SHEET_MAX);
    if (!capped) throw new Error('recipe refine: the replacement CSS was empty after sanitising');
    next = { ...recipe, stylesheet: capped };
    charsBefore = recipe.stylesheet.length;
    charsAfter = capped.length;
  }

  // Re-validate through the migrator, exactly as an authored recipe is: a
  // refinement must produce a document that is storable and readable.
  const gated = gate(migrateRecipe(next), layer);
  return {
    recipe: gated.recipe,
    diff: {
      layer,
      mode: layered ? 'layer' : 'sheet',
      charsBefore,
      charsAfter,
      repairs: gated.repairs,
      dropped: gated.dropped,
    },
  };
}
