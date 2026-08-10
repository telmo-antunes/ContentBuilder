/**
 * THE BRIEF — what the user actually asked for, in a shape the pipeline can obey.
 *
 * A post used to be one free-text `idea` handed whole to the copywriter, which
 * meant three things the user plainly intended were invisible to the machine:
 *
 *   · A SOURCE. "Make a carousel from this blog post <url>" named the material
 *     and nobody fetched it, so the copywriter wrote from the URL string.
 *   · A PLAN. Typing "Slide 3 list: a; b; c" is a per-slide instruction, and it
 *     was read as one long paragraph — the list vanished.
 *   · EXACT WORDS. There was no way to say "this line, exactly like this".
 *
 * So a brief is parsed, not just passed on:
 *
 *   idea  — the angle, in the user's words
 *   plan  — one direction per slide, in order (empty = the writer decides)
 *   locks — every "quoted" span: copy that must survive word for word
 *   urls  — sources to read before writing
 *
 * All of it is plain string work: no model, no network. The API resolves `urls`
 * separately (see `sourceIngest.ts`); everything else is final here, which is
 * why the web app can parse the same brief to show the user what it understood
 * before they spend a compose on it.
 */

/** One per-slide direction can be a paragraph, not an essay. */
export const MAX_SLIDE_DIRECTION_CHARS = 600;
/** The deck ceiling, mirroring MAX_SLIDES_PER_PROJECT's practical limit. */
export const MAX_PLAN_SLIDES = 12;
/** A verbatim lock longer than this is a paragraph, not a line of copy. */
export const MAX_LOCK_CHARS = 240;

export interface ParsedBrief {
  /** The overall angle — the brief with any inline slide plan lifted out. */
  idea: string;
  /** One direction per slide, in deck order. Empty means "you decide". */
  plan: string[];
  /** Quoted spans, deduplicated: copy that must appear exactly as written. */
  locks: string[];
  /** http(s) sources named in the brief, deduplicated, in order of appearance. */
  urls: string[];
}

// ── URLs ────────────────────────────────────────────────────────────────────

/** Trailing characters that are punctuation around a URL, never part of it. */
const URL_TRAIL = /[.,;:!?)\]}'"»”’]+$/;

/**
 * Every http(s) URL in the text, in order, deduplicated.
 *
 * Deliberately permissive about what a URL contains and strict about where it
 * ends: prose puts a full stop after a link far more often than a link ends in
 * one, and a balanced trailing `)` belongs to the sentence, not the path.
 */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(text ?? '').matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    let raw = m[0]!;
    // Keep a closing paren only when the URL opened one itself.
    for (;;) {
      const trimmed = raw.replace(URL_TRAIL, '');
      if (trimmed === raw) break;
      raw = trimmed;
    }
    if (raw.length < 12) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= 4) break; // a brief cites sources; it does not crawl
  }
  return out;
}

// ── Verbatim locks ──────────────────────────────────────────────────────────

/**
 * Straight and typographic quote pairs. Apostrophes are NOT a pair here: "it's"
 * would otherwise open a lock that swallowed the rest of the brief.
 */
const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ['“', '”'],
  ['«', '»'],
];

/**
 * Every `"quoted"` span in the brief — the user's own words, to be used exactly.
 *
 * A lock never spans a blank line: an unclosed quote is a typo, and letting it
 * run to the next one three paragraphs later would lock a whole essay verbatim.
 */
