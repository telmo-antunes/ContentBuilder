/**
 * Surgical editing for AI-composed (authored) slides — WITHOUT the lossy
 * HTML→blocks conversion. An authored slide is a flat fragment of recipe-class
 * elements (`<p class="eyebrow">`, `<h1 class="headline">…`, `<div class="fill">`).
 * We parse it into an editable list, let the studio tweak copy / order / the
 * signature emphasis, then rebuild the SAME fragment shape — so the recipe CSS
 * still styles it pixel-for-pixel (on-brand by construction, nothing degraded).
 *
 * Client-only (uses DOMParser). The rebuilt HTML is re-sanitised server-side on
 * save (normalizeSlides → sanitizeAuthoredHtml), so this stays a UX layer.
 */

export interface AuthoredEl {
  /** Stable key for React across reorders. */
  key: string;
  tag: string; // 'p' | 'h1' | 'a' | 'div' | …
  className: string; // recipe class(es), e.g. 'headline sm'
  kind: 'text' | 'structural';
  /** Editable visible text (text kind). */
  text: string;
  /** The accented sub-phrase (the brand signature move), if the element has one. */
  emphasis?: string;
  /** The span class that carries the emphasis ('em' | 'it' | …). */
  emphClass?: string;
  /** Verbatim outerHTML for structural elements (logo, rule, fill, panel…). */
  raw?: string;
  /** Friendly label for the editor chip. */
  label: string;
}

const LABELS: Record<string, string> = {
  eyebrow: 'Eyebrow',
  headline: 'Headline',
  tagline: 'Tagline',
  body: 'Body',
  quote: 'Quote',
  attr: 'Attribution',
  stat: 'Stat',
  cta: 'Button',
  handle: 'Handle',
  wordmark: 'Wordmark',
  logo: 'Logo',
  'logo-row': 'Logo',
  monogram: 'Monogram',
  rule: 'Rule',
  fill: 'Spacer',
  panel: 'Panel',
};

/** Inline tags allowed inside a "text" element (anything else ⇒ structural). */
const INLINE = new Set(['SPAN', 'BR']);

function labelFor(className: string): string {
  const first = className.split(/\s+/)[0] ?? '';
  return LABELS[first] ?? (first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Element');
}

let seq = 0;
const nextKey = () => `ae${(seq += 1)}`;

/** Parse an authored fragment into an editable element list. */
export function parseAuthored(html: string): AuthoredEl[] {
  if (typeof window === 'undefined') return [];
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  const root = doc.getElementById('r');
  if (!root) return [];
  return Array.from(root.children).map((node) => {
    const el = node as HTMLElement;
    const className = el.getAttribute('class') ?? '';
    const kids = Array.from(el.children);
    const onlyInline = kids.every((c) => INLINE.has(c.tagName));
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    // A "text" element is a leaf of copy: only inline children (an optional
    // emphasis span / <br>) and some visible text. Everything else (logo,
    // rule, spacer, panel, logo-row with <b>/<i>) is kept verbatim.
    if (onlyInline && text) {
      const span = kids.find((c) => c.tagName === 'SPAN') as HTMLElement | undefined;
      return {
        key: nextKey(),
        tag: el.tagName.toLowerCase(),
        className,
        kind: 'text' as const,
        text,
        emphasis: span ? (span.textContent ?? '').replace(/\s+/g, ' ').trim() : undefined,
        emphClass: span ? span.getAttribute('class') ?? undefined : undefined,
        label: labelFor(className),
      };
    }
    return {
      key: nextKey(),
      tag: el.tagName.toLowerCase(),
      className,
      kind: 'structural' as const,
      text: '',
      raw: el.outerHTML,
      label: labelFor(className),
    };
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const clsAttr = (c: string) => (c ? ` class="${esc(c)}"` : '');

/** Block/text tags a text element may re-emit (else fall back to <p>). Mirrors
 *  the authored-HTML sanitiser's allowlist — defence-in-depth on the client. */
const SAFE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'div', 'a', 'span', 'blockquote', 'li']);

/** Rebuild the authored fragment from the (possibly edited/reordered) element list. */
export function buildAuthored(els: AuthoredEl[]): string {
  return els
    .map((el) => {
      if (el.kind === 'structural') return el.raw ?? '';
      const tag = SAFE_TAGS.has(el.tag) ? el.tag : 'p';
      let inner = esc(el.text);
      // Re-apply the signature emphasis: wrap the first occurrence of the
      // accent phrase in its span, keeping the brand's signature move intact.
      const emph = el.emphasis?.trim();
      if (emph) {
        const i = el.text.indexOf(emph);
        if (i >= 0) {
          inner =
            esc(el.text.slice(0, i)) +
            `<span${clsAttr(el.emphClass ?? 'em')}>${esc(emph)}</span>` +
            esc(el.text.slice(i + emph.length));
        }
      }
      return `<${tag}${clsAttr(el.className)}>${inner}</${tag}>`;
    })
    .join('');
}
