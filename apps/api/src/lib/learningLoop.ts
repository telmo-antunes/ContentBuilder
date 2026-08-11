/**
 * THE LOOP, WIRED UP — recording what the app wrote, noticing what the user
 * changed, and handing the result to the deterministic lesson-maker in
 * `packages/shared/src/learning.ts`.
 *
 * Three entry points, and each one is best-effort by construction:
 *
 *   `recordGeneration`  after a compose — store the prompts and the deck
 *   `observeOutcome`    after a save or an export — diff shipped vs generated
 *   `lessonsFor`        before the next compose — what this brand has taught us
 *
 * NOTHING HERE MAY FAIL A USER'S ACTION. Learning is a side effect of using the
 * product, not a feature the product depends on: every call swallows its own
 * errors and logs one line, because a post that will not save because the
 * learning loop had a bad day is a far worse product than one that forgets.
 */
import {
  deriveLessons,
  LESSON_WINDOW,
  type GenerationOutcome,
  type Lesson,
  type LearnablePart,
  type ObservedGeneration,
  type PartEdit,
  type SlideOutcome,
  type TweakPress,
} from '@contentbuilder/shared';
import { GenerationModel, BusinessModel } from '../models';
import { partsFromAuthored } from './htmlDirector/reparse';
import type { ComposeRecord } from './htmlDirector/compose';

/** The parts a lesson can be about, as a set for the diff below. */
const PARTS: LearnablePart[] = ['eyebrow', 'headline', 'body', 'tagline', 'cta'];

/** How much of a prompt is worth keeping. A read source can be long. */
const MAX_PROMPT_CHARS = 24_000;

export interface RecordInput {
  projectId: string;
  businessId: string;
  kind?: 'deck' | 'slide';
  record: ComposeRecord;
  brief: {
    idea: string;
    plan?: readonly string[];
    locks?: readonly string[];
    sources?: ReadonlyArray<{ url: string; title?: string; chars?: number }>;
  };
  /** The slide ids the deck was saved under, in order — how an outcome finds a slide. */
  slideIds: string[];
}

