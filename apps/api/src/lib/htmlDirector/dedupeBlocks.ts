/**
 * TWO MORE MECHANICAL COMPOSE GUARDS — cheap, deterministic, no model.
 *
 * The composer is a typesetter: it arranges already-written copy. Twice now it
 * has been caught saying the same thing twice on one slide — a paragraph AND a
 * panel of rows carrying the identical sentences:
 *
 *   <div class="body">Cash in the bank. Repeat visits secured.</div>
 *   <div class="panel"><div class="row">Cash in the bank.</div>…</div>
 *
 * Both render, so the slide holds double the copy its box allows and the two
 * collide. The existing VERBATIM guard cannot see it: it only checks each part's
 * copy SURVIVES, and copy appearing twice survives twice over.
 *
 *   Guard A (`dedupeBlocks`)    — a top-level block whose visible text is
 *                                 contained in another block's is redundant;
 *                                 drop it, keeping the richer expression.
 *   Guard B (`stripEmptyInline`) — remove inline elements left with nothing in
 *                                 them (the `<em></em>` stubs of a row's unused
 *                                 trailing note).
 *
 * Both are pure string work (no DOM, like `reparse.ts` and `htmlSanitize.ts`),
 * information-preserving — Guard A only ever removes a block whose text still
 * appears elsewhere in the fragment — and report what they did so the caller can
 * log it.
 */

// ── The recipe vocabulary these guards are derived from ─────────────────────
//
// Not guessed: every class below is one the real recipes actually define.
//   · apps/api/src/lib/htmlDirector/recipes.ts — the two hand-authored reference
//     recipes' `components` lists (dynatós: logo, eyebrow, headline[.sm],
//     tagline, rule, body, quote[.em], attr, cta, handle, fill · detailmasters:
//     logo-row, monogram, wordmark, eyebrow, headline[.sm, .it], rule, body,
//     stat, panel[.row, .tick, <em>], cta, handle, fill).
//   · packages/shared/src/recipe.ts `ORDER` — the reveal groups every recipe is
//     animated by (.logo/.logo-row/.wordmark/.monogram, .eyebrow, .cb-shot,
//     .headline/.quote, .stat/.rule, .tagline/.body/.panel, .attr, .cta, .handle).
//   · apps/api/src/lib/htmlDirector/reparse.ts `CLASS_TO_PART` — which classes
//     carry a copy PART (eyebrow, headline, tagline, body, quote, attr, stat,
//     cta, handle).
//   · apps/api/src/lib/htmlDirector/authorRecipe.ts — the vocabulary every
//     AI-authored recipe is required to define: "eyebrow, headline + a .sm
//     variant, body, a tagline or quote, a rule, a cta button, a handle, a stat,
//     … a .panel plus a .row for one enumerated item …, a logo/wordmark, a .fill
//     spacer".

/**
 * Classes that carry the slide's VOICE, its brand furniture or its structure.
 * A block wearing any of these is never dropped, whatever it duplicates — this
 * is the hard gate that keeps Guard A from ever removing a headline, an eyebrow,
 * a CTA, a quote, the brand's signature tagline or a panel of rows.
 * (Modifier/child classes — sm, it, em, row, tick — are listed too: a top-level
 * block wearing one is not a plain prose paragraph.)
 */
const VOICE_CLASSES = new Set([
  'logo', 'logo-row', 'wordmark', 'monogram',
  'eyebrow', 'headline', 'sm', 'quote', 'em', 'it',
  'stat', 'rule', 'tagline', 'panel', 'row', 'tick',
  'attr', 'cta', 'handle', 'fill', 'cb-shot',
]);

/**
 * The prose classes — the ONLY blocks Guard A may drop. `body` is the single
 * paragraph class in the reference recipes ("Supporting sentence(s), muted") and
 * the one every authored recipe is told to define; a hallucinated or
 * unrecognised class is deliberately NOT treated as prose (it might be another
 * brand's headline).
 */
