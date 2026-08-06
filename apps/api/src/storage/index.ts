import { config } from '../config';
import { DiskStorageProvider } from './DiskStorageProvider';
import type { StorageProvider } from './StorageProvider';

export type { StorageProvider, SaveOptions } from './StorageProvider';
export { DiskStorageProvider } from './DiskStorageProvider';

/** Public URL prefix under which the API serves stored media. */
export const MEDIA_ROUTE = '/media';

/**
 * Media URLs are stored ROOT-RELATIVE (`/media/<key>`), never absolute.
 *
 * They are persisted into MongoDB at save time and read back months later, so
 * baking `http://localhost:<API_PORT>` into them made every stored record
 * depend on the API keeping the same port forever. Moving the API to another
 * port silently broke images on existing records — and the PNG exporter treats
 * a failed image as `null`, so the failure mode was a blank slide rather than
 * an error.
 *
 * Root-relative URLs resolve against whichever origin is displaying them: the
 * browser and Puppeteer both load them from the web origin, which proxies
 * `/media/*` to the API (see apps/web/next.config.mjs).
 */
export const mediaPublicBase = MEDIA_ROUTE;

/** Absolute form, for the rare caller that needs to reach the API directly. */
export const absoluteMediaBase = `${config.apiUrl.replace(/\/+$/, '')}${MEDIA_ROUTE}`;

/**
 * Normalise a stored media URL to its root-relative form.
 *
 * Accepts the legacy absolute shape (`http://localhost:4000/media/x.png`) and
 * returns `/media/x.png`. Anything that is not a media URL — remote stock
 * photos, data URIs, already-relative paths — is returned untouched, so this is
 * safe to apply blanket-fashion on read.
 */
export function normalizeMediaUrl<T extends string | undefined | null>(url: T): T {
  if (typeof url !== 'string' || url.length === 0) return url;
  const idx = url.indexOf(`${MEDIA_ROUTE}/`);
  if (idx <= 0) return url;
  const prefix = url.slice(0, idx);
  // Only rewrite when the part before /media/ is a bare origin, e.g.
  // "http://localhost:4000" or "https://cdn.example.com". Leaves paths that
  // merely contain "/media/" further down (e.g. "/uploads/media/x") alone.
  if (!/^https?:\/\/[^/]+$/i.test(prefix)) return url;
  return url.slice(idx) as T;
}

let provider: StorageProvider | null = null;

/** Singleton storage provider, selected by STORAGE_PROVIDER (disk for now). */
export function getStorage(): StorageProvider {
  if (provider) return provider;
  switch (config.storage.provider) {
    case 'disk':
    default:
      provider = new DiskStorageProvider(config.storage.dir, mediaPublicBase);
      break;
    // case 'cloudinary': provider = new CloudinaryStorageProvider(...); break;
  }
  return provider;
}