export function extractQuotedCopy(text: string): string[] {
  const s = String(text ?? '');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [open, close] of QUOTE_PAIRS) {
    const re =
      open === close
        ? new RegExp(`${escapeRe(open)}([^${escapeRe(close)}\\n]{2,${MAX_LOCK_CHARS}})${escapeRe(close)}`, 'g')
        : new RegExp(`${escapeRe(open)}([^${escapeRe(close)}\\n]{2,${MAX_LOCK_CHARS}})${escapeRe(close)}`, 'g');
    for (const m of s.matchAll(re)) {
      const value = (m[1] ?? '').replace(/\s+/g, ' ').trim();
      if (value.length < 2) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── The inline slide plan ───────────────────────────────────────────────────

/**
 * A line that names a slide: "Slide 3", "Slide 3:", "slide 3 -", "Slide 3 title:".
 * The word is required. A bare "3." at the start of a line is an ordinary
 * numbered list far more often than it is a slide boundary, and guessing wrong
 * would shred a normal brief into twelve slides.
 */
const SLIDE_LINE = /^[ \t]*slide[ \t]*#?[ \t]*(\d{1,2})\b[ \t]*[:.)\-–—]?[ \t]*(.*)$/i;

/**
 * Lift an inline per-slide plan out of a brief.
 *
 * Everything before the first `Slide N` line stays in `rest` (it is the angle);
 * every line after one belongs to the slide it follows, so a multi-line
 * direction works without repeating the prefix. Slides are emitted in numeric
 * order and gaps are closed — "Slide 1 … Slide 4" is a three-slide plan whose
 * third entry is the one labelled 4, not two empty slides in the middle.
 */
export function parseSlidePlan(text: string): { plan: string[]; rest: string } {
  const lines = String(text ?? '').split(/\r?\n/);
  const bySlide = new Map<number, string[]>();
  const rest: string[] = [];
  let current: number | undefined;

  for (const line of lines) {
    const m = line.match(SLIDE_LINE);
    if (m) {
      current = Number(m[1]);
      const tail = (m[2] ?? '').trim();
      const bucket = bySlide.get(current) ?? [];
      if (tail) bucket.push(tail);
      bySlide.set(current, bucket);
      continue;
    }
    if (current === undefined) {
      rest.push(line);
      continue;
    }
    // A blank line inside a plan is spacing, not the end of it.
    if (line.trim()) bySlide.get(current)!.push(line.trim());
  }

  const plan = [...bySlide.keys()]
    .sort((a, b) => a - b)
    .map((n) => bySlide.get(n)!.join('\n').trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_PLAN_SLIDES)
    .map((t) => t.slice(0, MAX_SLIDE_DIRECTION_CHARS));

  // One slide is not a plan — it is a sentence that happened to start with the
  // word. Two is the smallest thing that can be called an order of slides.
  if (plan.length < 2) return { plan: [], rest: String(text ?? '') };
  return { plan, rest: rest.join('\n').trim() };
}

// ── The whole brief ─────────────────────────────────────────────────────────

/**
 * Parse a brief, optionally with an explicit per-slide plan from the composer's
 * slide-plan editor. An explicit plan always wins: the user built it on purpose,
 * so nothing in the free text is allowed to reinterpret it.
 */
export function parseBrief(idea: string, explicitPlan?: readonly string[]): ParsedBrief {
  const raw = String(idea ?? '');
  const cleanPlan = (explicitPlan ?? [])
    .map((p) => String(p ?? '').trim().slice(0, MAX_SLIDE_DIRECTION_CHARS))
    .filter(Boolean)
    .slice(0, MAX_PLAN_SLIDES);

  const inline = cleanPlan.length ? { plan: [], rest: raw } : parseSlidePlan(raw);
  const plan = cleanPlan.length ? cleanPlan : inline.plan;
  const body = plan === inline.plan ? inline.rest : raw;

  return {
    idea: body.trim(),
    plan,
    locks: extractQuotedCopy([raw, ...plan].join('\n')),
    urls: extractUrls([raw, ...plan].join('\n')),
  };
}

// ── Reading a role out of a plan entry ──────────────────────────────────────

/**
 * The words a person actually uses to ask for a slide of a given shape. A plan
 * entry is a sentence, not a form field, so "the two wear signals, as a list of
 * two" has to be recognised as a list without the user learning a vocabulary.
 */
const ROLE_HINTS: Array<[string, RegExp]> = [
  ['list', /\b(?:as a |a )?(?:list|bullets?|checklist|enumerat\w+|rundown)\b|\b\d+\s+(?:things|ways|reasons|habits|signs|steps|mistakes|tips)\b/i],
  ['quote', /\b(?:a )?(?:pull[- ]?quote|quotation|testimonial)\b|\bquote (?:from|by)\b/i],
  ['stat', /\b(?:as a |a |one )?(?:stat|statistic|big number|percentage|figure)\b/i],
  ['cta', /\b(?:call to action|cta|the ask|close|closing slide|sign[- ]?off|book|get in touch)\b/i],
  ['cover', /\b(?:cover|the hook|opening slide|open(?:er|ing)?)\b/i],
];

/**
 * Which slide role a plan entry is asking for, if it is asking for one.
 *
 * Reported as a HINT, never as a decision: the copywriter is told what the
 * entry looks like it wants and still owns the judgement, because "five habits"
 * is a strong signal and "the close" is a weak one, and a rule that overrides
 * the writer on the weak ones would be worse than no rule.
 */
export function roleHintFor(direction: string): string | undefined {
  const text = String(direction ?? '');
  for (const [role, re] of ROLE_HINTS) if (re.test(text)) return role;
  return undefined;
}

/**
 * Does `text` contain `lock`, ignoring case, whitespace runs and the difference
 * between a straight and a typographic apostrophe or dash?
 *
 * The last part matters more than it sounds: a copywriter asked to reproduce
 * "don't wait" reliably returns "don’t wait", and a literal comparison would
 * call the promise broken and trigger a repair that changes nothing.
 */
export function containsLock(text: string, lock: string): boolean {
  return normalizeForLock(text).includes(normalizeForLock(lock));
}

function normalizeForLock(s: string): string {
  return String(s ?? '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Which locks are NOT present anywhere in `text`. */
export function missingLocks(text: string, locks: readonly string[]): string[] {
  return locks.filter((l) => !containsLock(text, l));
}

// ── How many slides the material wants ──────────────────────────────────────

export interface SlideCountRange {
  min: number;
  max: number;
  /** What to aim for when nothing else decides. */
  target: number;
  /** True when the user's own plan fixed the number and the writer may not vary it. */
  fixed: boolean;
}

/** Hard bounds, whatever the arithmetic says. */
const COUNT_FLOOR = 3;
const COUNT_CEILING = 10;

/** A short deck is four slides; the material has to earn anything past that. */
const COUNT_BASE = 4;
/** Words of BRIEF per extra slide — the user's words are already compressed. */
const WORDS_PER_SLIDE_BRIEF = 45;
/**
 * Words of SOURCE per extra slide. Far higher than the brief's, because an
 * article is prose and a slide is a poster: a 550-word blog post is six or
 * seven slides' worth of ideas, not twelve. Dividing both at the same rate is
 * what produced a ten-slide deck padded out with slides that said nothing.
 */
const WORDS_PER_SLIDE_SOURCE = 140;
/** Rough characters per word, used to turn a length into a word count. */
const CHARS_PER_WORD = 5.6;

/**
 * How many slides this brief is worth — replacing the manual stepper.
 *
 * A plan fixes it exactly. Otherwise the count follows the VOLUME of material,
 * weighted by KIND: the user's own words are already the shape of slides, an
 * article is prose that has to be cut down to fit them. The result is a RANGE,
 * not a number — the copywriter is told what the material looks like it needs
 * and allowed to land a slide either side rather than padding to hit a quota.
 */
export function slideCountFor(input: {
  planLength?: number;
  /** The user's own words. */
  ideaChars?: number;
  /** Fetched source material, if any. */
  sourceChars?: number;
  /** A story is watched, not swiped — it wants fewer, bigger frames. */
  story?: boolean;
}): SlideCountRange {
  const plan = input.planLength ?? 0;
  if (plan > 0) {
    const n = Math.min(MAX_PLAN_SLIDES, plan);
    return { min: n, max: n, target: n, fixed: true };
  }
  const ceiling = input.story ? 5 : COUNT_CEILING;
  const briefWords = (input.ideaChars ?? 0) / CHARS_PER_WORD;
  const sourceWords = (input.sourceChars ?? 0) / CHARS_PER_WORD;
  const raw = COUNT_BASE + briefWords / WORDS_PER_SLIDE_BRIEF + sourceWords / WORDS_PER_SLIDE_SOURCE;
  const target = Math.max(COUNT_FLOOR, Math.min(ceiling, Math.round(raw)));
  return {
    min: Math.max(COUNT_FLOOR, target - 1),
    max: Math.min(ceiling, target + 1),
    target,
    fixed: false,
  };
}
