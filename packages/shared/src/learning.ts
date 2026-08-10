/**
 * WHAT THIS BRAND HAS TAUGHT THE COPYWRITER.
 *
 * Every post is a small experiment nobody was recording. The app wrote a deck,
 * the user quietly cut the headline in half, deleted the tagline, rewrote the
 * kicker and shipped it — and the next post was written by a copywriter that
 * had never heard about any of it. The corrections were the most valuable thing
 * in the product and they evaporated on save.
 *
 * So the loop closes here:
 *
 *   CAPTURE   every prompt that made a slide, and the slide it made
 *      ↓
 *   SIGNAL    diff what shipped against what was generated — deterministic,
 *             per part, per slide
 *      ↓
 *   LESSON    aggregate the signal until it repeats; a lesson exists only when
 *             several posts agree, never after one edit
 *      ↓
 *   APPLY     the lesson rides in the copywriter's USER message, and where it
 *             is numeric (a copy budget) it moves the number too
 *
 * FOUR RULES hold this honest, and they are the same rules the rest of this
 * codebase's gates follow:
 *
 *   · NO MODEL. Every function here is arithmetic over strings. A learning
 *     system that needs a model to decide what it learned cannot be audited,
 *     cannot be tested, and cannot explain itself to the person it is learning
 *     about.
 *   · EVIDENCE OR IT DID NOT HAPPEN. A lesson carries the posts it came from.
 *     "Your headlines get cut" is a horoscope; "cut on 4 of your last 6 posts,
 *     by 14 characters on average" is a finding.
 *   · ONE EDIT IS NOISE. Below `MIN_OBSERVATIONS` nothing is learned, however
 *     dramatic the single edit was.
 *   · THE PERSON DECIDES. Lessons are shown, and any one can be muted. Nothing
 *     here rewrites a brand's recipe or re-composes a post on its own.
 */

// ── What was observed ───────────────────────────────────────────────────────

/** The copy parts a lesson can be about. */
export const LEARNABLE_PARTS = ['eyebrow', 'headline', 'body', 'tagline', 'cta', 'rows'] as const;
export type LearnablePart = (typeof LEARNABLE_PARTS)[number];

/** One part of one slide, as generated and as it ended up. */
export interface PartEdit {
  part: LearnablePart;
  before: string;
  after: string;
}

/** What became of one generated slide. */
export interface SlideOutcome {
  slideId: string;
  role: string;
  /** 'kept' — untouched; 'edited' — copy changed; 'dropped' — removed from the deck. */
  verdict: 'kept' | 'edited' | 'dropped';
  /** Only on 'edited'. */
  edits?: PartEdit[];
}

/** What became of one whole generation. */
export interface GenerationOutcome {
  /** When the diff was taken. */
  at: string;
  /** True once the post has been exported — it shipped in this state. */
  exported: boolean;
  slides: SlideOutcome[];
  /** Slides in the final deck that the generation never produced. */
  added: number;
}

/** The minimum a generation record needs for a lesson to be derived from it. */
export interface ObservedGeneration {
  id: string;
  projectId: string;
  /** Post title — what the evidence list shows a person. */
  title?: string;
  at: string;
  outcome?: GenerationOutcome;
}

// ── What was learned ────────────────────────────────────────────────────────

export type LessonKind =
  /** The user shortens this part, consistently. */
  | 'shorter'
  /** The user deletes this part, consistently. */
  | 'drops-part'
  /** The user deletes slides of this role, consistently. */
  | 'drops-role'
  /** A word the user takes out and never puts in. */
  | 'avoids-word'
  /** A word the user puts in and never takes out. */
  | 'prefers-word';

export interface Lesson {
  /** Stable across derivations, so muting one sticks. */
  id: string;
  kind: LessonKind;
  /** The part or role or word this is about. */
  subject: string;
  /** How many independent observations agree. */
  observations: number;
  /** The number that makes it actionable: characters for 'shorter', else absent. */
  amount?: number;
  /** One sentence, written for the copywriter — this is what rides in the prompt. */
  instruction: string;
  /** One sentence, written for the person — this is what the brand screen shows. */
  summary: string;
  /** Which posts it came from. */
  evidence: Array<{ projectId: string; title?: string; before: string; after: string }>;
}

