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
import { SLOT_ATTR, authoredSlots, isFormat, type BrandRecipe, type Format, type SlidePhoto } from '@contentbuilder/shared';
import {
  UNKNOWN_VERDICT,
  addHeadlineVariant,
  checkSlideOverflow,
  hasSmallerHeadlineVariant,
  headlineVariantOf,
  layoutFaults,
  openRenderProbe,
  renderCheckEnabledByDefault,
  repairOverflow,
  withCeiling,
  type CheckOptions,
  type CheckSlide,
  type LayoutVerdict,
  type RenderProbe,
  type RepairContext,
} from './renderCheck';
import type { ComposeSlideInput } from './prompt';

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

/**
 * "SAME WORDS" IS A CONTRACT, NOT A HOPE.
 *
 * "Other arrangements" promises the copy is kept and only the layout moves. A
 * candidate shipped with the caption gone and the headline repeated inside the
 * card — plausible markup, wrong words — and the person applied it believing
 * the promise. So every candidate is read back against the parts it was
 * composed from: each part must appear, and the headline must appear once.
 * Cheap, deterministic, and it runs before anything is measured.
 */
export interface WordParts {
  eyebrow?: string;
  headline?: string;
  tagline?: string;
  body?: string;
  quote?: string;
  attribution?: string;
  stat?: string;
  cta?: string;
  rows?: ReadonlyArray<{ text?: string; note?: string }>;
}

/** What a reader would read: tags gone, entities decoded, whitespace collapsed, case folded. */
export function readableText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const SCALAR_PARTS = ['eyebrow', 'headline', 'tagline', 'body', 'quote', 'attribution', 'stat', 'cta'] as const;

