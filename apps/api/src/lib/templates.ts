import { z } from 'zod';
import {
  BLOCK_TYPES,
  MOTIF_CATALOG,
  type BrandLayout,
  type Format,
  type LayoutLibrary,
} from '@contentbuilder/shared';
import { BrandKitModel } from '../models';
import { repairFrame } from './draft';

/**
 * Brand template packs: a set of signature FreePosition compositions designed
 * once per brand (colors/personality/logo in the prompt, no copy in the output).
 * They are what makes two brands' posts STRUCTURALLY different, not just
 * recolored. Free-mode drafts receive the pack as composition guidance, and the
 * kit page previews it with sample copy.
 */

export const TEMPLATE_COUNT = 6;

export const frameSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const templateSchema = z.object({
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

const DECOR_KINDS = new Set(['logo', 'rule', 'divider', 'scrim']);
const MOTIF_IDS = new Set(MOTIF_CATALOG.map((m) => m.id));

/**
 * In-place salvage of one raw layout/template item before zod validation:
 * chrome emitted as a block moves to decorations, over-long arrays trim,
 * frames repair, and a "background" motif id is normalized/validated (an
 * off-menu motif drops the background, never the layout).
 */
export function sanitizeSkeleton(item: unknown): void {
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

export interface TemplateBrandFacts {
  styleDescriptor?: string;
  voice?: string;
  category?: string;
  /** BUSINESS_TONES from the profile — an array (a single string is tolerated). */
  tone?: string | string[];
  hasLogo: boolean;
  headingFont?: string;
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

/**
 * Draft-time brand context: the business's approved layout library summarized
 * for the free-draft prompt, matched to the project FORMAT (story projects draw
 * from the story layouts, everything else from posts). Undefined → the draft
 * proceeds brand-agnostic (never fails a draft).
 */
export interface BrandDraftContext {
  /** Compact single-line pack summary for the (legacy) free-compose prompt. */
  pack?: string;
  /** The format-matched brand layouts, for library-first deterministic drafting. */
  layouts?: BrandLayout[];
  /** The art-direction brief, if the director produced one. */
  brief?: string;
}

export async function brandPackContext(
  businessId: string,
  format?: Format,
): Promise<BrandDraftContext | undefined> {
  try {
    const kit = await BrandKitModel.findOne({ businessId, status: 'approved' })
      .sort({ createdAt: -1 })
      .lean<{ templatePack?: BrandTemplate[]; layoutLibrary?: LayoutLibrary; artDirection?: { brief?: string } }>();
    const isStory = format === '1080x1920';
    const lib = kit?.layoutLibrary;
    // Prefer the format-matched set; fall back to posts if a story set is empty.
    const chosen = (isStory ? lib?.story : lib?.post)?.length ? (isStory ? lib?.story : lib?.post) : lib?.post;
    const brief = kit?.artDirection?.brief;
    if (Array.isArray(chosen) && chosen.length) {
      return { pack: packSummary(chosen), layouts: chosen as BrandLayout[], brief };
    }
    if (Array.isArray(kit?.templatePack) && kit.templatePack.length) {
      return { pack: packSummary(kit.templatePack), layouts: kit.templatePack as BrandLayout[], brief };
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
