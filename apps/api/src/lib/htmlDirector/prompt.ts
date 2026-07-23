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
import type { BrandRecipe } from '@contentbuilder/shared';

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
}

/** Render the recipe into the compact spec the composer reasons over. */
export function recipeSpecBlock(recipe: BrandRecipe): string {
  const comps = recipe.components.map((c) => `  .${c.className} — ${c.use}`).join('\n');
  const patterns = recipe.composition.patterns.map((p) => `  - ${p}`).join('\n');
  return [
    `SIGNATURE MOVE (${recipe.signature.name}): ${recipe.signature.description}`,
    `ALIGNMENT: ${recipe.composition.align}`,
    ``,
    `COMPONENT CLASSES you may use (and nothing else):`,
    comps,
    ``,
    `COMPOSITION PATTERNS (arrangement by slide role):`,
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
- The canvas is large (1080×1350) and the stylesheet already sets big, legible type — do not fight it. Keep the fragment to the few elements the pattern calls for; embrace negative space.
- If a copy part is absent, omit its element (don't fabricate a placeholder).

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

  const user = [
    `BRAND SPEC`,
    recipeSpecBlock(recipe),
    ``,
    `THIS SLIDE`,
    `  role: ${input.role}`,
    `  format: ${input.format}`,
    input.photo ? `  photo: true (add class "photo" to nothing — the renderer sets it; compose the photo-cover pattern)` : ``,
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
