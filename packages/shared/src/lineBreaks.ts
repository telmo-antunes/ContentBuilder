/**
 * WHERE A HEADLINE BREAKS.
 *
 * The browser breaks at whatever space is nearest the edge, which is why a real
 * deck shipped "Have it looked at by / someone who does / this for a living."
 * and "These are what actually / shorten a coating's life." Both split
 * grammatical units, and a line ending on "by" or "at" reads as a mistake even
 * to someone who could not say why.
 *
 * The fix is not to choose the breaks — CSS cannot be told "break here" without
 * knowing the rendered width, and hard-coding line ends would break again at
 * another size. It is to make the WRONG breaks unavailable: glue the words that
 * must not be separated with a non-breaking space, and let the browser pick
 * from what is left. A headline with three legal break points and one illegal
 * one is a headline the browser cannot set badly.
 *
 * Applied to display copy only. Body text at 30px has many more break points
 * and a widow there costs far less than the risk of gluing a long phrase and
 * forcing an overflow.
 */

/** Words a line must not end on — they belong to what follows. */
const ORPHAN_ENDERS = new Set([
  // articles
  'a', 'an', 'the',
  // prepositions that bind tightly to their object
  'at', 'by', 'for', 'from', 'in', 'into', 'of', 'off', 'on', 'onto',
  'over', 'to', 'up', 'with', 'without', 'under', 'via',
  // conjunctions and relatives that open a clause
  'and', 'or', 'nor', 'but', 'so', 'if', 'as', 'than', 'that', 'which', 'who',
  // determiners / possessives
  'your', 'our', 'their', 'its', 'his', 'her', 'my', 'this', 'these', 'those',
  'every', 'each', 'any', 'no', 'not',
  // auxiliaries
  'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'has', 'have', 'had',
  'can', 'will', 'would', 'should', 'could', 'may', 'might', 'must',
]);

/** Non-breaking space. Named, because a literal one is invisible in source. */
export const NBSP = ' ';

/** A short final word left alone on its own line is the classic widow. */
export const WIDOW_MAX_CHARS = 8;

const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t);
const bare = (t: string) => t.replace(/[^\p{L}\p{N}'’-]/gu, '').toLowerCase();

/**
 * Glue the pairs a line must not be broken between.
 *
 * Two rules, both conservative:
 *
 *   1. A word in `ORPHAN_ENDERS` is glued to the word after it, so no line can
 *      end on "by" or "the".
 *   2. The last two words are glued, so the final line cannot be one short
 *      word alone — the widow that also made a list row 65% taller than its
 *      neighbours in a real deck.
 *
 * Never glues across existing markup, and never glues a pair long enough to
 * become an unbreakable run wider than a sensible line: a headline that cannot
 * break at all overflows, which is a worse fault than the one being fixed.
 */
export function bindLineBreaks(text: string, maxRun = 24): string {
  if (!text.includes(' ')) return text;

  // Split on spaces, keeping everything else (punctuation, entities) in place.
  const tokens = text.split(/( +)/);
  const wordAt: number[] = [];
  tokens.forEach((t, i) => {
    if (i % 2 === 0 && isWord(t)) wordAt.push(i);
  });
  if (wordAt.length < 2) return text;

  const glue = new Set<number>(); // indices of separators to replace

  for (let w = 0; w < wordAt.length - 1; w += 1) {
    const here = tokens[wordAt[w]!]!;
    const next = tokens[wordAt[w + 1]!]!;
    const sep = wordAt[w]! + 1;
    if (tokens[sep] === undefined) continue;
    if (here.length + next.length + 1 > maxRun) continue;
    if (ORPHAN_ENDERS.has(bare(here))) glue.add(sep);
  }

  // The widow rule: bind the last pair when the final word is short.
  const last = wordAt[wordAt.length - 1]!;
  const prev = wordAt[wordAt.length - 2]!;
  const lastWord = tokens[last]!;
  if (
    bare(lastWord).length <= WIDOW_MAX_CHARS &&
    lastWord.length + tokens[prev]!.length + 1 <= maxRun
  ) {
    glue.add(prev + 1);
  }

  return tokens
    .map((t, i) => (glue.has(i) ? NBSP.repeat(t.length) : t))
    .join('');
}

/**
 * Apply the binder to display copy inside a slide's markup.
 *
 * Text nodes only, and only inside the elements that carry display type. A
 * `.body` paragraph is left alone: it has far more break points, a widow costs
 * less there, and gluing inside long prose is the fastest way to force the
 * overflow this is meant to avoid.
 */
const DISPLAY_CLASSES = ['headline', 'tagline', 'quote', 'stat', 'cta'];

export function bindDisplayBreaks(html: string): string {
  const classAlt = DISPLAY_CLASSES.join('|');
  // Matches one display element and its full inner markup, non-greedily.
  const re = new RegExp(
    `(<([a-z][a-z0-9]*)\\s[^>]*\\bclass="[^"]*\\b(?:${classAlt})\\b[^"]*"[^>]*>)([\\s\\S]*?)(</\\2\\s*>)`,
    'gi',
  );
  return html.replace(re, (_m, open: string, _tag: string, inner: string, close: string) => {
    // Bind each text node separately so tags (the emphasis wrap especially)
    // stay exactly where they were.
    const bound = inner.replace(/>([^<]+)</g, (_s, t: string) => `>${bindLineBreaks(t)}<`);
    const head = bound.startsWith('<') ? bound : bound.replace(/^([^<]+)/, (t) => bindLineBreaks(t));
    const full = head.endsWith('>') ? head : head.replace(/([^>]+)$/, (t) => bindLineBreaks(t));
    return `${open}${full}${close}`;
  });
}
