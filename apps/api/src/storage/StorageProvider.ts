import type { StoredMedia } from '@contentbuilder/shared';

export interface SaveOptions {
  /** MIME type, e.g. "image/png". Used to set the right content type on read. */
  contentType?: string;
}

/**
 * Abstraction over where media (logos, uploads, screenshots, rendered PNGs)
 * is stored. Records persist only the provider-agnostic `{ key, url }` — never
 * a raw filesystem path — so swapping DiskStorageProvider for a Cloudinary
 * implementation later requires no schema change.
 */
export interface StorageProvider {
  /** Store bytes under `key`, returning the provider-agnostic reference. */
  save(key: string, data: Buffer, opts?: SaveOptions): Promise<StoredMedia>;
  /** Read bytes back (used by routes that stream media). */
  read(key: string): Promise<Buffer>;
  /** Whether an object exists at `key`. */
  exists(key: string): Promise<boolean>;
  /** Remove an object (no-op if missing). */
  remove(key: string): Promise<void>;
  /** Resolve the public URL for a key without re-uploading. */
  urlFor(key: string): string;
}
