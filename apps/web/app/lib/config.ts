export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/** Build a full API URL from a path. */
export function api(path: string): string {
  return `${API_URL.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
