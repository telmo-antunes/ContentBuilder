/**
 * PROMPT VERSIONS — one integer per AI touchpoint, bumped by hand whenever that
 * touchpoint's prompt text changes in a way that could move output quality.
 *
 * WHY. Prompts are the highest-leverage, least-observable thing in the product:
 * a two-word edit to the author's system prompt changes every brand generated
 * afterwards, and there was nothing on a stored recipe or in an eval report that
 * said WHICH prompt produced it. A regression six weeks later was unattributable
 * — "recipes got worse" with no way to bisect. Now the version travels with the
 * artefact: `promptVersion` on every authored recipe (see `brandRecipeSchema`),
 * and `meta.promptVersion` on every eval report (see `src/eval/run.ts`).
 *
 * THE RULE. Bump a touchpoint when you change what its prompt ASKS FOR (a new
 * required field, a changed hard rule, a new exemplar shape). Do NOT bump for
 * typos, comment edits, or refactors that leave the rendered prompt identical —
 * a version that changes for no reason is worse than none, because it splits the
 * evidence for a prompt that never moved.
 *
 * Deliberately hand-maintained integers rather than a hash of the prompt string:
 * a hash changes on every whitespace edit and names nothing a human can discuss.
 */
export const PROMPT_VERSION = {
  /**
   * `SYSTEM` + the worked exemplars in lib/htmlDirector/authorRecipe.ts.
   * v2: the author now also emits `fragments` — one worked slide per role, in
   * the brand's own markup with `{{…}}` copy holes (see htmlDirector/fragments.ts).
   * v3: composition.align is an explicit decision read from the brand evidence
   * (center is a real option; all three exemplars are flush-left, which was
   * silently becoming the only answer), and the CSS must implement the align
   * the recipe declares.
   */
  author: 3,
  /**
   * `CRITIQUE_SYSTEM` in lib/htmlDirector/authorRecipe.ts.
   * v2: also judges composition.align against the brand evidence, and that the
   * authored CSS implements the declared align.
   */
  critique: 2,
  /** `PARSE_SYSTEM` in lib/htmlDirector/compose.ts (idea → slides + copy). */
  parse: 1,
  /** `SLIDE_AUTHOR_INSTRUCTIONS` in lib/htmlDirector/prompt.ts (parts → markup). */
  compose: 1,
} as const;

/** The AI touchpoints that carry a versioned prompt. */
export type PromptTouchpoint = keyof typeof PROMPT_VERSION;
