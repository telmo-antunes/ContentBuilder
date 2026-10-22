/**
 * THE DESIGNER PATH, end to end — design, render, review, revise, keep the
 * better deck. The route owns persistence and photography and hands them in
 * as callbacks, so this loop runs the same way under a test with scripted
 * replies as it does against the real models.
 *
 *   design (round 1) ─▶ measure ─▶ persist ─▶ shoot ─▶ sheet ─▶ review
 *        │                                                        │
 *        └──────────── revise (round 2), if earned ◀──────────────┘
 *                                 │
 *                       measure ─▶ persist ─▶ shoot ─▶ sheet ─▶ review
 *                                 │
 *                       keep the better round; persist it if it is not the one on disk
 */
import type { BrandRecipe, DesignRound, DesignSummary, ScoreDimension } from '@contentbuilder/shared';
import { SLACK_LIMIT, archetypeFor } from '@contentbuilder/shared';
import { buildContactSheet } from '../contactSheet';
import type { ReferenceSheet } from '../inspo';
import type { PoolAsset } from '../photoPool';
import { affordsUsd } from '../spend';
import { describeMeasured, designDeck, needsDeckStrip, REVISION_ESTIMATE_USD, stripDeckClasses, type DesignContext, type DesignedDeck } from './designDeck';
import type { ComposeSlideInput } from './prompt';
import { betterRound, reviewDeck, shouldRevise, type DeckReview, type ReviewOutcome } from './reviewDeck';
import type { OpenProbe } from './renderCheck';
import type { ComposeProgress } from './compose';

export interface DesignPathArgs {
  recipe: BrandRecipe;
  format: string;
  type: 'carousel' | 'story';
  inputs: readonly ComposeSlideInput[];
  pool: readonly PoolAsset[];
  /** The brief, for the review's fidelity dimension. */
  idea: string;
  brandName?: string;
  handle?: string;
  audience?: string;
  references?: readonly ReferenceSheet[];
  /** The classic composer for a slide the designer could not be trusted with. */
  classic: DesignContext['classic'];
  /** Write the deck to the project; return the slide ids in order. */
  persist: (deck: DesignedDeck, round: number) => Promise<string[]>;
  /** Photograph the persisted deck through the real render route (base64 PNGs). */
  shoot: (slideIds: readonly string[]) => Promise<Array<string | null>>;
  /** The layout probe — absent in tests. */
  openProbe?: OpenProbe;
  onProgress?: (p: ComposeProgress) => void;
  /** 1 = design only, 2 = allow one revision. */
  maxRounds?: number;
  designModel?: string;
  reviewModel?: string;
}

export interface DesignPathResult {
  deck: DesignedDeck;
  review: DeckReview | null;
  reviewSkip?: Exclude<ReviewOutcome, { status: 'ok' }>;
  summary: DesignSummary;
  /** The spoken layout verdicts for the deck that shipped. */
  measured: string[];
  /** The slide ids of the deck that is on disk when this returns. */
  slideIds: string[];
}

/**
 * Measure a designed deck through the probe, and REPAIR what the one
 * mechanical rung can: a slide that overflows or ladders its headline loses
 * its deck devices and is measured again; the plainer version is kept only if
 * it measures better. Empty when no probe can run. Mutates `deck` in place.
 */