/** Below this, an edit is one person having one opinion on one afternoon. */
export const MIN_OBSERVATIONS = 3;
/** A slide role has to be dropped this often before it counts as unwanted. */
export const MIN_ROLE_DROPS = 2;
/** Only a shortening of at least this fraction counts as "they cut it". */
const SHORTEN_RATIO = 0.15;
/** …and at least this many characters, so an 8-char eyebrow cannot qualify on 2. */
const SHORTEN_FLOOR = 6;
/** How many posts back a lesson may look. Older than this is a different brand. */
export const LESSON_WINDOW = 20;
/** How many evidence rows a lesson carries. Enough to be checked, not a log. */
const MAX_EVIDENCE = 4;

// ── Deriving the lessons ────────────────────────────────────────────────────

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9'’-]+/)
    .filter((w) => w.length > 3);

/** Words in `before` that are not in `after` — what the edit took out. */
function removedWords(before: string, after: string): string[] {
  const kept = new Set(words(after));
  return [...new Set(words(before))].filter((w) => !kept.has(w));
}

function addedWords(before: string, after: string): string[] {
  const had = new Set(words(before));
  return [...new Set(words(after))].filter((w) => !had.has(w));
}

/** The median of a list — resistant to the one post where everything was rewritten. */
function median(ns: number[]): number {
  if (!ns.length) return 0;
  const sorted = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Read a brand's generations and report what they agree on.
 *
 * Pure: hand it the same records and it returns the same lessons, which is what
 * makes the brand screen and the copywriter's prompt provably the same story.
 */
export function deriveLessons(generations: readonly ObservedGeneration[]): Lesson[] {
  const recent = [...generations]
    .filter((g) => g.outcome)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, LESSON_WINDOW);
  if (!recent.length) return [];

  const lessons: Lesson[] = [];

  // ── 1. Parts the user shortens ────────────────────────────────────────
  for (const part of LEARNABLE_PARTS) {
    const shrinks: number[] = [];
    const evidence: Lesson['evidence'] = [];
    for (const gen of recent) {
      for (const slide of gen.outcome!.slides) {
        for (const edit of slide.edits ?? []) {
          if (edit.part !== part) continue;
          const delta = edit.before.length - edit.after.length;
          if (delta < SHORTEN_FLOOR || delta < edit.before.length * SHORTEN_RATIO) continue;
          shrinks.push(delta);
          if (evidence.length < MAX_EVIDENCE) {
            evidence.push({ projectId: gen.projectId, title: gen.title, before: edit.before, after: edit.after });
          }
        }
      }
    }
    if (shrinks.length < MIN_OBSERVATIONS) continue;
    const amount = median(shrinks);
    lessons.push({
      id: `shorter:${part}`,
      kind: 'shorter',
      subject: part,
      observations: shrinks.length,
      amount,
      instruction: `This brand's ${part} copy is always cut after it is written — aim about ${amount} characters shorter than the budget allows.`,
      summary: `You shorten the ${part} — ${plural(shrinks.length, 'time')}, by about ${amount} characters.`,
      evidence,
    });
  }

  // ── 2. Parts the user deletes outright ────────────────────────────────
  for (const part of LEARNABLE_PARTS) {
    const evidence: Lesson['evidence'] = [];
    let removals = 0;
    for (const gen of recent) {
      for (const slide of gen.outcome!.slides) {
        for (const edit of slide.edits ?? []) {
          if (edit.part !== part || edit.after.trim().length) continue;
          removals += 1;
          if (evidence.length < MAX_EVIDENCE) {
            evidence.push({ projectId: gen.projectId, title: gen.title, before: edit.before, after: '' });
          }
        }
      }
    }
    if (removals < MIN_OBSERVATIONS) continue;
    lessons.push({
      id: `drops-part:${part}`,
      kind: 'drops-part',
      subject: part,
      observations: removals,
      instruction: `This brand deletes the ${part} rather than keep it — only write one when the slide is genuinely worse without it.`,
      summary: `You delete the ${part} — ${plural(removals, 'time')}.`,
      evidence,
    });
  }

  // ── 3. Roles whose slides get cut ─────────────────────────────────────
  const byRole = new Map<string, { made: number; dropped: number; evidence: Lesson['evidence'] }>();
  for (const gen of recent) {
    for (const slide of gen.outcome!.slides) {
      const row = byRole.get(slide.role) ?? { made: 0, dropped: 0, evidence: [] };
      row.made += 1;
      if (slide.verdict === 'dropped') {
        row.dropped += 1;
        if (row.evidence.length < MAX_EVIDENCE) {
          row.evidence.push({ projectId: gen.projectId, title: gen.title, before: slide.role, after: '' });
        }
      }
      byRole.set(slide.role, row);
    }
  }
  for (const [role, row] of byRole) {
    // Both tests must pass: enough drops to be a habit, and a high enough share
    // that it is the ROLE being rejected rather than the deck being trimmed.
    if (row.dropped < MIN_ROLE_DROPS || row.dropped / row.made < 0.5) continue;
    lessons.push({
      id: `drops-role:${role}`,
      kind: 'drops-role',
      subject: role,
      observations: row.dropped,
      instruction: `This brand cuts "${role}" slides — do not include one unless the material genuinely calls for it.`,
      summary: `You cut ${role} slides — ${row.dropped} of the ${row.made} written.`,
      evidence: row.evidence,
    });
  }

  // ── 4. Words the user always takes out, or always puts in ─────────────
  const out = new Map<string, Lesson['evidence']>();
  const inn = new Map<string, Lesson['evidence']>();
  for (const gen of recent) {
    for (const slide of gen.outcome!.slides) {
      for (const edit of slide.edits ?? []) {
        if (!edit.after.trim()) continue; // a deletion is rule 2, not a word choice
        const row = { projectId: gen.projectId, title: gen.title, before: edit.before, after: edit.after };
        for (const w of removedWords(edit.before, edit.after)) out.set(w, [...(out.get(w) ?? []), row]);
        for (const w of addedWords(edit.before, edit.after)) inn.set(w, [...(inn.get(w) ?? []), row]);
      }
    }
  }
  for (const [word, evidence] of out) {
    if (evidence.length < MIN_OBSERVATIONS || inn.has(word)) continue; // never both
    lessons.push({
      id: `avoids-word:${word}`,
      kind: 'avoids-word',
      subject: word,
      observations: evidence.length,
      instruction: `Do not use the word "${word}" — this brand takes it out every time.`,
      summary: `You remove "${word}" — ${plural(evidence.length, 'time')}.`,
      evidence: evidence.slice(0, MAX_EVIDENCE),
    });
  }
  for (const [word, evidence] of inn) {
    if (evidence.length < MIN_OBSERVATIONS || out.has(word)) continue;
    lessons.push({
      id: `prefers-word:${word}`,
      kind: 'prefers-word',
      subject: word,
      observations: evidence.length,
      instruction: `This brand reaches for the word "${word}" — use it where it fits.`,
      summary: `You add "${word}" — ${plural(evidence.length, 'time')}.`,
      evidence: evidence.slice(0, MAX_EVIDENCE),
    });
  }

  // Strongest first: the most-agreed lesson is the most worth obeying, and the
  // prompt block below is capped, so the order decides what survives the cap.
  return lessons.sort((a, b) => b.observations - a.observations);
}

