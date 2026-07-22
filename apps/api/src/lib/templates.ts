import { z } from 'zod';
import {
  BLOCK_TYPES,
  MOTIF_CATALOG,
  renderMotif,
  type BgColors,
  type BrandLayout,
  type LayoutLibrary,
} from '@contentbuilder/shared';
import { BrandKitModel, MediaAssetModel, SettingModel } from '../models';
import { getStorage } from '../storage';
import { aiMessage, modelFor, textOf } from './ai';
import { recordUsage } from './usage';
import { repairFrame } from './draft';

/**
 * Brand template packs: a set of signature FreePosition compositions designed
 * once per brand (colors/personality/logo in the prompt, no copy in the output).
 * They are what makes two brands' posts STRUCTURALLY different, not just
 * recolored. Free-mode drafts receive the pack as composition guidance, and the
 * kit page previews it with sample copy.
 */

export const TEMPLATE_COUNT = 6;

const frameSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

const templateSchema = z.object({
  name: z.string().min(1).max(60),
  purpose: z.enum(['cover', 'content', 'list', 'quote', 'image-feature', 'cta']),
  imageNeed: z.enum(['none', 'upload']).default('none'),
  blocks: z
    .array(
      z.object({
        type: z.enum(BLOCK_TYPES as unknown as [string, ...string[]]),
        frame: frameSchema,
        z: z.number().optional(),
      }),
    )
    .min(1)
    .max(6),
  decorations: z
    .array(
      z.object({
        kind: z.enum(['logo', 'rule', 'divider', 'scrim']),
        frame: frameSchema,
        z: z.number().optional(),
        direction: z.enum(['to-top', 'to-bottom', 'to-left', 'to-right']).optional(),
        opacity: z.number().min(0).max(1).optional(),
      }),
    )
    .max(8)
    .optional(),
  imageFrame: frameSchema.optional(),
  imageBackground: z.boolean().optional(),
});

export type BrandTemplate = z.infer<typeof templateSchema>;

/** Package-path schema: a layout may carry its matched background motif. */
const layoutSchema = templateSchema.extend({ backgroundMotif: z.string().optional() });

export const TEMPLATES_SYSTEM = `You are an art director designing a brand's SIGNATURE Instagram compositions — the structural identity that makes this brand's posts recognizable before you read a word.

CANVAS: 1080×1350 portrait. All positions are FRACTIONS of the canvas (0..1); a "frame" is { "x": left, "y": top, "w": width, "h": height }. Keep every frame inside x in [0.08, 0.92], y in [0.07, 0.93].

OUTPUT: ONLY a JSON array of ${TEMPLATE_COUNT} composition skeletons (no prose, no markdown fences). Each element:
{ "name": string (2-4 words), "purpose": one of "cover" | "content" | "list" | "quote" | "image-feature" | "cta", "imageNeed": "none" | "upload", "blocks": [{ "type": one of ${BLOCK_TYPES.join(', ')}, "frame": {...}, "z": number }], "decorations"?: [{ "kind": "logo" | "rule" | "divider" | "scrim", "frame": {...}, "z": number, "direction"?: "to-top" | "to-bottom" | "to-left" | "to-right", "opacity"?: number }], "imageFrame"?: {...}, "imageBackground"?: boolean }

RULES:
- NO copy anywhere — these are skeletons; text is poured in later.
- Exactly one of each purpose: cover, content, list, quote, image-feature, cta.
- Design for THIS brand's character (given below): a luxury serif brand might use generous whitespace, asymmetric columns and hairline dividers; a bold industrial brand might use edge-to-edge stacked type and thick rules. Commit to a recognizable structural language and keep it coherent across all ${TEMPLATE_COUNT}.
- Vary anchoring across the set (top-weighted, bottom-weighted, side-hugging) — but make it feel like ONE designer's system, not six random layouts.
- "list" must include a "list" block with a tall frame (h ≥ 0.35). "quote" uses a "quote" block. "cta" includes a "cta" block near the bottom.
- Include the brand's logo as a decoration where it belongs in this system (skip if the brand has no logo). Use "rule"/"divider" decorations as the system's connective tissue. Use a "scrim" ONLY on image-heavy templates ("image-feature" with imageBackground, or cover if it uses a background photo).
- "image-feature": either a generous "imageFrame" (0.45–0.7 of the canvas) with text in the remaining space, or "imageBackground": true with a scrim and overlaid text. Text frames must not overlap the imageFrame or each other.
- Blocks: an eyebrow is short (h ~0.04–0.06); a title is the hero (h up to 0.3); paragraphs sit in tighter columns; frames never overlap.`;

