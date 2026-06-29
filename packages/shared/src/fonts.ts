/**
 * Curated set of license-clear (SIL OFL / Apache) fonts bundled into the repo.
 *
 * Exported images use ONLY these fonts. A brand's detected font is mapped to
 * the nearest bundled family via `mapToBundledFont`. The `slug` matches the
 * woff2 filenames produced by `scripts/copy-fonts.mjs` (served from
 * /apps/web/public/fonts/<slug>-<weight>.woff2).
 */
export type FontCategory = 'sans' | 'serif' | 'display' | 'mono';
export type FontRole = 'heading' | 'body';

export interface BundledFont {
  /** CSS font-family name (also the display label). */
  family: string;
  /** Filename slug + @fontsource package id. */
  slug: string;
  category: FontCategory;
  /** Which roles this face is suitable for. */
  roles: FontRole[];
  /** Available weights bundled (normal style). */
  weights: number[];
}

export const BUNDLED_FONTS: BundledFont[] = [
  { family: 'Inter', slug: 'inter', category: 'sans', roles: ['heading', 'body'], weights: [400, 500, 600, 700] },
  { family: 'Montserrat', slug: 'montserrat', category: 'sans', roles: ['heading'], weights: [400, 600, 700] },
  { family: 'Poppins', slug: 'poppins', category: 'sans', roles: ['heading', 'body'], weights: [400, 500, 600, 700] },
  { family: 'Roboto', slug: 'roboto', category: 'sans', roles: ['heading', 'body'], weights: [400, 500, 700] },
  { family: 'Open Sans', slug: 'open-sans', category: 'sans', roles: ['body'], weights: [400, 600, 700] },
  { family: 'Lato', slug: 'lato', category: 'sans', roles: ['heading', 'body'], weights: [400, 700] },
  { family: 'Work Sans', slug: 'work-sans', category: 'sans', roles: ['heading', 'body'], weights: [400, 600, 700] },
  { family: 'Raleway', slug: 'raleway', category: 'sans', roles: ['heading'], weights: [400, 600, 700] },
  { family: 'Nunito', slug: 'nunito', category: 'sans', roles: ['heading', 'body'], weights: [400, 600, 700] },
  { family: 'Archivo', slug: 'archivo', category: 'sans', roles: ['heading'], weights: [400, 600, 700] },
  { family: 'Oswald', slug: 'oswald', category: 'display', roles: ['heading'], weights: [400, 600, 700] },
  { family: 'Bebas Neue', slug: 'bebas-neue', category: 'display', roles: ['heading'], weights: [400] },
  { family: 'Playfair Display', slug: 'playfair-display', category: 'serif', roles: ['heading'], weights: [400, 600, 700] },
  { family: 'Merriweather', slug: 'merriweather', category: 'serif', roles: ['body', 'heading'], weights: [400, 700] },
  { family: 'Lora', slug: 'lora', category: 'serif', roles: ['heading', 'body'], weights: [400, 600, 700] },
  { family: 'Source Serif 4', slug: 'source-serif-4', category: 'serif', roles: ['body'], weights: [400, 600, 700] },
];

export const BUNDLED_FONT_FAMILIES: string[] = BUNDLED_FONTS.map((f) => f.family);

export function getBundledFont(family: string): BundledFont | undefined {
  return BUNDLED_FONTS.find((f) => f.family.toLowerCase() === family.toLowerCase());
}

/** Sensible default render fonts when nothing is detected. */
export const DEFAULT_RENDER_HEADING = 'Montserrat';
export const DEFAULT_RENDER_BODY = 'Inter';

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map a detected `font-family` string (which may be a stack, e.g.
 * `"Helvetica Neue", Arial, sans-serif`) to the nearest bundled font.
 * Render fonts only ever come from this set.
 */
export function mapToBundledFont(detected: string | undefined, role: FontRole): string {
  const fallback = role === 'heading' ? DEFAULT_RENDER_HEADING : DEFAULT_RENDER_BODY;
  if (!detected) return fallback;

  // Split a font stack into individual candidate families.
  const candidates = detected.split(',').map(normalize).filter(Boolean);

  // 1) Exact / contains match against a bundled family name.
  for (const cand of candidates) {
    const exact = BUNDLED_FONTS.find((f) => normalize(f.family) === cand);
    if (exact && exact.roles.includes(role)) return exact.family;
    const partial = BUNDLED_FONTS.find(
      (f) => cand.includes(normalize(f.family)) || normalize(f.family).includes(cand),
    );
    if (partial && partial.roles.includes(role)) return partial.family;
  }

  // 2) Heuristic mapping of well-known web fonts to a close bundled alternative.
  const ALIASES: Record<string, string> = {
    helvetica: 'Inter',
    'helvetica neue': 'Inter',
    arial: 'Inter',
    'sans-serif': role === 'heading' ? 'Montserrat' : 'Inter',
    georgia: 'Lora',
    times: 'Merriweather',
    'times new roman': 'Merriweather',
    serif: role === 'heading' ? 'Playfair Display' : 'Source Serif 4',
    futura: 'Poppins',
    'avenir': 'Nunito',
    'gotham': 'Montserrat',
    'proxima nova': 'Montserrat',
    'roboto condensed': 'Oswald',
    'sf pro': 'Inter',
    'segoe ui': 'Open Sans',
  };
  for (const cand of candidates) {
    const alias = ALIASES[cand];
    if (alias) {
      const f = getBundledFont(alias);
      if (f && f.roles.includes(role)) return f.family;
    }
  }

  // 3) Generic-family hint.
  if (candidates.some((c) => c.includes('serif') && !c.includes('sans'))) {
    return role === 'heading' ? 'Playfair Display' : 'Source Serif 4';
  }

  return fallback;
}