// ── Applying them ───────────────────────────────────────────────────────────

/** How many lessons ride in one prompt. Past this it is a style guide, not a nudge. */
export const MAX_LESSONS_IN_PROMPT = 6;

/**
 * The block the copywriter reads. Empty when nothing has been learned, which is
 * the case for every brand until it has been corrected the same way three times.
 *
 * Deliberately in the USER message: the system prompt is a cached prefix shared
 * by every brand, and per-brand text in it would both break the cache and make
 * one brand's habits leak into another's posts.
 */
export function lessonsBlock(lessons: readonly Lesson[]): string {
  const use = lessons.slice(0, MAX_LESSONS_IN_PROMPT);
  if (!use.length) return '';
  return [
    `WHAT THIS BRAND HAS TAUGHT YOU — these are corrections its owner made to your previous posts, more than once each. Follow them:`,
    ...use.map((l) => `  · ${l.instruction}`),
  ].join('\n');
}

/**
 * The numeric half of applying a lesson. A sentence asking for shorter
 * headlines is a hint; moving the budget is a fact, enforced by the same clamp
 * that enforces every other budget.
 *
 * Floored at 60% of the original so a run of aggressive edits cannot collapse a
 * brand's copy to nothing, and only ever downward — nobody has ever wanted the
 * app to write MORE than it does.
 */
export function budgetAfterLessons(
  budgets: Record<string, number>,
  lessons: readonly Lesson[],
): Record<string, number> {
  const out = { ...budgets };
  for (const l of lessons) {
    if (l.kind !== 'shorter' || !l.amount) continue;
    const key = l.subject === 'rows' ? 'rowText' : l.subject;
    const base = out[key];
    if (typeof base !== 'number') continue;
    out[key] = Math.max(Math.round(base * 0.6), base - l.amount);
  }
  return out;
}
