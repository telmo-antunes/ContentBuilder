/**
 * STRUCTURAL LINT for composed slides — the guard that was missing.
 *
 * Every defect in this family shipped the same way: the composer produced
 * markup that was valid, sanitised, on-vocabulary and *structurally wrong*, and
 * nothing looked at it between the model and the user. The verbatim guard
 * checks the COPY survived. The overflow guard and the type floor act at RENDER.
 * Nothing checked the SHAPE of what was authored.
 *
 * The specific things that got through:
 *
 *   · a paragraph that is secretly a list — "Cash in the bank before the work
 *     begins. Repeat visits secured in advance. Slow weeks funded ahead of
 *     time." under a headline that says "Four things". Nothing noticed, and it
 *     shipped as a wall of prose under a headline promising a list.
 *   · invisible leftovers — an element with no content that is not a spacer,
 *     rule, art layer, image slot or list marker, which contributes nothing but
 *     can still take up space.
 *
 * (The empty bullet marker that made lists look broken is deliberately NOT
 * handled here: the render layer owns the marker, and one owner is right.)
 *
 * Repairs here are DETERMINISTIC and conservative: drop an invisible leftover,
 * and nothing else. Anything that would require rewriting copy is reported, not
 * "fixed" — splitting a sentence is the parse step's job, and a linter that
 * quietly rewrites prose is worse than one that complains.
 */

/** Classes whose elements are MEANT to be empty — spacers, rules, art, slots. */
const LEGITIMATELY_EMPTY = /^(fill|rule|divider|hr|scrim|spacer|monogram|logo|glyph|cb-[a-z-]+)$/;

/** Classes that read as a list marker — a bullet, dash, arrow, tick, number. */
const MARKER_HINT = /(^|[-_])(tick|bullet|dot|dash|mark|marker|num|no|check|arrow|caret|chev)([-_]|$)/;

export interface LintFinding {
  kind: 'empty-element-dropped' | 'paragraph-is-a-list';
  detail: string;
}

const classesOf = (attrs: string): string[] => {
  const m = attrs.match(/class\s*=\s*"([^"]*)"/i);
  return m ? m[1]!.trim().split(/\s+/).filter(Boolean) : [];
};

/** Does any class on this element look like a list marker? */
const isMarker = (classes: string[]) => classes.some((c) => MARKER_HINT.test(c));
/** Is this element allowed to carry no content? */
const mayBeEmpty = (classes: string[]) => classes.some((c) => LEGITIMATELY_EMPTY.test(c));

/**
 * Sentence count for a run of copy. Deliberately crude — it only has to notice
 * "three or more full stops" to flag a paragraph that wanted to be a list.
 */
function sentenceCount(text: string): number {
  return text.split(/[.!?](?:\s|$)/).filter((s) => s.trim().length > 8).length;
}

/**
 * Lint and repair one composed fragment.
 *
 * Returns the (possibly repaired) HTML plus what was found, so the caller can
 * log it. Never throws: a linter that can fail a compose is worse than the
 * defects it catches.
 */
export function lintAuthored(
  html: string,
  opts: { hasListVocabulary?: boolean } = {},
): { html: string; findings: LintFinding[] } {
  const findings: LintFinding[] = [];
  if (!html) return { html, findings };
  let out = html;

  // ── empty elements ────────────────────────────────────────────────────
  // Matches an element with nothing (or only whitespace) between its tags.
  out = out.replace(
    /<(span|div|p|em|i|b|strong|small|figcaption)((?:[^>"']|"[^"]*"|'[^']*')*)>\s*<\/\1\s*>/gi,
    (whole, tag: string, attrs: string) => {
      const classes = classesOf(attrs);
      // A marker element is LEFT ALONE. It is legitimately empty: the render
      // layer owns the bullet now (it hides an empty marker and supplies the
      // glyph in the row's own gutter), so filling it here would be a second
      // owner for the same decision — and the composer's contract already
      // treats these spans as decorative.
      if (isMarker(classes) || mayBeEmpty(classes)) return whole;
      findings.push({
        kind: 'empty-element-dropped',
        detail: classes.length ? `<${tag} class="${classes.join(' ')}">` : `<${tag}>`,
      });
      return '';
    },
  );

  // ── a paragraph that is secretly a list ───────────────────────────────
  // Reported only. Splitting the copy is the parse step's decision, and this
  // linter must never invent or re-order a sentence.
  if (opts.hasListVocabulary) {
    for (const m of out.matchAll(/<(?:p|div)[^>]*class="[^"]*\b(?:body|lead|sub)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/gi)) {
      const text = (m[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const n = sentenceCount(text);
      if (n >= 3) {
        findings.push({
          kind: 'paragraph-is-a-list',
          detail: `${n} sentences in one paragraph — this wanted rows: "${text.slice(0, 70)}…"`,
        });
      }
    }
  }

  return { html: out, findings };
}
