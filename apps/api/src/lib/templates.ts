import { z } from 'zod';
import { BLOCK_TYPES } from '@contentbuilder/shared';
import { BrandKitModel } from '../models';
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

  const DECOR_KINDS = new Set(['logo', 'rule', 'divider', 'scrim']);
  const valid: BrandTemplate[] = [];
  for (const item of parsed) {
    if (item && typeof item === 'object') {
      const it = item as Record<string, unknown>;
      // Salvage the model's most common slip: chrome ("logo"/"rule"/…) emitted as
      // a BLOCK instead of a decoration — move it over rather than dropping the
      // whole template.
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
        // Over-long arrays are trimmed, not fatal — a 7-block skeleton is still a design.
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
    }
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
  tone?: string;
  hasLogo: boolean;
  headingFont?: string;
}

/** One premium-tier call → the brand's composition pack (empty array on a dud response). */
export async function generateTemplatePack(facts: TemplateBrandFacts): Promise<BrandTemplate[]> {
  const lines = [
    facts.styleDescriptor && `Visual character: ${facts.styleDescriptor}`,
    facts.voice && `Brand voice: ${facts.voice}`,
    facts.category && `Business category: ${facts.category}`,
    facts.tone && `Tone: ${facts.tone}`,
    `Logo available: ${facts.hasLogo ? 'yes' : 'no'}`,
    facts.headingFont && `Heading typeface: ${facts.headingFont}`,
  ].filter(Boolean);
  const model = await modelFor('templates');
  const resp = await aiMessage({
    model,
    max_tokens: 12000,
    system: [{ type: 'text', text: TEMPLATES_SYSTEM, cache_control: { type: 'ephemeral' } }],
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

/**
 * Draft-time brand context: the business's approved kit's pack as a compact
 * summary, or undefined (draft proceeds brand-agnostic — never fails a draft).
 */
export async function brandPackContext(businessId: string): Promise<{ pack?: string } | undefined> {
  try {
    const kit = await BrandKitModel.findOne({ businessId, status: 'approved' })
      .sort({ createdAt: -1 })
      .lean<{ templatePack?: BrandTemplate[] }>();
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