async function measureDeck(args: DesignPathArgs, deck: DesignedDeck): Promise<string[]> {
  if (!args.openProbe) return [];
  const caps = deck.slides.map((s) => archetypeFor(s.archetype)?.maxHeadlineLines);
  let probe;
  try {
    probe = await args.openProbe(
      args.recipe,
      args.format as never,
      deck.slides.map((s) => ({ html: s.html, bg: s.bg, role: s.role, archetype: s.archetype, slotSizes: Object.fromEntries(s.photos.filter((p) => p.placement === 'slot' && p.slot).map((p) => [p.slot!, { shape: p.shape, size: p.size }])) })),
      { deckCss: deck.deckCss },
    );
  } catch (err) {
    console.warn(`[design] no probe: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  try {
    const verdicts = await probe.measure(deck.slides.map((s, index) => ({ index, html: s.html })));
    const retry = deck.slides
      .map((s, index) => ({ s, index }))
      .filter(({ s, index }) => needsDeckStrip(verdicts[index], caps[index]) && s.source === 'designer' && stripDeckClasses(s.html) !== s.html);
    if (retry.length) {
      const again = await probe.measure(retry.map(({ s, index }) => ({ index, html: stripDeckClasses(s.html) })));
      retry.forEach(({ s, index }, j) => {
        const after = again[j];
        if (after && !needsDeckStrip(after, caps[index])) {
          s.html = stripDeckClasses(s.html);
          verdicts[index] = after;
          deck.notes.push(`slide ${index + 1}: its deck device ${verdicts[index]?.state === 'overflows' ? 'overflowed' : 'laddered the headline'} — set at the brand's own sizes instead`);
        }
      });
    }
    return describeMeasured(verdicts, SLACK_LIMIT.display, caps);
  } catch (err) {
    console.warn(`[design] measure failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  } finally {
    await probe.close().catch(() => {});
  }
}

async function sheetOf(shots: ReadonlyArray<string | null>, format: string): Promise<Buffer | null> {
  const usable = shots.filter((s): s is string => Boolean(s)).map((b64) => ({ buffer: Buffer.from(b64, 'base64') }));
  if (usable.length < Math.max(2, Math.ceil(shots.length / 2))) return null;
  try {
    return await buildContactSheet(usable, format as never);
  } catch (err) {
    console.warn(`[design] contact sheet failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const roundRecord = (round: number, deck: DesignedDeck, review: DeckReview | null, kept: boolean, reason: string): DesignRound => ({
  round,
  ...(review ? { scores: review.scores as Partial<Record<ScoreDimension, number>>, total: review.total, verdict: review.verdict } : {}),
  fallbacks: deck.fallbacks,
  kept,
  reason,
});

/**
 * Run the path. Returns null only when round 1 could not be designed at all
 * (unaffordable, refused, unusable) — the route then runs the classic path.
 */
export async function runDesignPath(args: DesignPathArgs): Promise<DesignPathResult | null> {
  const maxRounds = args.maxRounds ?? 2;
  const base: DesignContext = {
    recipe: args.recipe,
    format: args.format,
    type: args.type,
    inputs: args.inputs,
    pool: args.pool,
    brandName: args.brandName,
    handle: args.handle,
    audience: args.audience,
    references: args.references,
    classic: args.classic,
    model: args.designModel,
  };
  const copy = args.inputs.map((s) =>
    [s.parts.eyebrow, s.parts.headline, s.parts.tagline, s.parts.body, s.parts.quote, s.parts.stat, s.parts.cta, ...(s.parts.rows ?? []).map((r) => r.text)]
      .filter(Boolean)
      .join(' / '),
  );

  args.onProgress?.({ phase: 'designing' });
  const first = await designDeck(base);
  if (!first) return null;

  const judge = async (deck: DesignedDeck, round: number): Promise<{ measured: string[]; sheet: Buffer | null; outcome: ReviewOutcome | null; slideIds: string[] }> => {
    args.onProgress?.({ phase: 'rendering', done: round, total: maxRounds });
    const measured = await measureDeck(args, deck);
    const slideIds = await args.persist(deck, round);
    const shots = await args.shoot(slideIds);
    const sheet = await sheetOf(shots, args.format);
    if (!sheet) return { measured, sheet: null, outcome: null, slideIds };
    args.onProgress?.({ phase: 'reviewing', done: round, total: maxRounds });
    const outcome = await reviewDeck(args.recipe, {
      sheet,
      format: args.format,
      brief: args.idea,
      copy,
      measured,
      references: args.references,
      slideCount: deck.slides.length,
      model: args.reviewModel,
    });
    return { measured, sheet, outcome, slideIds };
  };

  const r1 = await judge(first, 1);
  const review1 = r1.outcome?.status === 'ok' ? r1.outcome.review : null;
  const rounds: DesignRound[] = [];
  let shipped = { deck: first, review: review1, measured: r1.measured, slideIds: r1.slideIds, round: 1 };

  const wantsRevision = maxRounds >= 2 && review1 !== null && r1.sheet !== null && shouldRevise(review1, r1.measured);
  if (wantsRevision && affordsUsd(REVISION_ESTIMATE_USD, 'design-revision')) {
    args.onProgress?.({ phase: 'revising', done: 2, total: maxRounds });
    const second = await designDeck({
      ...base,
      revision: { previous: first, sheet: r1.sheet!, findings: review1!.findings, scores: review1!.scores, verdict: review1!.verdict, measured: r1.measured },
    });
    if (second) {
      const r2 = await judge(second, 2);
      const review2 = r2.outcome?.status === 'ok' ? r2.outcome.review : null;
      const winner = betterRound(review1, review2);
      if (winner === 'b') {
        rounds.push(roundRecord(1, first, review1, false, `the revision scored higher (${review2?.total ?? '?'} against ${review1?.total ?? '?'})`));
        rounds.push(roundRecord(2, second, review2, true, 'scored higher than the first round'));
        shipped = { deck: second, review: review2, measured: r2.measured, slideIds: r2.slideIds, round: 2 };
      } else {
        rounds.push(roundRecord(1, first, review1, true, review2 ? `kept over a revision that scored ${review2.total} against ${review1?.total ?? '?'}` : 'the revision could not be reviewed'));
        rounds.push(roundRecord(2, second, review2, false, 'did not beat the first round'));
        // Round 2 is what is on disk; put round 1 back.
        shipped.slideIds = await args.persist(first, 1);
      }
    } else {
      rounds.push(roundRecord(1, first, review1, true, 'the revision could not be designed'));
    }
  } else {
    rounds.push(
      roundRecord(
        1,
        first,
        review1,
        true,
        review1 ? (wantsRevision ? 'a revision was earned but the budget was spent' : 'the review found nothing a second round would fix') : 'not reviewed',
      ),
    );
  }

  const summary: DesignSummary = { engine: 'designer', rounds, ...(shipped.deck.rationale ? { rationale: shipped.deck.rationale } : {}) };
  const skip = shipped.round === 1 ? r1.outcome : null;
  return {
    deck: shipped.deck,
    review: shipped.review,
    ...(skip && skip.status === 'skipped' ? { reviewSkip: skip } : {}),
    summary,
    measured: shipped.measured,
    slideIds: shipped.slideIds,
  };
}