const PROSE_CLASSES = new Set(['body']);

/** Tags a classless block must have to count as paragraph-ish prose. */
const PROSE_TAGS = new Set(['p', 'div']);

/** The flex-grow spacer, per both recipes' `components` ("an empty spacer div"). */
const SPACER_CLASSES = new Set(['fill']);

/**
 * Inline text elements Guard B may remove when they are empty — the inline
 * subset of `htmlSanitize`'s ALLOWED_TAGS. Block/structural tags (div, p,
 * figure, …) are never touched: that is where the legitimately-empty elements
 * live (`.rule`, `.fill`, `.monogram`, `.logo`, a `data-cb-slot` figure).
 */
const INLINE_TAGS = ['em', 'i', 'b', 'strong', 'span', 'small', 'sup', 'sub', 'u'];

/** Text shorter than this never counts as duplication (an eyebrow echoing a word). */
const MIN_DUP_TEXT = 25;

/** Elements that never open a nesting level. */
const VOID_TAGS = new Set(['br', 'hr', 'img']);

/** One HTML tag: [1] leading slash, [2] name, [3] attribute string. */
const TAG_SRC = '<(/?)([a-zA-Z][\\w:-]*)((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>';

// ── Blocks ──────────────────────────────────────────────────────────────────

/** One top-level element of a slide fragment. */
export interface SlideBlock {
  /** Position among the fragment's top-level blocks. */
  order: number;
  /** `[start, end)` — offsets into the fragment covering the whole element. */
  start: number;
  end: number;
  tag: string;
  classes: string[];
  html: string;
  /** Visible text: tags/entities out, whitespace collapsed, lowercased, trailing punctuation trimmed. */
  text: string;
  /** `text` with all whitespace removed — the containment compare key. */
  key: string;
  /** How much internal structure it has: text-bearing descendants (a .panel of 4 .rows → 4). */
  structure: number;
  /** A short human label for logs, e.g. `div.body`. */
  label: string;
}

/**
 * Split a fragment into its TOP-LEVEL elements (depth tracked, so a `.panel` and
 * all its rows come back as one block). Stray text and void elements between
 * blocks are not returned — they are simply left alone by every caller, which
 * rebuilds by slicing the original string.
 */
export function topLevelBlocks(html: string): SlideBlock[] {
  const re = new RegExp(TAG_SRC, 'g');
  const out: SlideBlock[] = [];
  let depth = 0;
  let start = -1;
  let tag = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = (m[2] ?? '').toLowerCase();
    const attrs = m[3] ?? '';
    if (m[1] === '/') {
      if (depth === 0) continue; // stray closing tag
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const end = m.index + m[0].length;
        out.push(makeBlock(out.length, start, end, tag, html.slice(start, end)));
        start = -1;
      }
      continue;
    }
    if (VOID_TAGS.has(name) || /\/\s*$/.test(attrs)) continue; // self-closing / void
    if (depth === 0) {
      start = m.index;
      tag = name;
    }
    depth += 1;
  }
  return out;
}

function makeBlock(order: number, start: number, end: number, tag: string, html: string): SlideBlock {
  const classes = classesOf(html);
  const text = blockText(html);
  return {
    order,
    start,
    end,
    tag,
    classes,
    html,
    text,
    key: text.replace(/\s+/g, ''),
    structure: structureOf(html),
    label: tag + classes.map((c) => `.${c}`).join(''),
  };
}

/** The classes on an element's OWN opening tag. */
function classesOf(elHtml: string): string[] {
  const attrs = elHtml.match(new RegExp(`^${TAG_SRC}`))?.[3] ?? '';
  const cls =
    attrs.match(/\bclass\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/\bclass\s*=\s*'([^']*)'/i)?.[1] ?? '';
  return cls
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** An element's inner markup (everything between its own start and end tags). */
function innerOf(elHtml: string): string {
  const open = elHtml.match(new RegExp(`^${TAG_SRC}`));
  if (!open) return elHtml;
  const from = open[0].length;
  const close = elHtml.lastIndexOf('</');
  return close > from ? elHtml.slice(from, close) : elHtml.slice(from);
}

