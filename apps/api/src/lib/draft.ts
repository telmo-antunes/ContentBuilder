import type Anthropic from '@anthropic-ai/sdk';
import {
  applyBrandLayout,
  BLOCK_TYPES,
  DESIGNER_LAYOUT_TYPES,
  FORMAT_DIMENSIONS,
  MAX_SLIDES_PER_PROJECT,
  safeAreaFor,
  type AssetType,
  type BlockFrame,
  type BrandLayout,
  type Format,
  type Slide,
} from '@contentbuilder/shared';
import { config } from '../config';
import { SettingModel } from '../models';
import { aiMessage, textOf } from './ai';
import { recordUsage } from './usage';
import { parseParagraph, type ContentUnit } from './draftParse';
import { reorderByReading } from './director/readingOrder';
import { slideSchema, type SlideInput } from './validation';
import type { BrandDraftContext } from './templates';

export type DraftMode = 'designer' | 'free';

interface AiSettings {
  designerModel?: string;
  freeModel?: string;
  designerSystem?: string;
  freeSystem?: string;
  freeMaxTokens?: number;
}

/** Operator overrides from the AI Settings page (empty fields → code defaults). */
async function loadAiSettings(): Promise<AiSettings> {
  try {
    const doc = await SettingModel.findOne({ key: 'ai' }).lean<AiSettings>();
    return doc ?? {};
  } catch {
    return {};
  }
}

const pick = (override: string | undefined, fallback: string): string =>
  override && override.trim() ? override : fallback;

const THEMES = 'editorial, bold, minimal, soft';
const TREATMENTS = 'none, tint, duotone';

const DESIGNER_SYSTEM = `You are an art director turning a user's paragraph into an ordered set of Instagram slides. The user brings the WORDS; you bring the visual judgment — imagery, layout rhythm, mood.

Output ONLY a JSON array (no prose, no markdown fences). Each element:
{ "order": number, "layoutType": <one of: ${DESIGNER_LAYOUT_TYPES.join(', ')}>, "blocks": [{ "type": <one of: ${BLOCK_TYPES.join(', ')}>, "text": string, "items"?: string[] }], "imageNeed": "none" | "upload", "imageQuery"?: string, "overrides"?: { "theme"?: <one of: ${THEMES}>, "imageTreatment"?: <one of: ${TREATMENTS}>, "focalPoint"?: { "x": number, "y": number } } }

ART DIRECTION — you decide where imagery belongs; do not wait for the user to mention photos:
- The OPENING slide should stop the scroll: a BackgroundImage cover (full-bleed photo + short title) is often the strongest opener — use it whenever the first slide's copy is short enough to sit on a photo.
- Feature/benefit/product moments suit CenteredHero (one framed visual) or SplitImageText (image beside copy). Dense copy, lists, quotes and closers suit Statement/TextOnly/Checklist/Quote/CTA.
- Aim for visual rhythm across the set: at least one image slide in most posts, but never force one onto copy that can't share the space.
- For EVERY slide with "imageNeed": "upload", also set "imageQuery": a concrete 2–4 word stock-photo search phrase grounded in the business context (e.g. "ceramic coating closeup", "barista pouring latte"). Describe a photographable SCENE, not an abstraction.
- On image slides, choose an "overrides.imageTreatment" that aids legibility ("tint"/"duotone" for photos behind text, "none" otherwise) and a sensible "overrides.focalPoint" (x,y in 0..1, default {x:0.5,y:0.5}).

RULES:
- Use ONLY the listed layoutType and block type values. Never invent values.
- Pick a coherent "overrides.theme" that suits the brand mood and keep it consistent across slides.
- Insert the user's text VERBATIM. NEVER invent, rewrite, translate, summarize, or embellish copy. Prefer leaving a block out over inventing filler. ("imageQuery" is a search phrase, not copy — it never appears on the slide.)
- For a list, put the items in "items" (array of strings) and set "text" to "".
- At most ${MAX_SLIDES_PER_PROJECT} slides.`;

/**
 * Free-mode system prompt TEMPLATE. Tokens ({{width}}, {{xMin}}, …) are filled in
 * per request. Editable via the AI Settings page; this is the default.
 */
