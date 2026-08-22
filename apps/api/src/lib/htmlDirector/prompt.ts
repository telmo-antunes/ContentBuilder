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
import type Anthropic from '@anthropic-ai/sdk';
import { cachedSystemLayers } from '../ai';
import {
  RECIPE_FORMAT_DIMS,
  archetypeFor,
  recipePatternsFor,
  recipePatternVariant,
  slideAlignFor,
  type BrandRecipe,
  type SlideAlign,
} from '@contentbuilder/shared';

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
  /** Extra rows for panel/list roles: [{ text, note?, state? }] — `state`
   *  ('do' | 'dont') marks a verdict row; the renderer draws tick vs cross. */
  rows?: Array<{ text: string; note?: string; state?: 'do' | 'dont' }>;
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
  /**
   * The art director's chosen arrangement for this slide (0-based), when it
   * overrode the positional rotation. See `variantIndexOf`.
   */
  variantPin?: number;
  /**
   * This slide's alignment when it deviates from the brand default — the parse
   * step's per-deck call. Threaded into the spec block so the composer arranges
   * for it, stored on `authored.align`, applied by the app's `data-align` layer.
   */
  align?: SlideAlign;
  /**
   * The parse step's one-line reasoning for this slide's calls (role, image,
   * align). Never reaches the composer — it is stored on the slide and shown
   * on the review page, so the model's judgment is inspectable after the fact.
   */
  rationale?: string;
  /** Position in the deck — rotates which composition VARIANT this role uses. */
  index?: number;
  /**
   * Per-DECK offset for the variant rotation, derived from the project (a
   * stable hash of its id), so two consecutive posts pick different pattern +
   * fragment variants for the same roles. Deterministic: recomposing the same
   * project lands on the same variants.
   */
  seed?: number;
  /**
   * Start that rotation further along. Set from a `rearranges-role` lesson: the
   * arrangement the rotation lands on is the one this brand keeps swapping out,
   * so the composer reaches past it. Never changes the slide's position in the
   * deck — only which of the role's authored arrangements it follows.
   */
  variantBias?: number;
  /**
   * The COMPOSITION this slide will be laid out as — an archetype key.
   *
   * Decided from the parse (role + whether it has a photograph), before any
   * slide is written. The composer used to work without it and find out
   * afterwards, when the layout gates measured the result against a policy it
   * had never been told: an archetype owns where a slide's leftover space
   * lands and how many lines its headline may run to, so the same markup reads
   * 34% empty under one and 66% under none.
   */
  archetype?: string;
}

/** The rotation position for this slide's composition variant. */
/**
 * Where an archetype's leftover space goes, in words a writer can act on.
 *
 * The policy is a single token in the type — `top`, `between`, `center` — which
 * is precise and says nothing to someone deciding how much to write. This is the
 * same fact in the form the composer needs it: not "the slack policy is bottom"
 * but "pack from the top and let the space fall below".
 */
const SLACK_IN_WORDS: Record<string, string> = {
  top: 'above the content — anchor the slide low',
  bottom: 'below the content — pack it from the top',
  between: 'between the picture and the type, each owning its own band',
  center: 'around the content — let it sit optically centred, with room either side',
};

/**
 * WHICH ARRANGEMENT THIS SLIDE USES.
 *
 * Normally derived — deck position, plus a lesson's bias, plus the per-deck
 * seed that stops consecutive posts being re-skins. `variantPin` is the art
 * director's override: it has read the whole deck and matched the arrangement
 * to what the slide actually SAYS, which position never can, so it wins
 * outright rather than being added to the rotation.
 */
export const variantIndexOf = (input: ComposeSlideInput): number =>
  input.variantPin !== undefined
    ? input.variantPin
    : (input.index ?? 0) + (input.variantBias ?? 0) + (input.seed ?? 0);

/**
 * The BRAND-STABLE half of the composer's spec: byte-identical for every slide
 * of a deck, so it rides in the cached system prefix instead of being re-sent
 * (and re-billed) on all seven slides. See `cachedSystemLayers` in lib/ai.ts.
 */
export function recipeBrandBlock(recipe: BrandRecipe): string {
  const comps = recipe.components.map((c) => `  .${c.className} — ${c.use}`).join('\n');
  return [
    `SIGNATURE MOVE (${recipe.signature.name}): ${recipe.signature.description}`,
    ``,
    `COMPONENT CLASSES you may use (and nothing else):`,
    comps,
  ].join('\n');
}

