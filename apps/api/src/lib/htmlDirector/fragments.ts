/**
 * COMPOSE BY EXAMPLE — the recipe's own reference fragments, and the
 * deterministic substitution that fills them.
 *
 * THE PROBLEM. Every slide used to be GENERATED from scratch by a cheap model
 * following prose rules ("use only these classes", "follow this pattern", "omit
 * the element when a part is absent"). The recipe already fixed the LOOK; what
 * it could not fix was the STRUCTURE, so class invention, arrangement drift and
 * the same copy said twice were permanent risks, mitigated only by a stack of
 * mechanical guards downstream.
 *
 * THE FIX. The design-tier author — the expensive, once-per-brand call that
 * already writes the CSS — also writes ONE worked slide per role, in the brand's
 * own classes, with the copy replaced by placeholders. A deck is then composed
 * by SUBSTITUTION: fill the holes with the parse step's verbatim copy. No model,
 * no invention, no drift. A deck whose every role has a usable fragment costs
 * exactly one model call (the parse) for the whole deck.
 *
 * THE PLACEHOLDER CONVENTION (mustache-ish; plain text, so it survives the
 * sanitiser untouched — there is no attribute to smuggle it in):
 *
 *   {{eyebrow}} {{headline}} {{tagline}} {{body}} {{quote}}
 *   {{attribution}} {{stat}} {{cta}} {{handle}}      one hole per copy part
 *   {{#rows}} … {{row.text}} … {{row.note}} … {{/rows}}   the REPEATED unit
 *
 * and three rules that fall out of it:
 *
 *   · THE ELEMENT AROUND A HOLE BELONGS TO IT. When a part is absent, the
 *     innermost element enclosing its placeholder is removed whole — which is
 *     the composer's existing instruction ("if a copy part is absent, omit its
 *     element") made mechanical.
 *   · THERE IS NO {{emphasis}}. The signature's headline accent is a SUB-phrase
 *     of the headline, wrapped mechanically after the fact by
 *     `ensureEmphasisWrap`; a hole for it would print the phrase twice.
 *   · A SLOT IS CONDITIONAL. `<figure class="cb-shot" data-cb-slot="…">` is kept
 *     verbatim on a slide that holds a photograph and removed on one that does
 *     not, so a single fragment per role serves both.
 *
 * ANYTHING THIS CANNOT EXPRESS FALLS BACK to the model compose for that slide
 * alone — see `substituteFragment`, which returns undefined rather than
 * producing a slide that lost copy.
 */
import {
  RECIPE_REVEAL_ORDER,
  RECIPE_STRUCTURAL_CLASSES,
  SLIDE_ROLES,
  SLOT_ATTR,
  authoredSlots,
  recipeEmphasisWrap,
  recipePatternVariant,
  type BrandRecipe,
} from '@contentbuilder/shared';
import { sanitizeAuthoredHtml } from '../htmlSanitize';
import type { ComposeParts, ComposeSlideInput } from './prompt';

// ── Shared markup helpers ───────────────────────────────────────────────────
//
// Used by BOTH sides of this feature: the author-time fragment validator below
// and `compose.ts`'s reply digester. They live here rather than in compose.ts
// because compose.ts imports this module (and not the other way round).