/** Empty when the candidate says exactly what the parts say — otherwise, what it lost or repeated. */
export function keepsTheWords(parts: WordParts, html: string): string[] {
  const text = readableText(html);
  const faults: string[] = [];
  const count = (needle: string): number => {
    const n = readableText(needle);
    if (!n) return 1;
    let i = 0;
    let at = text.indexOf(n);
    while (at !== -1) {
      i += 1;
      at = text.indexOf(n, at + n.length);
    }
    return i;
  };
  for (const key of SCALAR_PARTS) {
    const value = parts[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const n = count(value);
    if (n === 0) faults.push(`lost the ${key}`);
    else if (key === 'headline' && n > 1) faults.push('repeats the headline');
  }
  for (const [i, row] of (parts.rows ?? []).entries()) {
    if (row.text && count(row.text) === 0) faults.push(`lost row ${i + 1}`);
  }
  return faults;
}

/**
 * THE PHOTO'S GEOMETRY, ON THE CANDIDATE'S OWN SLOT NAMES.
 *
 * A candidate names its slot as it likes ("pricing-ui" where the slide had
 * "price"), and the reservation is keyed by name — so a size keyed to the old
 * name reserved nothing, the slot fell back to its default (taller) geometry,
 * and every alternative for a slide with a wide screenshot measured as
 * overflowing. The photo lands on the candidate's first declared slot when it
 * is applied (`photosFor` on the page, `normalizePhotos` on save), so that is
 * where its size is measured too.
 */
export function slotSizesOn(
  html: string,
  sizes: Record<string, { shape?: string; size?: string }> | undefined,
): Record<string, { shape?: string; size?: string }> {
  if (!sizes || !Object.keys(sizes).length) return {};
  const declared = authoredSlots(html);
  if (!declared.length) return {};
  const out: Record<string, { shape?: string; size?: string }> = {};
  const spare = [...declared];
  for (const [slot, g] of Object.entries(sizes)) {
    const target = declared.includes(slot) ? slot : spare.find((d) => !(d in out));
    if (!target) break;
    out[target] = g;
    spare.splice(spare.indexOf(target), 1);
  }
  return out;
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
  const slides: CheckSlide[] = candidates.map((c) => {
    const sizes = slotSizesOn(c.html, opts?.slotSizes);
    return {
      html: c.html,
      ...(c.bg ? { bg: c.bg } : {}),
      ...(c.role ?? opts?.role ? { role: c.role ?? opts?.role } : {}),
      ...(opts?.archetype ? { archetype: opts.archetype } : {}),
      ...(Object.keys(sizes).length ? { slotSizes: sizes } : {}),
    };
  });
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
 * ONE PROBE for everything: the measurement, the repairs and the re-measures
 * all write into the same throwaway scaffold, because opening a probe stands
 * up a business, a kit, a project and a browser, and a route that opened one
 * per candidate would take longer than the compose it followed.
 *
 * A BROKEN CANDIDATE GETS THE SAME LADDER A DECK GETS. A whole-deck compose
 * does not throw an overflowing slide away; it climbs `repairOverflow` —
 * smaller headline, drop the least essential block, recompose with the copy
 * declared fixed — and keeps what fits. Dropping candidates instead left a
 * slide with a wide screenshot and a long caption with no alternatives at all,
 * every time. `opts.input` is the slide the candidates were composed from;
 * without it the ladder cannot recompose and only the free rung runs.
 *
 * `max` caps what comes back so a route can compose generously and still
 * return the two the picker has room for.
 */
export async function soundCandidates(
  recipe: BrandRecipe,
  format: Format | string,
  candidates: ReadonlyArray<Candidate>,
  opts?: Parameters<typeof measureCandidates>[3] & {
    max?: number;
    /** The slide these candidates were composed from — what the ladder recomposes. */
    input?: ComposeSlideInput;
    /** Test seam for the ladder's last rung; production uses the real composer. */
    recompose?: RepairContext['recompose'];
    /**
     * WHAT THE ROUTE DID TO THE ORIGINALS, DONE TO EVERY REPAIR TOO. The
     * ladder's last rung recomposes from scratch, and the model that put a
     * picture behind the copy the first time will do it again — a repaired
     * candidate came back with the bleed the route had just removed, measured
     * fine (nothing overlaps in the flow), and was offered. Applied to the
     * output of every rung before it is measured.
     */
    normalise?: (html: string) => string;
  },
): Promise<{ kept: Candidate[]; rejected: string[][]; repaired: number }> {
  const cap = (list: Candidate[]) => (opts?.max ? list.slice(0, opts.max) : list);
  const unchecked = () => ({ kept: cap([...candidates]), rejected: [] as string[][], repaired: 0 });
  if (!candidates.length) return { kept: [], rejected: [], repaired: 0 };
  if (!opts?.openProbe && !renderCheckEnabledByDefault()) return unchecked();

  const fmt: Format = isFormat(format) ? format : '1080x1350';
  const slides: CheckSlide[] = candidates.map((c) => {
    const sizes = slotSizesOn(c.html, opts?.slotSizes);
    return {
      html: c.html,
      ...(c.bg ? { bg: c.bg } : {}),
      ...(c.role ?? opts?.role ? { role: c.role ?? opts?.role } : {}),
      ...(opts?.archetype ? { archetype: opts.archetype } : {}),
      ...(Object.keys(sizes).length ? { slotSizes: sizes } : {}),
    };
  });
  const open = opts?.openProbe ?? openRenderProbe;
  let probe: RenderProbe;
  try {
    probe = await withCeiling(open(recipe, fmt, slides), MEASURE_CEILING_MS, 'candidate probe');
  } catch (err) {
    console.warn(`[candidates] renderer unavailable — offering unchecked: ${err instanceof Error ? err.message : String(err)}`);
    return unchecked();
  }
  const faultsOf = (v: LayoutVerdict | undefined, role: string | undefined): string[] =>
    !v || v.state === 'unknown' ? [] : layoutFaults(v, undefined, role).filter(BROKEN);
  const normalise = opts?.normalise ?? ((h: string) => h);
  const recomposeRaw: NonNullable<RepairContext['recompose']> =
    opts?.recompose ??
    (async (input, note) => {
      const { composeSlide } = await import('./compose');
      return (await composeSlide(recipe, input, { note, renderCheck: false })).html;
    });
  const recompose: NonNullable<RepairContext['recompose']> = async (input, note) => normalise(await recomposeRaw(input, note));
  try {
    const verdicts = await withCeiling(
      probe.measure(candidates.map((c, index) => ({ index, html: c.html }))),
      MEASURE_CEILING_MS,
      'candidate measurement',
    );
    const kept: Candidate[] = [];
    const rejected: string[][] = [];
    let repaired = 0;
    for (const [i, c] of candidates.entries()) {
      const role = c.role ?? opts?.role;
      let html = c.html;
      let faults = faultsOf(verdicts[i], role);
      if (faults.length) {
        // Measured in THIS candidate's own position, so the ladder's verdicts
        // are about the frame the person will actually see.
        const measure = async (h: string) => ((await probe.measure([{ index: i, html: h }]))[0] ?? UNKNOWN_VERDICT).state;
        if (faults.includes('overflows') && opts?.input) {
          const r = await repairOverflow(recipe, opts.input, html, fmt, { measure, recompose });
          if (!r.stillOverflows) html = normalise(r.html);
        } else if (hasSmallerHeadlineVariant(recipe) && headlineVariantOf(html) !== 'sm') {
          const smaller = addHeadlineVariant(html, 'sm');
          if (smaller.changed) html = normalise(smaller.html);
        }
        if (html !== c.html) {
          faults = faultsOf((await probe.measure([{ index: i, html }]))[0], role);
          if (!faults.length) repaired += 1;
        }
      }
      if (faults.length) {
        rejected.push(faults);
        continue;
      }
      if (!opts?.max || kept.length < opts.max) kept.push({ ...c, html });
    }
    return { kept, rejected, repaired };
  } catch (err) {
    console.warn(`[candidates] measuring failed — offering unchecked: ${err instanceof Error ? err.message : String(err)}`);
    return unchecked();
  } finally {
    await probe.close().catch(() => {});
  }
}
