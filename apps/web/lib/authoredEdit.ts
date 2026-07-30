/**
 * Surgical editing for AI-composed (authored) slides, straight on the markup.
 * An authored slide is a flat fragment of recipe-class
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
  kind: 'text' | 'list' | 'structural';
  /** Editable visible text (text kind). */
  text: string;
  /** The accented sub-phrase (the brand signature move), if the element has one. */
  emphasis?: string;
  /** The span class that carries the emphasis ('em' | 'it' | …). */
  emphClass?: string;
  /** Verbatim outerHTML for structural elements (logo, rule, fill…). */
  raw?: string;
  /**
   * An enumeration's editable rows. A container of parallel rows used to be
   * classified `structural`, so a slide that said "three things" showed
   * "Panel — kept exactly as designed" and its copy could not be touched at all.
   */
  rows?: AuthoredRow[];
  /** How to rebuild those rows in the brand's own markup. */
  rowShape?: {
    tag: string;
    className: string;
    /** The (usually empty) marker element, kept verbatim — it carries the bullet. */
    marker: string;
    noteTag: string;
    noteClass: string;
  };
  /** Friendly label for the editor chip. */
  label: string;
}

/** One line of an enumeration: the item, and an optional half-line of detail. */
export interface AuthoredRow {
  key: string;
  text: string;
  note?: string;
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

/**
 * Visible text, with `<br>` preserved as a newline.
 *
 * `textContent` drops line breaks entirely, which silently corrupted copy: a
 * headline authored as `…shift the moment<br><span>a pack is sold.</span>`
 * came back as "…shift the momenta pack is sold." — shown to the user that
 * way, and re-saved without the designed break. Newlines survive here and are
 * re-emitted as `<br>` on the way out, so a round-trip is lossless.
 */
function visibleText(el: Element): string {
  let out = '';
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) out += n.textContent ?? '';
    else if ((n as Element).tagName === 'BR') out += '\n';
    else out += visibleText(n as Element);
  }
  // Collapse horizontal runs but keep the line structure.
  return out.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** Tags that carry a row's secondary detail in the brands' list vocabulary. */
const NOTE_TAGS = new Set(['EM', 'I', 'SMALL']);

/** Is this element a container of parallel rows (an enumeration)? */
function asListRows(el: Element): { rows: AuthoredRow[]; shape: NonNullable<AuthoredEl['rowShape']> } | null {
  const kids = Array.from(el.children);
  if (kids.length < 2) return null;
  const cls = kids[0]!.getAttribute('class') ?? '';
  // Parallel rows share a class and a tag — that is what makes them a list
  // rather than an arbitrary group of blocks.
  if (!kids.every((k) => k.tagName === kids[0]!.tagName && (k.getAttribute('class') ?? '') === cls)) return null;
  // Every row must be simple enough to rebuild faithfully.
  if (!kids.every((k) => Array.from(k.children).every((c) => INLINE.has(c.tagName) || NOTE_TAGS.has(c.tagName)))) {
    return null;
  }
  let marker = '';
  let noteTag = 'em';
  let noteClass = '';
  const rows: AuthoredRow[] = kids.map((k) => {
    const noteEl = Array.from(k.children).find((c) => NOTE_TAGS.has(c.tagName)) as HTMLElement | undefined;
    const markerEl = Array.from(k.children).find(
      (c) => !NOTE_TAGS.has(c.tagName) && !visibleText(c),
    ) as HTMLElement | undefined;
    if (markerEl && !marker) marker = markerEl.outerHTML;
    if (noteEl) {
      noteTag = noteEl.tagName.toLowerCase();
      noteClass = noteEl.getAttribute('class') ?? '';
    }
    const note = noteEl ? visibleText(noteEl) : undefined;
    let text = visibleText(k);
    if (note && text.endsWith(note)) text = text.slice(0, -note.length).trim();
    return { key: nextKey(), text, note: note || undefined };
  });
  if (!rows.some((r) => r.text)) return null;
  return { rows, shape: { tag: kids[0]!.tagName.toLowerCase(), className: cls, marker, noteTag, noteClass } };
}