/** Strip markdown fences / stray prose around an HTML fragment. */
export function stripFences(text: string): string {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

/**
 * The stored fragment must be the INNER markup of `.cb-slide` (the renderer adds
 * the wrapper). Models sometimes wrap their output in the full
 * `<div class="cb-slide …">…</div>` anyway — which double-wraps at render and,
 * worse, makes the whole slide one un-editable block. Strip a sole outer wrapper.
 */
export function unwrapCbSlide(html: string): string {
  const t = html.trim();
  const m = t.match(/^<div\s+class="[^"]*\bcb-slide\b[^"]*"\s*>([\s\S]*)<\/div>$/i);
  return m ? m[1]!.trim() : t;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── The convention, as constants ────────────────────────────────────────────

/**
 * The copy parts a fragment may carry a hole for. Deliberately NOT `emphasis`
 * (a sub-phrase of the headline — see the header) and not `rows` (a repeated
 * unit, which needs the section form below).
 */
export const FRAGMENT_PARTS = [
  'eyebrow',
  'headline',
  'tagline',
  'body',
  'quote',
  'attribution',
  'stat',
  'cta',
  'handle',
] as const;
export type FragmentPart = (typeof FRAGMENT_PARTS)[number];

export const ROWS_OPEN = '{{#rows}}';
export const ROWS_CLOSE = '{{/rows}}';
export const ROW_TEXT = '{{row.text}}';
export const ROW_NOTE = '{{row.note}}';

/** Every `{{…}}` token a valid fragment may contain. */
const KNOWN_TOKENS = new Set<string>([
  ...FRAGMENT_PARTS,
  '#rows',
  '/rows',
  'row.text',
  'row.note',
]);

/** One `{{…}}` hole. Whitespace inside the braces is normalised away first. */
const TOKEN_RE = /\{\{([^{}]*)\}\}/g;

/**
 * THE CONVENTION, IN THE WORDS THE AUTHOR PROMPT USES. Stated once, here, so
 * the prompt that asks for fragments and the code that validates them can never
 * describe different things. Module-level and constant — it renders inside the
 * author's cached SYSTEM prefix, so its bytes must not vary per call.
 */
export const FRAGMENT_CONVENTION = `Each fragment is the inner markup of .cb-slide for ONE slide of that role, written with THIS brand's component classes exactly as you would compose it by hand — but with the words replaced by placeholders:
- {{eyebrow}} {{headline}} {{tagline}} {{body}} {{quote}} {{attribution}} {{stat}} {{cta}} {{handle}} — one hole per copy part, each used AT MOST ONCE, spelled exactly like that (no spaces inside the braces).
- A repeated list unit is wrapped in a section: ${ROWS_OPEN}<the markup for ONE row, containing ${ROW_TEXT} and optionally ${ROW_NOTE}>${ROWS_CLOSE}. The app repeats what is between the markers once per row.
- NO {{emphasis}} placeholder. The signature's headline accent is a sub-phrase of the headline and the app wraps it inside {{headline}} for you; a hole for it would print the phrase twice.
- The ELEMENT AROUND A HOLE BELONGS TO IT: when a slide has no copy for a part, the app removes that placeholder's innermost enclosing element whole. So put every hole inside its own element (<div class="eyebrow">{{eyebrow}}</div>), never two parts in one element.
- Put a photo slot in any role whose slides can carry a photograph, exactly as the composer would: <figure class="cb-shot" data-cb-slot="hero"></figure>. It is kept on a slide that holds a picture and removed on one that does not.
- Use ONLY the classes you list in "components" (plus the structural ones: fill, row, tick, sm, em, it, cb-shot). A fragment naming any other class is thrown away, and its role falls back to a slower, less predictable per-slide model call.
ILLUSTRATIVE SHAPE ONLY — write YOUR brand's classes, YOUR arrangement, one fragment per role and each following that role's composition pattern:
  <div class="eyebrow">{{eyebrow}}</div>
  <div class="headline">{{headline}}</div>
  <div class="rule"></div>
  <div class="body">{{body}}</div>
  <div class="fill"></div>
  <div class="panel">${ROWS_OPEN}<div class="row"><span class="tick"></span>${ROW_TEXT}<em>${ROW_NOTE}</em></div>${ROWS_CLOSE}</div>`;

// ── A tiny element scanner ──────────────────────────────────────────────────

/** One HTML tag: [1] leading slash, [2] name, [3] attribute string. */
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const VOID_TAGS = new Set(['br', 'hr', 'img']);

interface ElementSpan {
  /** `[start, end)` — offsets covering the whole element, open tag to close tag. */
  start: number;
  end: number;
}

/**
 * Every element in a fragment, nested ones included, as `[start, end)` ranges.
 * Pure string work (no DOM), exactly like `dedupeBlocks.ts` and `htmlSanitize.ts`
 * — this runs on already-sanitised markup, so the tags are well-formed enough
 * for a stack.
 */
function elementSpans(html: string): ElementSpan[] {
  const out: ElementSpan[] = [];
  const open: number[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    const name = (m[2] ?? '').toLowerCase();
    const attrs = m[3] ?? '';
    if (m[1] === '/') {
      const start = open.pop();
      if (start !== undefined) out.push({ start, end: m.index + m[0].length });
      continue;
    }
    if (VOID_TAGS.has(name) || /\/\s*$/.test(attrs)) continue; // void / self-closing
    open.push(m.index);
  }
  return out;
}

/** The innermost element containing `pos`, or undefined when it sits at top level. */
function innermostAt(html: string, pos: number): ElementSpan | undefined {
  let best: ElementSpan | undefined;
  for (const span of elementSpans(html)) {
    if (span.start < pos && pos < span.end && (!best || span.start > best.start)) best = span;
  }
  return best;
}

/** Remove `[start, end)`. */
function cut(html: string, start: number, end: number): string {
  return html.slice(0, start) + html.slice(end);
}

/** Any `{{…}}` hole at all (non-global, so `.test` has no lastIndex state). */
const ANY_TOKEN = /\{\{[^{}]*\}\}/;

/**
 * The element that may be removed on behalf of the hole at `[from, to)`, if any.
 *
 * REFUSED when that element ALSO holds another hole. "The element around a hole
 * belongs to it" is only safe while the element is that hole's alone: an author
 * who packs two parts into one `<div>` must not lose the part that IS present
 * because its neighbour was absent. In that case only the token itself goes.
 */
function ownerToDrop(html: string, from: number, to: number): ElementSpan | undefined {
  const owner = innermostAt(html, from);
  if (!owner || owner.end < to) return undefined;
  const rest = html.slice(owner.start, from) + html.slice(to, owner.end);
  return ANY_TOKEN.test(rest) ? undefined : owner;
}

/**
 * Remove the element that owns the token at `[from, to)` — or just the token
 * when it has no enclosing element (a hole at the fragment's top level) or that
 * element is shared with another hole.
 */
function dropOwner(html: string, from: number, to: number): string {
  const owner = ownerToDrop(html, from, to);
  return owner ? cut(html, owner.start, owner.end) : cut(html, from, to);
}

/** Squeeze the blank lines an element removal leaves behind. */
function tidy(html: string): string {
  return html
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// ── Author-time validation ──────────────────────────────────────────────────

/** A fragment that was thrown away, and why. */
export interface DroppedFragment {
  role: string;
  reason: string;
}

/** Normalise `{{  headline }}` → `{{headline}}` so everything downstream is exact. */
function normalizeTokens(html: string): string {
  return html.replace(TOKEN_RE, (_all, name: string) => `{{${name.trim()}}}`);
}

/** Every class token the markup actually uses. */
function classesUsed(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\bclass\s*=\s*"([^"]*)"/gi)) {
    for (const token of (m[1] ?? '').trim().split(/\s+/)) if (token) out.push(token.toLowerCase());
  }
  return out;
}

