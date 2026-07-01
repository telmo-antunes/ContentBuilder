/**
 * Sanitize an untrusted SVG string (e.g. AI-generated) into a safe brand
 * background, or return null if it can't be made safe.
 *
 * Defense-in-depth for stored SVG (which browsers execute):
 *  - re-wrap in our own <svg> root (fixed viewBox/size; drops root-level attrs)
 *  - drop dangerous elements entirely (script/style/foreignObject/image/use/a/…)
 *  - strip event handlers (on*), href/xlink:href, and any javascript:/external url()
 *  - whitelist the remaining element names — anything unexpected → reject
 */

const W = 1080;
const H = 1350;

// Presentational elements a static background legitimately needs.
const ALLOWED = new Set([
  'g', 'defs', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern',
  'filter', 'fegaussianblur', 'feblend', 'fecolormatrix', 'fecomponenttransfer',
  'femerge', 'femergenode', 'feoffset', 'feflood', 'fecomposite', 'fefunca',
  'fefuncr', 'fefuncg', 'fefuncb', 'title', 'desc',
]);

// Elements removed wholesale (with their content) before whitelisting.
const DANGEROUS = [
  'script', 'style', 'foreignobject', 'iframe', 'image', 'use', 'a', 'audio', 'video',
  'animate', 'animatetransform', 'animatemotion', 'set', 'metadata', 'switch', 'text',
  'textpath', 'tspan',
];

function stripElement(svg: string, tag: string): string {
  const paired = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi');
  const selfClosing = new RegExp(`<${tag}\\b[^>]*/?>`, 'gi');
  return svg.replace(paired, '').replace(selfClosing, '');
}

export function sanitizeSvgBackground(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let s = raw.trim();
  // Peel markdown fences / prose around the SVG.
  const start = s.toLowerCase().indexOf('<svg');
  const end = s.toLowerCase().lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end <= start) return null;
  s = s.slice(start, end + '</svg>'.length);

  // Remove comments, CDATA, doctype, processing instructions.
  s = s.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  // Drop dangerous elements entirely.
  for (const tag of DANGEROUS) s = stripElement(s, tag);

  // Strip event handlers, links, and any script-y / external references.
  s = s
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    // neutralize url(...) that isn't an internal #fragment reference
    .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');

  // Extract inner content and re-wrap in a controlled root (drops root attrs).
  const openEnd = s.indexOf('>');
  const closeStart = s.toLowerCase().lastIndexOf('</svg>');
  if (openEnd === -1 || closeStart <= openEnd) return null;
  const inner = s.slice(openEnd + 1, closeStart).trim();
  if (!inner) return null;

  // Whitelist: every element in the body must be known-safe.
  const tags = inner.match(/<\/?([a-z][\w:-]*)/gi) ?? [];
  for (const t of tags) {
    const name = t.replace(/[</]/g, '').toLowerCase();
    if (!ALLOWED.has(name)) return null;
  }

  // Must actually draw something.
  if (!/<(rect|circle|ellipse|path|polygon|polyline|line|g)\b/i.test(inner)) return null;
  // Guard against absurdly large payloads.
  if (inner.length > 60_000) return null;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" width="${W}" height="${H}">${inner}</svg>`;
}
