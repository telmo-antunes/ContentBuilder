/**
 * WHERE A HEADLINE BREAKS.
 *
 * The browser breaks at whatever space is nearest the edge, which is how a real
 * deck shipped "Have it looked at by / someone who does / this for a living."
 * A line ending on "by" or "at" reads as a mistake even to someone who could
 * not say why.
 *
 * ── What was tried first, and why it was wrong ──────────────────────────────
 *
 * The obvious fix is to glue the words that must not separate with non-breaking
 * spaces and let the browser choose from what is left. It was implemented, and
 * it made the deck materially worse: gluing chains into long unbreakable runs
 * means a run that does not fit jumps WHOLE to the next line, leaving the
 * previous one short. "Tight beads: healthy." became "Tight" alone on its own
 * line, because "beads:_healthy." was a 15-character atom that would not fit
 * beside it. Slides that had used the full measure started wrapping at ~75%.
 *
 * The reason is structural, not a tuning problem: gluing happens with no
 * knowledge of the rendered line width, so every glue is a guess that can cost
 * more width than the bad break it prevents.
 *
 * ── What is right ──────────────────────────────────────────────────────────
 *
 * `text-wrap: pretty` — the browser does it, at layout, knowing the measure.
 * It fills each line to the available width and only reflows the last few to
 * avoid orphans, which is exactly the trade the hand-rolled version got
 * backwards. Chrome has supported it since 117 and the export renders in
 * Chrome 150.
 *
 * Not `balance`: it equalises line lengths, which deliberately does NOT use the
 * full measure. On a headline already complained about for wrapping short, it
 * is the wrong instrument.
 */

/** Display classes whose typesetting the app owns. */
const PRETTY_CLASSES = ['headline', 'tagline', 'quote', 'stat', 'cta', 'body', 'row'];

/**
 * App-owned typesetting, emitted after the brand sheet.
 *
 * A brand may still override it — this is a default, not a lock. It carries no
 * width, size or family, so it cannot fight anything the recipe authored.
 */
export function slideTypesettingCss(): string {
  const sel = PRETTY_CLASSES.map((c) => `.cb-slide .${c}`).join(',');
  return [
    `${sel}{text-wrap:pretty}`,
    // The slide root too, so copy in an element the brand named something else
    // still gets sensible last-line handling.
    `.cb-slide{text-wrap:pretty}`,
  ].join('\n');
}