export const FREE_SYSTEM_TEMPLATE = `You are a senior graphic designer composing Instagram slides on a free canvas. Treat each slide as a deliberate composition, and vary the layouts across the set so it feels designed — never templated.

CANVAS: {{width}}×{{height}}px. All positions are FRACTIONS of the canvas (0..1). A "frame" is { "x": left, "y": top, "w": width, "h": height }. Each text block also takes a "z" (higher = painted in front).

OUTPUT: ONLY a JSON array (no prose, no markdown fences). Each element:
{ "order": number, "layoutType": "FreePosition", "imageNeed": "none" | "upload", "imageQuery"?: string, "blocks": [{ "type": <one of: {{blockTypes}}>, "text": string, "items"?: string[], "frame": { "x": number, "y": number, "w": number, "h": number }, "z": number }], "overrides"?: { "imageFrame": { "x": number, "y": number, "w": number, "h": number } } }

IMAGES — you are the art director; decide where imagery belongs, don't wait for the user to mention photos:
- The OPENING slide should stop the scroll: a full-bleed photo with short copy over it ("imageNeed": "upload", "overrides": { "imageBackground": true }) is often the strongest opener. Full-bleed also suits closers.
- To FEATURE a visual (product, screenshot, scene), set "imageNeed": "upload" and reserve a GENEROUS region in "overrides.imageFrame" (typically 0.45–0.75 of the canvas). Place the text where the image is NOT (above, below, beside). Text frames must NOT overlap the imageFrame. There is NO image block; the image IS the imageFrame.
- For EVERY slide with "imageNeed": "upload", also set "imageQuery": a concrete 2–4 word stock-photo search phrase grounded in the business (a photographable SCENE, e.g. "ceramic coating closeup"). It never appears on the slide.
- Aim for visual rhythm: most posts want at least one image slide, but dense-copy slides are fine without.
- A slide with no visual: "imageNeed": "none".

COMPOSITION — make each slide visually distinct from the others:
- Vary the anchor across the set: some top-weighted, some bottom-weighted, some asymmetric (copy hugging one side). Do NOT reuse the same x/y for the same block type on every slide.
- Use scale contrast: a hero title can be large (h up to ~0.30) and span most of the width; an eyebrow is small (h ~0.05–0.08) and sits just above its title; supporting copy sits in a tighter column.
- A cta/handle usually anchors near the bottom.
- Image-slide patterns to mix (pick what fits, vary slide to slide): image across the top ~0.55 with title+eyebrow below; image on the right half with copy stacked on the left; a tall portrait image on the left with copy on the right; a centered image with a short caption beneath.

RULES:
- Use ONLY the listed block type values. "layoutType" is always "FreePosition".
- Keep EVERY frame (text blocks AND imageFrame) inside the safe area: x in [{{xMin}}, {{xMax}}], y in [{{yMin}}, {{yMax}}], x+w ≤ {{xMax}}, y+h ≤ {{yMax}}.
- Make text "h" a bit taller than the copy strictly needs so nothing clips. Text frames must not overlap each other or the imageFrame.
- Insert the user's text VERBATIM. NEVER invent, rewrite, translate, summarize, or embellish copy. Prefer leaving a block out over inventing filler.
- For a list, put the items in "items" (array of strings) and set "text" to "".
- At most {{maxSlides}} slides.`;

/** Default prompts/params surfaced to the AI Settings page. */
export const PROMPT_DEFAULTS = {
  designerSystem: DESIGNER_SYSTEM,
  freeSystem: FREE_SYSTEM_TEMPLATE,
  // Roomy: on Fable-family models thinking is always on and bills against
  // max_tokens, so the cap must cover reasoning + the full JSON layout.
  freeMaxTokens: 16000,
};

/** Substitute {{token}} placeholders. */
function fillTemplate(tpl: string, tokens: Record<string, string | number>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(tokens[k] ?? `{{${k}}}`));
}

/** System prompt for Free mode, from a template (override or the default). */
function freeSystem(type: AssetType, format: Format, override?: string): string {
  const { width, height } = FORMAT_DIMENSIONS[format];
  const safe = safeAreaFor(type);
  const xMin = +(safe.padding / width).toFixed(3);
  const xMax = +(1 - safe.padding / width).toFixed(3);
  const yMin = +(safe.topReserve / height || safe.padding / height).toFixed(3);
  const yMax = +(1 - (safe.bottomReserve / height || safe.padding / height)).toFixed(3);
  const tpl = override && override.trim() ? override : FREE_SYSTEM_TEMPLATE;
  return fillTemplate(tpl, {
    width,
    height,
    xMin,
    xMax,
    yMin,
    yMax,
    blockTypes: BLOCK_TYPES.join(', '),
    maxSlides: MAX_SLIDES_PER_PROJECT,
  });
}

