/**
 * THE BRAND MARK — the one thing on a deck that must be identical everywhere.
 *
 * The composer is a typesetter: it arranges copy into the brand's component
 * classes, one slide at a time, with no memory of the slide before. That is
 * right for a headline and wrong for a logo. A brand mark is not copy and it is
 * not composition — it is a fixed artifact, and re-deriving it per slide means
 * assembling it differently per slide.
 *
 * Which is exactly what happened. One brand's recipe declares `.logo-row` as a
 * wrapper of `.monogram` (a 52px box painted with `var(--cb-logo)`) plus
 * `.wordmark` (the name in the display face). The cover slide got it right:
 *
 *   <div class="logo-row"><i class="monogram"></i>
 *     <div class="wordmark"><b>detail</b><span class="it">masters</span></div></div>
 *
 * The call-to-action slide improvised:
 *
 *   <div class="logo-row">detail<span class="monogram">masters</span></div>
 *
 * Both read "detailmasters" in the DOM, so nothing downstream noticed. On
 * screen the second is half the width, sets "detail" in the body face because
 * loose text in a wrapper inherits nothing, and stuffs "masters" into the 52px
 * square that holds the logo image.
 *
 * So the app takes this decision back. The prompt still asks for the mark the
 * recipe describes — but one variant is chosen for the whole deck and stamped
 * on every slide, which is a guarantee rather than a request.
 *
 * DELIBERATELY REGEX, NOT A PARSER. Every other authored-HTML gate in this
 * codebase works this way (`sanitizeAuthoredHtml`, `authoredSlots`,
 * `partsFromAuthored`), the input is a small allowlisted fragment the app
 * itself sanitised, and this has to run in the shared package with no DOM.
 */

/**
 * The wrapper that holds a brand mark. `.logo-row` and `.logo` are the names
 * recipes actually use; `.wordmark` and `.monogram` are counted only when one
 * of them is the OUTERMOST mark element (some brands have no wrapper at all).
 */
const MARK_CLASS = /(^|\s)(logo|logo-row|logorow|brandmark|brand-mark)(\s|$)/i;
const SOLO_MARK_CLASS = /(^|\s)(wordmark|monogram)(\s|$)/i;

export interface BrandMark {
  /** The whole element, e.g. `<div class="logo-row">…</div>`. */
  outer: string;
  /** Just what is inside it — what gets swapped. */
  inner: string;
  /** Where `outer` sits in the source html. */
  start: number;
  end: number;
}

/** Read `class="…"` off an opening tag. */
function classOf(openTag: string): string {
  const m = /\sclass\s*=\s*"([^"]*)"/i.exec(openTag) ?? /\sclass\s*=\s*'([^']*)'/i.exec(openTag);
  return m?.[1] ?? '';
}

/**
 * Find the brand mark in one slide's markup, if it has one.
 *
 * Returns the OUTERMOST match only: a `.logo-row` containing a `.wordmark`
 * would otherwise yield two marks, and replacing the inner one inside the outer
 * one is how you corrupt markup.
 */
export function findBrandMark(html: string): BrandMark | null {
  const tagRe = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const [full, tag = '', attrs = ''] = m as unknown as [string, string, string];
    if (full.endsWith('/>')) continue; // self-closing: nothing to hold a mark
    const cls = classOf(attrs);
    if (!MARK_CLASS.test(cls) && !SOLO_MARK_CLASS.test(cls)) continue;

    // Walk forward counting same-name tags so nesting closes correctly.
    const openStart = m.index;
    const innerStart = openStart + full.length;
    const nested = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    nested.lastIndex = innerStart;
    let depth = 1;
    let n: RegExpExecArray | null;
    while ((n = nested.exec(html))) {
      if (n[0].endsWith('/>')) continue;
      depth += n[1] ? -1 : 1;
      if (depth === 0) {
        return {
          outer: html.slice(openStart, n.index + n[0].length),
          inner: html.slice(innerStart, n.index),
          start: openStart,
          end: n.index + n[0].length,
        };
      }
    }
    // Unclosed — the sanitizer would have caught it, but never guess a range.
    return null;
  }
  return null;
}

/** Whitespace-insensitive identity, so indentation differences are not "different". */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Elements that never have a closing tag, so they never open a depth level. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'source', 'wbr']);

interface MarkChild {
  tag: string;
  cls: string;
  /** This child's own markup, so "is it empty" is a real question. */
  inner: string;
}

/**
 * A fragment's TOP LEVEL: its direct element children, and any text sitting
 * loose beside them.
 *
 * This exists because the first version asked these questions with regexes and
 * got both answers wrong. `inner.replace(/<[a-z][^>]*>[\s\S]*?<\/[a-z]+>/g, '')`
 * cannot strip a nested element — on the real mark it consumed
 * `<div class="wordmark">…</span>` and left a bare `</div>`, which then read as
 * loose text on a perfectly clean mark. And `\s*\S` after an opening tag was
 * meant to mean "this element has content", but the very next character is the
 * `<` of the closing tag, so an EMPTY element always looked full.
 *
 * Both signals therefore never fired, and scoring silently collapsed to "the
 * variant with the most elements wins" — which happened to be right for the
 * mark that prompted this, and wrong the moment an improvisation is wordier.
 *
 * One depth-counting pass answers both questions exactly, so the checks below
 * are about markup rather than about regex behaviour.
 */
