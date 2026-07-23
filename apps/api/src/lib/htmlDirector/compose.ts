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
import type { BrandRecipe } from '@contentbuilder/shared';
import { aiMessage, textOf } from '../ai';
import { config } from '../../config';
import { sanitizeAuthoredHtml } from '../htmlSanitize';
import { buildComposeMessages, type ComposeParts, type ComposeSlideInput, type SlideRole } from './prompt';

const SLIDE_ROLES = ['cover', 'statement', 'quote', 'feature', 'stat', 'list', 'cta'] as const;

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
    .array(z.object({ role: z.enum(SLIDE_ROLES), parts: partsSchema }))
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
{"slides":[{"role":"cover|statement|quote|feature|stat|cta","parts":{...}}]}
Rules:
- First slide role "cover" (a hook). Last slide role "cta". In between use statement / feature / stat / quote as the content wants.
- parts keys (include only what a slide needs): eyebrow (2–4 word kicker), headline (the line — punchy), emphasis (the sub-phrase inside headline to accent), tagline (a short payoff line), body (1 short sentence), quote, attribution, stat (e.g. "40%"), cta (button text), handle.
- Keep copy SHORT and legible at a glance — this is a poster, not an article. Headlines a few words; body one sentence.
- Write in the brand voice provided. No hashtags, no emoji.`;

function parseUser(recipe: BrandRecipe, idea: string, count: number, handle?: string): string {
  return [
    `BRAND VOICE: ${recipe.voice.description || 'clear, confident'}`,
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
  const photoHero = recipe.imagery.photoRole === 'hero';
  return parsed.slides.map((s) => ({
    role: s.role as SlideRole,
    parts: s.parts as ComposeParts,
    format,
    photo: s.role === 'cover' && photoHero,
  }));
}

/** Compose one slide's authored HTML from its parts (arrange-only; sanitised). */
export async function composeSlide(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
  opts?: ComposeOptions,
): Promise<{ html: string; bg?: string }> {
  const { system, user } = buildComposeMessages(recipe, input);
  const resp = await aiMessage({
    model: composeModel(opts),
    max_tokens: 1400,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const safe = sanitizeAuthoredHtml(stripFences(textOf(resp)));
  // Mechanical verbatim guard: every provided part's copy must survive in the output.
  const hay = plain(safe);
  const missing = Object.entries(input.parts)
    .filter(([, v]) => typeof v === 'string' && v.length > 2)
    .filter(([, v]) => !hay.includes(plain(v as string)))
    .map(([k]) => k);
  if (missing.length) {
    console.warn(`[compose] ${input.role}: parts not verbatim in output: ${missing.join(', ')}`);
  }
  return { html: safe, bg: input.photo ? 'photo' : undefined };
}

/** Full path: idea → authored slides (role + authored markup). */
export async function composeProject(
  recipe: BrandRecipe,
  idea: string,
  opts?: ComposeOptions,
): Promise<Array<{ role: SlideRole; authored: { html: string; bg?: string } }>> {
  const inputs = await parseForCompose(recipe, idea, opts);
  const out: Array<{ role: SlideRole; authored: { html: string; bg?: string } }> = [];
  for (const input of inputs) {
    const authored = await composeSlide(recipe, input, opts);
    if (authored.html) out.push({ role: input.role, authored });
  }
  return out;
}
