/**
 * Sanitize an untrusted SVG string (e.g. AI-authored) into a safe brand
 * background, or return null if it can't be made safe.
 *
 * The render pipeline places backgrounds via `<img src>` (where SVG scripts do
 * NOT execute), so this is defense-in-depth — but it's also the ONLY guard on
 * SVG that is stored and later served from `/media/*`. It is fail-closed: an
 * allowlist for both elements AND attributes, a re-wrapped root, and hard caps.
 *
 *  - re-wrap in our own <svg> root (format-aware viewBox; drops all root attrs)
 *  - drop dangerous elements entirely (script/style/foreignObject/image/use/a/…)
 *  - strip event handlers (on*), href/xlink:href, javascript:, external url()
 *  - allowlist remaining ELEMENT names — anything unexpected → reject
 *  - allowlist remaining ATTRIBUTE names + scrub their values — unknown → drop
 *  - require a full-canvas <rect> base coat as the first painted element
 *    (the legibility gate + the prompt both rely on this guarantee)
 */

export interface SvgSanitizeOptions {
  /** Target canvas width (post 1080, story 1080). */
  width: number;
  /** Target canvas height (post 1350, story 1920). */
  height: number;
  /** Reject inputs larger than this many bytes of inner content. Default 80KB. */
  maxBytes?: number;
  /** Max number of `<` element opens allowed (render-bomb guard). Default 2000. */
  maxElements?: number;
}

// Presentational elements a static background legitimately needs.
const ALLOWED = new Set([
  'g', 'defs', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern',
  'filter', 'fegaussianblur', 'feblend', 'fecolormatrix', 'fecomponenttransfer',
  'femerge', 'femergenode', 'feoffset', 'feflood', 'fecomposite', 'feturbulence',
  'fedisplacementmap', 'fedropshadow', 'fetile', 'femorphology', 'fefunca',
  'fefuncr', 'fefuncg', 'fefuncb', 'title', 'desc',
]);

// Elements removed wholesale (with their content) before allowlisting.
const DANGEROUS = [
  'script', 'style', 'foreignobject', 'iframe', 'image', 'use', 'a', 'audio', 'video',
  'animate', 'animatetransform', 'animatemotion', 'set', 'metadata', 'switch', 'text',
  'textpath', 'tspan',
];

// Presentation attributes a static background legitimately needs. Anything not
// here (notably `style`, `on*`, `href`) is dropped from every element.
const ALLOWED_ATTR = new Set([
  'id', 'class', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r',
  'rx', 'ry', 'width', 'height', 'fill', 'fill-opacity', 'fill-rule', 'stroke',
  'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity',
  'transform', 'gradienttransform', 'gradientunits', 'spreadmethod', 'offset',
  'stop-color', 'stop-opacity', 'clip-path', 'clip-rule', 'mask', 'filter',
  'stddeviation', 'in', 'in2', 'mode', 'result', 'type', 'values', 'operator',
  'k1', 'k2', 'k3', 'k4', 'flood-color', 'flood-opacity', 'dx', 'dy',
  'patternunits', 'patterncontentunits', 'patterntransform', 'maskunits',
  'maskcontentunits', 'clippathunits', 'filterunits', 'primitiveunits',
  'preserveaspectratio', 'viewbox', 'fx', 'fy', 'fr', 'tablevalues', 'slope',
  'intercept', 'amplitude', 'exponent', 'numoctaves', 'basefrequency', 'seed',
  'stitchtiles', 'xchannelselector', 'ychannelselector', 'scale', 'radius',
  'edgemode', 'color-interpolation-filters',
]);

function stripElement(svg: string, tag: string): string {
  const paired = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi');
  const selfClosing = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi');
  return svg.replace(paired, '').replace(selfClosing, '');
}

