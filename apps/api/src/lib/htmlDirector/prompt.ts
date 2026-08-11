/**
 * THE FORMULA — the slide-author prompt the generation touchpoint runs.
 *
 * Division of labour (this is what makes autonomous generation reliable + safe):
 *   1. an upstream cheap parse splits the raw idea into slides, each a ROLE +
 *      LABELED copy parts, VERBATIM (draftParse-style; enforced by a substring
 *      guard downstream).
 *   2. this composer ARRANGES one slide's parts into the brand's own markup,
 *      using ONLY the recipe's component classes. It never writes or alters copy
 *      and never invents CSS — coherence + safety live in the recipe.
 *
 * Output is a single HTML fragment (no <html>/<style>/<script>) that mounts
 * inside `.cb-slide`; the renderer injects the recipe stylesheet + `--cb-*`
 * tokens around it. The fragment is sanitised (allowlist) before it is stored.
 */
import { RECIPE_FORMAT_DIMS, recipePatternsFor, recipePatternVariant, type BrandRecipe } from '@contentbuilder/shared';

/** A slide's role — selects which composition pattern the composer follows. */
export type SlideRole = 'cover' | 'statement' | 'quote' | 'feature' | 'stat' | 'list' | 'cta';

/** Labeled, verbatim copy parts for one slide (produced by the parse step). */
export interface ComposeParts {
  eyebrow?: string;
  headline?: string;
  /** The phrase within the headline to emphasise with the brand signature. */
  emphasis?: string;
  tagline?: string;
  body?: string;
  quote?: string;
  attribution?: string;
  stat?: string;
  cta?: string;
  handle?: string;
  /** Extra rows for panel/list roles: [{ text, note? }]. */
  rows?: Array<{ text: string; note?: string }>;
}

export interface ComposeSlideInput {
  role: SlideRole;
  parts: ComposeParts;
  /** '1080x1350' (post) or '1080x1920' (story). */
  format: string;
  /** true when this brand+slide should be photo-forward (cover with imagery). */
  photo?: boolean;
  /**
   * What the picture should be OF, in stock-library words. Never reaches the
   * composer — it is the parse step's note to the USER, and prefills the
   * Studio's photo picker so it opens on a search instead of an empty box.
   */
  imageQuery?: string;
  /** Position in the deck — rotates which composition VARIANT this role uses. */
  index?: number;
  /**
   * Start that rotation further along. Set from a `rearranges-role` lesson: the
   * arrangement the rotation lands on is the one this brand keeps swapping out,
   * so the composer reaches past it. Never changes the slide's position in the
   * deck — only which of the role's authored arrangements it follows.
   */
  variantBias?: number;
}

/** The rotation position for this slide's composition variant. */
export const variantIndexOf = (input: ComposeSlideInput): number =>
  (input.index ?? 0) + (input.variantBias ?? 0);

/** Render the recipe into the compact spec the composer reasons over. */
export function recipeSpecBlock(recipe: BrandRecipe, format: string, role?: string, index?: number): string {
  const comps = recipe.components.map((c) => `  .${c.className} — ${c.use}`).join('\n');
  // When the role is known, lead with the ONE variant this slide should follow
  // (a brand may author several arrangements per role); otherwise list them all.
  const chosen = role ? recipePatternVariant(recipe, format, role, index) : undefined;
  const patterns = chosen
    ? `  - ${chosen}`
    : recipePatternsFor(recipe, format).map((p) => `  - ${p}`).join('\n');
  return [
    `SIGNATURE MOVE (${recipe.signature.name}): ${recipe.signature.description}`,
    `ALIGNMENT: ${recipe.composition.align}`,
    ``,
    `COMPONENT CLASSES you may use (and nothing else):`,
    comps,
    ``,
    `COMPOSITION PATTERN to follow:`,
    patterns,
  ].join('\n');
}