const DECOR_KINDS = new Set(['logo', 'rule', 'divider', 'scrim']);
const MOTIF_IDS = new Set(MOTIF_CATALOG.map((m) => m.id));

/**
 * In-place salvage of one raw layout/template item before zod validation:
 * chrome emitted as a block moves to decorations, over-long arrays trim,
 * frames repair, and a "background" motif id is normalized/validated (an
 * off-menu motif drops the background, never the layout).
 */
function sanitizeSkeleton(item: unknown): void {
  if (!item || typeof item !== 'object') return;
  const it = item as Record<string, unknown>;
  if (Array.isArray(it.blocks)) {
    let blocks = it.blocks as Array<{ type?: string; frame?: unknown; z?: number } | null>;
    const isChrome = (b: (typeof blocks)[number]) =>
      Boolean(b && typeof b === 'object' && DECOR_KINDS.has(b.type ?? ''));
    const misplaced = blocks.filter(isChrome) as Array<{ type: string; frame?: unknown; z?: number }>;
    if (misplaced.length) {
      it.decorations = [
        ...(Array.isArray(it.decorations) ? it.decorations : []),
        ...misplaced.map((b) => ({ kind: b.type, frame: b.frame, z: b.z })),
      ].slice(0, 8);
      blocks = blocks.filter((b) => !isChrome(b));
    }
    it.blocks = blocks.slice(0, 6);
  }
  if (Array.isArray(it.blocks)) {
    it.blocks.forEach((b, i) => {
      if (b && typeof b === 'object') (b as { frame?: unknown }).frame = repairFrame((b as { frame?: unknown }).frame, i);
    });
  }
  if (Array.isArray(it.decorations)) {
    it.decorations.forEach((d, i) => {
      if (d && typeof d === 'object') (d as { frame?: unknown }).frame = repairFrame((d as { frame?: unknown }).frame, i);
    });
  }
  if (it.imageFrame) it.imageFrame = repairFrame(it.imageFrame, 0);
  // "background": "<motif id>" | null → backgroundMotif (validated against the catalog).
  const bg = it.background ?? it.backgroundMotif;
  delete it.background;
  it.backgroundMotif = typeof bg === 'string' && MOTIF_IDS.has(bg) ? bg : undefined;
}

/** Parse + validate the model's pack; frames are repaired, invalid entries dropped. */
export function extractTemplates(raw: string): BrandTemplate[] {
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

  const valid: BrandTemplate[] = [];
  for (const item of parsed) {
    sanitizeSkeleton(item);
    const result = templateSchema.safeParse(item);
    if (result.success) valid.push(result.data);
    if (valid.length >= TEMPLATE_COUNT) break;
  }
  return valid;
}

export interface TemplateBrandFacts {
  styleDescriptor?: string;
  voice?: string;
  category?: string;
  /** BUSINESS_TONES from the profile — an array (a single string is tolerated). */
  tone?: string | string[];
  hasLogo: boolean;
  headingFont?: string;
}

