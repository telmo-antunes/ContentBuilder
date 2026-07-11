'use client';

import { BUNDLED_FONT_FAMILIES } from '@contentbuilder/shared';

/**
 * Dynamic Google Fonts loading for non-bundled brand fonts (a kit whose site
 * font exists on GF renders in the brand's REAL typeface). Bundled families are
 * self-hosted woff2 and never touch this. Export safety: the exporter awaits
 * `document.fonts.ready` and the fitter re-measures on font load, so swapped-in
 * faces are laid out correctly in PNGs too.
 */

const requested = new Set<string>();

function inject(href: string, onFail?: () => void) {
  if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  if (onFail) link.onerror = onFail;
  document.head.appendChild(link);
}

function css2Url(family: string, weights?: number[]): string {
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  const axis = weights?.length ? `:wght@${weights.join(';')}` : '';
  return `https://fonts.googleapis.com/css2?family=${fam}${axis}&display=swap`;
}

/** Idempotently load any non-bundled families from Google Fonts. */
export function ensureGoogleFonts(families: Array<string | undefined>): void {
  if (typeof document === 'undefined') return;
  for (const family of families) {
    if (!family || BUNDLED_FONT_FAMILIES.includes(family) || requested.has(family)) continue;
    requested.add(family);
    // Ask for the weights the type scale uses; if the family lacks some (GF
    // css2 400s on any missing weight), fall back to the family's own defaults
    // and let the browser synthesize the rest.
    inject(css2Url(family, [400, 500, 600, 700, 800]), () => inject(css2Url(family)));
  }
}
