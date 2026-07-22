import { randomUUID } from 'node:crypto';
import type { AssetType, BrandKit, Format, MediaAsset, ProjectSettings, Slide } from '@contentbuilder/shared';

/**
 * A short-lived, in-process stash of render-ready payloads. It lets the design
 * pipeline render an AD-HOC candidate composition (one that isn't a saved
 * Project) through the SAME hidden `/render` route the exporter uses: the API
 * `putStash()`es a payload, points Puppeteer at `/render?stashId=…`, and the web
 * render page fetches it back from `GET /render-stash/:id`. Both writer and
 * reader live in this (API) process, so there is no cross-process/bundle state
 * to coordinate — the web side only ever reads it over HTTP.
 *
 * The payload is shaped like the subset of the project-GET response that the
 * render page consumes (brandKit + media + one slide + format), so the render
 * page runs its EXISTING transform unchanged.
 */
export interface StashRenderPayload {
  format: Format;
  type: AssetType;
  slides: Slide[];
  brandKit: Partial<BrandKit> | null;
  media: MediaAsset[];
  settings?: ProjectSettings;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX = 200;

export interface Stash {
  put(payload: StashRenderPayload): string;
  get(id: string): StashRenderPayload | null;
  size(): number;
  clear(): void;
}

/** Factory so tests can inject a fake clock + tiny bounds; prod uses the singleton below. */
export function createStash(opts?: { ttlMs?: number; max?: number; now?: () => number }): Stash {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const max = opts?.max ?? DEFAULT_MAX;
  const now = opts?.now ?? Date.now;
  const store = new Map<string, { payload: StashRenderPayload; expires: number }>();

  const expire = (t: number) => {
    for (const [id, e] of store) if (e.expires <= t) store.delete(id);
  };

  return {
    put(payload) {
      const t = now();
      expire(t);
      const id = randomUUID();
      store.set(id, { payload, expires: t + ttlMs });
      // Map preserves insertion order → evict oldest beyond the cap (after insert).
      while (store.size > max) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
      return id;
    },
    get(id) {
      const e = store.get(id);
      if (!e) return null;
      if (e.expires <= now()) {
        store.delete(id);
        return null;
      }
      return e.payload;
    },
    size: () => store.size,
    clear: () => store.clear(),
  };
}

const singleton = createStash();

export const putStash = (payload: StashRenderPayload): string => singleton.put(payload);
export const getStash = (id: string): StashRenderPayload | null => singleton.get(id);