/** Normalize the profile tone (string | string[]) → a flat string[] for renderMotif. */
function toneList(tone: string | string[] | undefined): string[] | undefined {
  if (Array.isArray(tone)) return tone.length ? tone : undefined;
  return tone ? [tone] : undefined;
}
/** Human-readable tone for a prompt line. */
function toneText(tone: string | string[] | undefined): string {
  return Array.isArray(tone) ? tone.join(', ') : (tone ?? '');
}

/** One premium-tier call → the brand's composition pack (empty array on a dud response). */
export async function generateTemplatePack(facts: TemplateBrandFacts): Promise<BrandTemplate[]> {
  const lines = [
    facts.styleDescriptor && `Visual character: ${facts.styleDescriptor}`,
    facts.voice && `Brand voice: ${facts.voice}`,
    facts.category && `Business category: ${facts.category}`,
    facts.tone && `Tone: ${toneText(facts.tone)}`,
    `Logo available: ${facts.hasLogo ? 'yes' : 'no'}`,
    facts.headingFont && `Heading typeface: ${facts.headingFont}`,
  ].filter(Boolean);
  const model = await modelFor('templates');
  // Prompt override from the AI Settings page (blank → the code default).
  let system = TEMPLATES_SYSTEM;
  try {
    const doc = await SettingModel.findOne({ key: 'ai' }).lean<{ templatesSystem?: string }>();
    if (doc?.templatesSystem?.trim()) system = doc.templatesSystem;
  } catch {
    /* settings unavailable → default prompt */
  }
  const resp = await aiMessage({
    model,
    max_tokens: 12000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Design this brand's signature composition pack.\n\n${lines.join('\n')}`,
      },
    ],
  });
  await recordUsage({
    feature: 'templates',
    model,
    inputTokens: resp.usage?.input_tokens,
    outputTokens: resp.usage?.output_tokens,
  });
  return extractTemplates(textOf(resp));
}

export const STORY_PURPOSES = ['cover', 'content', 'quote', 'cta'] as const;

export const PACKAGE_SYSTEM = `You are the design director creating a brand's COMPLETE Instagram design system in one pass: post layouts, story layouts, and the background each layout sits on — one coherent visual language, not separate features.

CANVASES — all positions are FRACTIONS (0..1); a "frame" is { "x", "y", "w", "h" }:
- POST: 1080×1350 portrait. Keep frames inside x ∈ [0.08, 0.92], y ∈ [0.07, 0.93].
- STORY: 1080×1920 portrait. Instagram covers the top and bottom — keep ALL frames inside y ∈ [0.14, 0.86] (x as above). Compositions are taller and airier; fewer, larger elements.

BACKGROUNDS — each layout may name ONE motif from this vetted menu (rendered in the brand's palette by code):
${MOTIF_CATALOG.map((m) => `- "${m.id}": ${m.desc}`).join('\n')}
Pick motifs that express the SAME design language as your compositions — e.g. hairline editorial layouts pair with quiet motifs (mesh, waves, halftone), bold blocky layouts with geoblocks/speedlines. Text-heavy purposes (content, list) need CALM backgrounds; covers/ctas can be bolder. A layout with "imageBackground": true uses a PHOTO, so give it "background": null. Use 2–3 distinct motifs across the whole package (variety within one family), not a different motif per layout.

OUTPUT: ONLY a JSON object (no prose, no fences):
{ "direction": string (ONE sentence describing the system's design language), "post": [${TEMPLATE_COUNT} layouts], "story": [${STORY_PURPOSES.length} layouts] }
Each layout:
{ "name": string (2-4 words), "purpose": string, "imageNeed": "none" | "upload", "background": "<motif id>" | null, "blocks": [{ "type": one of ${BLOCK_TYPES.join(', ')}, "frame": {...}, "z": number }], "decorations"?: [{ "kind": "logo" | "rule" | "divider" | "scrim", "frame": {...}, "z": number, "direction"?, "opacity"? }], "imageFrame"?: {...}, "imageBackground"?: boolean }

RULES:
- NO copy anywhere — skeletons only; text is poured in later.
- POST purposes, exactly one each: cover, content, list, quote, image-feature, cta.
- STORY purposes, exactly one each: ${STORY_PURPOSES.join(', ')}.
- Design for THIS brand's character, voice and vertical (given below). A luxury serif brand: generous whitespace, asymmetric columns, hairline dividers. A bold industrial brand: edge-to-edge stacked type, thick rules. Commit to ONE recognizable structural language across posts AND stories.
- Vary anchoring across each set (top-weighted, bottom-weighted, side-hugging) while staying one system.
- "list" needs a "list" block with a tall frame (h ≥ 0.35 post). "quote" uses a "quote" block. "cta" puts a "cta" block near the bottom of the safe area.
- Include the logo as a decoration where the system wants it (skip if none). Rules/dividers are the connective tissue. "scrim" ONLY over photos (imageBackground layouts).
- "image-feature" (post): generous "imageFrame" (0.45–0.7) with text in the remaining space, OR "imageBackground": true + scrim. Frames never overlap.
- Blocks: eyebrow short (h ~0.04–0.06 post, ~0.03–0.045 story); title is the hero; paragraphs in tighter columns.`;

