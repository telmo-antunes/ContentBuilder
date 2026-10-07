/**
 * SPEC SLIDES — one item to buy, its picture, what it does, and the specs to
 * check before paying for one.
 *
 * Telmo, 2026-10-07, on the what-to-buy-first deck: each item slide should say
 * why the item matters and then "Make sure you get one with the following
 * specs", for someone new to the trade. He liked the specs as ticked rows and
 * asked for them smaller.
 *
 * Two rules stood in the way. The parse step dropped the photograph from any
 * slide carrying rows ("rows and a picture cannot share a slide"), and the
 * composer is told a slot replaces the pattern's optional furniture. Both are
 * right for a list slide and wrong here: on an item slide the picture shows
 * what to look for and the specs say what to check, so neither is furniture.
 * The list is set at a smaller scale (`.specs`, see `specsDensityCss`) so the
 * photo, the body and four or five specs share one 4:5 frame.
 */
import type { SlideRole } from '@contentbuilder/shared';

/** Longest a spec row may be: a label read in one glance, not a sentence. */
export const SPEC_ROW_MAX = 36;

/** The app's class for a list at spec scale. */
export const SPECS_CLASS = 'specs';

type Row = { text: string; note?: string; state?: string };

/**
 * A feature slide whose rows are specs: two to five short, plain rows. A row
 * with a note, a verdict or a sentence's length is a list's job, not a spec's,
 * and keeps the old rule.
 */
export function isSpecSlide(role: SlideRole | string, rows: ReadonlyArray<Row> | undefined): boolean {
  const list = rows ?? [];
  return (
    role === 'feature' &&
    list.length >= 2 &&
    list.length <= 5 &&
    list.every((r) => !r.note?.trim() && !r.state && r.text.trim().length > 0 && r.text.trim().length <= SPEC_ROW_MAX)
  );
}

/**
 * Put `specs` on the element that holds the rows, if the composer did not.
 * The container is the last element opened before the first row, which is how
 * every brand's list is built (a panel, then its rows). Markup with no row, or
 * a container that already carries the class, comes back unchanged.
 */
export function markSpecList(html: string): string {
  const firstRow = html.search(/<[a-z][\w-]*\b[^>]*\bclass\s*=\s*"(?:[^"]*\s)?row(?:\s[^"]*)?"/i);
  if (firstRow <= 0) return html;
  let container: RegExpExecArray | undefined;
  const open = /<([a-z][\w-]*)\b[^>]*>/gi;
  for (let m = open.exec(html); m && m.index < firstRow; m = open.exec(html)) {
    if (!m[0].endsWith('/>')) container = m;
  }
  if (!container) return html;
  const tag = container[0];
  const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(tag);
  if (cls && cls[1]!.split(/\s+/).includes(SPECS_CLASS)) return html;
  const next = cls
    ? tag.replace(cls[0], `class="${`${cls[1]!.trim()} ${SPECS_CLASS}`.trim()}"`)
    : tag.replace(/^<([a-z][\w-]*)/i, `<$1 class="${SPECS_CLASS}"`);
  return html.slice(0, container.index) + next + html.slice(container.index + tag.length);
}