/**
 * How richly a block expresses its copy: the number of text-bearing descendant
 * elements. A `.panel` of four `.row`s scores 4; a flat `.body` paragraph scores
 * 0 — which is exactly the preference the real bug needs ("a panel of rows beats
 * a paragraph").
 */
function structureOf(elHtml: string): number {
  let n = 0;
  for (const child of topLevelBlocks(innerOf(elHtml))) {
    if (child.text) n += 1;
    n += structureOf(child.html);
  }
  return n;
}

/** Entities the composer's copy actually contains (same set as `reparse.ts`, plus nbsp). */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * A block's comparable visible text. Tags become spaces (so a panel's rows do
 * not run together into "begins.repeat"), entities are decoded, whitespace
 * collapses, case is dropped and trailing punctuation is trimmed — a paragraph
 * ending in "." must still match rows that do not.
 */
export function blockText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\s.,;:!?…"'’”)\]}]+$/u, '');
}

// ── Guard A — drop duplicated copy ──────────────────────────────────────────

/** A block Guard A removed, and what it was redundant against. */
export interface DroppedBlock {
  label: string;
  text: string;
  /** The block that survives and still carries this copy. */
  keptLabel: string;
  /** Set when the block went only because it left two adjacent `.fill` spacers. */
  spacer?: true;
}

/** Prose: `.body`, or a classless paragraph-ish element. Never a voice block. */
function isProse(b: SlideBlock): boolean {
  if (b.classes.some((c) => VOICE_CLASSES.has(c))) return false;
  if (b.classes.some((c) => PROSE_CLASSES.has(c))) return true;
  return b.classes.length === 0 && PROSE_TAGS.has(b.tag);
}

function isSpacer(b: SlideBlock): boolean {
  return !b.text && b.classes.some((c) => SPACER_CLASSES.has(c));
}

/**
 * Which of two related blocks is redundant, or undefined if their copy is
 * unrelated. On identical text the richer expression wins (tie → the earlier
 * block); on containment the block whose text is wholly inside the other's is
 * the redundant one, so dropping it can never lose copy.
 */
function redundantOf(a: SlideBlock, b: SlideBlock): { loser: SlideBlock; winner: SlideBlock } | undefined {
  if (a.key === b.key) {
    // Identical copy. Lose the plain prose restatement whichever way round it was
    // written — a headline must never go in favour of a body. Then the thinner
    // expression (a paragraph loses to a panel of rows), then the later block.
    if (isProse(a) !== isProse(b)) return isProse(a) ? { loser: a, winner: b } : { loser: b, winner: a };
    if (b.structure > a.structure) return { loser: a, winner: b };
    return { loser: b, winner: a };
  }
  if (a.key.includes(b.key)) return { loser: b, winner: a };
  if (b.key.includes(a.key)) return { loser: a, winner: b };
  return undefined;
}

/**
 * Drop top-level blocks whose copy is already said elsewhere on the slide.
 *
 * Deliberately narrow: the loser must be a plain prose block (`.body` or a
 * classless paragraph) and its text must survive in the winner, so the slide's
 * primary voice is untouchable and no copy is ever lost. Returns the input
 * string unchanged (byte-identical) when there is nothing to drop.
 */
