/**
 * WHAT'S OUT OF DATE HERE — the two questions the app actually asks.
 *
 * `updateStatus` in shared is the pure rule ("behind AND a detector fires");
 * this binds it to the two things a person looks at: a brand kit, and a post.
 *
 * Neither ever CHANGES anything. Re-authoring a recipe costs money and moves a
 * design the user approved; re-composing a slide rewrites their words. The API
 * reports; the person decides.
 */
import {
  DETECTOR_LABEL,
  TOUCHPOINT_REGISTRY,
  ensureBrandMark,
  updateStatus,
  type BrandRecipe,
  type DetectorId,
  type TouchpointId,
  type UpdateStatus,
} from '@contentbuilder/shared';
import { brandDetector, postDetector } from './promptDetectors';

/** What a brand's design system is missing, if anything. */
export function brandUpdateStatus(recipe: BrandRecipe | undefined): UpdateStatus | null {
  // A brand with no recipe hasn't been designed yet — there is nothing to be
  // behind ON, and a badge on an empty kit is just noise.
  if (!recipe) return null;
  return updateStatus(recipe.promptVersions as Partial<Record<TouchpointId, number>> | undefined, 'brand', (d) =>
    brandDetector(recipe, d),
  );
}

/** One slide's own verdict, so the review screen can point at the right card. */
export interface SlideUpdateFlag {
  id: string;
  order: number;
  /** Short phrases from DETECTOR_LABEL — enough for a chip on the card. */
  reasons: string[];
  /** The detectors behind those phrases — what a refresh of this slide has to fix. */
  detectors: DetectorId[];
}

/**
 * HOW TO BRING ONE SLIDE UP TO DATE, given what fired on it.
 *
 * The strip used to stop at "a newer prompt would fix this" and point at the
 * whole-deck Recompose, which rewrites seven slides to fix one. A slide can be
 * refreshed alone: its copy is recovered from its own markup, and the CURRENT
 * composer arranges it again. Two detectors are about the words themselves,
 * and only the copywriter can fix words — so those carry a direction for it,
 * written here so the thing that flags and the thing that fixes agree.
 */
export function slideRefreshPlan(detectors: ReadonlyArray<DetectorId>): { direction?: string; balance: boolean } {
  const lines: string[] = [];
  if (detectors.includes('secretList')) {
    lines.push(
      'This slide lists several things inside one paragraph. Keep every fact and the headline exactly; write the items as rows, one item each, and drop the paragraph.',
    );
  }
  if (detectors.includes('emptyList')) {
    lines.push(
      'This slide carries a list card with nothing in it. Keep the headline\'s meaning; either fill the rows with items the copy actually names, or say it as one line with no list.',
    );
  }
  return {
    ...(lines.length ? { direction: lines.join(' ') } : {}),
    // The spacer-at-the-end arrangement is repaired by the same pass that
    // detects it, so the refresh runs it on what the composer hands back.
    balance: detectors.includes('strandedSpacer'),
  };
}

export interface PostUpdateStatus extends UpdateStatus {
  /** Only the slides that actually fire something. */
  slides: SlideUpdateFlag[];
}

type AuthoredSlide = {
  id?: string;
  order?: number;
  authored?: { html?: string; pv?: Record<string, number> };
};

/**
 * What a post would gain from a newer copywriter or composer.
 *
 * A deck is only as new as its OLDEST slide: one slide re-composed last week
 * doesn't make the other six current, so the post-level version per touchpoint
 * is the minimum across slides. The per-slide list is what makes this
 * actionable — "this post is behind" is a shrug, "slide 4 writes a list as a
 * paragraph" is a thing to go and look at.
 */
export function postUpdateStatus(
  slides: AuthoredSlide[],
  recipe: BrandRecipe | undefined,
): PostUpdateStatus | null {
  const authored = slides.filter((s) => s.authored?.html);
  if (!authored.length) return null;

  const oldest: Partial<Record<TouchpointId, number>> = {};
  for (const id of Object.keys(TOUCHPOINT_REGISTRY) as TouchpointId[]) {
    if (TOUCHPOINT_REGISTRY[id].affects !== 'post') continue;
    // An unstamped slide predates versioning, which is version 0 — and being
    // the minimum, one of them drags the whole deck back where it belongs.
    oldest[id] = Math.min(...authored.map((s) => s.authored?.pv?.[id] ?? 0));
  }

  const deck = updateStatus(oldest, 'post', (d) => postDetector(authored, recipe, d));
  if (!deck.flagged) return { ...deck, slides: [] };

  // Which slides earned the flag. Re-run only the detectors that already fired
  // deck-wide, against one slide at a time.
  const fired = [...new Set(deck.findings.map((f) => f.detector))] as DetectorId[];

  /**
   * The brand mark is the one finding a slide cannot reach on its own — a mark
   * is only wrong RELATIVE to the rest of the deck. So the odd slides out are
   * exactly the ones the repair would rewrite, asked of the repair itself:
   * the thing that flags and the thing that fixes cannot drift apart.
   */
  const odd = new Set<number>();
  if (fired.includes('brandMarkDrift')) {
    const htmls = authored.map((s) => s.authored!.html!);
    ensureBrandMark(htmls).htmls.forEach((next, i) => {
      if (next !== htmls[i]) odd.add(i);
    });
  }

  const flagged: SlideUpdateFlag[] = [];
  authored.forEach((s, i) => {
    const detectors = fired.filter((d) =>
      d === 'brandMarkDrift' ? odd.has(i) : postDetector([s], recipe, d).length > 0,
    );
    if (detectors.length) {
      flagged.push({ id: s.id ?? String(i), order: s.order ?? i, reasons: detectors.map((d) => DETECTOR_LABEL[d]), detectors });
    }
  });

  return { ...deck, slides: flagged };
}