/** The classes a fragment may name: the recipe's own vocabulary + the structural set. */
function allowedClasses(recipe: BrandRecipe): Set<string> {
  const out = new Set<string>(RECIPE_STRUCTURAL_CLASSES);
  for (const c of recipe.components) {
    for (const token of c.className.trim().split(/\s+/)) if (token) out.add(token.toLowerCase());
  }
  out.add(recipeEmphasisWrap(recipe).className.toLowerCase());
  return out;
}

/** Count non-overlapping occurrences of a literal. */
function countOf(html: string, needle: string): number {
  let n = 0;
  let at = html.indexOf(needle);
  while (at !== -1) {
    n += 1;
    at = html.indexOf(needle, at + needle.length);
  }
  return n;
}

const ROLES = new Set<string>(SLIDE_ROLES);

/**
 * Check ONE fragment. Returns the cleaned markup to store, or the reason it is
 * unusable. The markup is sanitised with the SAME allowlist a composed slide
 * goes through, so a fragment can never carry something a model reply could not.
 */
export function checkFragment(
  recipe: BrandRecipe,
  role: string,
  raw: string,
): { html: string } | { reason: string } {
  if (!ROLES.has(role)) return { reason: 'not a slide role' };
  const html = normalizeTokens(sanitizeAuthoredHtml(unwrapCbSlide(stripFences(String(raw ?? '')))));
  if (!html) return { reason: 'empty after sanitising' };

  // 1. Only known holes, each at most once.
  const seen = new Set<string>();
  for (const m of html.matchAll(TOKEN_RE)) {
    const name = (m[1] ?? '').trim();
    if (!KNOWN_TOKENS.has(name)) return { reason: `unknown placeholder {{${name}}}` };
    if (seen.has(name)) return { reason: `{{${name}}} appears more than once` };
    seen.add(name);
  }

  // 2. The rows section is well-formed, and the row holes live inside it.
  const open = html.indexOf(ROWS_OPEN);
  const close = html.indexOf(ROWS_CLOSE);
  if ((open === -1) !== (close === -1)) return { reason: 'unbalanced {{#rows}} section' };
  if (open !== -1) {
    if (close < open + ROWS_OPEN.length) return { reason: 'unbalanced {{#rows}} section' };
    const unit = html.slice(open + ROWS_OPEN.length, close);
    if (!unit.includes(ROW_TEXT)) return { reason: '{{#rows}} section carries no {{row.text}}' };
    if (!unit.includes(ROW_NOTE) && html.includes(ROW_NOTE)) {
      return { reason: '{{row.note}} sits outside the {{#rows}} section' };
    }
  } else if (html.includes(ROW_TEXT) || html.includes(ROW_NOTE)) {
    return { reason: 'row placeholder outside a {{#rows}} section' };
  }

  // 3. Only classes this recipe advertises (the fragment twin of
  //    `validateRecipeConsistency` dropping components the CSS never defines).
  const allowed = allowedClasses(recipe);
  for (const cls of classesUsed(html)) {
    if (!allowed.has(cls)) return { reason: `uses undefined class .${cls}` };
  }

  // 4. At most the two slots SLIDE_AUTHOR_INSTRUCTIONS allows ("usually ONE").
  if (authoredSlots(html).length > 2) return { reason: 'more than two photo slots' };
  if (countOf(html, SLOT_ATTR) !== authoredSlots(html).length) {
    return { reason: 'a photo slot has a duplicate or unusable name' };
  }

  return { html };
}

