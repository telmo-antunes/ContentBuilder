import { aiDraftConfigured } from '../config';
import { aiMessage, premiumModel, textOf } from './ai';
import { recordUsage } from './usage';

export interface GeneratedCaption {
  text: string;
  hashtags: string[];
}

interface CaptionBlock {
  type: string;
  text?: string;
  items?: string[];
}
interface CaptionSlide {
  blocks?: CaptionBlock[];
}
interface CaptionContext {
  title?: string;
  slides?: CaptionSlide[];
  voice?: string;
  styleDescriptor?: string;
  profile?: { offer?: string; audience?: string; goal?: string; category?: string; tone?: string[] };
}

/** Pull the on-slide copy (verbatim) so the caption is grounded in the actual post. */
function slideCopy(slides: CaptionSlide[] = []): string {
  const lines: string[] = [];
  for (const s of slides) {
    for (const b of s.blocks ?? []) {
      if (b.text && b.text.trim()) lines.push(b.text.trim());
      for (const it of b.items ?? []) if (it.trim()) lines.push(`• ${it.trim()}`);
    }
  }
  return lines.join('\n').slice(0, 3000);
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    return JSON.parse(raw.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** Normalize a hashtag to a single `#word` token (letters/digits only, capped). */
export function cleanHashtag(raw: string): string | null {
  const t = raw.replace(/[^A-Za-z0-9#]/g, '');
  const bare = t.replace(/^#+/, '');
  if (!bare) return null;
  return `#${bare.slice(0, 40)}`;
}

/**
 * Write a social caption + hashtags for a post, IN THE BRAND'S VOICE. This is new
 * copy *about* the post (a caption is expected to be freshly written) — it never
 * rewrites the on-slide text, which is fed in only as grounding. Runs on the
 * premium tier when configured: voice is the whole point of a caption, and it's
 * a small once-per-post call.
 */
export async function generateCaption(ctx: CaptionContext): Promise<GeneratedCaption> {
  if (!aiDraftConfigured()) return { text: '', hashtags: [] };
  const copy = slideCopy(ctx.slides);
  if (!copy.trim()) return { text: '', hashtags: [] };

  const p = ctx.profile ?? {};
  const prompt =
    `Write an Instagram caption for this post, then suggest hashtags.\n\n` +
    (ctx.voice ? `Brand voice (match it exactly): ${ctx.voice}\n` : '') +
    (ctx.styleDescriptor ? `Brand style: ${ctx.styleDescriptor}\n` : '') +
    (p.offer ? `What the business offers: ${p.offer}\n` : '') +
    (p.audience ? `Audience: ${p.audience}\n` : '') +
    (p.goal ? `Goal of this content: ${p.goal}\n` : '') +
    (p.tone?.length ? `Tone tags: ${p.tone.join(', ')}\n` : '') +
    `\nThe post's on-slide copy (for grounding — do NOT just repeat it):\n"""${copy}"""\n\n` +
    `Guidelines: hook in the first line; 1–3 short paragraphs; a light call-to-action; ` +
    `no emoji spam (0–3 tasteful emoji at most); sound like the brand voice, not generic marketing. ` +
    `Then 5–8 relevant, specific hashtags (no generic #love/#instagood filler).\n\n` +
    `Return STRICT JSON only: {"caption": "the caption text", "hashtags": ["#tag", ...]}`;

  const model = premiumModel();
  const resp = await aiMessage({
    model,
    max_tokens: 2500, // roomy: Fable-family thinking bills against max_tokens
    messages: [{ role: 'user', content: prompt }],
  });
  await recordUsage({
    feature: 'caption',
    model,
    inputTokens: resp.usage?.input_tokens,
    outputTokens: resp.usage?.output_tokens,
  });

  const json = parseJson(textOf(resp)) ?? {};
  const text = typeof json.caption === 'string' ? json.caption.trim().slice(0, 2200) : '';
  const hashtags = Array.isArray(json.hashtags)
    ? [...new Set(json.hashtags.map((h) => cleanHashtag(String(h))).filter((h): h is string => Boolean(h)))].slice(0, 12)
    : [];
  return { text, hashtags };
}
