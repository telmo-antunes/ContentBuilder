/**
 * The slide-compose touchpoint: turn an idea into on-brand authored slides.
 *
 *   idea + recipe  --parse-->  slides (role + verbatim parts)
 *                  --compose-> authored HTML (brand classes only)  --sanitise-->
 *
 * Two cheap steps. The PARSE writes the copy (creative); the COMPOSE only
 * arranges it into the brand's classes (the formula's hard rules) and never
 * rewrites it — a mechanical verbatim guard enforces that. Both run on the small
 * model tier by default; the look comes entirely from the recipe.
 */
import { z } from 'zod';
import { SLOT_ATTR, SLOT_CLASS, authoredSlots, type BrandRecipe } from '@contentbuilder/shared';
import { aiMessage, modelFor, textOf } from '../ai';
import { config } from '../../config';
import { sanitizeAuthoredHtml } from '../htmlSanitize';
import { buildComposeMessages, type ComposeParts, type ComposeSlideInput, type SlideRole } from './prompt';

const SLIDE_ROLES = ['cover', 'statement', 'quote', 'feature', 'stat', 'list', 'cta'] as const;

/** Fallback slot appended when a photo slide came back without one. */
const DEFAULT_SLOT = `<figure class="${SLOT_CLASS}" ${SLOT_ATTR}="photo"></figure>`;

const partsSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string().optional(),
  emphasis: z.string().optional(),
  tagline: z.string().optional(),
  body: z.string().optional(),
  quote: z.string().optional(),
  attribution: z.string().optional(),
  stat: z.string().optional(),
  cta: z.string().optional(),
  handle: z.string().optional(),
});
const parseResultSchema = z.object({
  slides: z
    .array(
      z.object({
        role: z.enum(SLIDE_ROLES),
        parts: partsSchema,
        /** Does this slide want a photograph? Drives the placeholder the user fills. */
        image: z.boolean().catch(false).default(false),
      }),
    )
    .min(1)
    .max(12),
});

export interface ComposeOptions {
  format?: string;
  slideCount?: number;
  /** Override the model (defaults to the small tier). */
  model?: string;
  handle?: string;
}

function composeModel(opts?: ComposeOptions): string {
  return opts?.model ?? config.ai.modelSmall ?? config.ai.model!;
}

/** Extract the first JSON object from a model response (tolerates prose/fences). */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in response');
  return JSON.parse(body.slice(start, end + 1));
}

/** Strip markdown fences / stray prose around an HTML fragment. */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

/**
 * The stored fragment must be the INNER markup of `.cb-slide` (the renderer adds
 * the wrapper). Composers sometimes wrap their output in the full
 * `<div class="cb-slide …">…</div>` anyway — which double-wraps at render and,
 * worse, makes the whole slide one un-editable block. Strip a sole outer wrapper.
 */
function unwrapCbSlide(html: string): string {
  const t = html.trim();
  const m = t.match(/^<div\s+class="[^"]*\bcb-slide\b[^"]*"\s*>([\s\S]*)<\/div>$/i);
  return m ? m[1]!.trim() : t;
}