/**
 * Hold a recipe's fragments to the same standard as its components: whatever
 * cannot be used is DROPPED with a warning, and the recipe stays valid. A brand
 * whose every fragment is thrown away simply composes the way it always has.
 *
 * Deterministic: no model call, no judgement.
 */
export function validateRecipeFragments(recipe: BrandRecipe): {
  recipe: BrandRecipe;
  dropped: DroppedFragment[];
} {
  const raw = recipe.fragments;
  if (!raw || !Object.keys(raw).length) return { recipe, dropped: [] };

  const kept: Record<string, string> = {};
  const dropped: DroppedFragment[] = [];
  for (const [role, fragment] of Object.entries(raw)) {
    const checked = checkFragment(recipe, role, fragment);
    if ('reason' in checked) dropped.push({ role, reason: checked.reason });
    else kept[role] = checked.html;
  }
  if (!dropped.length && Object.entries(kept).every(([r, h]) => raw[r] === h)) {
    return { recipe, dropped };
  }
  const next: BrandRecipe = { ...recipe };
  if (Object.keys(kept).length) next.fragments = kept;
  else delete next.fragments;
  return { recipe: next, dropped };
}

// ── Filling the gaps a fragment was authored without ────────────────────────

/**
 * A FRAGMENT WITH A MISSING HOLE COSTS A MODEL CALL, EVERY TIME.
 *
 * Substitution is all-or-nothing on purpose: a fragment with no `{{tagline}}`
 * cannot carry a slide that has a tagline without silently dropping it, so the
 * whole slide falls back to the composer. That is the right call and the wrong
 * outcome — on one real brand, three of nine slides took the slow path because
 * the recipe's `list` fragment was authored without a `{{tagline}}` and its
 * `cta` without a `{{body}}`. The arrangement was fine. It just had one fewer
 * hole than the copywriter turned out to need.
 *
 * So the gaps are filled in, deterministically:
 *
 *   · the ELEMENT is the brand's own — `<div class="tagline">{{tagline}}</div>`,
 *     using the class the recipe already advertises for that part. Nothing new
 *     is invented, and a part whose class this brand does not define is skipped.
 *   · the POSITION comes from the role's own composition pattern ("eyebrow →
 *     headline → rule → body → fill → panel"), so the hole lands where this
 *     brand said that part goes. With no pattern, the shared reveal order
 *     decides, which is the same fallback `spliceMissingParts` uses.
 *   · anything that would change what the fragment ALREADY says is refused: an
 *     existing hole is never moved, and a fragment that fails re-validation is
 *     discarded whole rather than repaired badly.
 *
 * No model. No new vocabulary. The brand's own classes, in the brand's own
 * order, in the gaps its author happened to leave.
 */
