/**
 * NO CANDIDATE IS OFFERED UNMEASURED.
 *
 * A whole-deck compose never ships a slide the renderer has not looked at:
 * `renderCheckDeck` measures every frame and repairs what overflows or
 * collides. The per-slide paths — Rewrite, New words, Other arrangements, and
 * the prompt refresh — composed markup and handed it straight to the picker,
 * measuring nothing at all. So the Studio offered, and saved, a slide whose
 * quote card was painted on top of its screenshot: the arrangement was
 * plausible as markup and broken on the canvas, which is precisely the failure
 * the render check exists to catch.
 *
 * The gate here is deliberately narrow. Overflow and collision are FACTS about
 * the canvas — a clipped line and two painted boxes on top of each other are
 * wrong in every brand and every taste. Slack is taste (a one-liner is meant to
 * be airy), and the deck-level pass owns it, so an airy candidate is still
 * offered. A renderer that cannot be reached returns `unknown`, and unknown
 * ships: the alternative is a feature that stops working whenever the web app
 * is restarting.
 */
import { SLOT_ATTR, type BrandRecipe, type Format, type SlidePhoto } from '@contentbuilder/shared';
import {
  checkSlideOverflow,
  layoutFaults,
  renderCheckEnabledByDefault,
  withCeiling,
  type CheckOptions,
  type CheckSlide,
} from './renderCheck';

export interface Candidate {
  html: string;
  bg?: string;
  role?: string;
  pv?: Record<string, number>;
}

export interface CandidateVerdict {
  candidate: Candidate;
  /** Empty when the canvas is sound — what a human would say is wrong otherwise. */
  faults: string[];
}

/**
 * What a slide's photos occupy, for the measurement.
 *
 * A scaffold carries no media, so a slot is reserved at its DEFAULT geometry.
 * That is right at compose time, where no photo has been chosen, and wrong
 * here: this slide's picture may have been shrunk or widened by hand, and
 * measuring the default would either invent a collision or miss a real one.
 */
export function slotSizesFor(photos: ReadonlyArray<SlidePhoto> | undefined): Record<string, { shape?: string; size?: string }> {
  const out: Record<string, { shape?: string; size?: string }> = {};
  for (const p of photos ?? []) {
    if (p.placement !== 'slot' || !p.slot) continue;
    if (p.shape) out[p.slot] = { shape: p.shape };
  }
  return out;
}

/**
 * HOW A SLIDE TREATS ITS PICTURE — an exhibit in the flow, or a backdrop behind
 * the copy.
 *
 * An `edge` figure is absolutely positioned down one side of the canvas with
 * every other block lifted above it (`slidePhotos.ts`), so the words are read
 * ON the picture. That is right for a photograph and wrong for a screenshot:
 * a pricing table behind italic serif is unreadable, and it is not a collision
 * — nothing overlaps in the flow — so the measurement cannot see it.
 *
 * A rewrite is asked to change WORDS. It may not quietly turn the exhibit the
 * person put on the slide into wallpaper behind them.
 */
export type PictureTreatment = 'bleed' | 'inset' | 'none';

export function pictureTreatment(html: string): PictureTreatment {
  const figures = html.match(new RegExp(`<[^>]*${SLOT_ATTR}\\s*=\\s*"[^"]*"[^>]*>`, 'gi')) ?? [];
  if (!figures.length) return 'none';
  return figures.some((tag) => /\bclass\s*=\s*"[^"]*\bedge\b/i.test(tag)) ? 'bleed' : 'inset';
}

/**
 * PUT THE PICTURE BACK IN THE FLOW.
 *
 * Refusing a candidate outright is right when nothing can be done, but a bleed
 * the person did not ask for is one class away from the exhibit they had: drop
 * `edge` (and the side modifier that only means anything with it) and the
 * figure lays out as an ordinary shot again — the `:has(> .edge)` rule that
 * lifts every other block above the picture stops applying with it. The result
 * is still measured before anyone sees it, so a repair that reads badly on the
 * canvas is dropped like any other candidate.
 */