/** Drop every attribute not on the allowlist, and scrub disallowed values. */
function filterAttributes(inner: string): string {
  return inner.replace(
    /\s([a-zA-Z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g,
    (match, rawName: string, value: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_ATTR.has(name)) return '';
      // Value scrub: no embedded markup, no scripts, no external url().
      if (value.includes('<') || /javascript:/i.test(value)) return '';
      if (/url\(/i.test(value) && !/url\(\s*['"]?#/.test(value)) return '';
      return match;
    },
  );
}

/** Parse an SVG length attribute value ("100%", "1080", "1080px") to px against `full`. */
function lengthToPx(value: string | undefined, full: number): number | null {
  if (value == null) return null;
  const v = value.trim();
  if (v.endsWith('%')) {
    const pct = parseFloat(v);
    return Number.isFinite(pct) ? (pct / 100) * full : null;
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function attrOf(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

/**
 * Enforce the base-coat contract: the FIRST painted element must be a `<rect>`
 * that covers (near) the whole canvas. This is what lets the legibility gate
 * reason about text-on-background contrast at all. Returns the base fill hex, or
 * null if the contract is violated.
 */
function baseCoatFill(inner: string, width: number, height: number): string | null {
  const firstDraw = inner.match(/<(rect|circle|ellipse|path|polygon|polyline|line)\b[^>]*>/i);
  if (!firstDraw) return null;
  if (firstDraw[1]!.toLowerCase() !== 'rect') return null; // first paint must be the base rect
  const tag = firstDraw[0];
  const x = lengthToPx(attrOf(tag, 'x'), width) ?? 0;
  const y = lengthToPx(attrOf(tag, 'y'), height) ?? 0;
  const w = lengthToPx(attrOf(tag, 'width'), width) ?? 0;
  const h = lengthToPx(attrOf(tag, 'height'), height) ?? 0;
  const covers = x <= 1 && y <= 1 && w >= width * 0.999 && h >= height * 0.999;
  if (!covers) return null;
  const fill = attrOf(tag, 'fill');
  // Base coat must be a solid brand hex (gradients can't be contrast-checked cheaply).
  return fill && /^#[0-9a-fA-F]{6}$/.test(fill) ? fill : null;
}

export interface SanitizedSvg {
  svg: string;
  /** Solid hex of the full-canvas base rect — the color text will sit on. */
  baseFill: string;
}

/**
 * Full result variant: returns the sanitized markup AND the base-coat fill so
 * callers can run the legibility gate without re-parsing.
 */
export function sanitizeSvgBackgroundEx(raw: string, opts: SvgSanitizeOptions): SanitizedSvg | null {
  if (!raw || typeof raw !== 'string') return null;
  const width = Math.round(opts.width);
  const height = Math.round(opts.height);
  const maxBytes = opts.maxBytes ?? 80_000;
  const maxElements = opts.maxElements ?? 2000;

  let s = raw.trim();
  // Peel markdown fences / prose around the SVG.
  const start = s.toLowerCase().indexOf('<svg');
  const end = s.toLowerCase().lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end <= start) return null;
  s = s.slice(start, end + '</svg>'.length);

  // Remove comments, CDATA, doctype, processing instructions.
  s = s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  // Drop dangerous elements entirely (with their content).
  for (const tag of DANGEROUS) s = stripElement(s, tag);

  // Belt-and-suspenders strips (the attribute allowlist below also catches these).
  s = s
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');

  // Extract inner content and re-wrap in a controlled root (drops root attrs).
  const openEnd = s.indexOf('>');
  const closeStart = s.toLowerCase().lastIndexOf('</svg>');
  if (openEnd === -1 || closeStart <= openEnd) return null;
  let inner = s.slice(openEnd + 1, closeStart).trim();
  if (!inner) return null;

  // Element allowlist: every element in the body must be known-safe.
  const tags = inner.match(/<\/?([a-z][\w:-]*)/gi) ?? [];
  if (tags.length > maxElements) return null;
  for (const t of tags) {
    const name = t.replace(/[</]/g, '').toLowerCase();
    if (!ALLOWED.has(name)) return null;
  }

  // Attribute allowlist + value scrub (drops style="", stray handlers, etc.).
  inner = filterAttributes(inner);

  // Must actually draw something, and honor the base-coat contract.
  if (!/<(rect|circle|ellipse|path|polygon|polyline|line|g)\b/i.test(inner)) return null;
  const baseFill = baseCoatFill(inner, width, height);
  if (!baseFill) return null;

  // Guard against absurdly large payloads.
  if (inner.length > maxBytes) return null;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" width="${width}" height="${height}">${inner}</svg>`;
  return { svg, baseFill };
}

/** Sanitize an untrusted SVG into safe markup, or null. (Convenience wrapper.) */
export function sanitizeSvgBackground(raw: string, opts: SvgSanitizeOptions): string | null {
  return sanitizeSvgBackgroundEx(raw, opts)?.svg ?? null;
}

// Elements that can execute script or fetch external resources — removed from
// ANY uploaded SVG (logos included), with their content.
const UPLOAD_DANGEROUS = [
  'script', 'style', 'foreignobject', 'iframe', 'audio', 'video',
  'animate', 'animatetransform', 'animatemotion', 'set', 'handler',
];

/**
 * Permissive, structure-preserving sanitizer for USER-UPLOADED SVG (which may be
 * a logo or icon, not a background). Unlike `sanitizeSvgBackground` it keeps the
 * file's own root/viewBox, text, and arbitrary safe elements — it only removes
 * the script/exfil surface so the stored bytes are safe even if the `/media` URL
 * is opened directly (the in-app render path already uses `<img>`, where SVG
 * script never runs). Returns cleaned markup, or null if there's no usable SVG.
 */
export function sanitizeSvgUpload(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  const start = s.toLowerCase().indexOf('<svg');
  const end = s.toLowerCase().lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end <= start) return null;
  s = s.slice(start, end + '</svg>'.length);

  s = s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  for (const tag of UPLOAD_DANGEROUS) s = stripElement(s, tag);

  s = s
    // event handlers on any element
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // external references (keep internal #fragment href — e.g. <use href="#id">)
    .replace(/\s(?:xlink:)?href\s*=\s*("\s*#[^"]*"|'\s*#[^']*'|#[^\s>]+)/gi, ' data-safe-href=$1')
    .replace(/\s(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sdata-safe-href=/gi, ' href=')
    .replace(/javascript:/gi, '')
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');

  // Must still contain an <svg> root and some drawable content.
  if (!/<svg[\s\S]*<\/svg>/i.test(s)) return null;
  if (s.length > 200_000) return null;
  return s;
}