/** Which class carries which part — the fragment twin of compose's PART_TO_CLASS. */
const PART_CLASS: Record<FragmentPart, string> = {
  eyebrow: 'eyebrow',
  headline: 'headline',
  tagline: 'tagline',
  body: 'body',
  quote: 'quote',
  attribution: 'attr',
  stat: 'stat',
  cta: 'cta',
  handle: 'handle',
};

/** The class order this role's fragment should follow, most specific first. */
function fragmentOrder(recipe: BrandRecipe, role: string): string[] {
  const order: string[] = [];
  const pattern = recipePatternVariant(recipe, '1080x1350', role, 0);
  if (pattern) {
    for (const token of pattern.slice(pattern.indexOf(':') + 1).split('→')) {
      const name = token.trim().toLowerCase().match(/^[a-z][\w-]*/)?.[0];
      if (name && !order.includes(name)) order.push(name);
    }
  }
  for (const sel of RECIPE_REVEAL_ORDER.flat()) {
    const cls = sel.replace(/^\./, '');
    if (!order.includes(cls)) order.push(cls);
  }
  return order;
}

/** Does this recipe advertise a component whose FIRST class is `cls`? */
function definesClass(recipe: BrandRecipe, cls: string): boolean {
  return recipe.components.some((c) => c.className.trim().split(/\s+/)[0] === cls);
}

/**
 * The TOP-LEVEL element ranges of a fragment, with the classes each wears — a
 * nested `.row` inside a `.panel` is part of the panel, not a position of its
 * own, so a hole is never inserted between a list and its items.
 */
function topLevel(html: string): Array<{ start: number; end: number; classes: string[] }> {
  const spans = elementSpans(html);
  return spans
    .filter((span) => !spans.some((o) => o.start < span.start && span.end <= o.end))
    .map((span) => {
      const open = html.slice(span.start, html.indexOf('>', span.start) + 1);
      const m = open.match(/\bclass\s*=\s*"([^"]*)"/i);
      return { ...span, classes: (m?.[1] ?? '').trim().split(/\s+/).filter(Boolean) };
    })
    .sort((a, b) => a.start - b.start);
}

export interface FragmentRepair {
  role: string;
  /** The parts a hole was added for. */
  added: string[];
}

