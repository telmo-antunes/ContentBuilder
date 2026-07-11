import { BUNDLED_FONT_FAMILIES } from '@contentbuilder/shared';

/**
 * Real brand fonts: instead of mapping every detected font onto the ~16 bundled
 * faces, prefer the site's ACTUAL font whenever it exists on Google Fonts (the
 * renderer loads it dynamically; export waits for document.fonts.ready, so the
 * PNG uses it too). Bundled faces remain the fallback and the offline path.
 */

/** Fonts that identify a platform default, not a brand choice — never "prefer" these. */
const GENERIC_FONTS = new Set([
  'arial',
  'helvetica',
  'helvetica neue',
  'times',
  'times new roman',
  'georgia',
  'verdana',
  'tahoma',
  'trebuchet ms',
  'segoe ui',
  'system-ui',
  '-apple-system',
  'blinkmacsystemfont',
  'sans-serif',
  'serif',
  'monospace',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
]);

/**
 * First concrete family from a CSS stack, cleaned of quotes and of Next.js's
 * internal tokens ("__Playfair_Display_eea437" → "Playfair Display").
 */
export function cleanFontFamily(raw: string | undefined): string {
  if (!raw) return '';
  const first = raw.split(',')[0] ?? '';
  return first
    .replace(/["']/g, '')
    .trim()
    .replace(/^__/, '')
    .replace(/_[0-9a-f]{6}$/i, '')
    .replace(/_/g, ' ')
    .trim();
}

export function isBundledFont(family: string): boolean {
  return BUNDLED_FONT_FAMILIES.includes(family);
}

export function isGenericFont(family: string): boolean {
  return GENERIC_FONTS.has(family.toLowerCase());
}

const availabilityCache = new Map<string, boolean>();

/**
 * Does this family exist on Google Fonts? Checked via the css2 endpoint (200
 * with CSS when it exists, 400 otherwise). Cached; network failure → false
 * (fail closed: we'd rather fall back to a bundled face than save a font that
 * can never load).
 */
export async function googleFontAvailable(
  family: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const key = family.toLowerCase();
  const cached = availabilityCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' },
    });
    const ok = res.ok;
    availabilityCache.set(key, ok);
    return ok;
  } catch {
    return false; // don't cache network failures — retry next time
  }
}

export interface ResolvedFonts {
  render: { heading: string; body: string };
  /** True when at least one role uses the site's real font (via Google Fonts). */
  usesSiteFont: boolean;
}

/**
 * Per role: prefer the site's real (cleaned) detected font when it's bundled or
 * on Google Fonts; otherwise keep the mapped fallback (personality pairing or
 * name-matched bundled face).
 */
export async function resolveRenderFonts(
  detected: { heading: string; body: string },
  mapped: { heading: string; body: string },
  isAvailable: (family: string) => Promise<boolean> = googleFontAvailable,
): Promise<ResolvedFonts> {
  const resolve = async (rawDetected: string, fallback: string): Promise<[string, boolean]> => {
    const family = cleanFontFamily(rawDetected);
    if (!family || isGenericFont(family)) return [fallback, false];
    if (isBundledFont(family)) return [family, false];
    if (await isAvailable(family)) return [family, true];
    return [fallback, false];
  };
  const [heading, hSite] = await resolve(detected.heading, mapped.heading);
  const [body, bSite] = await resolve(detected.body, mapped.body);
  return { render: { heading, body }, usesSiteFont: hSite || bSite };
}
