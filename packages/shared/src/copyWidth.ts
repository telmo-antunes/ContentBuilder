/**
 * HOW WIDE THE PROSE RUNS — the per-slide measure control.
 *
 * A brand sets its own measure on the blocks that carry prose: detailmasters
 * writes `.body{max-width:22ch}` and `.tagline{max-width:20ch}`, which is the
 * right default (a long line is hard to read) and sometimes wrong for one
 * slide — a caption under a wide screenshot that wraps into a narrow column
 * beside acres of empty canvas.
 *
 * The owner asked for that as a button, and the only control the Studio had
 * was the copywriter, who writes WORDS: "make the text box wider" came back as
 * different sentences in the same narrow column, over and over.
 *
 * So the measure is app capability, like the type floor and the poster sizes:
 * three steps either side of whatever the brand chose, applied to one slide by
 * a class, deterministic and instant. The classes are DOUBLED in the selector
 * (`.cb-w-wide.cb-w-wide`, specificity 0,4,0) so they outrank a brand rule
 * written as `.cb-slide .body` (0,2,0) whatever order the sheets land in.
 */

/** The blocks that carry prose and therefore have a measure worth changing. */
export const COPY_BLOCKS = ['body', 'tagline', 'quote'] as const;

/** Off the brand's default, in both directions. `undefined` IS the brand's own. */
export const COPY_WIDTHS = ['cb-w-narrow', 'cb-w-wide', 'cb-w-full'] as const;
export type CopyWidth = (typeof COPY_WIDTHS)[number];

/** Narrow → the brand's own → wide → edge to edge. */
const LADDER: Array<CopyWidth | undefined> = ['cb-w-narrow', undefined, 'cb-w-wide', 'cb-w-full'];

export function copyWidthCss(): string {
  return [
    '/* Per-slide measure — see copyWidth.ts. Doubled class outranks the brand rule. */',
    '.cb-slide .cb-w-narrow.cb-w-narrow{ max-width:16ch; }',
    '.cb-slide .cb-w-wide.cb-w-wide{ max-width:30ch; }',
    '.cb-slide .cb-w-full.cb-w-full{ max-width:none; }',
  ].join('\n');
}

const OPEN_TAG = /<([a-z][a-z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
const CLASS_ATTR = /(\bclass\s*=\s*)(?:"([^"]*)"|'([^']*)')/i;

/**
 * Rewrite the class list of every prose block, tokenised.
 *
 * Tokenised rather than pattern-matched for the reason the headline size
 * buttons learned the hard way: `class="lead body"` and `class="body cb-w-wide"`
 * are both ordinary, and a regex that assumes the order or the position of a
 * class silently does nothing on half the brands.
 */
function editCopyBlocks(html: string, edit: (tokens: string[]) => string[] | null): { html: string; changed: boolean } {
  let changed = false;
  const out = html.replace(OPEN_TAG, (whole, tag: string, attrs: string) => {
    const m = attrs.match(CLASS_ATTR);
    if (!m) return whole;
    const quote = m[2] !== undefined ? '"' : "'";
    const tokens = (m[2] ?? m[3] ?? '').split(/\s+/).filter(Boolean);
    if (!tokens.some((t) => (COPY_BLOCKS as readonly string[]).includes(t))) return whole;
    const next = edit(tokens);
    if (!next) return whole;
    changed = true;
    // Replaced through a function so a `$` in a class name cannot be a backref.
    const attrsNext = attrs.replace(CLASS_ATTR, (_a, lead: string) => `${lead}${quote}${next.join(' ')}${quote}`);
    return `<${tag}${attrsNext}>`;
  });
  return { html: out, changed };
}

/** Where this slide's prose currently sits on the ladder. */
export function copyWidthOf(html: string): CopyWidth | undefined {
  const found = new Set<CopyWidth>();
  editCopyBlocks(html, (tokens) => {
    for (const w of COPY_WIDTHS) if (tokens.includes(w)) found.add(w);
    return null;
  });
  // One slide, one measure: the first step present wins, narrowest first, so a
  // slide that somehow carries two classes still reports something stable.
  return LADDER.find((step) => step && found.has(step)) as CopyWidth | undefined;
}

function setCopyWidth(html: string, width: CopyWidth | undefined): { html: string; changed: boolean } {
  return editCopyBlocks(html, (tokens) => {
    const kept = tokens.filter((t) => !(COPY_WIDTHS as readonly string[]).includes(t));
    if (width) kept.push(width);
    return kept.join(' ') === tokens.join(' ') ? null : kept;
  });
}

/** One step wider. Unchanged at the top of the ladder. */
export function widerCopy(html: string): { html: string; changed: boolean } {
  const at = LADDER.indexOf(copyWidthOf(html) ?? undefined);
  if (at >= LADDER.length - 1) return { html, changed: false };
  return setCopyWidth(html, LADDER[at + 1]);
}

/** One step narrower. Unchanged at the bottom. */
export function narrowerCopy(html: string): { html: string; changed: boolean } {
  const at = LADDER.indexOf(copyWidthOf(html) ?? undefined);
  if (at <= 0) return { html, changed: false };
  return setCopyWidth(html, LADDER[at - 1]);
}

/** Does this slide have prose whose measure a button could move at all? */
export function hasCopyToWiden(html: string): boolean {
  return editCopyBlocks(html, () => null).html === html && /class\s*=\s*["'][^"']*\b(body|tagline|quote)\b/i.test(html);
}