function topLevel(fragment: string): { children: MarkChild[]; text: string } {
  const children: MarkChild[] = [];
  let text = '';
  let depth = 0;
  let cursor = 0;
  let open: { tag: string; cls: string; innerStart: number } | null = null;

  const tagRe = /<(\/?)([a-z][a-z0-9]*)\b([^>]*?)(\/?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(fragment))) {
    const closing = m[1] === '/';
    const tag = (m[2] ?? '').toLowerCase();
    const attrs = m[3] ?? '';
    const selfClosing = m[4] === '/' || VOID_TAGS.has(tag);

    if (depth === 0) text += fragment.slice(cursor, m.index);
    cursor = tagRe.lastIndex;

    if (selfClosing) {
      if (depth === 0) children.push({ tag, cls: classOf(attrs), inner: '' });
      continue;
    }
    if (!closing) {
      if (depth === 0) open = { tag, cls: classOf(attrs), innerStart: tagRe.lastIndex };
      depth += 1;
      continue;
    }
    // A stray close with nothing open is malformed; ignore rather than go negative.
    if (depth === 0) continue;
    depth -= 1;
    if (depth === 0 && open) {
      children.push({ tag: open.tag, cls: open.cls, inner: fragment.slice(open.innerStart, m.index) });
      open = null;
    }
  }
  if (depth === 0) text += fragment.slice(cursor);
  return { children, text: norm(text) };
}

/**
 * Classes that name the element carrying the logo IMAGE rather than words.
 *
 * A heuristic, and deliberately the only one here: reading it off the recipe's
 * CSS (`background: var(--cb-logo)`) would be exact, but the repair also runs
 * at the wire boundary where no recipe is loaded, and two code paths deciding
 * the same thing differently is how the original bug happened.
 */
const IMAGE_BEARER = /(^|[\s-])(monogram|mark|icon|glyph|symbol|badge|emblem)([\s-]|$)/i;

/** Every distinct class used anywhere in a fragment. */
function classesIn(fragment: string): Set<string> {
  const out = new Set<string>();
  for (const m of fragment.matchAll(/\sclass\s*=\s*["']([^"']*)["']/gi)) {
    for (const c of (m[1] ?? '').split(/\s+/)) if (c) out.add(c.toLowerCase());
  }
  return out;
}

/**
 * How well one variant behaves as a brand mark. Higher is better.
 *
 * Two disqualifying faults, then one positive:
 *
 *  1. LOOSE TEXT beside the children. A wrapper class is a layout box; the
 *     recipe styles its children, so bare text in it renders in whatever the
 *     slide happens to inherit — which is how "detail" ended up in the body
 *     face at half the size beside a Playfair wordmark.
 *  2. WORDS INSIDE THE LOGO IMAGE. That element is a fixed-size box painted
 *     with `var(--cb-logo)`; text in it lands on top of the picture.
 *  3. Failing those, MORE OF THE BRAND'S VOCABULARY. Counted as distinct
 *     CLASSES, not elements: an improvisation padded with unclassed <em>s
 *     gains nothing, whereas the real mark genuinely uses the classes the
 *     recipe authored for it.
 */
function score(inner: string): number {
  const { children, text } = topLevel(inner);
  const bearerHasText = children.some(
    (c) => IMAGE_BEARER.test(c.cls) && c.inner.replace(/<[^>]*>/g, '').trim() !== '',
  );
  return (text ? -100 : 0) + (bearerHasText ? -60 : 0) + classesIn(inner).size * 8;
}

/**
 * Pick ONE mark for a whole deck.
 *
 * Frequency decides first — if five slides agree and one does not, the five are
 * the brand. Only a tie goes to `score`, which is where a two-slide deck with
 * one good mark and one improvisation is settled.
 *
 * Returns null when no slide has a mark at all, which is a perfectly ordinary
 * deck and not something to repair.
 */
export function canonicalMark(htmls: string[]): string | null {
  const seen = new Map<string, { inner: string; count: number }>();
  for (const html of htmls) {
    const mark = findBrandMark(html);
    if (!mark) continue;
    const key = norm(mark.inner);
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { inner: mark.inner, count: 1 });
  }
  if (seen.size === 0) return null;
  const ranked = [...seen.values()].sort(
    (a, b) => b.count - a.count || score(b.inner) - score(a.inner) || b.inner.length - a.inner.length,
  );
  return ranked[0]!.inner;
}

/** Replace a slide's brand mark with `inner`, keeping the wrapper it authored. */
export function applyBrandMark(html: string, inner: string): string {
  const mark = findBrandMark(html);
  if (!mark || norm(mark.inner) === norm(inner)) return html;
  const open = mark.outer.slice(0, mark.outer.indexOf('>') + 1);
  const close = mark.outer.slice(mark.outer.lastIndexOf('<'));
  return html.slice(0, mark.start) + open + inner + close + html.slice(mark.end);
}

/**
 * THE GATE. One mark, chosen from the deck, stamped on every slide that has
 * one. Repair, not warning — the same contract as every other gate here.
 *
 * Returns the slides plus how many were rewritten, so a caller can log it
 * without re-deriving the answer.
 */
export function ensureBrandMark(htmls: string[]): { htmls: string[]; repaired: number } {
  const mark = canonicalMark(htmls);
  if (mark === null) return { htmls, repaired: 0 };
  let repaired = 0;
  const out = htmls.map((html) => {
    const next = applyBrandMark(html, mark);
    if (next !== html) repaired += 1;
    return next;
  });
  return { htmls: out, repaired };
}

/**
 * Do the marks on this deck disagree? Used by the prompt-version detectors to
 * say so on a post that was composed before the gate existed.
 */
export function brandMarkVariants(htmls: string[]): number {
  const seen = new Set<string>();
  for (const html of htmls) {
    const mark = findBrandMark(html);
    if (mark) seen.add(norm(mark.inner));
  }
  return seen.size;
}