export function extractSlides(raw: string, mode: DraftMode): SlideInput[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('model did not return a JSON array');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('model returned invalid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('model did not return a JSON array');

  const valid: SlideInput[] = [];
  for (const item of parsed) {
    // Defense-in-depth: force the free layout AND repair frames so a slightly
    // off-range value (or a stray pixel coordinate) doesn't get the whole slide
    // dropped by validation — the user gets a usable slide they can nudge.
    if (mode === 'free' && item && typeof item === 'object') {
      const it = item as { layoutType?: string; blocks?: unknown; overrides?: Record<string, unknown> };
      it.layoutType = 'FreePosition';
      if (Array.isArray(it.blocks)) {
        it.blocks.forEach((b, i) => {
          if (b && typeof b === 'object') (b as { frame?: unknown }).frame = repairFrame((b as { frame?: unknown }).frame, i);
        });
      }
      if (it.overrides && typeof it.overrides === 'object' && it.overrides.imageFrame) {
        it.overrides.imageFrame = repairFrame(it.overrides.imageFrame, 0);
      }
    }
    const result = slideSchema.safeParse(item);
    if (result.success) valid.push(result.data);
    if (valid.length >= MAX_SLIDES_PER_PROJECT) break;
  }
  return valid;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Coerce a model-supplied frame into a valid in-bounds rectangle (fractions). */
export function repairFrame(raw: unknown, i: number): { x: number; y: number; w: number; h: number } {
  const f = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const w = Math.min(1, Math.max(0.05, n(f.w, 0.8)));
  const h = Math.min(1, Math.max(0.05, n(f.h, 0.18)));
  let x = clamp01(n(f.x, 0.1));
  let y = clamp01(n(f.y, 0.1 + (i % 4) * 0.04));
  if (x + w > 1) x = Math.max(0, 1 - w);
  if (y + h > 1) y = Math.max(0, 1 - h);
  return { x, y, w, h };
}

/** Mirror a frame horizontally — for varied repeats of the same brand layout. */
function mirrorFrame(f: BlockFrame): BlockFrame {
  return { ...f, x: Math.max(0, +(1 - f.x - f.w).toFixed(4)) };
}
function mirrorLayout(layout: BrandLayout): BrandLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((b) => ({ ...b, frame: mirrorFrame(b.frame) })),
    imageFrame: layout.imageFrame ? mirrorFrame(layout.imageFrame) : undefined,
    decorations: layout.decorations?.map((d) => ({ ...d, frame: mirrorFrame(d.frame) })),
  };
}

/**
 * Library-first instantiation: pour each parsed content unit into the brand's
 * matching composition (cycling + mirroring duplicates for variety) — deterministic
 * and copy-preserving. Falls back to the 'content' layout for any purpose the
 * format-matched library lacks, so no unit is ever dropped. No AI call here.
 */
export function instantiateFromLibrary(units: ContentUnit[], layouts: BrandLayout[]): SlideInput[] {
  if (!layouts.length) return [];
  const byPurpose = new Map<string, BrandLayout[]>();
  for (const l of layouts) {
    const arr = byPurpose.get(l.purpose) ?? [];
    arr.push(l);
    byPurpose.set(l.purpose, arr);
  }
  const fallback = byPurpose.get('content')?.[0] ?? layouts[0]!;
  const seen = new Map<string, number>();
  const slides: SlideInput[] = [];
  units.forEach((unit, i) => {
    const candidates = byPurpose.get(unit.purpose) ?? [];
    const n = seen.get(unit.purpose) ?? 0;
    seen.set(unit.purpose, n + 1);
    let layout = candidates.length ? candidates[n % candidates.length]! : fallback;
    if (n >= Math.max(1, candidates.length)) layout = mirrorLayout(layout); // vary repeats
    const source: Slide = {
      id: `s${i}`,
      order: i,
      layoutType: 'FreePosition',
      blocks: unit.blocks.map((b) => ({ type: b.type, text: b.text, items: b.items })),
      imageNeed: layout.imageNeed ?? 'none',
    };
    const applied = applyBrandLayout(source, layout, layout.backgroundMediaAssetId);
    applied.order = i;
    if (unit.imageQuery) applied.imageQuery = unit.imageQuery;
    // Guard against leftover copy (e.g. an unmatched header) landing below the
    // body it introduces: re-stack any out-of-order column into reading order.
    applied.blocks = reorderByReading(applied.blocks);
    const parsed = slideSchema.safeParse(applied);
    if (parsed.success) slides.push(parsed.data);
  });
  return slides;
}