/**
 * Add the missing holes to ONE fragment. Returns the fragment unchanged when
 * there is nothing to add, nothing to add it with, or the result would not
 * re-validate.
 */
export function fillFragmentGaps(
  recipe: BrandRecipe,
  role: string,
  fragment: string,
  wanted: readonly FragmentPart[],
): { html: string; added: string[] } {
  const missing = wanted.filter(
    (p) => !fragment.includes(`{{${p}}}`) && definesClass(recipe, PART_CLASS[p]),
  );
  if (!missing.length) return { html: fragment, added: [] };

  const order = fragmentOrder(recipe, role);
  const rankOf = (cls: string) => {
    const i = order.indexOf(cls);
    return i === -1 ? order.length : i;
  };

  let html = fragment;
  const added: string[] = [];
  // Insert least-ranked first so each insertion's position is computed against
  // markup that already holds everything that comes before it.
  for (const part of [...missing].sort((a, b) => rankOf(PART_CLASS[a]) - rankOf(PART_CLASS[b]))) {
    const cls = PART_CLASS[part];
    const rank = rankOf(cls);
    const blocks = topLevel(html);
    // Before the first block the order places AFTER this part; else at the end.
    let at = html.length;
    for (const block of blocks) {
      const ranks = block.classes.map(rankOf).filter((r) => r < order.length);
      if (ranks.length && Math.min(...ranks) > rank) {
        at = block.start;
        break;
      }
    }
    const el = `<div class="${cls}">{{${part}}}</div>`;
    html = at >= html.length ? `${html}\n${el}` : `${html.slice(0, at)}${el}\n${html.slice(at)}`;
    added.push(part);
  }

  // Re-validate through the same gate a stored fragment goes through. A repair
  // that produces something unusable is not a repair.
  const checked = checkFragment(recipe, role, html);
  if ('reason' in checked) return { html: fragment, added: [] };
  return { html: checked.html, added };
}

/**
 * Every part a role's slides realistically carry. Derived from the role itself
 * rather than from a fixed list, because a `quote` slide has no use for a hole
 * the copywriter will never fill, and each unused hole is one more element the
 * substitution has to remove.
 */
const ROLE_PARTS: Record<string, FragmentPart[]> = {
  cover: ['eyebrow', 'headline', 'tagline', 'body', 'handle'],
  statement: ['eyebrow', 'headline', 'body', 'tagline', 'handle'],
  quote: ['eyebrow', 'quote', 'attribution', 'handle'],
  feature: ['eyebrow', 'headline', 'body', 'tagline', 'handle'],
  stat: ['eyebrow', 'stat', 'tagline', 'body', 'handle'],
  list: ['eyebrow', 'headline', 'body', 'tagline', 'handle'],
  cta: ['eyebrow', 'headline', 'tagline', 'body', 'cta', 'handle'],
};

/**
 * Fill the gaps in every fragment a recipe has. Deterministic and idempotent —
 * a second run adds nothing — so it is safe to apply on read.
 */
export function fillRecipeFragmentGaps(recipe: BrandRecipe): {
  recipe: BrandRecipe;
  repairs: FragmentRepair[];
} {
  const fragments = recipe.fragments;
  if (!fragments || !Object.keys(fragments).length) return { recipe, repairs: [] };

  const next: Record<string, string> = { ...fragments };
  const repairs: FragmentRepair[] = [];
  for (const [role, fragment] of Object.entries(fragments)) {
    const wanted = ROLE_PARTS[role];
    if (!wanted || typeof fragment !== 'string') continue;
    const out = fillFragmentGaps(recipe, role, fragment, wanted);
    if (!out.added.length) continue;
    next[role] = out.html;
    repairs.push({ role, added: out.added });
  }
  if (!repairs.length) return { recipe, repairs: [] };
  return { recipe: { ...recipe, fragments: next }, repairs };
}

// ── Substitution ────────────────────────────────────────────────────────────

