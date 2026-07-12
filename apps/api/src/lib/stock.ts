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

/** Search Pexels; returns the top photo or null. Never throws. */
export async function searchStockPhoto(
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
