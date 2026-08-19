/**
 * How much empty space a slide may carry before it reads as a hole.
 *
 * Lives in `shared` because two places have to agree about it: the API's layout
 * gate, which decides whether a composed deck is acceptable, and the review
 * page's badge, which tells a person the same thing about a deck they are
 * editing. Two copies of a threshold is two thresholds, and the one nobody
 * remembers to update is the one that starts lying.
 *
 * The numbers are measured — see `maxSlackFor`'s callers and
 * `src/scripts/slackDistribution.ts` in the API, which renders every stored
 * slide and reports the spread by role.
 */

/** Roles that exist to carry information rather than to make an impression. */
export const CONTENT_ROLES: ReadonlySet<string> = new Set(['feature', 'statement', 'list', 'stat']);

/**
 * A display role may be mostly air — that is the form. A slide whose job is to
 * carry content may not: the two worst `feature` slides in the calibration
 * sample, both at 65.5%, are the ones that had to be hand-authored into panels
 * because they said nothing.
 */
export const SLACK_LIMIT = { display: 0.65, content: 0.5 } as const;

/**
 * The largest empty band this role may carry. An unknown role gets the
 * permissive limit: a gate that cries wolf is a gate that gets ignored.
 */
export function maxSlackFor(role: string | undefined): number {
  return role && CONTENT_ROLES.has(role) ? SLACK_LIMIT.content : SLACK_LIMIT.display;
}