/** Render the recipe into the compact spec the composer reasons over. */
export function recipeSpecBlock(
  recipe: BrandRecipe,
  format: string,
  role?: string,
  index?: number,
  align?: SlideAlign,
): string {
  const comps = recipe.components.map((c) => `  .${c.className} — ${c.use}`).join('\n');
  // When the role is known, lead with the ONE variant this slide should follow
  // (a brand may author several arrangements per role); otherwise list them all.
  const chosen = role ? recipePatternVariant(recipe, format, role, index) : undefined;
  const patterns = chosen
    ? `  - ${chosen}`
    : recipePatternsFor(recipe, format).map((p) => `  - ${p}`).join('\n');
  // THIS slide's alignment: its own deviation → the recipe's per-role override
  // → the brand default. Named per slide so the composer arranges for the
  // alignment the app layer will actually apply, instead of the global one.
  const effectiveAlign = slideAlignFor(recipe, role, align) ?? recipe.composition.align;
  return [
    `SIGNATURE MOVE (${recipe.signature.name}): ${recipe.signature.description}`,
    `ALIGNMENT: ${effectiveAlign}${
      effectiveAlign !== recipe.composition.align
        ? ` (this slide deviates from the brand's ${recipe.composition.align} default — compose for ${effectiveAlign})`
        : ''
    }`,
    ``,
    `COMPONENT CLASSES you may use (and nothing else):`,
    comps,
    ``,
    `COMPOSITION PATTERN to follow:`,
    patterns,
  ].join('\n');
}

/**
 * The PER-SLIDE half of the spec — the alignment this slide composes at and the
 * one arrangement it follows. Both vary by role, deck position and deviation,
 * so this sits in the user message, after the cached prefix.
 */
export function slideSpecBlock(
  recipe: BrandRecipe,
  format: string,
  role?: string,
  index?: number,
  align?: SlideAlign,
): string {
  const chosen = role ? recipePatternVariant(recipe, format, role, index) : undefined;
  const patterns = chosen
    ? `  - ${chosen}`
    : recipePatternsFor(recipe, format).map((p) => `  - ${p}`).join('\n');
  const effectiveAlign = slideAlignFor(recipe, role, align) ?? recipe.composition.align;
  return [
    `ALIGNMENT: ${effectiveAlign}${
      effectiveAlign !== recipe.composition.align
        ? ` (this slide deviates from the brand's ${recipe.composition.align} default — compose for ${effectiveAlign})`
        : ''
    }`,
    ``,
    `COMPOSITION PATTERN to follow:`,
    patterns,
  ].join('\n');
}

export const SLIDE_AUTHOR_INSTRUCTIONS = `You compose one slide of a brand's Instagram carousel. The copy is already written and approved; the brand's design system — its component classes, its patterns, its devices — is given. Your job is the part between them: setting THIS copy in THIS brand's vocabulary so the slide reads like something the business made for itself. A poster with one clear subject, a hierarchy the eye follows without being told to, and room to breathe. Not a template with the fields filled in.

WHAT IS YOURS TO DECIDE
- The pattern names the arrangement's bones; how the copy inhabits them is your call — what leads, what supports, what earns one of the brand's devices (a card, a badge, a panel, a rule) and what stands bare. A device is for content of its kind: a claim with its evidence belongs in the card built for that, and a device used because it exists is decoration.
- Restraint is a decision you are allowed to make. The canvas is large, the stylesheet already sets big confident type, and a slide that says one thing well beats a slide that uses every element it was offered. Negative space you chose reads as poise; negative space left over reads as unfinished — the difference is whether the remaining elements form one group with a clear anchor, or two orphans with a hole between them.
- Where a photograph sits is a real composition decision, not a default — see PICTURES.

THE CONTRACT — these are enforced by machines after you finish, so treat them as physics
- Output ONE HTML fragment, nothing else: no <html>, <head>, <style>, <script>, no markdown fences, no commentary. It mounts inside .cb-slide.
- ONLY the component classes listed for this brand. No invented class names, no style="" attributes, no ids.
- COPY IS VERBATIM. Every provided text part appears exactly as given — no rewording, no additions, no punctuation changes — and nothing appears that was not provided. A part that is absent gets no element and no placeholder; a URL, a handle, a footer line you were not given does not exist.
- Apply the brand SIGNATURE MOVE exactly as its description says.
- NEVER emit an empty element — invisible, but it still takes space.

THE ARRANGEMENT, when this slide names one, was decided for the whole DECK so seven slides carry one rhythm instead of seven opinions — honour it. Two things follow: where it says the leftover space belongs is where the .fill spacer goes (a <div class="fill"></div> ABOVE the content anchors the slide low; one below packs it from the top), and its headline line limit is the limit for THIS composition — a headline past it is unedited copy sitting where a picture or a list should be. A spacer is only worth writing when something follows it: a trailing .fill grows into blank canvas, the classic unfinished slide.

ALIGNMENT is applied to the whole frame by the app afterwards — you never write alignment classes. What it changes is judgment: a centred slide holds short display moments (an eyebrow, the headline, one payoff line, a cta) and no asymmetric furniture, because centred running text and centred lists do not read.

ROWS are an enumeration and must read as one: the brand's list container, one row element per entry, parallel in class and rhythm — never concatenated into a paragraph. A row is its text plus, optionally, its detail in the brand's note element; the stylesheet draws every marker in its own gutter, so write no bullet, dash or number. A row given a STATE carries it as an extra class — class="row do" / class="row dont" — and nothing else: the app draws the tick or cross. Never write ✓ or ✕ into copy.

THE BRAND MARK IS FIXED. When the pattern calls for the logo, build it exactly as the brand's logo/wordmark/monogram classes describe — same elements, same nesting, same words, every time. It is an identity, not a composition. No loose text directly inside the wrapper, and any class that carries the logo IMAGE stays empty — words placed in it land on top of the picture.

PICTURES
When this slide is marked "image: true", you are composing a two-body layout — a photograph and a block of type sharing one frame — and where the seam falls is the decision the slide is judged on. The photograph arrives later; you leave its place. Three placements exist:
- INSET: <figure class="cb-shot" data-cb-slot="NAME"></figure> — an empty figure, no children, no src, NAME your own short lowercase label ("hero", "before", "product"; letters, digits, hyphens; unique per slide). Add a shape class when the composition wants one: "wide" (16:9, ~38% of the canvas), "tall" (3:4, ~46%), "square" (~38%); none means 4:3 (~34%). The inset is right when the picture is EVIDENCE for the words — a screenshot, a detail, a proof. Place it in the flow where the design needs it, and place it WITH the type, not away from it: the figure and the copy it supports are one group, and a figure drifting in leftover space with a band of nothing above it is the commonest way a photo slide fails. Spend "tall" only when the picture is the slide, and then the copy is an eyebrow and one short headline.
- EDGE: class "edge" (optionally "edge left") instead of a shape — the photograph takes that whole side, floor to ceiling, type holding the other. It costs no vertical space, so the copy runs its full length beside it. Reach for it when the picture deserves to be half the poster; a deck where every photograph is an inset rounded rectangle is the single strongest "template" signal a carousel can carry.
- FULL-BLEED (only when the brief says so): the picture is the background layer behind your whole fragment, under the brand's scrim. No figure at all — a slot would punch a card through it — and the copy stays to the few short display moments the arrangement names.
A slot REPLACES content, it does not add to it: the picture costs a third to half the canvas, so keep the brand mark, an eyebrow, the headline, the slot — and drop the pattern's optional furniture to pay for it. One slot, two only for a genuine pair (a before and an after). When "image" is not set, no slot at all.

Return only the fragment (the inner markup of .cb-slide).`;

/** Build the {system, user} messages for one slide compose call. */
export function buildComposeMessages(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
): { system: Anthropic.TextBlockParam[]; user: string } {
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
  const arrangement = archetypeFor(input.archetype);
  const user = [
    `THIS SLIDE'S SPEC`,
    slideSpecBlock(recipe, input.format, input.role, variantIndexOf(input), input.align),
    ``,
    `THIS SLIDE`,
    `  role: ${input.role}`,
    `  canvas: ${canvas}`,
    arrangement
      ? `  arrangement: ${arrangement.key} — ${arrangement.intent} ` +
        `Leftover space belongs ${SLACK_IN_WORDS[arrangement.slack] ?? 'where the brand puts it'}, ` +
        `and the headline may run to ${arrangement.maxHeadlineLines} line${arrangement.maxHeadlineLines === 1 ? '' : 's'}.`
      : ``,
    input.photo
      ? archetypeFor(input.archetype)?.placement === 'bleed'
        ? `  image: true, FULL-BLEED — the photograph arrives as the background layer behind your markup, under the brand's scrim (see IMAGE SLOTS). Do NOT leave a <figure class="cb-shot"> slot. Compose only the type, spare, for the arrangement's quiet end. Treatment for reference: ${recipe.imagery.treatment || 'photographic'}`
        : `  image: true — this slide holds a photograph. Leave an EMPTY <figure class="cb-shot" data-cb-slot="…"> where it belongs (see IMAGE SLOTS). Treatment for reference: ${recipe.imagery.treatment || 'photographic'}`
      : ``,
    `  copy parts (VERBATIM — arrange, do not change):`,
    partLines || '  (none)',
    rowLines,
    ``,
    `Compose the fragment now.`,
  ]
    .filter((l) => l !== ``)
    .join('\n');

  /**
   * TWO CACHE SCOPES: the instructions (identical everywhere) and the brand's
   * own vocabulary (identical across this deck's slides). Both are prefix, so a
   * seven-slide deck pays full price for them once instead of seven times.
   */
  return {
    system: cachedSystemLayers(SLIDE_AUTHOR_INSTRUCTIONS, `BRAND SPEC\n${recipeBrandBlock(recipe)}`),
    user,
  };
}