/** Parse + validate the package response: { direction, post[], story[] }. */
export function extractPackage(raw: string): { direction?: string; post: BrandTemplate[]; story: BrandTemplate[] } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('model did not return a JSON object');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error('model returned invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('model did not return a JSON object');
  }
  const obj = parsed as { direction?: unknown; post?: unknown; story?: unknown };
  const takeSet = (arr: unknown, max: number): BrandTemplate[] => {
    if (!Array.isArray(arr)) return [];
    const valid: BrandTemplate[] = [];
    for (const item of arr) {
      sanitizeSkeleton(item);
      const result = layoutSchema.safeParse(item);
      if (result.success) valid.push(result.data);
      if (valid.length >= max) break;
    }
    return valid;
  };
  const post = takeSet(obj.post, TEMPLATE_COUNT);
  const story = takeSet(obj.story, STORY_PURPOSES.length);
  if (post.length === 0) throw new Error('package had no usable post layouts');
  return {
    direction: typeof obj.direction === 'string' ? obj.direction.slice(0, 240) : undefined,
    post,
    story,
  };
}

export interface PackageInputs extends TemplateBrandFacts {
  businessId: string;
  colors: BgColors;
}

/**
 * ONE design-director pass → the brand's complete layout system: post + story
 * skeletons AND their matched backgrounds. The AI decides the language and
 * names a motif per layout; CODE renders each motif in the brand palette and
 * stores it as a media asset (deterministic key → stable URLs on regenerate),
 * attaching backgroundMediaAssetId so applying a layout brings its background.
 */
