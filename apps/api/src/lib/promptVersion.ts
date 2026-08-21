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
   * v4: composition.roles — per-role alignment overrides, mirroring
   * motion.roles; fragments must not hard-pin text-align on structural
   * elements the app's data-align layer would need to move.
   * v5: VARIETY — statement/feature/list want 2–3 pattern arrangements and
   * fragment VARIANT arrays (rotated per slide and per deck), and the list
   * vocabulary gains the app's numbered-rows contract. One skeleton per role
   * made every post a re-skin of the last.
   * v6: THE JOB — posts are a business promoting its content to its audience,
   * and should read like the business thinks (job sheets, verdicts,
   * checklists); component vocabulary gains card / chip / badge / verdict
   * rows / split-with-winner. Calibrated against Telmo's picked references.
   * v7: VERTICAL RHYTHM — spacing authored as grouping (tight lockups,
   * ~2× between units, air around the cta, 3–4 reused spacing steps).
   * v8: the fragments TOOL SCHEMA admits variant arrays. Every fragment was
   * declared `type: 'string'`, and structured output makes the schema
   * authoritative — so v5's demand for 2–3 arrangements per role was
   * unsatisfiable, and three re-authors dutifully returned one skeleton each.
   */
  author: 8,
  /**
   * `CRITIQUE_SYSTEM` in lib/htmlDirector/authorRecipe.ts.
   * v2: also judges composition.align against the brand evidence, and that the
   * authored CSS implements the declared align.
   * v3: shared ENUMS now name composition.roles (per-role align overrides).
   * v4: judges variety — arrangements + fragment variants on the content
   * roles, and a list treatment beyond the quiet marker panel.
   * v5: judges the job register — card / chip / badge / verdict-row / split
   * devices present, so posts can read as the business's own artifacts.
   */
  critique: 5,
  /**
   * `PARSE_SYSTEM` in lib/htmlDirector/compose.ts (idea → slides + copy).
   * v2: the parse step may set per-slide "align" — it is the only model that
   * sees the whole deck, so alignment deviations (a centred cta, a monumental
   * one-liner) are its call; the brand default stays a default, not a law.
   * v3: per-slide "why" — one line of the model's own reasoning for its calls
   * (role, image, align), stored on the slide and shown on the review page. A
   * decision nobody can see is a decision nobody can improve.
   * v4: verdict rows — when the material contrasts a way that works with one
   * that fails, rows carry state 'do'/'dont' instead of burying it in prose.
   */
  parse: 4,
  /**
   * `SLIDE_AUTHOR_INSTRUCTIONS` in lib/htmlDirector/prompt.ts (parts → markup).
   * v2: the spec names THIS slide's alignment (slide deviation → recipe role
   * override → brand default) and the composer is told what a centred slide
   * changes about its judgment — never its markup.
   * v3: full-bleed slides carry NO photo slot — the picture is the background
   * layer, and the slot rules (leave a hole / forced DEFAULT_SLOT) invert on
   * them. Ends the slot-chauvinism that fought the showcase archetype.
   * v4: a row's verdict state travels as class "row do"/"row dont"; the app
   * draws tick/cross and quiets the loser — the composer never writes glyphs.
   */
  compose: 4,
} as const;

/** The AI touchpoints that carry a versioned prompt. */
export type PromptTouchpoint = keyof typeof PROMPT_VERSION;