/** Fill one row unit: its text, and its note — or the note's element, dropped. */
function fillRow(unit: string, row: { text: string; note?: string }): string {
  let out = unit;
  const noteAt = out.indexOf(ROW_NOTE);
  if (noteAt !== -1) {
    out =
      typeof row.note === 'string' && row.note.length
        ? out.slice(0, noteAt) + escapeHtml(row.note) + out.slice(noteAt + ROW_NOTE.length)
        : dropOwner(out, noteAt, noteAt + ROW_NOTE.length);
  }
  const textAt = out.indexOf(ROW_TEXT);
  if (textAt === -1) return out; // defensive: validation guarantees one is there
  return out.slice(0, textAt) + escapeHtml(row.text) + out.slice(textAt + ROW_TEXT.length);
}

/** Expand (or remove) the `{{#rows}}…{{/rows}}` section. */
function fillRows(html: string, rows: ReadonlyArray<{ text: string; note?: string }>): string {
  const open = html.indexOf(ROWS_OPEN);
  const close = html.indexOf(ROWS_CLOSE);
  if (open === -1 || close === -1) return html;
  const sectionEnd = close + ROWS_CLOSE.length;
  if (!rows.length) {
    // No rows: the panel that was only ever there to hold them goes too, exactly
    // as an absent part takes its element — and under the same restraint, so a
    // panel that also carries a headline keeps it.
    const owner = ownerToDrop(html, open, sectionEnd);
    return owner ? cut(html, owner.start, owner.end) : cut(html, open, sectionEnd);
  }
  const unit = html.slice(open + ROWS_OPEN.length, close).trim();
  const body = rows.map((r) => fillRow(unit, r)).join('\n');
  return html.slice(0, open) + body + html.slice(sectionEnd);
}

/** Fill (or remove) every scalar hole. */
function fillParts(html: string, parts: ComposeParts): string {
  let out = html;
  // Removals first, innermost-owner by innermost-owner, so a value substituted
  // into a sibling can never be swept up by a later element removal.
  for (;;) {
    let removed = false;
    for (const part of FRAGMENT_PARTS) {
      const token = `{{${part}}}`;
      const at = out.indexOf(token);
      if (at === -1) continue;
      const value = parts[part];
      if (typeof value === 'string' && value.length) continue;
      out = dropOwner(out, at, at + token.length);
      removed = true;
      break;
    }
    if (!removed) break;
  }
  for (const part of FRAGMENT_PARTS) {
    const value = parts[part];
    if (typeof value !== 'string' || !value.length) continue;
    const token = `{{${part}}}`;
    const at = out.indexOf(token);
    if (at === -1) continue;
    // Spliced rather than `String.replace`d: a `$&` or `$'` in the copy is a
    // replacement PATTERN to `replace`, and would mangle the words verbatim
    // composition exists to protect.
    out = out.slice(0, at) + escapeHtml(value) + out.slice(at + token.length);
  }
  return out;
}

/** Remove every photo slot — a slide with no picture must leave no hole. */
function dropSlots(html: string): string {
  let out = html;
  for (let guard = 0; guard < 8; guard += 1) {
    const at = out.indexOf(SLOT_ATTR);
    if (at === -1) break;
    const owner = innermostAt(out, at);
    if (!owner) break;
    out = cut(out, owner.start, owner.end);
  }
  return out;
}

/** The copy parts this slide actually carries (rows counted as one). */
function providedParts(parts: ComposeParts): { scalars: FragmentPart[]; rows: boolean } {
  const scalars = FRAGMENT_PARTS.filter((p) => {
    const v = parts[p];
    return typeof v === 'string' && v.length > 0;
  });
  return { scalars, rows: (parts.rows ?? []).length > 0 };
}

/**
 * WHY A SLIDE FALLS BACK TO THE MODEL. Returned instead of a filled fragment so
 * the caller can log it; every one of these means "this fragment cannot express
 * this slide", never "the fragment is bad".
 */
