import { z } from 'zod';
import {
  DESIGNER_LAYOUT_TYPES,
  isFreeLayout,
  layoutWantsImage,
  type AssetType,
  type Format,
  type LayoutType,
} from '@contentbuilder/shared';
import { aiMessage, modelFor, textOf } from './ai';
import { recordUsage } from './usage';
import { repairFrame } from './draft';
import { slideSchema, type SlideInput } from './validation';

/**
 * Per-slide layout alternatives (G6): one AI call proposes 3 different layouts
 * for the SAME copy. The model never returns text — only structure — and the
 * server merges structure onto the original blocks, so the copy stays verbatim
 * by construction.
 */

const frameSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

// Designer-variant override vocabulary. Parsed leniently: an off-menu VALUE
// ("theme":"dark") drops that field, never the whole variant — the layoutType
// is the substance of an alternative.
const OVERRIDE_VALUES = {
  theme: ['editorial', 'bold', 'minimal', 'soft'],
  split: ['image-left', 'image-right', 'image-top', 'image-bottom'],
  imageAspect: ['square', 'landscape', 'wide', 'portrait'],
  imageSize: ['sm', 'md', 'lg'],
  imageTreatment: ['none', 'tint', 'duotone'],
} as const;

function cleanDesignerOverrides(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, allowed] of Object.entries(OVERRIDE_VALUES)) {
    const val = (raw as Record<string, unknown>)[key];
    if (typeof val === 'string' && (allowed as readonly string[]).includes(val)) out[key] = val;
  }
  return out;
}

const freeVariantSchema = z.object({
  blocks: z.array(z.object({ frame: frameSchema, z: z.number().optional() })).min(1),
  imageFrame: frameSchema.optional(),
  imageBackground: z.boolean().optional(),
});

export function designerSystem(): string {
  return `You are an art director proposing layout ALTERNATIVES for one Instagram slide. The copy is fixed; only the structure changes.

Output ONLY a JSON array of exactly 3 elements (no prose, no fences). Each element:
{ "layoutType": one of ${DESIGNER_LAYOUT_TYPES.join(', ')}, "overrides"?: { "theme"?: one of editorial|bold|minimal|soft, "split"?: one of image-left|image-right|image-top|image-bottom, "imageAspect"?: one of square|landscape|wide|portrait, "imageSize"?: one of sm|md|lg, "imageTreatment"?: one of none|tint|duotone } }
Use ONLY the listed values — never invent new ones.

Rules:
- Each alternative must differ meaningfully from the CURRENT layout and from each other (different layoutType, or same type with a clearly different theme/arrangement).
- Choose layouts that suit the given blocks (a quote block suits Quote; a list suits Checklist; a slide with an image suits image layouts).`;
}

function freeSystem(pack?: string): string {
  return (
    `You are an art director proposing composition ALTERNATIVES for one free-canvas Instagram slide (1080-base canvas, positions as fractions 0..1). The copy is fixed; only the structure changes.

Output ONLY a JSON array of exactly 3 elements (no prose, no fences). Each element:
{ "blocks": [{ "frame": { "x", "y", "w", "h" }, "z": number }], "imageFrame"?: {...}, "imageBackground"?: boolean }

Rules:
- "blocks" must have EXACTLY as many entries as the current slide, in the SAME order — entry i re-positions block i.
- Each alternative must be a genuinely different composition (different anchoring/asymmetry/scale), not a nudge.
- Keep frames inside x,y ∈ [0.07, 0.93]; text frames must not overlap each other or the imageFrame.
- If the current slide has an image, each alternative must place it (imageFrame or imageBackground: true).` +
    (pack
      ? `\n\nBRAND COMPOSITIONS — this brand's signature skeletons; let them inspire the alternatives' structure:\n${pack}`
      : '')
  );
}

/** Merge a validated variant onto the original slide — copy stays untouched. */
export function mergeVariant(slide: SlideInput, variant: unknown, free: boolean): SlideInput | null {
  let merged: SlideInput;
  if (free) {
    const v = freeVariantSchema.safeParse(variant);
    if (!v.success || v.data.blocks.length !== slide.blocks.length) return null;
    merged = {
      ...slide,
      layoutType: 'FreePosition' as LayoutType,
      blocks: slide.blocks.map((b, i) => ({
        ...b,
        frame: repairFrame(v.data.blocks[i]!.frame, i),
        z: v.data.blocks[i]!.z ?? 10 + i,
      })),
      overrides: {
        ...slide.overrides,
        imageFrame: v.data.imageBackground ? undefined : v.data.imageFrame && repairFrame(v.data.imageFrame, 0),
        imageBackground: v.data.imageBackground ?? undefined,
      },
    };
  } else {
    const v = variant as { layoutType?: unknown; overrides?: unknown } | null;
    const layoutType = v?.layoutType;
    if (
      typeof layoutType !== 'string' ||
      !(DESIGNER_LAYOUT_TYPES as readonly string[]).includes(layoutType)
    ) {
      return null;
    }
    merged = {
      ...slide,
      layoutType: layoutType as LayoutType,
      imageNeed: layoutWantsImage(layoutType as LayoutType) ? 'upload' : 'none',
      overrides: { ...slide.overrides, ...cleanDesignerOverrides(v?.overrides) },
    };
  }
  const parsed = slideSchema.safeParse(merged);
  return parsed.success ? parsed.data : null;
}

/** One AI call → up to 3 alternative layouts for the slide (same copy, new bones). */
export async function generateSlideAlternatives(
  slide: SlideInput,
  type: AssetType,
  format: Format,
  brandPack?: string,
): Promise<SlideInput[]> {
  const free = isFreeLayout(slide.layoutType as LayoutType);
  const blockSummary = slide.blocks.map((b, i) => ({
    i,
    type: b.type,
    chars: (b.text || (b.items ?? []).join(' ')).length,
    text: (b.text || (b.items ?? []).join(' · ')).slice(0, 120),
    ...(free ? { frame: b.frame } : {}),
  }));
  const model = await modelFor('alternatives');
  const resp = await aiMessage({
    model,
    max_tokens: 6000,
    system: free ? freeSystem(brandPack) : designerSystem(),
    messages: [
      {
        role: 'user',
        content:
          `Asset: ${type} (${format}). Current layoutType: ${slide.layoutType}. ` +
          `Has image: ${slide.mediaAssetId ? 'yes' : slide.imageNeed === 'upload' ? 'planned' : 'no'}.\n` +
          `Blocks:\n${JSON.stringify(blockSummary)}\n\nPropose 3 alternatives.`,
      },
    ],
  });
  await recordUsage({
    feature: 'alternatives',
    model,
    inputTokens: resp.usage?.input_tokens,
    outputTokens: resp.usage?.output_tokens,
  });
  const raw = textOf(resp);
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
  return parsed
    .map((v) => mergeVariant(slide, v, free))
    .filter((s): s is SlideInput => s !== null)
    .slice(0, 3);
}