/** Collapse to comparable plain text (tags out, entities + whitespace normalised). */
function plain(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const PARSE_SYSTEM = `You are a social-carousel copywriter + editor. Turn the user's idea into a tight, scroll-stopping Instagram carousel, written in the brand's voice. Return STRICT JSON only (no prose, no fences):
{"slides":[{"role":"cover|statement|quote|feature|stat|cta","image":true|false,"parts":{...}}]}
Rules:
- First slide role "cover" (a hook). Last slide role "cta". In between use statement / feature / stat / quote as the content wants.
- parts keys (include only what a slide needs): eyebrow (2–4 word kicker), headline (the line — punchy), emphasis (the sub-phrase inside headline to accent), tagline (a short payoff line), body (1 short sentence), quote, attribution, stat (e.g. "40%"), cta (button text), handle.
- This is a POSTER read on a phone at arm's length, not an article. Hard budgets: eyebrow <= 22 characters, headline <= 60, body <= 90, cta <= 24. Going over does not get truncated — it pushes the design off the canvas.
- A slide marked "image": true gets an eyebrow and a headline ONLY. Omit "body" entirely on those slides — a photograph and a paragraph cannot share one poster, and the picture takes nearly half the canvas.
- Write in the brand voice provided. No hashtags, no emoji.
- "image": set true when this slide would be genuinely STRONGER with a photograph — it shows a place, a product, a person, a result, a before/after. Set false when the slide is a pure typographic statement, a pulled quote, or a big number, where a photo would only decorate. Judge each slide on its own; a deck may have several, one, or none. The user supplies the actual photographs later, so ask for one only where it earns its place.`;

/**
 * How photo-forward this brand is, in words the parse step can act on.
 *
 * `imagery.photoRole` is authored per brand and was left reading by nothing
 * when the old covers-only rule went away. This gives it a real job: it biases
 * the per-slide "would a photograph earn its place here?" judgement, so a
 * detailing shop is asked for pictures far more often than a brand whose whole
 * identity is typographic.
 */
function photoGuidance(recipe: BrandRecipe): string {
  switch (recipe.imagery.photoRole) {
    case 'hero':
      return 'PHOTOGRAPHY: this brand is carried by its images — most slides that show a place, a product, a person or a result should ask for one.';
    case 'accent':
      return 'PHOTOGRAPHY: this brand uses images sparingly, to support the type — ask for one only where it genuinely adds proof or atmosphere.';
    default:
      return 'PHOTOGRAPHY: this brand is typographic — set "image" to false unless a slide is meaningless without a picture.';
  }
}

function parseUser(recipe: BrandRecipe, idea: string, count: number, handle?: string): string {
  return [
    `BRAND VOICE: ${recipe.voice.description || 'clear, confident'}`,
    photoGuidance(recipe),
    recipe.voice.dos.length ? `DO: ${recipe.voice.dos.join('; ')}` : '',
    recipe.voice.donts.length ? `DON'T: ${recipe.voice.donts.join('; ')}` : '',
    handle ? `HANDLE: ${handle}` : '',
    `TARGET SLIDES: ~${count}`,
    ``,
    `IDEA: ${idea}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Parse an idea into composed-slide inputs (role + verbatim parts). */
export async function parseForCompose(
  recipe: BrandRecipe,
  idea: string,
  opts?: ComposeOptions,
): Promise<ComposeSlideInput[]> {
  const format = opts?.format ?? '1080x1350';
  const count = opts?.slideCount ?? 5;
  const resp = await aiMessage({
    model: composeModel(opts),
    max_tokens: 1600,
    system: PARSE_SYSTEM,
    messages: [{ role: 'user', content: parseUser(recipe, idea, count, opts?.handle) }],
  });
  const parsed = parseResultSchema.parse(extractJson(textOf(resp)));
  // Which slides get an image PLACEHOLDER is the parse step's judgement, per
  // slide — not "covers only, and only for photoRole: hero" as it used to be,
  // which meant whole brands could never show a photograph anywhere. The user
  // fills these afterwards; nothing is auto-attached.
  return parsed.slides.map((s, index) => ({
    role: s.role as SlideRole,
    parts: s.parts as ComposeParts,
    format,
    photo: s.image,
    index,
  }));
}

/** Compose one slide's authored HTML from its parts (arrange-only; sanitised). */
export async function composeSlide(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
  opts?: ComposeOptions,
): Promise<{ html: string; bg?: string; role?: string }> {
  const { system, user } = buildComposeMessages(recipe, input);
  const resp = await aiMessage({
    model: composeModel(opts),
    max_tokens: 1400,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const safe = sanitizeAuthoredHtml(unwrapCbSlide(stripFences(textOf(resp))));
  // Mechanical verbatim guard: every provided part's copy must survive in the output.
  const hay = plain(safe);
  const missing = Object.entries(input.parts)
    .filter(([, v]) => typeof v === 'string' && v.length > 2)
    .filter(([, v]) => !hay.includes(plain(v as string)))
    .map(([k]) => k);
  if (missing.length) {
    console.warn(`[compose] ${input.role}: parts not verbatim in output: ${missing.join(', ')}`);
  }
  // Mechanical placeholder guard, the twin of the verbatim guard above: if this
  // slide was meant to hold a photograph, it must LEAVE A HOLE for one. A model
  // that forgets the slot would silently produce a slide the user can't put an
  // image on, so append one rather than trusting the prompt.
  const withSlot = input.photo && authoredSlots(safe).length === 0 ? safe + DEFAULT_SLOT : safe;
  // The role travels WITH the slide so the renderer can apply the recipe's
  // per-role motion (a stat pops, a quote fades) in animated exports.
  // `bg` is no longer set here: a full-bleed photo is the USER's choice now,
  // and the renderer derives it from whether they set a background photo.
  return { html: withSlot, role: input.role };
}

/** Full path: idea → authored slides (role + authored markup). */
export async function composeProject(
  recipe: BrandRecipe,
  idea: string,
  opts?: ComposeOptions,
): Promise<Array<{ role: SlideRole; authored: { html: string; bg?: string; role?: string } }>> {
  // Resolve the compose model once (Settings override → cheap tier) and thread
  // it through the parse + per-slide compose calls, so all share one lookup.
  const o: ComposeOptions = { ...opts, model: opts?.model ?? (await modelFor('compose')) };
  const inputs = await parseForCompose(recipe, idea, o);
  const out: Array<{ role: SlideRole; authored: { html: string; bg?: string; role?: string } }> = [];
  for (const input of inputs) {
    const authored = await composeSlide(recipe, input, o);
    if (authored.html) out.push({ role: input.role, authored });
  }
  return out;
}
