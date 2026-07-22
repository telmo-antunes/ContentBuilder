import {
  BLOCK_TYPES,
  MAX_SLIDES_PER_PROJECT,
  type AssetType,
  type BlockType,
} from '@contentbuilder/shared';
import { config } from '../config';
import { SettingModel } from '../models';
import { aiMessage, textOf } from './ai';
import { recordUsage } from './usage';

/**
 * Mechanical paragraph → content-units parse (Haiku tier). Splits the user's copy
 * into classified units that the brand's own layouts get instantiated from. The
 * verbatim rule is enforced by CODE, not just the prompt: any emitted text that
 * isn't a substring of the source paragraph is dropped, so the model can never
 * invent, rewrite, or embellish copy.
 */

export type UnitPurpose = 'cover' | 'content' | 'list' | 'quote' | 'image-feature' | 'cta';
const PURPOSES: UnitPurpose[] = ['cover', 'content', 'list', 'quote', 'image-feature', 'cta'];

export interface ContentUnit {
  purpose: UnitPurpose;
  blocks: Array<{ type: BlockType; text: string; items?: string[] }>;
  imageQuery?: string;
}

export const PARSE_SYSTEM = `You split a user's paragraph into an ordered set of Instagram slide "content units". You bring NO words of your own — you only SEGMENT and CLASSIFY the user's exact copy.

OUTPUT: ONLY a JSON array (no prose, no code fences), at most ${MAX_SLIDES_PER_PROJECT} units. Each unit:
{ "purpose": one of ${PURPOSES.join(', ')}, "blocks": [{ "type": one of ${BLOCK_TYPES.join(', ')}, "text": string, "items"?: string[] }], "imageQuery"?: string }

RULES:
- Every "text" (and every list item) MUST be copied VERBATIM from the paragraph — never invent, rewrite, translate, summarize, paraphrase, or fix typos. If a slot has no matching copy, leave it out.
- Choose "purpose" from the content shape: an opening hook → cover; explanatory copy → content; enumerated points → list (put them in "items", set text ""); a testimonial → quote; a closing ask → cta; a moment that wants a photo → image-feature.
- "imageQuery" (optional) is a 2-4 word stock-photo search phrase for image-feature units — it NEVER appears on the slide, so it may be your own words.
- Keep the order the ideas appear in the paragraph.`;

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Parse + VERBATIM-GUARD the model's units against the source paragraph (pure). */
export function extractUnits(raw: string, source: string): ContentUnit[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const haystack = norm(source);
  const inSource = (text: string): boolean => {
    const t = norm(text);
    return t === '' || haystack.includes(t);
  };

  const units: ContentUnit[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const purpose = PURPOSES.includes(it.purpose as UnitPurpose) ? (it.purpose as UnitPurpose) : 'content';
    const rawBlocks = Array.isArray(it.blocks) ? it.blocks : [];
    const blocks: ContentUnit['blocks'] = [];
    for (const b of rawBlocks) {
      if (!b || typeof b !== 'object') continue;
      const bb = b as Record<string, unknown>;
      if (!BLOCK_TYPES.includes(bb.type as BlockType)) continue;
      const type = bb.type as BlockType;
      if (type === 'list') {
        const items = (Array.isArray(bb.items) ? bb.items : [])
          .filter((i): i is string => typeof i === 'string' && inSource(i));
        if (items.length) blocks.push({ type, text: '', items });
      } else {
        const text = typeof bb.text === 'string' ? bb.text : '';
        if (text.trim() && inSource(text)) blocks.push({ type, text });
      }
    }
    if (!blocks.length) continue; // guard dropped everything → skip the unit
    const imageQuery = typeof it.imageQuery === 'string' ? it.imageQuery.slice(0, 60) : undefined;
    units.push({ purpose, blocks, imageQuery });
    if (units.length >= MAX_SLIDES_PER_PROJECT) break;
  }
  return units;
}

async function parseModel(): Promise<string> {
  try {
    const doc = await SettingModel.findOne({ key: 'ai' }).lean<{ draftParseModel?: string }>();
    if (doc?.draftParseModel?.trim()) return doc.draftParseModel;
  } catch {
    /* settings unavailable → env default */
  }
  return config.ai.modelSmall ?? config.ai.model!;
}

/** One cheap parse call → verbatim-guarded content units (empty on failure). */
export async function parseParagraph(paragraph: string, type: AssetType): Promise<ContentUnit[]> {
  const model = await parseModel();
  try {
    const resp = await aiMessage({
      model,
      max_tokens: 3000,
      system: [{ type: 'text', text: PARSE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Asset type: ${type}.\nSplit this paragraph VERBATIM into content units:\n\n"""${paragraph}"""` }],
    });
    await recordUsage({ feature: 'draft:parse', model, inputTokens: resp.usage?.input_tokens, outputTokens: resp.usage?.output_tokens });
    return extractUnits(textOf(resp), paragraph);
  } catch (err) {
    console.warn('[draftParse] parse failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
