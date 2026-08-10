/**
 * Recover the COPY PARTS from an already-composed slide.
 *
 * Compose stores only the authored markup, not the parts it was built from — so
 * regenerating one slide used to be impossible: your options were re-composing
 * the entire deck (losing every other slide) or editing by hand. Reading the
 * parts back out of the markup makes a single slide re-composable.
 *
 * Pure string work (no DOM) so it runs on the server, and it only ever reads the
 * recipe's own component classes.
 */
import type { ComposeParts } from './prompt';

/** class name in the markup → the compose part it carries. */
const CLASS_TO_PART: Record<string, keyof ComposeParts> = {
  eyebrow: 'eyebrow',
  headline: 'headline',
  tagline: 'tagline',
  body: 'body',
  quote: 'quote',
  attr: 'attribution',
  stat: 'stat',
  cta: 'cta',
  handle: 'handle',
};

/** Collapse markup to its visible text. */
function textOf(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the copy parts from authored slide markup. The emphasis phrase (the
 * brand's signature accent) is read out of its span so a re-compose keeps it.
 */
export function partsFromAuthored(html: string): ComposeParts {
  const parts: ComposeParts = {};
  const el = /<([a-z][a-z0-9]*)\b[^>]*\bclass="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(el)) {
    const classes = (m[2] ?? '').split(/\s+/);
    const inner = m[3] ?? '';
    for (const c of classes) {
      const part = CLASS_TO_PART[c];
      if (!part || parts[part]) continue;
      const text = textOf(inner);
      if (!text) continue;
      (parts as Record<string, string>)[part] = text;
      // The accent phrase lives in a nested span — keep it so the signature survives.
      if (part === 'headline') {
        const span = inner.match(/<span\b[^>]*class="[^"]*\b(?:em|it)\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        const emphasis = span ? textOf(span[1] ?? '') : '';
        if (emphasis) parts.emphasis = emphasis;
      }
    }
  }
  return parts;
}

/**
 * THE INVERSE OF `partsFromAuthored`: put NEW copy into the arrangement that is
 * already there.
 *
 * "Alternatives" keeps the words and changes the layout. This keeps the layout
 * and changes the words — the other half of the same idea, and the one you
 * actually want when a slide is composed beautifully and simply says the wrong
 * thing. Doing it by re-composing would hand the arrangement back to the model
 * and lose exactly what the user wanted to keep, so the text is spliced into the
 * existing elements instead: same tags, same classes, same order, same spacers.
 *
 * Rows are matched positionally. Surplus row elements are removed (four rows of
 * markup cannot carry three items without leaving an empty card), and surplus
 * items are dropped (there is nowhere to put a fifth without inventing markup,
 * which is the thing this function exists not to do).
 */
export function rewriteAuthoredCopy(html: string, next: ComposeParts): { html: string; used: string[] } {
  const used: string[] = [];
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── the scalar parts ──────────────────────────────────────────────────
  const filled = new Set<string>();
  let out = html.replace(
    /<([a-z][a-z0-9]*)\b([^>]*\bclass="([^"]*)"[^>]*)>([\s\S]*?)<\/\1>/gi,
    (whole, tag: string, attrs: string, classAttr: string) => {
      // A row's own text is handled below; its container must not be rewritten
      // wholesale or the rows inside it would be replaced by one string.
      const classes = classAttr.split(/\s+/).filter(Boolean);
      if (classes.includes('row')) return whole;
      for (const c of classes) {
        const part = CLASS_TO_PART[c];
        if (!part || part === 'handle' || filled.has(part)) continue;
        const value = next[part];
        if (typeof value !== 'string' || !value.length) continue;
        filled.add(part);
        used.push(part);
        return `<${tag}${attrs}>${escape(value)}</${tag}>`;
      }
      return whole;
    },
  );

  // ── the rows ──────────────────────────────────────────────────────────
  const rows = next.rows ?? [];
  let i = 0;
  out = out.replace(
    /<([a-z][a-z0-9]*)\b([^>]*\bclass="[^"]*\brow\b[^"]*"[^>]*)>([\s\S]*?)<\/\1>/gi,
    (whole, tag: string, attrs: string, inner: string) => {
      const row = rows[i];
      i += 1;
      if (!row) return ''; // a row element with nothing left to put in it
      // Keep the row's own note element when the new item has a note for it.
      const noteEl = inner.match(
        /<([a-z][a-z0-9]*)\b([^>]*\bclass="[^"]*\b(?:sm|note|detail|sub|meta)\b[^"]*"[^>]*)>[\s\S]*?<\/\1>/i,
      );
      const note =
        row.note && noteEl ? `<${noteEl[1]}${noteEl[2]}>${escape(row.note)}</${noteEl[1]}>` : '';
      return `<${tag}${attrs}>${escape(row.text)}${note}</${tag}>`;
    },
  );
  if (rows.length) used.push('rows');

  return { html: out.replace(/\n{2,}/g, '\n').trim(), used };
}

/**
 * WHICH PARTS an arrangement can carry — the shape a rewrite has to fill.
 * Reported as the part names plus how many rows there is room for, so the
 * copywriter is asked for exactly what will fit rather than for a fresh slide.
 */
export function authoredShape(html: string): { parts: Array<keyof ComposeParts>; rows: number } {
  const parts = Object.keys(partsFromAuthored(html)) as Array<keyof ComposeParts>;
  const rows = (html.match(/\bclass\s*=\s*"[^"]*\brow\b[^"]*"/gi) ?? []).length;
  return { parts: parts.filter((p) => p !== 'emphasis'), rows };
}