export async function generateBrandPackage(inp: PackageInputs): Promise<LayoutLibrary> {
  const lines = [
    inp.styleDescriptor && `Visual character: ${inp.styleDescriptor}`,
    inp.voice && `Brand voice: ${inp.voice}`,
    inp.category && `Business category: ${inp.category}`,
    inp.tone && `Tone: ${toneText(inp.tone)}`,
    `Logo available: ${inp.hasLogo ? 'yes' : 'no'}`,
    inp.headingFont && `Heading typeface: ${inp.headingFont}`,
  ].filter(Boolean);
  const model = await modelFor('templates');
  // Prompt override from the AI Settings page (blank → the code default).
  let system = PACKAGE_SYSTEM;
  try {
    const doc = await SettingModel.findOne({ key: 'ai' }).lean<{ templatesSystem?: string }>();
    if (doc?.templatesSystem?.trim()) system = doc.templatesSystem;
  } catch {
    /* settings unavailable → default prompt */
  }
  const resp = await aiMessage({
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [
      { role: 'user', content: `Design this brand's complete layout + background package.\n\n${lines.join('\n')}` },
    ],
  });
  await recordUsage({
    feature: 'templates',
    model,
    inputTokens: resp.usage?.input_tokens,
    outputTokens: resp.usage?.output_tokens,
  });
  const pkg = extractPackage(textOf(resp));

  // Render + store each layout's background (skip photo-backed layouts).
  const storage = getStorage();
  const tone = toneList(inp.tone);
  const attach = async (layouts: BrandTemplate[], fmt: 'post' | 'story'): Promise<BrandLayout[]> => {
    const out: BrandLayout[] = [];
    for (let i = 0; i < layouts.length; i++) {
      const t = layouts[i]! as BrandTemplate & { backgroundMotif?: string };
      // zod already validated block types/purposes against the real enums — the
      // inferred `string` just can't see through the BLOCK_TYPES cast.
      const layout = { ...t } as BrandLayout;
      if (t.backgroundMotif && !t.imageBackground) {
        try {
          const bg = renderMotif(t.backgroundMotif, inp.colors, {
            tone,
            seed: `${inp.businessId}:${fmt}:${t.purpose}:${i}`,
          });
          if (bg) {
            const key = `backgrounds/${inp.businessId}/pkg-${fmt}-${t.purpose}-${i}.svg`;
            const stored = await storage.save(key, Buffer.from(bg.svg, 'utf8'), { contentType: 'image/svg+xml' });
            const asset = await MediaAssetModel.findOneAndUpdate(
              { businessId: inp.businessId, key: stored.key },
              {
                businessId: inp.businessId,
                type: 'generated',
                label: `Brand background — ${bg.label}`,
                key: stored.key,
                url: stored.url,
                width: 1080,
                height: 1350,
              },
              { upsert: true, new: true, setDefaultsOnInsert: true },
            );
            layout.backgroundMediaAssetId = String(asset._id);
          }
        } catch (err) {
          console.error('[package] background render failed (layout kept):', err);
        }
      }
      out.push(layout);
    }
    return out;
  };

  return {
    direction: pkg.direction,
    post: await attach(pkg.post, 'post'),
    story: await attach(pkg.story, 'story'),
  };
}

/**
 * Draft-time brand context: the business's approved kit's pack as a compact
 * summary, or undefined (draft proceeds brand-agnostic — never fails a draft).
 */
export async function brandPackContext(businessId: string): Promise<{ pack?: string } | undefined> {
  try {
    const kit = await BrandKitModel.findOne({ businessId, status: 'approved' })
      .sort({ createdAt: -1 })
      .lean<{ templatePack?: BrandTemplate[]; layoutLibrary?: LayoutLibrary }>();
    const lib = kit?.layoutLibrary?.post;
    if (Array.isArray(lib) && lib.length) {
      return { pack: packSummary(lib) };
    }
    if (Array.isArray(kit?.templatePack) && kit.templatePack.length) {
      return { pack: packSummary(kit.templatePack) };
    }
  } catch {
    /* no kit / db hiccup → brand-agnostic draft */
  }
  return undefined;
}

/**
 * Compact single-line JSON of the pack for the free-draft prompt (frames to 2dp,
 * no decorations — the draft only needs the structural bones).
 */
export function packSummary(pack: BrandTemplate[]): string {
  const r2 = (f: { x: number; y: number; w: number; h: number }) => ({
    x: +f.x.toFixed(2),
    y: +f.y.toFixed(2),
    w: +f.w.toFixed(2),
    h: +f.h.toFixed(2),
  });
  return JSON.stringify(
    pack.map((t) => ({
      name: t.name,
      purpose: t.purpose,
      imageNeed: t.imageNeed,
      blocks: t.blocks.map((b) => ({ type: b.type, frame: r2(b.frame) })),
      ...(t.imageFrame ? { imageFrame: r2(t.imageFrame) } : {}),
      ...(t.imageBackground ? { imageBackground: true } : {}),
    })),
  );
}