export function dedupeBlocks(html: string): { html: string; dropped: DroppedBlock[] } {
  const blocks = topLevelBlocks(html);
  if (blocks.length < 2) return { html, dropped: [] };

  const dropped = new Map<number, DroppedBlock>();
  const candidates = blocks.filter((b) => b.text.length >= MIN_DUP_TEXT);
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (dropped.has(a.order) || dropped.has(b.order)) continue;
      const rel = redundantOf(a, b);
      if (!rel || !isProse(rel.loser)) continue;
      dropped.set(rel.loser.order, {
        label: rel.loser.label,
        text: rel.loser.text,
        keptLabel: rel.winner.label,
      });
    }
  }
  if (!dropped.size) return { html, dropped: [] };

  // Removing a block can leave two spacers back to back, which is no longer a
  // bottom-anchor but a hole. Collapse only spacers that became adjacent BECAUSE
  // of a removal, and only ever the later of the pair — anything else is left be.
  const kept = blocks.filter((b) => !dropped.has(b.order));
  for (let i = 1; i < kept.length; i += 1) {
    const prev = kept[i - 1]!;
    const cur = kept[i]!;
    if (!isSpacer(prev) || !isSpacer(cur)) continue;
    if (cur.order - prev.order < 2) continue; // already adjacent before the drop
    dropped.set(cur.order, { label: cur.label, text: '', keptLabel: prev.label, spacer: true });
  }

  // Rebuild by slicing the original, so every surviving byte is untouched. A
  // block that sits on its own line takes that whole line (indent + newline)
  // with it; otherwise only the element itself goes.
  let out = '';
  let cursor = 0;
  for (const b of blocks) {
    if (!dropped.has(b.order)) continue;
    let from = b.start;
    let to = b.end;
    let f = from;
    while (f > 0 && /[ \t]/.test(html[f - 1]!)) f -= 1;
    let t = to;
    while (t < html.length && /[ \t]/.test(html[t]!)) t += 1;
    const ownLine = (f === 0 || html[f - 1] === '\n') && (t >= html.length || html[t] === '\n' || html[t] === '\r');
    if (ownLine) {
      from = Math.max(f, cursor);
      to = t;
      if (html[to] === '\r') to += 1;
      if (html[to] === '\n') to += 1;
    }
    out += html.slice(cursor, from);
    cursor = to;
  }
  out += html.slice(cursor);
  return { html: out.trim(), dropped: [...dropped.values()] };
}

// ── Guard B — strip empty inline elements ───────────────────────────────────

const EMPTY_INLINE = new RegExp(
  `<(${INLINE_TAGS.join('|')})\\s*>((?:\\s|&nbsp;|&#160;|&#xa0;)*)</\\1\\s*>`,
  'gi',
);

/**
 * Remove inline elements with nothing in them — `<em></em>`, `<span></span>`,
 * `<b> </b>` — the stubs a composer leaves where a row's optional note went
 * unused.
 *
 * Only ATTRIBUTE-LESS inline tags are matched (`<em\s*>`), so everything that is
 * legitimately empty by design survives: it always carries a class or a slot
 * attribute in the real recipes — `<span class="tick">`, `.rule`, `.fill`,
 * `.monogram`, `.logo`, and `<figure class="cb-shot" data-cb-slot="…">`.
 */
export function stripEmptyInline(html: string): { html: string; stripped: number } {
  let out = html;
  let stripped = 0;
  // Loop so a nested stub (`<span><em></em></span>`) collapses fully; bounded.
  for (let pass = 0; pass < 5; pass += 1) {
    let hits = 0;
    out = out.replace(EMPTY_INLINE, () => {
      hits += 1;
      return '';
    });
    stripped += hits;
    if (!hits) break;
  }
  return { html: out, stripped };
}

// ── Both guards ─────────────────────────────────────────────────────────────

export interface PruneResult {
  html: string;
  dropped: DroppedBlock[];
  /** How many empty inline elements Guard B removed. */
  strippedInline: number;
}

/**
 * Run both guards over a composed, sanitised slide fragment. Guard B first, so
 * Guard A compares (and keeps) already-clean markup. A fragment with nothing
 * wrong with it comes back byte-identical.
 */
export function pruneSlideMarkup(html: string): PruneResult {
  if (!html) return { html, dropped: [], strippedInline: 0 };
  const inline = stripEmptyInline(html);
  const deduped = dedupeBlocks(inline.html);
  return { html: deduped.html, dropped: deduped.dropped, strippedInline: inline.stripped };
}
