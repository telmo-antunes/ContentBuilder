/**
 * API base:
 * - In the browser, default to the same-origin `/api` proxy (see next.config
 *   rewrites) so the web app's Basic auth automatically covers API calls.
 * - Server-side (render page, exporters), talk to the API directly.
 * NEXT_PUBLIC_API_URL overrides both when set.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window === 'undefined' ? process.env.API_URL || 'http://localhost:4000' : '/api');

/** Build a full API URL from a path. */
export function api(path: string): string {
  return `${API_URL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
