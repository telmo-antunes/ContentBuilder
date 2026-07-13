import { randomUUID } from 'node:crypto';
import { FORMAT_DIMENSIONS, type Format } from '@contentbuilder/shared';
import { config } from '../config';
import { MediaAssetModel } from '../models';
import { getStorage } from '../storage';
import { aiMessage, modelFor, textOf } from './ai';
import { recordUsage } from './usage';
import type { SlideInput } from './validation';

/**
 * Stock photos via Pexels (free API). The AI draft emits a short `imageQuery`
 * per image slide; this searches Pexels, downloads the best hit and stores it
 * in the business's media library so the draft arrives with real imagery
 * instead of "Add image" placeholders. Everything is best-effort: no key, no
 * hit, or a network error simply leaves the placeholder (exactly today's
 * behaviour).
 */

export const STOCK_PHOTO_LABEL = 'Stock photo';
const MAX_BYTES = 12 * 1024 * 1024;

export function stockConfigured(): boolean {
  return Boolean(config.stock.pexelsKey);
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  alt?: string;
  src: { large2x?: string; large?: string; original?: string };
}

/** Candidate shape the editor's picker consumes. */
export interface StockCandidate {
  /** Preview thumb (Pexels 'medium'). */
  thumb: string;
  /** Full-resolution source to download on selection. */
  full: string;
  width: number;
  height: number;
  alt: string;
  photographer: string;
}

/** Search Pexels for up to `count` candidates. Never throws (empty on failure). */
export async function searchStockPhotos(
  query: string,
  orientation: 'portrait' | 'landscape' | 'square',
  count = 8,
): Promise<StockCandidate[]> {
  const key = config.stock.pexelsKey;
  if (!key || !query.trim()) return [];
  try {
    const url =
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query.trim())}` +
      `&per_page=${count}&orientation=${orientation}`;
    const res = await fetch(url, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      photos?: Array<PexelsPhoto & { src: { medium?: string }; photographer?: string }>;
    };
    return (data.photos ?? [])
      .map((p) => ({
        thumb: p.src.medium ?? p.src.large ?? '',
        full: p.src.large2x ?? p.src.large ?? p.src.original ?? '',
        width: p.width,
        height: p.height,
        alt: p.alt ?? '',
        photographer: p.photographer ?? '',
      }))
      .filter((c) => c.thumb && c.full);
  } catch {
    return [];
  }
}

/**
 * Parse the photo-fit judge's response into a 0-based candidate index.
 * Lenient (finds a "pick" number or the first bare integer); null when the
 * response is unusable — the caller falls back to candidate 0.
 */
export function parsePickIndex(raw: string, count: number): number | null {
  const pick = raw.match(/"pick"\s*:\s*(\d+)/)?.[1] ?? raw.match(/\b(\d+)\b/)?.[1];
  if (!pick) return null;
  const idx = Number(pick) - 1; // the judge speaks 1-based
  return idx >= 0 && idx < count ? idx : null;
}

/**
 * The photo-fit judge (G-curation): ONE vision call looks at the candidate
 * thumbnails next to the slide's copy and picks the best match — subject,
 * quality, and composition fit for how the image will be used. Falls back to
 * candidate 0 on any failure (exactly the old first-hit behaviour).
 */
export async function pickBestCandidate(
  candidates: StockCandidate[],
  context: { copy: string; usage: string; query: string },
): Promise<number> {
  if (candidates.length < 2 || !config.ai.apiKey) return 0;
  try {
    const model = await modelFor('photofit');
    const resp = await aiMessage({
      model,
      max_tokens: 300,
      system:
        'You are an art director choosing ONE stock photo for a social-media slide. Judge each numbered candidate on: subject match to the copy, professional photo quality, and composition fit for the stated usage (a full-bleed background needs calm negative space where text stays legible; a framed feature image should be a clear, well-composed subject). Output ONLY JSON: { "pick": <candidate number> }.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text' as const,
              text: `Slide copy: """${context.copy.slice(0, 400)}"""\nUsage: ${context.usage}\nSearch query: "${context.query}"\n\nCandidates:`,
            },
            ...candidates.flatMap((c, i) => [
              { type: 'text' as const, text: `Candidate ${i + 1}${c.alt ? ` — ${c.alt.slice(0, 80)}` : ''}:` },
              { type: 'image' as const, source: { type: 'url' as const, url: c.thumb } },
            ]),
          ],
        },
      ],
    });
    await recordUsage({
      feature: 'photofit',
      model,
      inputTokens: resp.usage?.input_tokens,
      outputTokens: resp.usage?.output_tokens,
    });
    return parsePickIndex(textOf(resp), candidates.length) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Download a picked candidate into the business library. Returns the created
 * MediaAsset (lean), or null (best-effort).
 */
export async function storeStockPhoto(
  businessId: string,
  photo: { full: string; width: number; height: number },
): Promise<Record<string, unknown> | null> {
  try {
    if (!/^https:\/\/images\.pexels\.com\//.test(photo.full)) return null; // pinned to Pexels CDN
    const res = await fetch(photo.full, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    const stored = await getStorage().save(`stock/${businessId}/${randomUUID()}.jpg`, buf, {
      contentType: 'image/jpeg',
    });
    const asset = await MediaAssetModel.create({
      businessId,
      type: 'upload',
      label: STOCK_PHOTO_LABEL,
      key: stored.key,
      url: stored.url,
      width: photo.width,
      height: photo.height,
    });
    return asset.toJSON() as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** How the slide will use its image — the judge weighs composition differently. */
function usageFor(slide: SlideInput): string {
  const bg = slide.layoutType === 'BackgroundImage' || slide.overrides?.imageBackground;
  return bg
    ? 'full-bleed background behind text (needs calm negative space for legibility)'
    : 'framed feature image beside/above the copy (needs a clear, well-composed subject)';
}

/** The slide's visible copy, for the photo-fit judge. */
function copyOf(slide: SlideInput): string {
  return (slide.blocks ?? [])
    .map((b) => b.text || (b.items ?? []).join(' · '))
    .filter(Boolean)
    .join(' — ');
}

/**
 * Give a fresh AI draft its imagery: every image slide that carries an
 * `imageQuery` (and no media yet) gets a Pexels photo placed as its
 * mediaAssetId — chosen by the photo-fit judge from the top candidates, not
 * blindly the first hit. Mutates `slides` in place; returns how many were
 * placed. Without a key this is a no-op (placeholders remain).
 */
export async function resolveDraftImages(
  businessId: string,
  slides: SlideInput[],
  format: Format,
): Promise<number> {
  if (!stockConfigured()) return 0;
  const { width, height } = FORMAT_DIMENSIONS[format];
  const orientation = height > width ? 'portrait' : width > height ? 'landscape' : 'square';
  let placed = 0;
  for (const s of slides) {
    if (s.imageNeed !== 'upload' || s.mediaAssetId || !s.imageQuery) continue;
    const candidates = await searchStockPhotos(s.imageQuery, orientation, 4);
    if (candidates.length === 0) continue;
    const idx = await pickBestCandidate(candidates, {
      copy: copyOf(s),
      usage: usageFor(s),
      query: s.imageQuery,
    });
    const asset = await storeStockPhoto(businessId, candidates[idx] ?? candidates[0]!);
    if (asset?._id) {
      s.mediaAssetId = String(asset._id);
      placed++;
    }
  }
  return placed;
}