/**
 * The opt-in draft call: paragraph + type/format ONLY — never the brand kit
 * (layout/block selection doesn't depend on colors or fonts, so sending it just
 * burns tokens). Output is validated against the allowlist; unknown slides/blocks
 * are dropped.
 *
 * - "designer": preset layouts + per-slide theme/treatment/focal point (cheap model).
 * - "free": absolute-positioned blocks on a FreePosition canvas (stronger model).
 */
export async function draftSlidesFromParagraph(
  paragraph: string,
  type: AssetType,
  format: Format,
  mode: DraftMode = 'designer',
  brandContext?: BrandDraftContext,
): Promise<SlideInput[]> {
  const settings = await loadAiSettings();
  const userMsg =
    `Asset type: ${type} (${format}).\n` +
    `Arrange the EXACT copy in this paragraph into slides per the rules:\n\n"""${paragraph}"""`;

  // Run one create call, record its token usage, and parse slides. Retries ONCE if
  // the model returns nothing usable (empty/garbled JSON) — cheap insurance against
  // a flaky single completion before the caller's mode-fallback kicks in.
  const run = async (params: Anthropic.MessageCreateParamsNonStreaming, m: DraftMode): Promise<SlideInput[]> => {
    let last: SlideInput[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const resp = await aiMessage(params);
      await recordUsage({
        feature: `draft:${m}`,
        model: params.model,
        inputTokens: resp.usage?.input_tokens,
        outputTokens: resp.usage?.output_tokens,
      });
      last = extractSlides(textOf(resp), m);
      if (last.some((s) => (s.blocks?.length ?? 0) > 0)) return last;
    }
    return last;
  };

  if (mode === 'free') {
    // LIBRARY-FIRST: if the brand has its OWN compositions, parse the copy into
    // units (cheap Haiku tier) and instantiate the brand's layouts deterministically
    // — on-brand by construction, and far cheaper than composing from scratch. The
    // model never touches coordinates or copy here.
    if (brandContext?.layouts?.length) {
      const units = await parseParagraph(paragraph, type);
      if (units.length) {
        const slides = instantiateFromLibrary(units, brandContext.layouts);
        if (slides.some((s) => (s.blocks?.length ?? 0) > 0)) return slides;
      }
    }

    // Fallback (no brand library, or parse failed): compose from scratch. Free
    // layout is a harder reasoning/JSON task — prefer a dedicated large model,
    // then the Sonnet-class draft model; the small vision model (Haiku) is the last
    // resort because it's unreliable at strict fractional-coordinate JSON.
    const model = pick(settings.freeModel, config.ai.modelLarge ?? config.ai.modelSmall ?? config.ai.model!);
    // The brand's signature compositions (G1): the draft starts from THIS brand's
    // structural language instead of generic layout instincts.
    const packSection = brandContext?.pack
      ? `\n\nBRAND COMPOSITIONS — this brand's signature composition skeletons. For each slide, pick the skeleton whose "purpose" fits the content (cover for openers, list for bullet content, cta for closers, …) and ADAPT its frames to the actual copy — resize/nudge as the text requires, but keep its structural character. Deviate only when no skeleton suits the content:\n${brandContext.pack}`
      : '';
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens:
        settings.freeMaxTokens && settings.freeMaxTokens > 0
          ? settings.freeMaxTokens
          : PROMPT_DEFAULTS.freeMaxTokens,
      // Static instructions cached (the retry + every draft in a session reuse
      // them); the per-brand pack rides behind the cache boundary.
      system: [
        { type: 'text', text: freeSystem(type, format, settings.freeSystem), cache_control: { type: 'ephemeral' } },
        ...(packSection ? [{ type: 'text' as const, text: packSection }] : []),
      ],
      messages: [{ role: 'user', content: userMsg }],
    };
    // Adaptive thinking + high effort sharpen spatial reasoning, but small models
    // (e.g. Haiku) reject them — only enable when a dedicated capable model is set.
    if (config.ai.modelLarge && !pick(settings.freeModel, '')) {
      params.thinking = { type: 'adaptive' };
      params.output_config = { effort: 'high' };
    }
    return run(params, 'free');
  }

  return run(
    {
      model: pick(settings.designerModel, config.ai.modelSmall!),
      max_tokens: 3000,
      system: [
        {
          type: 'text',
          text: pick(settings.designerSystem, DESIGNER_SYSTEM),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMsg }],
    },
    'designer',
  );
}
