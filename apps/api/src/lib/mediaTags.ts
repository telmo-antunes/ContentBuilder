/**
 * WHAT IS IN THE PICTURE, in words the pool can match against a slide.
 *
 * The photo pool chose by luminance and aspect ratio: a wide, light picture
 * was "a screenshot", a dark one "suited the ground", and the slide's own
 * image query could only pick between those two piles. So a slide about the
 * headliner got the packages table and the product slide got a bench still
 * life — related, wrong. One vision call per asset, once, stores the nouns a
 * designer would use to find it; from then on attachment is by meaning, and a
 * slide whose picture the library does not hold can be told so before it is
 * composed around an empty hole.
 */
import sharp from 'sharp';
import { aiMessage, modelFor, textOf } from './ai';
import { recordUsage } from './usage';
import { aiVisionConfigured } from '../config';

export const MEDIA_KINDS = ['photo', 'screenshot', 'graphic', 'logo'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_TONES = ['dark', 'mid', 'light'] as const;
export type MediaTone = (typeof MEDIA_TONES)[number];

export interface MediaTags {
  kind: MediaKind;
  /** 3–8 lowercase nouns for what is IN the picture. */
  subjects: string[];
  tone: MediaTone;
  /** Readable text or interface chrome in the picture. */
  hasText: boolean;
  /** One plain sentence. */
  caption: string;
  taggedAt: Date;
  model: string;
}

/** What one tagging call costs, near enough to plan a library pass on. */
export const MEDIA_TAG_ESTIMATE_USD = 0.005;

const PROMPT = `You are cataloguing a business's photo library so a designer can later find the right picture for a slide by WORDS. Look at this one image and return STRICT JSON only, no prose:
{"kind":"photo|screenshot|graphic|logo","subjects":["3 to 8 short lowercase nouns for what is IN the picture — objects, surfaces, places, people, product parts, screen elements"],"tone":"dark|mid|light","hasText":true|false,"caption":"one plain sentence describing the picture"}
kind: "screenshot" for any software interface or web page; "graphic" for an illustration, chart or poster; "logo" for a mark on a plain field; else "photo". tone is the overall brightness. Name what is visible, not what it means.`;

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    return JSON.parse(raw.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Tag one image's bytes. Null when vision is not configured or the reply is unusable. */
export async function tagImage(buffer: Buffer): Promise<MediaTags | null> {
  if (!aiVisionConfigured()) return null;
  const model = await modelFor('vision');
  const small = await sharp(buffer).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const resp = await aiMessage({
    model,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });
  await recordUsage({ feature: 'vision:media-tags', model, inputTokens: resp.usage?.input_tokens, outputTokens: resp.usage?.output_tokens });
  const json = parseJson(textOf(resp));
  if (!json) return null;
  const kind = MEDIA_KINDS.includes(json.kind as MediaKind) ? (json.kind as MediaKind) : 'photo';
  const tone = MEDIA_TONES.includes(json.tone as MediaTone) ? (json.tone as MediaTone) : 'mid';
  const subjects = (Array.isArray(json.subjects) ? json.subjects : [])
    .map((s) => String(s).toLowerCase().trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 8);
  return {
    kind,
    subjects,
    tone,
    hasText: Boolean(json.hasText),
    caption: String(json.caption ?? '').trim().slice(0, 200),
    taggedAt: new Date(),
    model,
  };
}

const STOP = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or', 'by', 'from', 'into', 'onto',
  'up', 'close', 'closeup', 'shot', 'photo', 'photograph', 'picture', 'image', 'view', 'detail', 'macro',
  'car', 'cars', 'vehicle', 'auto', 'automotive',
]);

/** The words of a query or a tag list, normalised for matching. */
export function matchWords(text: string | readonly string[] | undefined): string[] {
  const raw = Array.isArray(text) ? text.join(' ') : String(text ?? '');
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((w) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * How well a tagged picture answers a slide's image query. Zero means no word
 * in common — the library holds nothing for this slide. The generic words
 * ("car", "photo") are stopped so a detailing library does not match every
 * query on the one noun every picture shares.
 */
export function matchScore(tags: Pick<MediaTags, 'subjects' | 'caption'> | undefined, query: string | undefined): number {
  if (!tags || !query) return 0;
  const q = new Set(matchWords(query));
  if (!q.size) return 0;
  const have = new Set([...matchWords(tags.subjects), ...matchWords(tags.caption)]);
  let n = 0;
  for (const w of q) if (have.has(w)) n += 1;
  return n;
}