export function unbleedPicture(html: string): string {
  return html.replace(new RegExp(`<[^>]*${SLOT_ATTR}\\s*=\\s*"[^"]*"[^>]*>`, 'gi'), (tag) =>
    tag.replace(/\bclass\s*=\s*"([^"]*)"/i, (attr, cls: string) => {
      const kept = cls
        .split(/\s+/)
        .filter((c) => c && c !== 'edge' && c !== 'left' && c !== 'right');
      return `class="${kept.join(' ')}"`;
    }),
  );
}

/** Long enough for a cold browser and a handful of frames, short enough to fail a hung one. */
const MEASURE_CEILING_MS = 90_000;

/** Faults that make a candidate wrong rather than merely airy. */
const BROKEN = (f: string) => f === 'overflows' || f === 'collision';

/**
 * Measure every candidate in ONE probe and say which are sound.
 *
 * Batched on purpose: opening a probe writes a throwaway business, kit and
 * project and launches a browser, so measuring two candidates separately costs
 * twice what measuring them together does.
 */
export async function measureCandidates(
  recipe: BrandRecipe,
  format: Format | string,
  candidates: ReadonlyArray<Candidate>,
  opts?: CheckOptions & {
    role?: string;
    archetype?: string;
    /** The geometry this slide's photos actually occupy — see `slotSizesFor`. */
    slotSizes?: Record<string, { shape?: string; size?: string }>;
  },
): Promise<CandidateVerdict[]> {
  if (!candidates.length) return [];
  /**
   * THE SAME GATE THE DECK CHECK USES. Off under a test runner and on a box
   * with no web server (`COMPOSE_RENDER_CHECK=0`): the degraded path still
   * launches Chrome and still talks to Mongo before discovering there is
   * nothing to talk to, which is a hang, not a graceful skip.
   */
  if (!opts?.openProbe && !renderCheckEnabledByDefault()) {
    return candidates.map((candidate) => ({ candidate, faults: [] }));
  }
  const slides: CheckSlide[] = candidates.map((c) => ({
    html: c.html,
    ...(c.bg ? { bg: c.bg } : {}),
    ...(c.role ?? opts?.role ? { role: c.role ?? opts?.role } : {}),
    ...(opts?.archetype ? { archetype: opts.archetype } : {}),
    ...(opts?.slotSizes && Object.keys(opts.slotSizes).length ? { slotSizes: opts.slotSizes } : {}),
  }));
  /**
   * A WEDGED BROWSER MUST NOT HANG THE REQUEST. `checkSlideOverflow` handles a
   * probe that THROWS; one that never returns would leave the person watching
   * a spinner forever, so the whole measurement carries a ceiling and an
   * unmeasured candidate is simply offered.
   */
  const measured = await withCeiling(
    checkSlideOverflow(recipe, slides, format, { ...(opts?.openProbe ? { openProbe: opts.openProbe } : {}) }),
    MEASURE_CEILING_MS,
    'candidate measurement',
  ).catch((err) => {
    console.warn(`[candidates] measuring failed — offering unchecked: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  });
  return candidates.map((candidate, i) => {
    const m = measured[i];
    // Unmeasured ships: see the note at the top of this file.
    if (!m || m.state === 'unknown' || !m.layout) return { candidate, faults: [] };
    return {
      candidate,
      faults: layoutFaults(m.layout, undefined, candidate.role ?? opts?.role).filter(BROKEN),
    };
  });
}

/**
 * The candidates worth showing a person, and what was wrong with the rest.
 *
 * `max` caps what comes back so a route can compose generously, measure, and
 * still return the two the picker has room for.
 */
export async function soundCandidates(
  recipe: BrandRecipe,
  format: Format | string,
  candidates: ReadonlyArray<Candidate>,
  opts?: Parameters<typeof measureCandidates>[3] & { max?: number },
): Promise<{ kept: Candidate[]; rejected: string[][] }> {
  const verdicts = await measureCandidates(recipe, format, candidates, opts);
  const kept: Candidate[] = [];
  const rejected: string[][] = [];
  for (const v of verdicts) {
    if (v.faults.length) {
      rejected.push(v.faults);
      continue;
    }
    if (!opts?.max || kept.length < opts.max) kept.push(v.candidate);
  }
  return { kept, rejected };
}