function labelFor(className: string): string {
  const first = className.split(/\s+/)[0] ?? '';
  return LABELS[first] ?? (first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Element');
}

let seq = 0;
const nextKey = () => `ae${(seq += 1)}`;

/** Parse an authored fragment into an editable element list. */
export function parseAuthored(html: string): AuthoredEl[] {
  if (typeof window === 'undefined') return [];
  let root = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html').getElementById('r');
  if (!root) return [];
  // Defensive: some composer output wraps the whole slide in a `.cb-slide` div.
  // Unwrap it so the inner elements are individually editable (and match what
  // the renderer expects — the INNER fragment). Editing then re-saves it clean.
  while (
    root.children.length === 1 &&
    /\bcb-slide\b/.test((root.children[0] as HTMLElement).getAttribute('class') ?? '')
  ) {
    const inner = new DOMParser()
      .parseFromString(`<div id="r">${(root.children[0] as HTMLElement).innerHTML}</div>`, 'text/html')
      .getElementById('r');
    if (!inner) break;
    root = inner;
  }
  return Array.from(root.children).map((node) => {
    const el = node as HTMLElement;
    const className = el.getAttribute('class') ?? '';
    const kids = Array.from(el.children);
    const onlyInline = kids.every((c) => INLINE.has(c.tagName));
    const text = visibleText(el);
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
        emphasis: span ? visibleText(span) : undefined,
        emphClass: span ? span.getAttribute('class') ?? undefined : undefined,
        label: labelFor(className),
      };
    }
    // A container of parallel rows is an EDITABLE list, not immovable furniture.
    const list = asListRows(el);
    if (list) {
      return {
        key: nextKey(),
        tag: el.tagName.toLowerCase(),
        className,
        kind: 'list' as const,
        text: '',
        rows: list.rows,
        rowShape: list.shape,
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

/** Escape, then restore the designed line breaks as `<br>`. */
const nl = (s: string) => esc(s).replace(/\n/g, '<br>');

/** Block/text tags a text element may re-emit (else fall back to <p>). Mirrors
 *  the authored-HTML sanitiser's allowlist — defence-in-depth on the client. */
const SAFE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'div', 'a', 'span', 'blockquote', 'li']);

/** Rebuild the authored fragment from the (possibly edited/reordered) element list. */
export function buildAuthored(els: AuthoredEl[]): string {
  return els
    .map((el) => {
      if (el.kind === 'structural') return el.raw ?? '';
      if (el.kind === 'list') {
        const sh = el.rowShape;
        if (!sh) return '';
        const rowTag = SAFE_TAGS.has(sh.tag) ? sh.tag : 'div';
        const noteTag = ['em', 'i', 'small'].includes(sh.noteTag) ? sh.noteTag : 'em';
        const body = (el.rows ?? [])
          .filter((r) => r.text.trim() || r.note?.trim())
          .map(
            (r) =>
              `<${rowTag}${clsAttr(sh.className)}>${sh.marker}${nl(r.text)}` +
              (r.note?.trim() ? `<${noteTag}${clsAttr(sh.noteClass)}>${nl(r.note)}</${noteTag}>` : '') +
              `</${rowTag}>`,
          )
          .join('');
        const tag = SAFE_TAGS.has(el.tag) ? el.tag : 'div';
        return `<${tag}${clsAttr(el.className)}>${body}</${tag}>`;
      }
      const tag = SAFE_TAGS.has(el.tag) ? el.tag : 'p';
      let inner = nl(el.text);
      // Re-apply the signature emphasis: wrap the first occurrence of the
      // accent phrase in its span, keeping the brand's signature move intact.
      const emph = el.emphasis?.trim();
      if (emph) {
        const i = el.text.indexOf(emph);
        if (i >= 0) {
          inner =
            nl(el.text.slice(0, i)) +
            `<span${clsAttr(el.emphClass ?? 'em')}>${nl(emph)}</span>` +
            nl(el.text.slice(i + emph.length));
        }
      }
      return `<${tag}${clsAttr(el.className)}>${inner}</${tag}>`;
    })
    .join('');
}
