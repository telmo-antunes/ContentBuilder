/**
 * HOW MUCH COPY A SLIDE PART MAY CARRY.
 *
 * Lived in the API's `htmlDirector/compose.ts`, which is where they are spent.
 * They are here because a second thing needs them and cannot reach them there:
 * the fragment gap filler decides whether a candidate hole still FITS, and the
 * fill that decides it is the longest one a copywriter is allowed to write. A
 * worst case measured against numbers that had drifted from these would decline
 * holes that fit and keep holes that do not, so the two share one definition
 * rather than two that agree today.
 */
import type { SlideRole } from './recipe';

export interface ComposeBudgets {
  eyebrow: number;
  headline: number;
  body: number;
  /**
   * What a body may run to on a slide whose job is to EXPLAIN — see
   * {@link EXPLAIN_ROLES}. Always >= `body`.
   */
  explainBody: number;
  cta: number;
  /** One enumeration row's `text`. */
  rowText: number;
}

/** The 4:5 post budgets; other formats scale from these. */
export const BASE_BUDGETS: ComposeBudgets = {
  eyebrow: 26,
  headline: 60,
  body: 90,
  explainBody: 150,
  cta: 24,
  rowText: 42,
};

/**
 * The roles whose job is to EXPLAIN. A cover hooks, a stat lands a number and a
 * quote carries a voice — each wants one short line under it. A `statement` or a
 * `feature` is where a deck makes its actual argument.
 */
export const EXPLAIN_ROLES: ReadonlySet<SlideRole> = new Set<SlideRole>(['statement', 'feature']);