export type FragmentGap =
  | { kind: 'no-fragment' }
  /** A copy part the fragment has no hole for — substituting would LOSE it. */
  | { kind: 'no-placeholder'; part: string }
  /** A photo slide whose fragment leaves no hole for the picture. */
  | { kind: 'no-slot' }
  /** The fill produced nothing usable (an all-absent fragment). */
  | { kind: 'empty' };

export interface FragmentFill {
  html: string;
}

/**
 * Compose ONE slide by substitution, or explain why it cannot be.
 *
 * Deterministic and model-free: the copy is entity-escaped straight into the
 * brand's own markup, so the result is verbatim and sanitiser-clean by
 * construction. The caller still runs the full guard chain over it.
 */
export function substituteFragment(
  recipe: BrandRecipe,
  input: ComposeSlideInput,
): FragmentFill | FragmentGap {
  const fragment = recipe.fragments?.[input.role];
  if (typeof fragment !== 'string' || !fragment.trim()) return { kind: 'no-fragment' };

  // 1. Can this fragment carry every part this slide was given? A part with no
  //    hole would be silently dropped, which is exactly the failure the verbatim
  //    guard exists to prevent — so the whole slide goes to the model instead.
  const { scalars, rows } = providedParts(input.parts);
  for (const part of scalars) {
    if (!fragment.includes(`{{${part}}}`)) return { kind: 'no-placeholder', part };
  }
  if (rows && !(fragment.includes(ROWS_OPEN) && fragment.includes(ROW_TEXT))) {
    return { kind: 'no-placeholder', part: 'rows' };
  }
  // The emphasis is wrapped INSIDE the headline after the fact, so it is
  // expressible exactly when the headline is.
  const emphasis = input.parts.emphasis;
  if (typeof emphasis === 'string' && emphasis.length && !scalars.includes('headline')) {
    return { kind: 'no-placeholder', part: 'emphasis' };
  }

  // 2. A slide that holds a photograph needs the hole for it.
  if (input.photo && authoredSlots(fragment).length === 0) return { kind: 'no-slot' };

  let html = fillRows(fragment, input.parts.rows ?? []);
  html = fillParts(html, input.parts);
  if (!input.photo) html = dropSlots(html);
  html = tidy(html);
  return html ? { html } : { kind: 'empty' };
}

// ── The substituted path's own verbatim check ───────────────────────────────

/**
 * Comparable plain text for the substituted path.
 *
 * A near-twin of compose.ts's `plain()`, differing in two ways that only matter
 * here: it decodes EVERY entity `escapeHtml` can introduce (not just `&amp;` and
 * `&quot;`), and it decodes BEFORE stripping tags rather than after. Copy
 * containing `<` is written into the fragment as `&lt;`, so without the extra
 * decoding it reads as missing from markup that plainly carries it — and without
 * the ordering, `&lt;a&gt;` would decode into something the haystack then keeps
 * and the needle (a raw `<a>`) loses. Both sides normalise identically this way.
 *
 * compose.ts's own `plain()` is deliberately left untouched: changing it would
 * change what the model path retries and splices on.
 */
function fragmentPlain(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Which parts did NOT survive into the substituted markup. Zero by construction
 * — the fill is a verbatim splice — so a non-empty result means a guard further
 * down the chain (a dedupe, the sanitiser) took copy with it, and the caller
 * hands the slide to the model rather than shipping a slide that lost words.
 * Rows are checked too, which compose's own guard cannot do.
 */
export function fragmentVerbatimGaps(html: string, parts: ComposeParts): string[] {
  const hay = fragmentPlain(html);
  const missing: string[] = [];
  for (const [k, v] of Object.entries(parts)) {
    if (typeof v !== 'string' || v.length <= 2) continue;
    if (!hay.includes(fragmentPlain(v))) missing.push(k);
  }
  (parts.rows ?? []).forEach((row, i) => {
    if (row.text.length > 2 && !hay.includes(fragmentPlain(row.text))) missing.push(`rows[${i}].text`);
  });
  return missing;
}