export const SLIDE_AUTHOR_INSTRUCTIONS = `You are the slide composer for a brand's Instagram post system. You arrange already-written copy into the brand's OWN markup. You are a typesetter, not a copywriter or a CSS author.

HARD RULES
- Output ONE HTML fragment and nothing else: no <html>, <head>, <style>, <script>, no markdown fences, no commentary.
- Use ONLY the component classes listed for this brand. Never invent class names. Never add a style="" attribute. Never add ids.
- Copy is VERBATIM. Emit each provided text part exactly as given — no rewording, no added words, no new sentences, no punctuation changes. Do not add copy that wasn't provided.
- Apply the brand SIGNATURE MOVE exactly as its description says (e.g. wrap the emphasis phrase in the specified span; or place the tagline element).
- Follow the COMPOSITION PATTERN that matches this slide's ROLE. Use a <div class="fill"></div> spacer where the pattern bottom-anchors content.
- A SPACER IS ONLY WORTH WRITING WHEN SOMETHING FOLLOWS IT. A <div class="fill"></div> at the END of the fragment grows into empty canvas and leaves the bottom half of the poster blank — the classic unfinished-looking slide. Put the spacer where you want the gap: after the top-edge marks (the logo, the eyebrow) and before the statement they introduce, so the label sits on the top edge and the copy settles on the baseline.
- The canvas (dimensions given below) is large and the stylesheet already sets big, legible type for it — do not fight it. Keep the fragment to the few elements the pattern calls for; embrace negative space. On a taller (story) canvas lean on the fill spacer to spread content; on a square canvas keep it to the essentials.
- If a copy part is absent, omit its element (don't fabricate a placeholder).
- NEVER emit an empty element. An element with no content is invisible and can still take up space.
- ROWS are an enumeration, and must READ as one — never concatenate them into a paragraph. Wrap them in the brand's list container and give each entry its own row element (a .panel with one .row per entry, or whatever list vocabulary this brand defines). Keep them parallel: same class, same rhythm, one per entry.
- A row is JUST the item's text plus, optionally, its detail in the brand's note element. Do NOT add a bullet, dash, number or marker element — the stylesheet draws the marker in its own gutter, and an extra one leaves a gap or a double bullet.
- THE BRAND MARK IS FIXED. When the pattern calls for the logo, build it EXACTLY as the brand's logo/wordmark/monogram classes describe — same elements, same nesting, same words, every single time. It is an identity, not a composition: it does not vary by slide, and there is nothing about this slide that should change it. Put no loose text directly inside the wrapper (a wrapper is a layout box; text in it inherits nothing), and leave any class that carries the logo IMAGE empty — words placed in it land on top of the picture.

IMAGE SLOTS
- When this slide is marked "image: true", leave a HOLE for a photograph the user will supply — never describe one, never link one, never invent a src.
- A slot is exactly: <figure class="cb-shot" data-cb-slot="NAME"></figure> — always empty, no children, no <img> inside.
- NAME is your own short lowercase label for what belongs there (e.g. "hero", "before", "after", "product"). Lowercase letters, digits and hyphens only. Each slot on a slide needs a different name.
- Add a shape class when the composition wants one: "wide" (16:9), "tall" (3:4), "square" (1:1). With no shape class a slot is 4:3.
- SHAPES COST DIFFERENT AMOUNTS OF THE CANVAS: "wide" ~38%, 4:3 ~34%, "square" ~38%, "tall" ~46%. Spend "tall" only when the picture IS the slide — and when you do, the copy must be an eyebrow and one short headline, nothing else. Pick the shape that suits the photograph AND leaves room for the words you were given.
- Place the slot where the design needs the picture, in the flow of the composition — the recipe styles it, and the user's photo fills exactly that box.
- Usually ONE slot. Use two only when the slide is genuinely a pair (a before and an after).
- A SLOT REPLACES CONTENT, IT DOES NOT ADD TO IT. The picture costs a third to a half of the canvas, so on a slide with a slot follow the pattern only as far as: the brand mark, an eyebrow, the headline, and the slot. DROP the pattern's optional furniture — panels, rules, secondary blocks — to pay for it. The composition patterns were written for slides with no photograph; a slot is a substitution, not an addition.
- When "image" is not set, do not emit a slot at all.

Return only the fragment (the inner markup of .cb-slide).`;

/** Build the {system, user} messages for one slide compose call. */
export function buildComposeMessages(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
): { system: string; user: string } {
  const p = input.parts;
  const partLines = Object.entries({
    eyebrow: p.eyebrow,
    headline: p.headline,
    emphasis: p.emphasis,
    tagline: p.tagline,
    body: p.body,
    quote: p.quote,
    attribution: p.attribution,
    stat: p.stat,
    cta: p.cta,
    handle: p.handle,
  })
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n');
  const rowLines =
    p.rows && p.rows.length
      ? `  rows:\n` + p.rows.map((r) => `    - ${JSON.stringify(r)}`).join('\n')
      : '';

  const dims = RECIPE_FORMAT_DIMS[input.format];
  const canvas = dims ? `${dims.w}×${dims.h} (${dims.label})` : input.format;
  const user = [
    `BRAND SPEC`,
    recipeSpecBlock(recipe, input.format, input.role, variantIndexOf(input)),
    ``,
    `THIS SLIDE`,
    `  role: ${input.role}`,
    `  canvas: ${canvas}`,
    input.photo
      ? `  image: true — this slide holds a photograph. Leave an EMPTY <figure class="cb-shot" data-cb-slot="…"> where it belongs (see IMAGE SLOTS). Treatment for reference: ${recipe.imagery.treatment || 'photographic'}`
      : ``,
    `  copy parts (VERBATIM — arrange, do not change):`,
    partLines || '  (none)',
    rowLines,
    ``,
    `Compose the fragment now.`,
  ]
    .filter((l) => l !== ``)
    .join('\n');

  return { system: SLIDE_AUTHOR_INSTRUCTIONS, user };
}
