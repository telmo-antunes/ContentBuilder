import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { MediaAssetModel } from '../models';
import { getStorage } from '../storage';

/**
 * Stock photos via Pexels (free API), powering the editor's stock picker: the
 * media routes search for candidates and download the user's selection into
 * the business's library. Everything is best-effort: no key, no hit, or a
 * network error simply returns nothing.
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