/** Store what made this deck. Returns the record id, or undefined if it could not. */
export async function recordGeneration(input: RecordInput): Promise<string | undefined> {
  try {
    const doc = await GenerationModel.create({
      projectId: input.projectId,
      businessId: input.businessId,
      kind: input.kind ?? 'deck',
      brief: {
        idea: input.brief.idea.slice(0, MAX_PROMPT_CHARS),
        ...(input.brief.plan?.length ? { plan: [...input.brief.plan] } : {}),
        ...(input.brief.locks?.length ? { locks: [...input.brief.locks] } : {}),
        ...(input.brief.sources?.length ? { sources: input.brief.sources.map((s) => ({ ...s })) } : {}),
      },
      models: input.record.models,
      promptVersions: input.record.promptVersions,
      parseUser: input.record.parseUser.slice(0, MAX_PROMPT_CHARS),
      slides: input.record.slides.map((s, i) => ({
        id: input.slideIds[i] ?? `#${i}`,
        role: s.role,
        parts: s.parts,
        html: s.html,
        path: s.path,
        ...(s.composeUser ? { composeUser: s.composeUser.slice(0, MAX_PROMPT_CHARS) } : {}),
      })),
    });
    return String(doc._id);
  } catch (err) {
    console.warn('[learning] could not record this generation:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

// ── The diff ────────────────────────────────────────────────────────────────

/** Whitespace-insensitive comparison — a reflow is not an edit. */
const norm = (s: string): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * What the user did to ONE generated slide.
 *
 * Compared by PART, not by markup: a slide whose HTML differs because the type
 * floor raised a font size has not been edited by anybody, and counting it
 * would teach the copywriter a lesson about a change it did not make. Reading
 * the copy back out of both sides and comparing the words is the only signal
 * here that a person definitely produced.
 */
export function diffSlide(
  generated: { id: string; role?: string; html?: string; parts?: Record<string, unknown> },
  shipped: { authored?: { html?: string } } | undefined,
): SlideOutcome {
  const role = generated.role ?? 'statement';
  if (!shipped?.authored?.html) return { slideId: generated.id, role, verdict: 'dropped' };

  const before = partsFromAuthored(generated.html ?? '');
  const after = partsFromAuthored(shipped.authored.html);
  const edits: PartEdit[] = [];
  for (const part of PARTS) {
    const b = norm(String(before[part] ?? ''));
    const a = norm(String(after[part] ?? ''));
    if (!b && !a) continue;
    if (b === a) continue;
    edits.push({ part, before: b, after: a });
  }

  // Rows are compared as one blob: which item moved is not a lesson, but "the
  // list got shorter" and "this word never survives" both are.
  const rowsOf = (html: string) =>
    [...html.matchAll(/<[a-z][a-z0-9]*\b[^>]*\bclass="[^"]*\brow\b[^"]*"[^>]*>([\s\S]*?)<\/[a-z][a-z0-9]*>/gi)]
      .map((m) => norm((m[1] ?? '').replace(/<[^>]+>/g, ' ')))
      .filter(Boolean)
      .join(' · ');
  const rb = rowsOf(generated.html ?? '');
  const ra = rowsOf(shipped.authored.html);
  if (rb !== ra) edits.push({ part: 'rows', before: rb, after: ra });

  return edits.length
    ? { slideId: generated.id, role, verdict: 'edited', edits }
    : { slideId: generated.id, role, verdict: 'kept' };
}

/**
 * WHICH SLIDE WAS ACTUALLY DRAGGED, and how far.
 *
 * Moving one slide to the front pushes every slide it passed down by one, so a
 * single drag produces three or four displacements and only one of them was a
 * decision. Recording all of them taught "you move the statement slide later"
 * from a user who had dragged the stat slide earlier — true, and the wrong
 * lesson. The largest displacement is the drag; everything else is its wake.
 *
 * Ties are all kept: swapping two adjacent slides moves both by one, and which
 * of the pair was picked up is genuinely unknowable.
 */
export function draggedSlides(
  generatedOrder: readonly string[],
  shippedOrder: readonly string[],
): Map<string, number> {
  const now = new Map(shippedOrder.map((id, i) => [id, i]));
  const moved = new Map<string, number>();
  generatedOrder.forEach((id, was) => {
    const is = now.get(id);
    if (typeof is === 'number' && is !== was) moved.set(id, is - was);
  });
  if (!moved.size) return moved;
  const furthest = Math.max(...[...moved.values()].map(Math.abs));
  for (const [id, delta] of moved) if (Math.abs(delta) !== furthest) moved.delete(id);
  return moved;
}

/**
 * Diff a whole shipped deck against what was generated, and store the verdict
 * on the generation record.
 *
 * Called on save and on export. Re-running it simply overwrites the outcome
 * with a fresher one, which is correct: what matters is what the post looks
 * like NOW, and `exported` latches true once it has actually shipped.
 */
export async function observeOutcome(
  projectId: string,
  shippedSlides: ReadonlyArray<{ id?: string; authored?: { html?: string } }>,
  opts?: { exported?: boolean },
): Promise<GenerationOutcome | undefined> {
  try {
    const gen = await GenerationModel.findOne({ projectId }).sort({ createdAt: -1 });
    if (!gen) return undefined;
    const generated = (gen.get('slides') ?? []) as Array<{
      id: string;
      role?: string;
      html?: string;
      parts?: Record<string, unknown>;
    }>;
    if (!generated.length) return undefined;

    const byId = new Map(shippedSlides.filter((s) => s.id).map((s) => [String(s.id), s]));
    /**
     * Tweak presses and arrangement swaps are EVENTS, recorded the moment they
     * happen. Re-observing a deck must carry them forward rather than recompute
     * them — nothing in the final markup says a button was ever pressed.
     */
    const previous = new Map<string, SlideOutcome>(
      ((gen.get('outcome') as GenerationOutcome | undefined)?.slides ?? []).map((s) => [s.slideId, s]),
    );

    const displacement = draggedSlides(
      generated.map((g) => g.id),
      shippedSlides.map((s) => String(s.id ?? '')),
    );

    const slides = generated.map((g) => {
      const out = diffSlide(g, byId.get(g.id));
      const was = previous.get(g.id);
      if (was?.tweaks?.length) out.tweaks = was.tweaks;
      if (was?.rearranged) out.rearranged = true;
      const delta = displacement.get(g.id);
      if (delta !== undefined) out.moved = delta;
      return out;
    });
    const generatedIds = new Set(generated.map((g) => g.id));
    const outcome: GenerationOutcome = {
      at: new Date().toISOString(),
      // Latched: a post that shipped once has shipped, whatever is edited after.
      exported: Boolean(opts?.exported) || Boolean((gen.get('outcome') as GenerationOutcome | undefined)?.exported),
      slides,
      added: shippedSlides.filter((s) => !s.id || !generatedIds.has(String(s.id))).length,
    };
    gen.set('outcome', outcome);
    await gen.save();

    const edited = slides.filter((s) => s.verdict === 'edited').length;
    const dropped = slides.filter((s) => s.verdict === 'dropped').length;
    const moved = slides.filter((s) => typeof s.moved === 'number').length;
    if (edited || dropped || moved || outcome.added) {
      console.warn(
        `[learning] ${projectId}: ${edited} slide(s) edited, ${dropped} dropped, ${moved} moved, ${outcome.added} added`,
      );
    }
    return outcome;
  } catch (err) {
    console.warn('[learning] could not observe this outcome:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * RECORD AN EVENT ON ONE SLIDE — a tweak press, or an arrangement swapped for
 * an alternative.
 *
 * Neither leaves a trace the outcome diff can find later: a "smaller headline"
 * changes a class rather than a word, and applying an alternative changes the
 * markup while leaving every word exactly where it was. Both are the user
 * telling you something specific, and both were silently discarded.
 *
 * Written straight onto the generation's outcome, creating a bare one if the
 * deck has not been saved since it was composed. Best-effort throughout: this
 * is bookkeeping about a button press, and it may never fail the press.
 */
export async function noteSlideSignal(
  projectId: string,
  slideId: string,
  signal: { tweak?: TweakPress; rearranged?: boolean },
): Promise<void> {
  try {
    const gen = await GenerationModel.findOne({ projectId }).sort({ createdAt: -1 });
    if (!gen) return;
    const generated = (gen.get('slides') ?? []) as Array<{ id: string; role?: string }>;
    const made = generated.find((g) => g.id === slideId);
    if (!made) return; // a slide the app never wrote can teach nothing about writing

    const outcome: GenerationOutcome = (gen.get('outcome') as GenerationOutcome | undefined) ?? {
      at: new Date().toISOString(),
      exported: false,
      added: 0,
      slides: generated.map((g) => ({ slideId: g.id, role: g.role ?? 'statement', verdict: 'kept' as const })),
    };
    const row =
      outcome.slides.find((sl) => sl.slideId === slideId) ??
      ({ slideId, role: made.role ?? 'statement', verdict: 'kept' } as SlideOutcome);
    if (!outcome.slides.includes(row)) outcome.slides.push(row);

    if (signal.tweak) row.tweaks = [...(row.tweaks ?? []), signal.tweak];
    if (signal.rearranged) row.rearranged = true;
    outcome.at = new Date().toISOString();

    gen.set('outcome', outcome);
    gen.markModified('outcome');
    await gen.save();
  } catch (err) {
    console.warn('[learning] could not record that signal:', err instanceof Error ? err.message : err);
  }
}

// ── Reading the lessons back ────────────────────────────────────────────────

/** The lessons a brand has taught, minus the ones its owner switched off. */
export async function lessonsFor(businessId: string): Promise<Lesson[]> {
  try {
    const [rows, business] = await Promise.all([
      GenerationModel.find({ businessId, outcome: { $exists: true } })
        .sort({ createdAt: -1 })
        .limit(LESSON_WINDOW)
        .select('_id projectId createdAt outcome')
        .lean<Array<{ _id: unknown; projectId: unknown; createdAt: Date; outcome: GenerationOutcome }>>(),
      BusinessModel.findById(businessId).select('lessonMutes').lean<{ lessonMutes?: string[] } | null>(),
    ]);
    if (!rows.length) return [];

    // Titles are looked up in one query rather than joined per row.
    const { ProjectModel } = await import('../models');
    const titles = new Map<string, string>(
      (
        await ProjectModel.find({ _id: { $in: rows.map((r) => r.projectId) } })
          .select('_id title')
          .lean<Array<{ _id: unknown; title?: string }>>()
      ).map((p) => [String(p._id), String(p.title ?? '')]),
    );

    const observed: ObservedGeneration[] = rows.map((r) => ({
      id: String(r._id),
      projectId: String(r.projectId),
      title: titles.get(String(r.projectId)),
      at: new Date(r.createdAt).toISOString(),
      outcome: r.outcome,
    }));
    const muted = new Set(business?.lessonMutes ?? []);
    return deriveLessons(observed).filter((l) => !muted.has(l.id));
  } catch (err) {
    console.warn('[learning] could not read this brand’s lessons:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Every lesson, muted ones included — what the brand screen shows. */
export async function allLessonsFor(
  businessId: string,
): Promise<{ lessons: Array<Lesson & { muted: boolean }>; posts: number }> {
  const [rows, business] = await Promise.all([
    GenerationModel.find({ businessId, outcome: { $exists: true } })
      .sort({ createdAt: -1 })
      .limit(LESSON_WINDOW)
      .select('_id projectId createdAt outcome')
      .lean<Array<{ _id: unknown; projectId: unknown; createdAt: Date; outcome: GenerationOutcome }>>(),
    BusinessModel.findById(businessId).select('lessonMutes').lean<{ lessonMutes?: string[] } | null>(),
  ]);
  const { ProjectModel } = await import('../models');
  const titles = new Map<string, string>(
    (
      await ProjectModel.find({ _id: { $in: rows.map((r) => r.projectId) } })
        .select('_id title')
        .lean<Array<{ _id: unknown; title?: string }>>()
    ).map((p) => [String(p._id), String(p.title ?? '')]),
  );
  const muted = new Set(business?.lessonMutes ?? []);
  const lessons = deriveLessons(
    rows.map((r) => ({
      id: String(r._id),
      projectId: String(r.projectId),
      title: titles.get(String(r.projectId)),
      at: new Date(r.createdAt).toISOString(),
      outcome: r.outcome,
    })),
  ).map((l) => ({ ...l, muted: muted.has(l.id) }));
  return { lessons, posts: rows.length };
}
