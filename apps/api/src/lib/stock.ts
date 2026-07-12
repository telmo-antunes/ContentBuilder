import { randomUUID } from 'node:crypto';
import { FORMAT_DIMENSIONS, type Format } from '@contentbuilder/shared';
import { config } from '../config';
import { MediaAssetModel } from '../models';
import { getStorage } from '../storage';
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

/** Search Pexels; returns the top photo or null. Never throws. */
async function searchStockPhoto(
  query: string,
  orientation: 'portrait' | 'landscape' | 'square',
): Promise<PexelsPhoto | null> {
  const key = config.stock.pexelsKey;
  if (!key || !query.trim()) return null;
  try {
    const url =
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query.trim())}` +
      `&per_page=3&orientation=${orientation}`;
    const res = await fetch(url, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { photos?: PexelsPhoto[] };
    return data.photos?.[0] ?? null;
  } catch {
    return null;
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

/**
 * Give a fresh AI draft its imagery: every image slide that carries an
 * `imageQuery` (and no media yet) gets a Pexels photo placed as its
 * mediaAssetId. Mutates `slides` in place; returns how many were placed.
 * Without a key this is a no-op (placeholders remain, exactly as before).
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
    const id = await addStockPhoto(businessId, s.imageQuery, orientation);
    if (id) {
      s.mediaAssetId = id;
      placed++;
    }
  }
  return placed;
}

/**
 * Search + download + store one stock photo into the business's library.
 * Returns the created MediaAsset id, or null (best-effort).
 */
export async function addStockPhoto(
  businessId: string,
  query: string,
  orientation: 'portrait' | 'landscape' | 'square',
): Promise<string | null> {
  const photo = await searchStockPhoto(query, orientation);
  const src = photo?.src.large2x ?? photo?.src.large ?? photo?.src.original;
  if (!photo || !src) return null;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(20000) });
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
    return String(asset._id);
  } catch {
    return null;
  }
}
